import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
import {
  agentRuns,
  applicationEvents,
  applications,
  candidateDocuments,
  candidateExperiences,
  candidateProfiles,
  candidateSkills,
  candidateTargetRoles,
  jobMatches,
  jobs,
  platforms,
  platformSkills,
  scanSettings,
  skillFailures,
  skillHealthchecks,
  taskQueue,
} from '@employment-agent/database/schema';
import { and, asc, desc, eq, gte, like, sql } from 'drizzle-orm';
import { parseScanSettingsInput } from './scan-settings.js';
import { API_SOURCES, scanApiSource } from './scan-api-source.js';
import { derivePlatformSlug, onboardPlatform } from './platform-onboarding.js';

/**
 * Text-based tool calling for the agent chat.
 *
 * Providers in this app don't share a native function-calling API, so the
 * model emits `HERRAMIENTA: {"tool": "...", "args": {...}}` as its ENTIRE
 * reply when it needs data or wants to act. The backend executes the tool,
 * feeds the result back as a user message, and asks again (bounded loop).
 */

export const MAX_TOOL_ROUNDS = 3;
const MAX_RESULT_CHARS = 4000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type ParseToolCallResult =
  | { kind: 'none' }
  | { kind: 'call'; call: ToolCall; proseBefore: string }
  | { kind: 'error'; error: string };

const TOOL_PREFIX = 'HERRAMIENTA:';

export const TOOL_NAMES = [
  'get_profile_summary',
  'list_cv_documents',
  'list_jobs',
  'list_applications',
  'list_platforms',
  'list_platform_skills',
  'list_activity',
  'get_errors',
  'trigger_scan',
  'set_auto_scan',
  'add_platform',
] as const;
type ToolName = typeof TOOL_NAMES[number];
type ReadToolName = Extract<ToolName, 'get_profile_summary' | 'list_cv_documents' | 'list_jobs' | 'list_applications' | 'list_platforms' | 'list_platform_skills' | 'list_activity' | 'get_errors'>;
const KNOWN_TOOLS = new Set<string>(TOOL_NAMES);
const READ_TOOLS = new Set<ReadToolName>(TOOL_NAMES.slice(0, 8) as ReadToolName[]);
const READ_ARGS: Record<ReadToolName, Record<string, 'string' | 'number'>> = {
  get_profile_summary: {}, list_cv_documents: { limit: 'number' },
  list_jobs: { platform: 'string', query: 'string', minScore: 'number', limit: 'number' },
  list_applications: { status: 'string', limit: 'number' }, list_platforms: { limit: 'number' },
  list_platform_skills: { limit: 'number' }, list_activity: { limit: 'number' }, get_errors: { limit: 'number' },
};

/**
 * Detect a tool call in the model's reply. The call may be the whole reply or
 * appear after some prose ("Voy a revisar…\n\nHERRAMIENTA: {...}") — models
 * don't always follow the "reply ONLY with the call" instruction. When prose
 * precedes the marker it's returned as `proseBefore` so the caller can keep it.
 * A broken JSON after prose is treated as prose (kind: 'none'), not an error,
 * because the model may be mentioning the mechanism instead of invoking it.
 */
export function parseToolCall(text: string): ParseToolCallResult {
  const idx = text.indexOf(TOOL_PREFIX);
  if (idx < 0) return { kind: 'none' };
  const proseBefore = text.slice(0, idx).trim();

  const jsonPart = text.slice(idx + TOOL_PREFIX.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonPart);
  } catch {
    if (proseBefore !== '') return { kind: 'none' };
    return {
      kind: 'error',
      error: `No pude parsear el JSON de la herramienta. Respondé SOLO con ${TOOL_PREFIX} {"tool": "<nombre>", "args": {...}} y nada más.`,
    };
  }

  const record = parsed as Record<string, unknown> | null;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    if (proseBefore !== '') return { kind: 'none' };
    return { kind: 'error', error: 'El cuerpo de la herramienta debe ser un objeto JSON.' };
  }
  const tool = record.tool;
  if (typeof tool !== 'string' || !KNOWN_TOOLS.has(tool)) {
    if (proseBefore !== '') return { kind: 'none' };
    return {
      kind: 'error',
      error: `Herramienta desconocida: ${String(tool)}. Válidas: ${Array.from(KNOWN_TOOLS).join(', ')}.`,
    };
  }
  const args = record.args;
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    if (proseBefore !== '') return { kind: 'none' };
    return { kind: 'error', error: '"args" debe ser un objeto JSON.' };
  }
  const safeArgs = (args ?? {}) as Record<string, unknown>;
  if (READ_TOOLS.has(tool as ReadToolName)) {
    const shape = READ_ARGS[tool as ReadToolName];
    for (const [key, value] of Object.entries(safeArgs)) {
      if (!shape[key] || typeof value !== shape[key] || (typeof value === 'number' && (!Number.isFinite(value) || (key === 'limit' && value <= 0) || (key === 'minScore' && (value < 0 || value > 100)))) || (typeof value === 'string' && value.length > 100)) {
        return { kind: 'error', error: `Argumentos inválidos para ${tool}. Permitidos: ${Object.entries(shape).map(([k, v]) => `${k}:${v}`).join(', ') || 'ninguno'}.` };
      }
    }
    if (tool === 'list_applications' && typeof safeArgs.status === 'string' && !['draft', 'ready', 'submitted', 'failed', 'rejected'].includes(safeArgs.status)) {
      return { kind: 'error', error: 'Estado de postulación inválido.' };
    }
  }
  return { kind: 'call', call: { tool, args: safeArgs }, proseBefore };
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

const SENSITIVE_KEY = /^(?:password|token|api[-_]?key|secret|authorization)$/i;
function safeString(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}(?:(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return value.slice(0, 40);
  return value.replace(/https?:\/\/[^\s<>"']+/gi, (raw) => { try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return '[redacted URL]'; } })
    .replace(/<[^>]*>/g, ' ').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted email]').replace(/\+?\d(?:[\s().-]*\d){7,}/g, '[redacted phone]')
    .replace(/\b(?:sk-[\w-]{6,}|gh[pousr]_[A-Za-z\d]{20,}|github_pat_[\w]{20,}|Bearer\s+\S+|eyJ[A-Za-z\d_-]*\.[A-Za-z\d_-]+\.[A-Za-z\d_-]+)\b/gi, '[redacted credential]')
    .replace(/["']?(?:password|token|api[-_]?key|secret|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '"[redacted key]":"[redacted]"')
    .replace(/\bat\s+(?:(?:async|new)\s+)?(?:[\w$.<>]+\s*\([^)]*:\d+:\d+\)|(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/)[^\s)]+:\d+:\d+\)?)/gi, '[redacted stack]').replace(/(^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+\\)[^\s"']+/g, '$1[redacted path]')
    .replace(/(^|[\s("'=])\/(?:home|Users|opt|srv|var|etc|tmp)\/[^\s"')]+/gi, '$1[redacted path]').replace(/\b[a-f\d]{32,}\b/gi, '[redacted hash]')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}
function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[redacted]';
  if (typeof value === 'string') return safeString(value);
  if (Array.isArray(value)) return value.slice(0, MAX_LIMIT).map((item) => safeValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(new Map(Object.entries(value).slice(0, 30).map(([key, item]) => {
    const sensitive = SENSITIVE_KEY.test(key); return [sensitive ? '[redacted key]' : safeString(key), sensitive ? '[redacted]' : safeValue(item, depth + 1)];
  })));
  return value;
}

export function coarseLocation(value: string | null): string | null {
  if (!value) return null;
  const parts = value.replace(/\(?[-+]?\d{1,3}\.\d+\s*,\s*[-+]?\d{1,3}\.\d+\)?/g, '').split(',').map((part) => part.trim()).filter(Boolean);
  const address = /\d|\b(?:street|st\.?|road|rd\.?|avenida|av\.?|calle|pasaje|pje\.?|ruta|apartment|apt\.?)\b|#/i;
  while (parts.length > 2 && address.test(parts[0]!)) parts.shift();
  return parts.length === 0 || (parts.length === 1 && address.test(parts[0]!)) ? null : parts.slice(-3).join(', ');
}

export function formatReadResult(tool: ReadToolName, data: unknown[], requestedLimit?: unknown): string {
  const limit = clampLimit(requestedLimit);
  const sanitized = safeValue(data.slice(0, limit)) as unknown[];
  const items: unknown[] = [];
  for (const item of sanitized) {
    if (JSON.stringify({ tool, count: items.length + 1, limit, truncated: true, items: [...items, item] }).length > MAX_RESULT_CHARS) break;
    items.push(item);
  }
  return JSON.stringify({ tool, count: items.length, limit, truncated: items.length < sanitized.length, items });
}

async function getProfileId(): Promise<number | null> {
  const rows = await db.select({ id: candidateProfiles.id }).from(candidateProfiles).orderBy(desc(candidateProfiles.id)).limit(1);
  return rows[0]?.id ?? null;
}

async function toolGetProfileSummary(): Promise<unknown[]> {
  const profile = (await db.select({ id: candidateProfiles.id, summary: candidateProfiles.summary, location: candidateProfiles.location, searchScope: candidateProfiles.searchScope }).from(candidateProfiles).orderBy(desc(candidateProfiles.id)).limit(1))[0];
  if (!profile) return [];
  const [experiences, skills, roles] = await Promise.all([
    db.select({ role: candidateExperiences.role, company: candidateExperiences.company, startDate: candidateExperiences.startDate, endDate: candidateExperiences.endDate, summary: candidateExperiences.description }).from(candidateExperiences).where(eq(candidateExperiences.profileId, profile.id)).orderBy(desc(candidateExperiences.createdAt), desc(candidateExperiences.id)).limit(20),
    db.select({ name: candidateSkills.name }).from(candidateSkills).where(eq(candidateSkills.profileId, profile.id)).orderBy(asc(candidateSkills.name), asc(candidateSkills.id)).limit(50),
    db.select({ role: candidateTargetRoles.roleTitle, priority: candidateTargetRoles.priority }).from(candidateTargetRoles).where(and(eq(candidateTargetRoles.profileId, profile.id), eq(candidateTargetRoles.isActive, 1))).orderBy(asc(candidateTargetRoles.priority), asc(candidateTargetRoles.id)).limit(20),
  ]);
  return [{ summary: profile.summary, location: coarseLocation(profile.location), searchScope: profile.searchScope, targetRoles: roles, experiences, skills: skills.map((s) => s.name) }];
}

async function toolListCvDocuments(args: Record<string, unknown>): Promise<unknown[]> {
  const profile = (await db.select({ id: candidateProfiles.id, activeDocumentId: candidateProfiles.supersededByDocumentId }).from(candidateProfiles).orderBy(desc(candidateProfiles.id)).limit(1))[0];
  if (!profile) return [];
  const rows = await db.select({ kind: candidateDocuments.kind, mimeType: candidateDocuments.mimeType, uploadedAt: candidateDocuments.createdAt, id: candidateDocuments.id }).from(candidateDocuments)
    .where(eq(candidateDocuments.profileId, profile.id)).orderBy(desc(candidateDocuments.createdAt), desc(candidateDocuments.id)).limit(clampLimit(args.limit));
  return rows.map(({ id, ...row }) => ({ displayName: row.kind.replaceAll('_', ' '), type: row.mimeType ?? row.kind, uploadedAt: row.uploadedAt, status: id === profile.activeDocumentId ? 'active' : 'stored' }));
}

async function toolListJobs(args: Record<string, unknown>): Promise<unknown[]> {
  const profileId = await getProfileId();
  if (profileId === null) return [];
  const limit = clampLimit(args.limit);
  const conditions = [];
  if (typeof args.platform === 'string' && args.platform.trim() !== '') {
    conditions.push(eq(platforms.slug, args.platform.trim()));
  }
  if (typeof args.query === 'string' && args.query.trim() !== '') {
    conditions.push(like(jobs.title, `%${args.query.trim()}%`));
  }
  if (typeof args.minScore === 'number' && Number.isFinite(args.minScore)) {
    conditions.push(gte(jobMatches.score, args.minScore));
  }

  const base = db
    .select({
      title: jobs.title, company: jobs.company, location: jobs.location, platform: platforms.displayName,
      score: jobMatches.score, seenAt: jobs.firstSeenAt,
    })
    .from(jobs)
    .innerJoin(platforms, eq(jobs.platformId, platforms.id));

  const withMatch = base.leftJoin(jobMatches, and(eq(jobMatches.jobId, jobs.id), eq(jobMatches.profileId, profileId)));

  const rows = await withMatch
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(jobMatches.score), desc(jobs.firstSeenAt), desc(jobs.id))
    .limit(limit);

  return rows.map((r) => ({ ...r, score: r.score === null ? null : Math.round(r.score), status: r.score === null ? 'recent' : 'matched' }));
}

async function toolListApplications(args: Record<string, unknown>): Promise<unknown[]> {
  const profileId = await getProfileId();
  if (profileId === null) return [];
  const conditions = [];
  if (typeof args.status === 'string' && args.status.trim() !== '') {
    conditions.push(eq(applications.status, args.status.trim() as 'draft'));
  }
  const rows = await db
    .select({
      title: jobs.title, company: jobs.company, platform: platforms.displayName, status: applications.status,
      preparedAt: applications.preparedAt, submittedAt: applications.submittedAt, createdAt: applications.createdAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(platforms, eq(jobs.platformId, platforms.id))
    .where(and(eq(applications.profileId, profileId), ...conditions))
    .orderBy(desc(applications.createdAt), desc(applications.id))
    .limit(clampLimit(args.limit));
  return rows;
}

async function toolListPlatforms(args: Record<string, unknown>): Promise<unknown[]> {
  if (await getProfileId() === null) return [];
  const rows = await db
    .select({
      id: platforms.id, slug: platforms.slug, name: platforms.displayName, status: platforms.status,
    })
    .from(platforms)
    .orderBy(platforms.slug).limit(clampLimit(args.limit));

  const counts = await db
    .select({
      platformId: jobs.platformId,
      n: sql<number>`count(*)`,
      ultimaOferta: sql<string | null>`max(last_seen_at)`,
    })
    .from(jobs)
    .groupBy(jobs.platformId);
  const byPlatform = new Map(counts.map((c) => [c.platformId, c]));

  return rows.map(({ id, ...r }) => ({ ...r, capability: 'job-search', jobs: Number(byPlatform.get(id)?.n ?? 0), lastScanAt: byPlatform.get(id)?.ultimaOferta ?? null }));
}

async function currentScanConfig(): Promise<{ cadaMinutos: number; activa: boolean }> {
  const scanRows = await db.select().from(scanSettings).limit(1);
  const scan = scanRows[0];
  return scan
    ? { cadaMinutos: scan.scanIntervalMinutes, activa: scan.autoScanEnabled === 1 }
    : { cadaMinutos: 30, activa: true };
}

async function toolListPlatformSkills(args: Record<string, unknown>): Promise<unknown[]> {
  if (await getProfileId() === null) return [];
  const rows = await db.select({ name: platformSkills.skillSlug, platform: platforms.slug, platformName: platforms.displayName, lastSuccessAt: platformSkills.lastSuccessAt, consecutiveFailures: platformSkills.consecutiveFailures })
    .from(platformSkills).leftJoin(platforms, eq(platforms.id, platformSkills.platformId)).orderBy(asc(platformSkills.skillSlug), asc(platformSkills.id)).limit(clampLimit(args.limit));
  return Promise.all(rows.map(async (row) => {
    const health = (await db.select({ status: skillHealthchecks.status, checkedAt: skillHealthchecks.checkedAt }).from(skillHealthchecks)
      .where(eq(skillHealthchecks.skillSlug, row.name)).orderBy(desc(skillHealthchecks.checkedAt), desc(skillHealthchecks.id)).limit(1))[0];
    return { ...row, capabilities: ['scan_jobs'], health: health?.status ?? 'unknown', healthCheckedAt: health?.checkedAt ?? null };
  }));
}

async function toolListActivity(args: Record<string, unknown>): Promise<unknown[]> {
  if (await getProfileId() === null) return [];
  const rows = await db.select({ type: applicationEvents.kind, message: applicationEvents.message, timestamp: applicationEvents.occurredAt })
    .from(applicationEvents).orderBy(desc(applicationEvents.id)).limit(clampLimit(args.limit));
  return rows;
}

async function toolGetErrors(args: Record<string, unknown>): Promise<unknown[]> {
  if (await getProfileId() === null) return [];
  const limit = clampLimit(args.limit);
  const [failedRuns, failures, unhealthy] = await Promise.all([
    db
      .select({ kind: agentRuns.kind, resumen: agentRuns.summary, cuando: agentRuns.startedAt })
      .from(agentRuns)
      .where(eq(agentRuns.status, 'failed'))
      .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
      .limit(limit),
    db
      .select({
        skill: skillFailures.skillSlug,
        codigo: skillFailures.errorCode,
        mensaje: skillFailures.errorMessage, cuando: skillFailures.occurredAt,
        reparado: skillFailures.repairedAt, reparacion: skillFailures.repairStrategy,
      })
      .from(skillFailures)
      .orderBy(desc(skillFailures.occurredAt), desc(skillFailures.id))
      .limit(limit),
    db
      .select({
        skill: skillHealthchecks.skillSlug,
        estado: skillHealthchecks.status,
        cuando: skillHealthchecks.checkedAt,
      })
      .from(skillHealthchecks)
      .where(sql`${skillHealthchecks.status} != 'healthy'`)
      .orderBy(desc(skillHealthchecks.checkedAt), desc(skillHealthchecks.id))
      .limit(limit),
  ]);

  return [
    ...failedRuns.map((r) => ({ type: 'agent_run', ...r })),
    ...failures.map((r) => ({ type: 'skill_failure', ...r })),
    ...unhealthy.map((r) => ({ type: 'health', ...r })),
  ].sort((a, b) => String(b.cuando).localeCompare(String(a.cuando))).slice(0, limit);
}

/** Derive a URL-safe slug from a platform URL: "https://www.chiletrabajos.cl/empleos" → "chiletrabajos", "https://cl.indeed.com" → "indeed". */
export function deriveSlug(url: string): string | null {
  try { return derivePlatformSlug(url); } catch { return null; }
}

async function toolAddPlatform(args: Record<string, unknown>, approvedOrigins: ReadonlySet<string>): Promise<string> {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (name === '') return 'Error: falta el nombre de la plataforma (args.name).';
  const result = await onboardPlatform({ name, url: url || undefined, slug: typeof args.slug === 'string' ? args.slug : undefined, scanExisting: args.scan === true }, approvedOrigins);
  if (!result.created) return `La plataforma ya existe: ${result.platform.displayName} (${result.platform.slug}).${result.taskId ? ' Encolé un nuevo escaneo solicitado.' : ''}`;
  return `Plataforma "${name}" (${result.platform.slug}) agregada y activa. Encolé al agente navegador para buscar ofertas.`;
}

async function toolTriggerScan(args: Record<string, unknown>): Promise<string> {
  const slug = typeof args.platform === 'string' ? args.platform.trim() : '';
  const wantAgent = args.agent === true;
  const taskId = randomUUID();

  if (slug !== '') {
    const found = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
    if (found.length === 0) {
      return `Error: la plataforma "${slug}" no existe. Pedí list_platforms para ver las disponibles o add_platform para agregarla.`;
    }
    const platform = found[0]!;

    // API-based sources (GetOnboard, Arbeitnow) are scanned inline from the
    // web server — the worker has no skill for them.
    if (API_SOURCES.has(slug) && !wantAgent) {
      try {
        const { jobsFound, jobsNew } = await scanApiSource(slug);
        return `Scan de ${platform.displayName} completado ahora (API directa): ${jobsFound} ofertas encontradas, ${jobsNew} nuevas. Puntualmente se puntúan en el próximo ciclo del worker.`;
      } catch (err) {
        return `Error escaneando ${platform.displayName}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    // Platforms with an installed skill use the deterministic scraper unless
    // the caller explicitly wants the LLM browser agent. Platforms WITHOUT a
    // skill can only be scanned by the browser agent.
    const skillRows = await db
      .select({ id: platformSkills.id })
      .from(platformSkills)
      .where(eq(platformSkills.platformId, platform.id))
      .limit(1);
    const hasSkill = skillRows.length > 0;

    if (wantAgent || !hasSkill) {
      if (!platform.baseUrl) {
        return `Error: ${platform.displayName} no tiene URL registrada ni skill instalada — no hay forma de escanearla.`;
      }
      const { enqueuePlatformScan } = await import('./platform-onboarding.js');
      const agentTaskId = await enqueuePlatformScan({ slug, url: platform.baseUrl }, 'chat');
      if (!agentTaskId) return `Ya existe un escaneo activo para ${platform.displayName}.`;
      return `Agente navegador encolado para ${platform.displayName} (tarea ${agentTaskId}). El LLM abre un navegador visible y busca ofertas según tu perfil; si aparece un CAPTCHA podés resolverlo a mano.`;
    }

    const { enqueuePlatformScan } = await import('./platform-onboarding.js');
    const scanTaskId = await enqueuePlatformScan({ slug }, 'chat', 'SCAN_PLATFORM');
    return scanTaskId
      ? `Scan de ${platform.displayName} encolado (tarea ${scanTaskId}). El worker la procesa en segundos y puntúa las ofertas nuevas automáticamente.`
      : `Ya existe un escaneo activo para ${platform.displayName}.`;
  }

  await db.insert(taskQueue).values({
    id: taskId,
    type: 'SCAN_ACTIVE_PLATFORMS',
    payloadJson: JSON.stringify({ triggeredBy: 'chat' }),
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    scheduledAt: new Date().toISOString(),
  });
  return `Scan de TODAS las plataformas con skill encolado (tarea ${taskId}). El worker lo procesa en segundos. Las plataformas agregadas sin skill se escanean bajo demanda: pedime "escaneá <nombre> con el agente".`;
}

async function toolSetAutoScan(args: Record<string, unknown>): Promise<string> {
  const current = (await db.select().from(scanSettings).limit(1))[0];
  const intervalMinutes = typeof args.intervalMinutes === 'number'
    ? args.intervalMinutes
    : current?.scanIntervalMinutes ?? 30;
  const autoScanEnabled = typeof args.enabled === 'boolean'
    ? args.enabled
    : current ? current.autoScanEnabled === 1 : true;

  const parsed = parseScanSettingsInput({ intervalMinutes, autoScanEnabled });
  if (!parsed.ok) return `Error: ${parsed.error}`;

  const updatedAt = new Date().toISOString();
  await db.insert(scanSettings).values({
    id: 1,
    scanIntervalMinutes: parsed.value.intervalMinutes,
    autoScanEnabled: parsed.value.autoScanEnabled ? 1 : 0,
    updatedAt,
  }).onConflictDoUpdate({
    target: scanSettings.id,
    set: {
      scanIntervalMinutes: parsed.value.intervalMinutes,
      autoScanEnabled: parsed.value.autoScanEnabled ? 1 : 0,
      updatedAt,
    },
  });

  return parsed.value.autoScanEnabled
    ? `Búsqueda automática configurada: cada ${parsed.value.intervalMinutes} minutos. El worker toma el cambio solo, sin reiniciar.`
    : 'Búsqueda automática DESACTIVADA. Los scans manuales (trigger_scan) siguen disponibles.';
}

type ReadSource = (args: Record<string, unknown>) => Promise<unknown[]>;

/** Execute a parsed tool call against explicit local services. Never throws. */
export async function executeTool(call: ToolCall, context: { approvedOrigins?: ReadonlySet<string>; readSources?: Partial<Record<ReadToolName, ReadSource>> } = {}): Promise<string> {
  try {
    if (READ_TOOLS.has(call.tool as ReadToolName)) {
      const tool = call.tool as ReadToolName;
      const source = context.readSources?.[tool];
      const data = source ? await source(call.args) : await ({
        get_profile_summary: toolGetProfileSummary,
        list_cv_documents: toolListCvDocuments,
        list_jobs: toolListJobs,
        list_applications: toolListApplications,
        list_platforms: toolListPlatforms,
        list_platform_skills: toolListPlatformSkills,
        list_activity: toolListActivity,
        get_errors: toolGetErrors,
      } satisfies Record<ReadToolName, ReadSource>)[tool](call.args);
      return formatReadResult(tool, data, call.args.limit);
    }
    switch (call.tool) {
      case 'trigger_scan': return await toolTriggerScan(call.args);
      case 'set_auto_scan': return await toolSetAutoScan(call.args);
      case 'add_platform': return await toolAddPlatform(call.args, context.approvedOrigins ?? new Set());
      default: return `Error: herramienta desconocida "${call.tool}".`;
    }
  } catch (err) {
    return `Error ejecutando ${call.tool}.`;
  }
}

/**
 * Prompt block injected into the system prompt so the model knows which
 * tools exist and how to call them.
 */
export const TOOLS_PROMPT = `## Herramientas del agente (datos en vivo de la app)

Tenés acceso seguro y de solo lectura al perfil resumido, CVs, ofertas, postulaciones, plataformas, skills, actividad y errores. Cuando necesites datos o ejecutar una acción explícita, respondé ÚNICAMENTE con una línea HERRAMIENTA: seguida de un JSON, sin texto antes ni después:

HERRAMIENTA: {"tool": "<nombre>", "args": {...}}

Herramientas disponibles:

- get_profile_summary — Resumen, ubicación/alcance, cargos objetivo, experiencia y skills del candidato. Usala para consejos basados en el perfil; no devuelve contacto ni CV crudo.

- list_cv_documents — Metadatos seguros de CVs cargados (tipo, fecha y estado), nunca contenido o rutas. args opcionales: limit.

- list_jobs — Lista ofertas reales scrapeadas, ordenadas por fit con tu perfil.
  args opcionales: platform (slug, ej "computrabajo"), query (texto en el título), minScore (número), limit (máx 50, default 10).
  Usala para: "revisá las ofertas", "qué hay de mantención", "las mejores puntuadas", "cuál tiene mejor sueldo" (el sueldo aparece solo si la descripción lo publica).

- list_applications — Estado de las postulaciones (draft, ready, submitted, failed, rejected).
  args opcionales: status, limit.

- list_platforms — Plataformas conectadas, capacidad, estado, cantidad de ofertas y último escaneo. args opcionales: limit.

- list_platform_skills — Skills determinísticas instaladas, plataforma, capacidades y salud. Usala para saber qué conectores están operativos; no devuelve código, rutas ni entorno. args opcionales: limit.

- list_activity — Eventos recientes del agente en orden determinístico. Usala para explicar qué hizo recientemente; no inicia acciones ni reproduce el stream. args opcionales: limit.

- get_errors — Corridas fallidas del agente, fallos de skills de scraping y healthchecks con problemas.
  args opcionales: limit.

- trigger_scan — Encola un escaneo AHORA. Sin args escanea todas las plataformas con skill; con {"platform": "slug"} solo esa. Con {"platform": "slug", "agent": true} usa al agente navegador (el LLM abre un navegador y busca manualmente — más lento pero funciona en sitios con bloqueo o sin skill). Las plataformas sin skill SIEMPRE usan el agente.
  Usala para: "buscá ofertas ahora", "actualizá computrabajo", "activá el agente para que busque en indeed".

- add_platform — Da de alta una plataforma de empleo nueva y encola al agente navegador para buscar ofertas ahí de inmediato.
  args: name (nombre visible), url (https://…) salvo portales preaprobados, slug opcional.
  Usala para: "agregá chiletrabajos", "sumá el portal de empleos del Mercurio".
  Vos conocés portales de empleo de Chile y el mundo: si el usuario pide más fuentes, proponé 3-5 portales concretos con su URL y, cuando confirme, agregalos con esta herramienta. NO inventes URLs que no conocés con certeza.

- set_auto_scan — Configura la búsqueda automática periódica.
  args: intervalMinutes (5 a 10080) y/o enabled (true/false).
  Usala para: "activá las revisiones de oferta cada hora", "desactivá la búsqueda automática".

Reglas de las herramientas:
- Si la pregunta necesita datos que no tenés en el contexto, USÁ la herramienta en vez de inventar o decir que no podés.
- REGLA DE ORO — HONESTIDAD CON DATOS: JAMÁS inventes ofertas, empresas, sueldos, puntajes ni estados. Todo dato concreto tiene que venir del resultado de una herramienta. Si la herramienta devuelve 0 resultados o dice "No hay", reportás exactamente eso y ofrecés escanear. Una respuesta honesta de "no hay nada" vale mil veces más que una lista inventada.
- Después de llamar una herramienta recibís el resultado y respondés al usuario en prosa normal, interpretando los datos.
- Si el usuario pide una ACCIÓN (escanear, activar, desactivar), ejecutala con la herramienta y después confirmale qué hiciste.
- NUNCA muestres el JSON crudo del resultado al usuario: resumilo en lenguaje natural.
- Todas las lecturas son acotadas y redactadas. No pidas archivos, SQL, shell, navegador ni payloads internos.
- Si una acción es destructiva o ambigua (ej: desactivar algo), confirmala solo si el usuario lo pidió claramente; si no, preguntá primero.`;
