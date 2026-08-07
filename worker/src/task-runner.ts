import { claimNextTask, markCompleted, markFailed, markRetrying, TaskRow } from './task-queue.js';
import { isAppError, registry } from '@employment-agent/skill-runtime';
import { DatabaseEventEmitter } from './event-emitter.js';
import { createSkillContext } from '@employment-agent/skill-runtime';
import { isApprovedOrigin, createBrowserTools, pickContextForOrigin } from './browser-tools.js';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { CandidateProfile } from '@employment-agent/domain';
import type { LLMProvider } from '@employment-agent/llm';
import { db } from '@employment-agent/database';
import { candidateProfiles, candidateExperiences, candidateSkills, candidateTargetRoles, jobs, platforms, llmSettings, jobMatches, matchFeedback } from '@employment-agent/database/schema';
import { eq, and, isNull, sql, desc } from 'drizzle-orm';

/** Load the configured LLM provider from the database. */
async function loadLLM(): Promise<LLMProvider> {
  const { createConfiguredProvider } = await import('@employment-agent/llm');
  const rows = await db.select().from(llmSettings).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error('No LLM configured. Go to /configuracion and set up a provider.');
  }
  return createConfiguredProvider({
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl ?? null,
  });
}

/** Ensure a platform row exists and return its id. */
async function ensurePlatform(slug: string, displayName: string, baseUrl?: string): Promise<number> {
  const existing = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  if (existing[0]) return existing[0].id;
  const inserted = await db
    .insert(platforms)
    .values({ slug, displayName, baseUrl: baseUrl ?? null, status: 'active' })
    .returning({ id: platforms.id });
  return inserted[0]!.id;
}

/** Insert a job if it doesn't exist, or bump lastSeenAt if it does. Returns 'new' | 'duplicate'. */
async function persistJob(platformId: number, job: {
  externalId: string; title: string; company?: string; location?: string; url?: string; description?: string; postedAt?: string;
}): Promise<'new' | 'duplicate'> {
  const existing = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.platformId, platformId), eq(jobs.externalId, job.externalId)))
    .limit(1);
  if (existing[0]) {
    await db.update(jobs).set({ lastSeenAt: new Date().toISOString() }).where(eq(jobs.id, existing[0].id));
    return 'duplicate';
  }
  await db.insert(jobs).values({
    platformId,
    externalId: job.externalId,
    title: job.title,
    company: job.company ?? null,
    location: job.location ?? null,
    url: job.url ?? null,
    description: job.description ?? null,
    postedAt: job.postedAt ?? null,
  });
  return 'new';
}

/**
 * Load recent user feedback to inject as few-shot examples in the
 * scoring prompt. The LLM learns from past corrections.
 */
async function loadFeedbackExamples(profileId: number): Promise<string> {
  const recent = await db
    .select({
      verdict: matchFeedback.userVerdict,
      note: matchFeedback.userNote,
      originalScore: matchFeedback.originalScore,
      jobTitle: jobs.title,
      jobCompany: jobs.company,
      jobLocation: jobs.location,
      jobDescription: jobs.description,
    })
    .from(matchFeedback)
    .innerJoin(jobs, eq(matchFeedback.jobId, jobs.id))
    .where(eq(matchFeedback.profileId, profileId))
    .orderBy(desc(matchFeedback.createdAt))
    .limit(10);

  if (recent.length === 0) return '';

  const examples = recent.map((f) => {
    const desc = (f.jobDescription ?? '').slice(0, 150);
    return `- "${f.jobTitle}" en ${f.jobCompany ?? '?'} (${f.jobLocation ?? '?'}) — LLM dio ${Math.round(f.originalScore)}% → Usuario dijo: ${f.verdict === 'compatible' ? 'SÍ compatible' : 'NO compatible'}${f.note ? ` — "${f.note}"` : ''}`;
  });

  return `\n\nCorrecciones previas del usuario (usa estos ejemplos para calibrar tu puntaje):\n${examples.join('\n')}`;
}

/**
 * Score unscored jobs for a platform against the candidate profile.
 * Only scores jobs that don't already have a job_matches row.
 * Injects user feedback as few-shot examples so the LLM improves over time.
 * Returns the number of jobs scored.
 */
async function scoreNewJobs(platformId: number, profile: CandidateProfile, llm: import('@employment-agent/llm').LLMProvider): Promise<number> {
  if (!profile.id) return 0;
  const profileId = profile.id;

  // Load feedback examples once for the batch
  const feedbackExamples = await loadFeedbackExamples(profileId);

  // Find jobs for this platform that have no match row yet
  const unscored = await db
    .select({
      id: jobs.id,
      platformId: jobs.platformId,
      externalId: jobs.externalId,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      url: jobs.url,
      description: jobs.description,
    })
    .from(jobs)
    .leftJoin(jobMatches, and(eq(jobMatches.jobId, jobs.id), eq(jobMatches.profileId, profileId)))
    .where(and(eq(jobs.platformId, platformId), isNull(jobMatches.id)))
    .limit(20); // Score at most 20 per run to control LLM costs

  let scored = 0;
  for (const job of unscored) {
    try {
      // Use chat() directly with feedback-enriched prompt instead of
      // the generic scoreMatch() so we can inject few-shot examples.
      const prompt = `Puntua el match (0-100) entre perfil y oferta. Responde solo JSON con claves score, breakdown{skillsMatch,experienceMatch,locationMatch,seniorityMatch}, reasoning.
Perfil: ${JSON.stringify(profile)}
Oferta: ${JSON.stringify({ title: job.title, company: job.company, location: job.location, description: (job.description ?? '').slice(0, 500) })}${feedbackExamples}`;

      const raw = await llm.chat(prompt);
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      const score = typeof parsed.score === 'number' ? parsed.score : 0;
      const breakdown = parsed.breakdown ?? {};
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;

      await db.insert(jobMatches).values({
        jobId: job.id,
        profileId,
        score,
        breakdownJson: JSON.stringify({ breakdown, reasoning }),
      });
      scored++;
    } catch {
      // Skip individual scoring failures — don't break the batch
    }
  }
  return scored;
}

/**
 * Load the active candidate profile from the database so skills can
 * use it to build search queries and score matches.
 */
async function loadWorkerProfile(): Promise<CandidateProfile> {
  const rows = await db.select().from(candidateProfiles).limit(1);
  if (rows.length === 0) return {};
  const p = rows[0]!;
  const experiences = await db
    .select()
    .from(candidateExperiences)
    .where(eq(candidateExperiences.profileId, p.id));
  const skills = await db
    .select()
    .from(candidateSkills)
    .where(eq(candidateSkills.profileId, p.id));
  const targetRoles = await db
    .select()
    .from(candidateTargetRoles)
    .where(and(eq(candidateTargetRoles.profileId, p.id), eq(candidateTargetRoles.isActive, 1)));
  return {
    id: p.id,
    fullName: p.fullName ?? undefined,
    email: p.email ?? undefined,
    phone: p.phone ?? undefined,
    location: p.location ?? undefined,
    experiences: experiences.map((e) => ({
      id: e.id,
      company: e.company,
      role: e.role,
      startDate: e.startDate ?? undefined,
      endDate: e.endDate ?? undefined,
      description: e.description ?? undefined,
    })),
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      level: s.level ?? undefined,
      years: s.years ?? undefined,
    })),
    summary: [
      p.summary ?? '',
      targetRoles.length > 0
        ? `\nRoles objetivo activos: ${targetRoles.map((r) => `${r.roleTitle} (prioridad ${r.priority})`).join(', ')}`
        : '',
    ].filter(Boolean).join('\n'),
  };
}

const POLL_INTERVAL_MS = 5_000;

export type TaskHandler = (task: TaskRow) => Promise<void>;

const handlers = new Map<string, TaskHandler>();

export function registerHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler);
}

let stopRequested = false;

export function stopTaskRunner(): void {
  stopRequested = true;
}

export async function startTaskRunner(): Promise<void> {
  stopRequested = false;
  while (!stopRequested) {
    try {
      const task = await claimNextTask();
      if (task) {
        await runTask(task);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[task-runner] poll error:', err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function runTask(task: TaskRow): Promise<void> {
  const handler = handlers.get(task.type);
  if (!handler) {
    await markFailed(task.id, `No handler for task type: ${task.type}`);
    return;
  }

  try {
    await handler(task);
    await markCompleted(task.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isAppError(err) && err.kind === 'transient') {
      if (task.attempts + 1 >= task.maxAttempts) {
        await markFailed(task.id, message);
      } else {
        await markRetrying(task.id, message, backoffMs(task.attempts));
      }
    } else if (isAppError(err) && err.kind === 'human_intervention') {
      await markFailed(task.id, message);
    } else {
      await markFailed(task.id, message);
    }
  }
}

function backoffMs(attempts: number): number {
  return Math.min(60_000 * Math.pow(2, attempts), 15 * 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerBuiltinHandlers(): void {
  const events = new DatabaseEventEmitter();
  const ctx = createSkillContext(events);

    // Lazy import: the session-capture handler requires Playwright, which
    // is heavy. Loading it on demand keeps the cold-start path fast.
    const captureSession = async (task: TaskRow) => {
      const payload = JSON.parse(task.payloadJson) as { sessionId: string; slug: string; platformUrl: string };
      const { getSessionCapture, setSessionReady, setSessionCompleted, setSessionFailed, setSessionExpired, persistStorageState } = await import('@employment-agent/security');
    const { chromium } = await import('playwright');

    const session = await getSessionCapture(payload.sessionId);
    if (!session) {
      throw new Error(`Session ${payload.sessionId} not found`);
    }
    const approvedOrigin = new URL(payload.platformUrl).origin;

    let browser: import('playwright').Browser | null = null;
    try {
      // Headed is important: the user must see and interact with the page.
      browser = await chromium.launch({ headless: false });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        locale: 'es-CL',
        viewport: { width: 1280, height: 900 },
      });
      // Block navigation outside the approved origin while the user is
      // logging in. We DO allow the well-known OAuth providers here
      // (Google, Apple, Facebook, Microsoft, GitHub) because platforms
      // like Indeed require the user to complete the OAuth flow inside
      // the headed browser. The whitelist is intentionally narrow — see
      // OAUTH_ALLOWED_ORIGINS in session-capture-policy.ts.
      const { shouldAllowNavigation } = await import('./session-capture-policy.js');
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (!shouldAllowNavigation(url, approvedOrigin)) {
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      const page = await context.newPage();
      await page.goto(approvedOrigin, { timeout: 30_000, waitUntil: 'domcontentloaded' });

      await events.emit({
        kind: 'session_capture_ready',
        message: `Navegador abierto en ${approvedOrigin}. Loguéate y tocá "Listo" cuando termines.`,
        payload: { sessionId: payload.sessionId, slug: payload.slug },
      });
      await setSessionReady(payload.sessionId);

      // Poll for user completion. Each tick re-reads the row so the
      // user's "Listo" click is observable across process boundaries.
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await sleep(1_000);
        const current = await getSessionCapture(payload.sessionId);
        if (!current) return; // session was deleted
        if (current.status === 'completed') return; // shouldn't happen but safe
        if (current.status === 'cancelled') return; // user clicked Cancel in the UI
        if (current.userCompletedAt) {
          const storageState = JSON.stringify(await context.storageState());
          await persistStorageState(payload.slug, storageState);
          await setSessionCompleted(payload.sessionId);
          await events.emit({
            kind: 'session_capture_completed',
            message: `Sesión de ${payload.slug} guardada y cifrada.`,
            payload: { slug: payload.slug },
          });
          return;
        }
      }

      // Timeout. Re-check before persisting in case the user cancelled
      // in the last second — don't overwrite a 'cancelled' status with
      // 'expired'.
      const final = await getSessionCapture(payload.sessionId);
      if (final && final.status !== 'cancelled') {
        await setSessionExpired(payload.sessionId);
      }
      await events.emit({
        kind: 'session_capture_expired',
        message: `La sesión de ${payload.slug} expiró sin completarse.`,
        payload: { sessionId: payload.sessionId, slug: payload.slug },
      });
    } catch (err) {
      await setSessionFailed(payload.sessionId, err instanceof Error ? err.message : String(err));
      await events.emit({
        kind: 'session_capture_failed',
        message: `Falló la captura de sesión para ${payload.slug}: ${err instanceof Error ? err.message : String(err)}`,
        payload: { sessionId: payload.sessionId, slug: payload.slug },
      });
      throw err;
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  };
  registerHandler('CAPTURE_SESSION', captureSession);

  registerHandler('LAUNCH_BROWSER', async (task) => {
    const payload = JSON.parse(task.payloadJson) as { browserId?: string };
    const { detectAvailableBrowsers, pickDefaultBrowser, findBrowser, defaultProfileDir } = await import('./browser-detector.js');
    const { launchBrowser } = await import('./browser-launcher.js');

    const browser = payload.browserId
      ? findBrowser(payload.browserId as Parameters<typeof findBrowser>[0])
      : pickDefaultBrowser();
    if (!browser) {
      const available = detectAvailableBrowsers();
      throw new Error(
        `No supported browser found. Install Brave, Chrome, Edge, or Comet. Detected: ${available.map((b) => b.id).join(', ') || 'none'}.`
      );
    }

    const profileDir = defaultProfileDir(browser.id);
    if (!profileDir) {
      throw new Error(`No default profile dir for ${browser.id} on this OS.`);
    }

    const launched = await launchBrowser({
      browserId: browser.id,
      binaryPath: browser.binaryPath,
      profileDir,
    });
    await events.emit({
      kind: 'launch_browser_success',
      message: `${browser.id} launched with debug port ${launched.cdpPort}.`,
      payload: { browser: browser.id, port: launched.cdpPort, profileDir },
    });
  });

  registerHandler('SCAN_ACTIVE_PLATFORMS', async (task) => {
    const payload = JSON.parse(task.payloadJson) as { triggeredBy?: string };
    const skills = registry.list();
    for (const skill of skills) {
      if (!skill.capabilities.canScan) continue;
      const { enqueueTask } = await import('./task-queue.js');
      await enqueueTask({
        type: 'SCAN_PLATFORM',
        payload: { skillSlug: skill.slug, triggeredBy: payload.triggeredBy ?? 'unknown' },
      });
    }
  });

  registerHandler('SCAN_PLATFORM', async (task) => {
    const payload = JSON.parse(task.payloadJson) as { skillSlug: string };
    const skill = registry.get(payload.skillSlug);
    if (!skill) {
      throw new Error(`Skill not found: ${payload.skillSlug}`);
    }
    const profile = await loadWorkerProfile();
    const { platformUrlForSlug } = await import('./platform-urls.js');
    const platformId = await ensurePlatform(skill.slug, skill.displayName, platformUrlForSlug(skill.slug));

    // Wrap the event emitter to intercept job_found events and persist them.
    let newCount = 0;
    let dupCount = 0;
    const persistingEvents = {
      emit: async (event: { kind: string; message: string; payload?: unknown }) => {
        if (event.kind === 'job_found' && event.payload != null) {
          const job = event.payload as {
            externalId: string; title: string; company?: string; location?: string; url?: string; description?: string;
          };
          if (job.externalId && job.title) {
            const result = await persistJob(platformId, job);
            if (result === 'new') newCount++;
            else dupCount++;
          }
        }
        // Always forward to the original emitter for the event log.
        await events.emit(event);
      },
    };

    const scanCtx = { ...ctx, profile, events: persistingEvents };

    try {
      const result = await skill.scan(profile, scanCtx);
      await events.emit({
        kind: 'scan_summary',
        message: `Skill ${skill.slug} scan: found=${result.jobsFound} new=${newCount} duplicate=${dupCount} errors=${result.errors}`,
        payload: { ...result, jobsNew: newCount, jobsDuplicate: dupCount },
      });

      // Score unscored jobs against the profile — runs even when all
      // jobs are duplicates, because existing jobs may lack match rows.
      try {
        const llm = await loadLLM();
        const scored = await scoreNewJobs(platformId, profile, llm);
        if (scored > 0) {
          await events.emit({
            kind: 'scan_scored',
            message: `Scored ${scored} jobs for ${skill.slug}`,
            payload: { scored },
          });
        }
      } catch (scoreErr) {
        await events.emit({
          kind: 'scan_score_error',
          message: `Scoring failed: ${scoreErr instanceof Error ? scoreErr.message : String(scoreErr)}`,
        });
      }
    } catch (scanErr) {
      // Skill failed — enqueue a browser agent fallback task.
      const errMsg = scanErr instanceof Error ? scanErr.message : String(scanErr);
      await events.emit({
        kind: 'scan_fallback',
        message: `Skill ${skill.slug} failed (${errMsg.slice(0, 100)}). Enqueueing browser agent fallback.`,
        payload: { skillSlug: skill.slug, error: errMsg },
      });
      const { enqueueTask } = await import('./task-queue.js');
      const { platformUrlForSlug } = await import('./platform-urls.js');
      await enqueueTask({
        type: 'BROWSER_AGENT_SCAN',
        payload: {
          skillSlug: skill.slug,
          platformUrl: platformUrlForSlug(skill.slug),
          triggeredBy: 'skill-fallback',
          originalError: errMsg.slice(0, 200),
        },
        maxAttempts: 1, // Browser agent gets one shot — it's expensive
      });
    }
  });

  registerHandler('BROWSER_AGENT_SCAN', async (task) => {
    const payload = JSON.parse(task.payloadJson) as {
      skillSlug: string;
      platformUrl: string;
      triggeredBy?: string;
    };
    const profile = await loadWorkerProfile();
    const platformId = await ensurePlatform(payload.skillSlug, payload.skillSlug);
    const llm = await loadLLM();

    // Respect active platform blocks: if the platform is currently blocked
    // (e.g. Cloudflare verification cooldown), skip the scan and emit a
    // summary so the user can see what happened.
    const { isPlatformBlocked, getCurrentBlock, markPlatformBlocked } = await import('./platform-blocks.js');
    if (await isPlatformBlocked(payload.skillSlug)) {
      const block = await getCurrentBlock(payload.skillSlug);
      const until = block?.until ?? 'unknown';
      await events.emit({
        kind: 'scan_skipped',
        message: `Platform ${payload.skillSlug} is blocked until ${until} (${block?.reason ?? 'unknown'}); skipping scan.`,
        payload: { skillSlug: payload.skillSlug, until, reason: block?.reason },
      });
      return;
    }

    // Build queries from profile (same logic as skills)
    const summary = profile.summary ?? '';
    const rolesMatch = summary.match(/Roles objetivo activos:\s*(.+)/);
    const targetRoles = rolesMatch
      ? (rolesMatch[1] ?? '').split(',').map((r) => r.replace(/\s*\(prioridad\s*\d+\)/, '').trim()).filter(Boolean)
      : [];
    const shortSkills = (profile.skills ?? [])
      .map((s) => s.name?.trim())
      .filter((n): n is string => Boolean(n && n.length > 1 && n.length <= 30));
    const queries = [...new Set([...targetRoles, ...shortSkills])].slice(0, 3);
    if (queries.length === 0) queries.push('mantención', 'refrigeración');

    // Attach to a real browser. Three escalating strategies, in order:
    //
    //   1. CDP attach to whatever is already listening on 9222. This is
    //      the `npm run launch:brave` flow — user ran the launcher,
    //      has their normal Brave session with their cookies, the worker
    //      just connects. Works even WITHOUT a captured credential.
    //
    //   2. Launch a dedicated instance with the captured profile path
    //      (from a previous CAPTURE_SESSION). This is what makes the
    //      session survive a worker restart — profile has cookies.
    //
    //   3. Playwright's bundled Chromium. Last resort: Google will
    //      detect the TLS fingerprint and block login flows.
    //
    // Step 1 used to be gated on credential.browserPath existing, which
    // meant the user's first scan after install always fell through to
    // step 3 and failed. The condition was wrong: launching Brave via
    // npm run launch:brave is independent of whether any platform has
    // a captured credential yet.
    let realBrowser: import('playwright').Browser | null = null;
    let browserProc: { pid: number; cdpPort: number } | null = null;
    const { runBrowserAgent } = await import('./browser-agent.js');
    const { loadCredentialPlaintext } = await import('@employment-agent/security');
    const { detectAvailableBrowsers, findBrowser } = await import('./browser-detector.js');
    const { launchBrowser, connectToBrowser, profileDirFor, validateBrowserFlags } = await import('./browser-launcher.js');
    const { chromium } = await import('playwright');
    const credential = await loadCredentialPlaintext(payload.skillSlug);

    // Strategy 1: attach to the already-running CDP browser.
    try {
      realBrowser = await connectToBrowser();
      if (realBrowser) {
        await events.emit({
          kind: 'real_browser_attached',
          message: `Conectado al navegador ya corriendo vía CDP (perfil del usuario).`,
          payload: { source: 'cdp-existing', slug: payload.skillSlug },
        });
      } else {
        // connectToBrowser returns null in two distinct failure modes
        // that need different instructions:
        //   - No CDP endpoint at all (probe failed before validation).
        //     Tell the user to launch Brave.
        //   - CDP endpoint is up but the running browser was launched
        //     without --disable-brave-shields (Windows validation
        //     rejected it). Tell the user to close Brave and re-run
        //     npm run launch:brave so the launch script applies the
        //     correct flags. validateBrowserFlags() is the source of
        //     truth for which one we're in.
        const validation = await validateBrowserFlags();
        if (!validation.valid && validation.reason === 'missing-shield-flag') {
          await events.emit({
            kind: 'real_browser_attach_error',
            message: 'Brave está corriendo en el puerto 9222 pero sin --disable-brave-shields (los Shields bloquean localhost y la página de Indeed queda a medio renderizar). Cerrá todas las ventanas de Brave y re-ejecutá npm run launch:brave.',
            payload: { reason: 'wrong-flags', slug: payload.skillSlug, commandLine: validation.commandLine },
          });
        } else {
          await events.emit({
            kind: 'real_browser_attach_error',
            message: 'No hay navegador con CDP en el puerto 9222. Si tenés el navegador abierto, cerrá todas las ventanas y re-ejecutá npm run dev, o usá el botón "Lanzar Brave" en /configuracion para abrirlo con debug port.',
            payload: { reason: 'no-cdp-on-9222', slug: payload.skillSlug },
          });
        }
      }
    } catch (err) {
      // connectToBrowser returns null on failure; this catch is for the
      // unexpected case where connectOverCDP itself throws.
      await events.emit({
        kind: 'real_browser_attach_error',
        message: `CDP attach falló: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Strategy 2: launch a dedicated browser with the captured profile.
    if (!realBrowser && credential?.browserPath && credential?.profilePath) {
      const browser = findBrowser((credential.browserId ?? 'brave') as Parameters<typeof findBrowser>[0]);
      if (browser) {
        try {
          const launched = await launchBrowser({
            browserId: browser.id,
            binaryPath: credential.browserPath,
            profileDir: credential.profilePath,
          });
          browserProc = launched;
          realBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${launched.cdpPort}`);
          await events.emit({
            kind: 'real_browser_attached',
            message: `Lanzado ${browser.id} con perfil guardado de ${payload.skillSlug}.`,
            payload: { browser: browser.id, slug: payload.skillSlug },
          });
        } catch (err) {
          await events.emit({
            kind: 'real_browser_fallback',
            message: `Falló launch dedicado. Usando lo que haya disponible. ${err instanceof Error ? err.message : String(err)}`,
          });
          realBrowser = null;
        }
      }
    }

    const result = await runBrowserAgent({
      platform: payload.skillSlug,
      platformUrl: payload.platformUrl,
      queries,
      profile,
      llm,
      headless: false, // Headed so user can solve CAPTCHAs
      loginCredentials: credential ? { email: credential.email, password: credential.password } : undefined,
      storageState: credential?.storageState ?? undefined,
      existingBrowser: realBrowser ?? undefined,
      onJobsFound: async (agentJobs) => {
        let newC = 0, dupC = 0;
        for (const job of agentJobs) {
          const r = await persistJob(platformId, {
            externalId: job.externalId,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            description: job.description,
            postedAt: job.postedAt,
          });
          if (r === 'new') newC++; else dupC++;
        }
        return { new: newC, duplicate: dupC };
      },
      onEvent: async (kind, message) => {
        await events.emit({ kind: `agent_${kind}`, message });
      },
      onBlocked: async (reason, marker) => {
        await markPlatformBlocked(payload.skillSlug, reason, marker);
        await events.emit({
          kind: 'platform_blocked',
          message: `Platform ${payload.skillSlug} marked as blocked (${reason}); scheduler will skip for ${30} minutes.`,
          payload: { skillSlug: payload.skillSlug, reason, marker, ttlMinutes: 30 },
        });
      },
    });

    await events.emit({
      kind: 'scan_summary',
      message: `Browser agent ${payload.skillSlug}: found=${result.jobsFound} new=${result.jobsNew} dup=${result.jobsDuplicate} steps=${result.steps} — ${result.summary}`,
      payload: result,
    });

    // Score unscored jobs against the profile — always check, not just
    // when new jobs were found.
    try {
      const scored = await scoreNewJobs(platformId, profile, llm);
      if (scored > 0) {
        await events.emit({
          kind: 'scan_scored',
          message: `Scored ${scored} jobs for ${payload.skillSlug}`,
          payload: { scored },
        });
      }
    } catch (scoreErr) {
      await events.emit({
        kind: 'scan_score_error',
        message: `Scoring failed: ${scoreErr instanceof Error ? scoreErr.message : String(scoreErr)}`,
      });
    }
  });
}
