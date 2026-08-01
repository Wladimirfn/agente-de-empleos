import { randomUUID } from 'node:crypto';
import { db } from '@employment-agent/database';
import {
  agentRuns,
  applications,
  candidateProfiles,
  jobMatches,
  jobs,
  platforms,
  platformSkills,
  scanSettings,
  skillFailures,
  skillHealthchecks,
  taskQueue,
} from '@employment-agent/database/schema';
import { and, desc, eq, gte, like, sql } from 'drizzle-orm';
import { parseScanSettingsInput } from './scan-settings.js';
import { API_SOURCES, scanApiSource } from './scan-api-source.js';

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
const MAX_LIMIT = 25;

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export type ParseToolCallResult =
  | { kind: 'none' }
  | { kind: 'call'; call: ToolCall; proseBefore: string }
  | { kind: 'error'; error: string };

const TOOL_PREFIX = 'HERRAMIENTA:';

const KNOWN_TOOLS = new Set([
  'list_jobs',
  'list_applications',
  'list_platforms',
  'get_errors',
  'trigger_scan',
  'set_auto_scan',
  'add_platform',
]);

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
  return { kind: 'call', call: { tool, args: (args ?? {}) as Record<string, unknown> }, proseBefore };
}

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… [truncado]` : text;
}

async function getProfileId(): Promise<number | null> {
  const rows = await db.select({ id: candidateProfiles.id }).from(candidateProfiles).limit(1);
  return rows[0]?.id ?? null;
}

async function toolListJobs(args: Record<string, unknown>): Promise<string> {
  const profileId = await getProfileId();
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
      id: jobs.id,
      titulo: jobs.title,
      empresa: jobs.company,
      ubicacion: jobs.location,
      url: jobs.url,
      plataforma: platforms.displayName,
      puntaje: profileId !== null ? jobMatches.score : sql<number | null>`null`,
      publicada: jobs.firstSeenAt,
      descripcion: jobs.description,
    })
    .from(jobs)
    .innerJoin(platforms, eq(jobs.platformId, platforms.id));

  const withMatch = profileId !== null
    ? base.leftJoin(jobMatches, and(eq(jobMatches.jobId, jobs.id), eq(jobMatches.profileId, profileId)))
    : base;

  const rows = await withMatch
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(jobMatches.score), desc(jobs.firstSeenAt))
    .limit(limit);

  if (rows.length === 0) {
    return 'RESULTADO: 0 ofertas que cumplen esos filtros. INSTRUCCIÓN OBLIGATORIA: no inventes ofertas, empresas ni puntajes — decile al usuario que no hay resultados y ofrecé escanear la plataforma con trigger_scan para traer nuevas.';
  }

  const total = await db.select({ count: sql<number>`count(*)` }).from(jobs);
  const payload = {
    totalOfertasEnBase: total[0]?.count ?? rows.length,
    mostrando: rows.length,
    ofertas: rows.map((r) => ({
      ...r,
      puntaje: r.puntaje !== null ? Math.round(r.puntaje) : null,
      descripcion: r.descripcion
        ? r.descripcion.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
        : null,
    })),
    nota: 'El puntaje (0-100) es el fit con tu perfil calculado por el LLM. El sueldo solo aparece si la plataforma lo publica en la descripción.',
  };
  return truncate(JSON.stringify(payload, null, 1));
}

async function toolListApplications(args: Record<string, unknown>): Promise<string> {
  const conditions = [];
  if (typeof args.status === 'string' && args.status.trim() !== '') {
    conditions.push(eq(applications.status, args.status.trim() as 'draft'));
  }
  const rows = await db
    .select({
      titulo: jobs.title,
      empresa: jobs.company,
      plataforma: platforms.displayName,
      estado: applications.status,
      preparada: applications.preparedAt,
      enviada: applications.submittedAt,
      creada: applications.createdAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(platforms, eq(jobs.platformId, platforms.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(applications.createdAt))
    .limit(clampLimit(args.limit) || 20);

  if (rows.length === 0) return 'Todavía no hay postulaciones registradas.';
  return truncate(JSON.stringify({ postulaciones: rows }, null, 1));
}

async function toolListPlatforms(): Promise<string> {
  const rows = await db
    .select({
      id: platforms.id,
      slug: platforms.slug,
      nombre: platforms.displayName,
      estado: platforms.status,
    })
    .from(platforms)
    .orderBy(platforms.slug);

  const counts = await db
    .select({
      platformId: jobs.platformId,
      n: sql<number>`count(*)`,
      ultimaOferta: sql<string | null>`max(last_seen_at)`,
    })
    .from(jobs)
    .groupBy(jobs.platformId);
  const byPlatform = new Map(counts.map((c) => [c.platformId, c]));

  const payload = {
    busquedaAutomatica: await currentScanConfig(),
    plataformas: rows.map((r) => {
      const c = byPlatform.get(r.id);
      return {
        slug: r.slug,
        nombre: r.nombre,
        estado: r.estado,
        ofertas: Number(c?.n ?? 0),
        ultimaOferta: c?.ultimaOferta ?? null,
      };
    }),
  };
  return truncate(JSON.stringify(payload, null, 1));
}

async function currentScanConfig(): Promise<{ cadaMinutos: number; activa: boolean }> {
  const scanRows = await db.select().from(scanSettings).limit(1);
  const scan = scanRows[0];
  return scan
    ? { cadaMinutos: scan.scanIntervalMinutes, activa: scan.autoScanEnabled === 1 }
    : { cadaMinutos: 30, activa: true };
}

async function toolGetErrors(args: Record<string, unknown>): Promise<string> {
  const limit = clampLimit(args.limit);
  const [failedRuns, failures, unhealthy] = await Promise.all([
    db
      .select({ kind: agentRuns.kind, resumen: agentRuns.summary, cuando: agentRuns.startedAt })
      .from(agentRuns)
      .where(eq(agentRuns.status, 'failed'))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit),
    db
      .select({
        skill: skillFailures.skillSlug,
        codigo: skillFailures.errorCode,
        mensaje: skillFailures.errorMessage,
        cuando: skillFailures.occurredAt,
      })
      .from(skillFailures)
      .orderBy(desc(skillFailures.occurredAt))
      .limit(limit),
    db
      .select({
        skill: skillHealthchecks.skillSlug,
        estado: skillHealthchecks.status,
        cuando: skillHealthchecks.checkedAt,
      })
      .from(skillHealthchecks)
      .where(sql`${skillHealthchecks.status} != 'healthy'`)
      .orderBy(desc(skillHealthchecks.checkedAt))
      .limit(limit),
  ]);

  if (failedRuns.length === 0 && failures.length === 0 && unhealthy.length === 0) {
    return 'No hay errores recientes registrados: ni corridas fallidas, ni fallos de skills, ni healthchecks con problemas.';
  }
  return truncate(JSON.stringify({
    corridasFallidas: failedRuns,
    fallosDeSkills: failures,
    skillsConProblemas: unhealthy,
  }, null, 1));
}

/** Derive a URL-safe slug from a platform URL: "https://www.chiletrabajos.cl/empleos" → "chiletrabajos", "https://cl.indeed.com" → "indeed". */
export function deriveSlug(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = host.replace(/^www\./, '').split('.');
  // Country subdomains (cl.indeed.com, ar.linkedin.com) — the brand is the
  // second label, not the 2-letter country code.
  const candidate = labels.length >= 3 && labels[0].length <= 2 ? labels[1] : labels[0];
  const slug = (candidate ?? '').replace(/[^a-z0-9-]/g, '');
  return slug.length >= 2 ? slug : null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function enqueueBrowserAgentScan(slug: string, platformUrl: string): Promise<string> {
  const taskId = randomUUID();
  await db.insert(taskQueue).values({
    id: taskId,
    type: 'BROWSER_AGENT_SCAN',
    payloadJson: JSON.stringify({ skillSlug: slug, platformUrl, triggeredBy: 'chat' }),
    status: 'pending',
    attempts: 0,
    maxAttempts: 1, // browser agent is expensive — one shot
    scheduledAt: new Date().toISOString(),
  });
  return taskId;
}

async function toolAddPlatform(args: Record<string, unknown>): Promise<string> {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (name === '') return 'Error: falta el nombre de la plataforma (args.name).';
  if (url === '' || !isValidHttpUrl(url)) {
    return `Error: URL inválida "${url}". Tiene que ser http(s), ej: https://www.chiletrabajos.cl`;
  }

  const slug = typeof args.slug === 'string' && args.slug.trim() !== ''
    ? args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    : deriveSlug(url);
  if (!slug) return 'Error: no pude derivar un slug de esa URL. Pasá args.slug explícito.';

  // Duplicate check: by slug or by host.
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const existing = await db.select().from(platforms);
  const dupe = existing.find((p) =>
    p.slug === slug ||
    (p.baseUrl !== null && new URL(p.baseUrl).hostname.toLowerCase().replace(/^www\./, '') === host));
  if (dupe) {
    return `La plataforma ya existe: ${dupe.displayName} (${dupe.slug}). Podés escanearla con trigger_scan.`;
  }

  await db.insert(platforms).values({
    slug,
    displayName: name,
    baseUrl: url,
    status: 'active',
  });

  const taskId = await enqueueBrowserAgentScan(slug, url);
  return `Plataforma "${name}" (${slug}) agregada y activa. Encolé al agente navegador para buscar ofertas ahí ahora (tarea ${taskId}): el LLM abre un navegador, busca según tu perfil y guarda lo que encuentre. Ojo: como no tiene skill determinística, los scans de esta plataforma son bajo demanda (pedimelos por chat o desde Plataformas), no entran al ciclo automático.`;
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
    const platform = found[0];

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
      const agentTaskId = await enqueueBrowserAgentScan(slug, platform.baseUrl);
      return `Agente navegador encolado para ${platform.displayName} (tarea ${agentTaskId}). El LLM abre un navegador visible y busca ofertas según tu perfil; si aparece un CAPTCHA podés resolverlo a mano.`;
    }

    await db.insert(taskQueue).values({
      id: taskId,
      type: 'SCAN_PLATFORM',
      payloadJson: JSON.stringify({ skillSlug: slug, triggeredBy: 'chat' }),
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date().toISOString(),
    });
    return `Scan de ${platform.displayName} encolado (tarea ${taskId}). El worker la procesa en segundos y puntúa las ofertas nuevas automáticamente.`;
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

/** Execute a parsed tool call against the local database. Never throws. */
export async function executeTool(call: ToolCall): Promise<string> {
  try {
    switch (call.tool) {
      case 'list_jobs': return await toolListJobs(call.args);
      case 'list_applications': return await toolListApplications(call.args);
      case 'list_platforms': return await toolListPlatforms();
      case 'get_errors': return await toolGetErrors(call.args);
      case 'trigger_scan': return await toolTriggerScan(call.args);
      case 'set_auto_scan': return await toolSetAutoScan(call.args);
      case 'add_platform': return await toolAddPlatform(call.args);
      default: return `Error: herramienta desconocida "${call.tool}".`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Error ejecutando ${call.tool}: ${message}`;
  }
}

/**
 * Prompt block injected into the system prompt so the model knows which
 * tools exist and how to call them.
 */
export const TOOLS_PROMPT = `## Herramientas del agente (datos en vivo de la app)

Tenés acceso a los datos reales de la app: ofertas, postulaciones, plataformas y errores. Cuando necesites datos o ejecutar una acción, respondé ÚNICAMENTE con una línea HERRAMIENTA: seguida de un JSON, sin texto antes ni después:

HERRAMIENTA: {"tool": "<nombre>", "args": {...}}

Herramientas disponibles:

- list_jobs — Lista ofertas reales scrapeadas, ordenadas por fit con tu perfil.
  args opcionales: platform (slug, ej "computrabajo"), query (texto en el título), minScore (número), limit (máx 25, default 10).
  Usala para: "revisá las ofertas", "qué hay de mantención", "las mejores puntuadas", "cuál tiene mejor sueldo" (el sueldo aparece solo si la descripción lo publica).

- list_applications — Estado de las postulaciones (draft, ready, submitted, failed, rejected).
  args opcionales: status, limit.

- list_platforms — Plataformas conectadas, su estado, cuántas ofertas tiene cada una y la config de búsqueda automática.

- get_errors — Corridas fallidas del agente, fallos de skills de scraping y healthchecks con problemas.
  args opcionales: limit.

- trigger_scan — Encola un escaneo AHORA. Sin args escanea todas las plataformas con skill; con {"platform": "slug"} solo esa. Con {"platform": "slug", "agent": true} usa al agente navegador (el LLM abre un navegador y busca manualmente — más lento pero funciona en sitios con bloqueo o sin skill). Las plataformas sin skill SIEMPRE usan el agente.
  Usala para: "buscá ofertas ahora", "actualizá computrabajo", "activá el agente para que busque en indeed".

- add_platform — Da de alta una plataforma de empleo nueva y encola al agente navegador para buscar ofertas ahí de inmediato.
  args: name (nombre visible), url (https://…), slug opcional (se deriva de la URL si falta).
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
- Si una acción es destructiva o ambigua (ej: desactivar algo), confirmala solo si el usuario lo pidió claramente; si no, preguntá primero.`;
