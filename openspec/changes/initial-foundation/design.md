# Design — initial-foundation

This document makes the technical decisions that implement `spec.md`. Every decision is justified by a requirement or invariant from `proposal.md` / `spec.md`.

## D1 — Monorepo layout

**Decision**: npm workspaces (no pnpm, no yarn).

**Justification**:
- Native to Node, no extra dependency.
- Workspaces field in root `package.json` enables cross-package imports.
- Compatible with `npm run dev` for concurrent processes.

**Structure** (already in `README.md`, repeated here for clarity):

```
employment-agent/
├── apps/
│   └── web/                # Astro + React islands
├── worker/                  # Node process
├── packages/
│   ├── database/           # Drizzle schema + client
│   ├── domain/             # Types, scoring, invariants
│   ├── llm/                # LLM provider abstraction
│   ├── resume-engine/      # PDF + DOCX generation
│   ├── browser/            # Playwright wrapper + pool
│   ├── skill-runtime/      # PlatformSkill interface + registry
│   └── shared/             # Logger, errors, paths
├── skills/                  # Stub skill lives here
├── data/                    # SQLite (gitignored)
├── storage/                 # Files (gitignored)
├── drizzle/                 # Migration scripts
└── openspec/
```

**Cross-package imports**:
- Use TypeScript path aliases: `@employment-agent/database`, `@employment-agent/domain`, etc.
- Configured in root `tsconfig.base.json` consumed by all packages.

## D2 — Astro project setup

**Decision**: Astro 4.x with Node adapter, `output: 'server'`.

**Astro config** (`apps/web/astro.config.mjs`):
```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react(), tailwind({ applyBaseStyles: true })],
  server: { port: 3000 },
  vite: {
    resolve: { alias: { '@': '/src' } },
  },
});
```

**Justification**:
- `output: 'server'` is required for SSE (static-only can't stream).
- Node adapter lets us serve on port 3000 directly (no separate Express).
- React integration needed for islands.
- Tailwind integration gives base styles + automatic purge.

**Directory inside `apps/web`**:
```
src/
├── pages/
│   ├── index.astro
│   ├── perfil/index.astro
│   ├── curriculums/index.astro
│   ├── ofertas/index.astro
│   ├── postulaciones/index.astro
│   ├── plataformas/index.astro
│   ├── skills/index.astro
│   ├── actividad/index.astro
│   ├── errores/index.astro
│   └── api/
│       ├── eventos.ts
│       ├── health.ts
│       └── upload-cv.ts
├── components/
│   ├── astro/              # .astro components (server-only)
│   └── islands/            # React components (client-hydrated)
│       ├── LiveFeed.tsx
│       ├── UploadCvForm.tsx
│       ├── ProfileForm.tsx
│       └── HealthBadge.tsx
├── lib/                    # Server-side helpers (db queries, etc.)
├── stores/                 # nanostores for shared island state
└── styles/global.css
```

## D3 — React islands vs SSR

**Decision**: Pages are `.astro` files (server-rendered). Interactive pieces inside are React islands with `client:load` or `client:visible`.

**Justification**:
- Astro pages render fast (HTML + minimal JS).
- Islands hydrate only what needs interactivity (forms, SSE feed).
- Reduces bundle size vs a full Next.js-style SPA.

**When to use each**:
- `client:load` — form components that need immediate interactivity.
- `client:visible` — heavy widgets below the fold (charts, lists).
- Server-only — pure presentation, no React at all.

## D4 — shadcn/ui integration

**Decision**: Use shadcn/ui CLI to scaffold components into `apps/web/src/components/ui/`.

**Justification**:
- shadcn/ui is "copy-paste" components, not a dependency.
- They live in our repo, fully customizable.
- Compatible with Astro + React out of the box.

**Components to scaffold for this slice**:
- `button`, `card`, `dialog`, `input`, `label`, `table`, `toast`, `badge`, `tabs`, `textarea`, `select`.

**Configuration** (`components.json` in `apps/web/`):
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "tailwind.config.mjs", "css": "src/styles/global.css", "baseColor": "slate", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils" }
}
```

## D5 — State management across islands

**Decision**: nanostores for shared state.

**Justification**:
- Multiple islands need to react to the same SSE feed (LiveFeed, dashboard counters).
- React Context would require wrapping, which defeats islands.
- nanostores has zero-dependency atoms that any island can subscribe to.

**Pattern**:
```ts
// stores/activity.ts
import { atom } from 'nanostores';
export const recentEvents = atom<ActivityEvent[]>([]);
```

```tsx
// islands/LiveFeed.tsx
import { useStore } from '@nanostores/react';
import { recentEvents } from '@/stores/activity';
export function LiveFeed() {
  const events = useStore(recentEvents);
  // ...
}
```

**SSE bridge** (in `apps/web/src/lib/sse-client.ts`):
- Opens `EventSource('/api/eventos')`.
- On message, prepends to `recentEvents`.
- Auto-reconnect with exponential backoff (handled by `EventSource`).

## D6 — SSE implementation

**Decision**: Astro server endpoint polls SQLite, pushes via SSE.

**Endpoint** (`apps/web/src/pages/api/eventos.ts`):
```ts
import type { APIRoute } from 'astro';
import { db } from '@employment-agent/database';

export const GET: APIRoute = async ({ request }) => {
  let lastSeen = 0;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const heartbeat = setInterval(() => {
        controller.enqueue(enc.encode(':heartbeat\n\n'));
      }, 15_000);
      const poll = setInterval(async () => {
        try {
          const rows = await db
            .select()
            .from(applicationEvents)
            .where(gt(applicationEvents.id, lastSeen))
            .limit(50);
          for (const row of rows) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(row)}\n\n`));
            lastSeen = row.id;
          }
        } catch (err) {
          controller.enqueue(enc.encode(`event: error\ndata: ${err}\n\n`));
        }
      }, 1_000);
      request.signal.addEventListener('abort', () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

**Justification**:
- SSE is a GET endpoint, browser handles reconnect.
- Polling SQLite every 1s is cheap (indexed query on `id > lastSeen`).
- Heartbeat keeps connection through proxies.
- Cleanup on `request.signal.abort` prevents leaks.

## D7 — Drizzle migrations

**Decision**: Drizzle ORM + drizzle-kit for migrations.

**Migration workflow**:
1. Schema changes happen in `packages/database/src/schema/*.ts`.
2. `drizzle-kit generate` produces SQL in `drizzle/migrations/{timestamp}_{name}.sql`.
3. Worker (and web on boot) runs `drizzle-kit migrate` to apply pending migrations.
4. First-boot creates the SQLite file if missing.

**Schema files** (one per table group):
- `schema/candidate.ts` — profiles, experiences, skills, documents
- `schema/platform.ts` — platforms, platform_skills
- `schema/jobs.ts` — jobs, matches, applications, application_events
- `schema/agent.ts` — agent_runs, skill_failures, skill_healthchecks, task_queue

**Client** (`packages/database/src/client.ts`):
```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

const sqlite = new Database(process.env.DATABASE_PATH ?? 'data/employment-agent.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
export const db = drizzle(sqlite, { schema });
export function runMigrations() {
  migrate(db, { migrationsFolder: './drizzle/migrations' });
}
```

**Justification**:
- `better-sqlite3` is synchronous, fast, perfect for local.
- WAL mode allows concurrent reads while writing.
- Drizzle's TypeScript types flow through to all packages.

## D8 — Vitest configuration

**Decision**: Vitest in each package that has logic, with a shared root config.

**Root config** (`vitest.config.ts`):
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: {
    environment: 'node', // default; some tests use happy-dom
    globals: false,
    coverage: { provider: 'v8', reporter: ['text', 'html'], thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 } },
  },
  resolve: {
    alias: {
      '@employment-agent/database': path.resolve(__dirname, 'packages/database/src'),
      '@employment-agent/domain': path.resolve(__dirname, 'packages/domain/src'),
      // ...
    },
  },
});
```

**Island tests** use `environment: 'happy-dom'` via per-file pragma `// @vitest-environment happy-dom`.

**Coverage threshold** enforced only for `packages/domain`, `packages/skill-runtime`, `packages/database` (per spec N5).

## D9 — Worker process model

**Decision**: Worker is a separate Node process. Communication is via SQLite (no IPC).

**Lifecycle**:
1. Worker writes PID to `data/worker.pid` on boot.
2. Worker initializes: opens DB, registers skills, runs migrations, starts cron, starts task-runner, starts heartbeat loop.
3. On SIGINT/SIGTERM: graceful shutdown — close DB, delete PID file.
4. On crash: PID file becomes stale; next boot detects and overwrites.

**Heartbeat loop**:
- Every 60s, inserts/updates a row in `agent_runs` with `kind: 'heartbeat'`.
- Dashboard reads last heartbeat to detect liveness.

**Cron schedule** (`worker/scheduler.ts`):
```ts
import cron from 'node-cron';
import { enqueueTask } from './task-queue';

cron.schedule('*/30 * * * *', async () => {
  await enqueueTask({
    type: 'SCAN_ACTIVE_PLATFORMS',
    payload: { triggeredBy: 'cron' },
  });
});
```

**Task runner** (`worker/task-runner.ts`):
```ts
async function runNextTask() {
  const task = await claimNextTask(); // atomic UPDATE ... WHERE status='pending' RETURNING
  if (!task) return;
  try {
    const handler = handlers[task.type];
    await handler(task.payload);
    await markCompleted(task.id);
  } catch (err) {
    if (task.attempts + 1 >= task.max_attempts) {
      await markFailed(task.id, err.message);
      await markSkillDegradedIfApplicable(task.payload, err);
    } else {
      await markRetrying(task.id, err.message);
      await scheduleRetry(task);
    }
  }
}
setInterval(runNextTask, 5_000); // poll every 5s
```

## D10 — Skill runtime

**Decision**: Interface + registry + per-skill implementation.

**File layout**:
```
packages/skill-runtime/
├── src/
│   ├── types.ts            # PlatformSkill, ScanResult, SkillHealth, SkillStatus
│   ├── registry.ts         # register/get/list
│   ├── context.ts          # SkillContext (eventEmitter, browserPool, profile)
│   └── errors.ts           # HumanInterventionRequired, TransientSkillError, etc.
└── tests/
    ├── types.test.ts
    ├── registry.test.ts
    └── errors.test.ts
```

**Stub skill** (`skills/example-platform/index.ts`):
```ts
import type { PlatformSkill, ScanResult, SkillHealth } from '@employment-agent/skill-runtime';

export const examplePlatformSkill: PlatformSkill = {
  slug: 'example-platform',
  version: '0.1.0',
  displayName: 'Plataforma de ejemplo (stub)',
  requiredCandidateFields: [],
  capabilities: { canScan: true, canApply: false, canDetectLoggedOut: false },
  async scan(profile, ctx) {
    await ctx.events.emit({ kind: 'scan_started', message: 'Iniciando revisión de Plataforma de ejemplo' });
    const fakeJobs = Array.from({ length: 5 }, (_, i) => ({
      externalId: `stub-${Date.now()}-${i}`,
      title: `Oferta de ejemplo ${i + 1}`,
      company: 'Empresa Stub',
      location: 'Remoto',
      url: `https://example.com/jobs/${i}`,
      description: 'Descripción de la oferta stub.',
    }));
    for (const job of fakeJobs) {
      await ctx.events.emit({ kind: 'job_found', message: `Encontrada: ${job.title}`, payload: job });
    }
    await ctx.events.emit({ kind: 'scan_completed', message: `Escaneo completado: ${fakeJobs.length} ofertas` });
    return { jobsFound: fakeJobs.length, jobsNew: fakeJobs.length, jobsDuplicate: 0, errors: 0 };
  },
  async selfCheck(): Promise<SkillHealth> {
    return { status: 'healthy', schemaVersion: '0.1.0', detectedAt: new Date().toISOString() };
  },
};
```

**Registry init** (`worker/skill-init.ts`):
```ts
import { registry } from '@employment-agent/skill-runtime';
import { examplePlatformSkill } from '../../skills/example-platform/index';

export function initializeSkills() {
  registry.register(examplePlatformSkill);
  // Future: registry.register(chiletrabajosSkill);
}
```

## D11 — LLM provider

**Decision**: Interface + multiple implementations, selected by env var.

**Interface** (`packages/llm/src/types.ts`): see spec § LLMProvider.

**Stub** (`packages/llm/src/providers/stub.ts`):
```ts
import type { LLMProvider, StructuredResume, MatchScore } from '../types';

export class DeterministicStubProvider implements LLMProvider {
  readonly name = 'stub';
  async parseResume(_text: string): Promise<StructuredResume> {
    return { experiences: [], education: [], skills: [] };
  }
  async scoreMatch(_profile: unknown, _job: unknown): Promise<MatchScore> {
    return { score: 0, breakdown: { skillsMatch: 0, experienceMatch: 0, locationMatch: 0, seniorityMatch: 0 } };
  }
  async summarize(_text: string): Promise<string> {
    return 'stub';
  }
}
```

**Factory** (`packages/llm/src/index.ts`):
```ts
import { DeterministicStubProvider } from './providers/stub';
// import { OllamaProvider } from './providers/ollama'; // future
// import { OpenAIProvider } from './providers/openai'; // future

export function createLLMProvider(): LLMProvider {
  const which = process.env.LLM_PROVIDER ?? 'stub';
  switch (which) {
    case 'stub': return new DeterministicStubProvider();
    // case 'ollama': return new OllamaProvider();
    // case 'openai': return new OpenAIProvider();
    default: throw new Error(`Unknown LLM_PROVIDER: ${which}`);
  }
}
```

**Usage**: web and worker both import from `@employment-agent/llm` and call `createLLMProvider()`. No provider-specific code elsewhere.

## D12 — Resume engine

**Decision**: `pdf-lib` for PDF, `docx` for DOCX. No layout dependencies.

**PDF generation** (`packages/resume-engine/src/pdf.ts`):
- Uses `pdf-lib` to draw text directly (no HTML→PDF, no headless browser).
- Iterates over `profile.experiences`, `profile.skills`, `profile.education`.
- **Empty fields are omitted entirely** — no placeholder text.

**DOCX generation** (`packages/resume-engine/src/docx.ts`):
- Uses `docx` library to build paragraphs and tables.
- Same omission rule.

**Invariant enforcement** (test in `packages/resume-engine/tests/invariants.test.ts`):
- Given profile with no phone, the generated PDF does NOT contain any 10-digit string.
- Given profile with no summary, the PDF has no "Summary" heading.

## D13 — CV pipeline

**Decision**: pdf-parse + mammoth for text extraction. Hash-based dedup.

**File layout**:
```
apps/web/src/pages/api/upload-cv.ts   # POST endpoint, multipart form
packages/domain/src/cv-parser.ts       # extractText(buffer, mime) → string
apps/web/src/lib/upload.ts             # hashFile(buffer) → sha256 hex
```

**Upload flow**:
1. Client POSTs multipart form to `/api/upload-cv`.
2. Server reads file, computes SHA-256, checks `candidate_documents.file_hash` for collision.
3. If duplicate: returns `{ duplicate: true, existingProfileId }`.
4. Otherwise: extracts text via pdf-parse/mammoth, calls `LLMProvider.parseResume`, returns `{ structuredResume, fileHash, storagePath }`.
5. Client shows the form pre-filled with `structuredResume`, user edits, saves.

**Skip upload**: `/curriculums?mode=manual` skips step 1-4, shows empty form.

## D14 — Logging

**Decision**: pino for structured JSON logging.

**Justification**:
- pino is fast, widely used, JSON-native.
- Outputs to both stdout (dev) and `storage/logs/{date}.jsonl` (file).

**Setup** (`packages/shared/src/logger.ts`):
```ts
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';

const date = new Date().toISOString().slice(0, 10);
const logDir = path.resolve(process.cwd(), 'storage/logs');
fs.mkdirSync(logDir, { recursive: true });

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty', options: { colorize: true } },
}, pino.destination({ dest: path.join(logDir, `${date}.jsonl`), sync: false }));
```

## D15 — Error handling

**Decision**: Custom error classes in `packages/shared/src/errors.ts`. Skill runtime defines its own (`HumanInterventionRequired`, `TransientSkillError`, etc.).

**Hierarchy**:
- `AppError` (base)
  - `ValidationError` (400)
  - `NotFoundError` (404)
  - `HumanInterventionRequired` (skill can't auto-resolve)
  - `TransientSkillError` (retry-able)
  - `FatalSkillError` (mark skill broken)

**Worker behavior**:
- `ValidationError` → mark task `failed`, surface to UI.
- `HumanInterventionRequired` → mark task `failed` + insert `application_events` with `kind: 'needs_human'`.
- `TransientSkillError` → retry with backoff.
- `FatalSkillError` → mark task `failed` + mark skill `broken` in `skill_healthchecks`.

## D16 — Path conventions

**Decision**:
- All cross-package imports use `@employment-agent/*` aliases.
- File-system paths use `path.join` or `path.posix` depending on context.
- Storage paths are stored as POSIX-style relative paths in SQLite (e.g., `curriculum/abc123.pdf`), converted to absolute at read time.

## D17 — npm scripts

**Root `package.json`**:
```json
{
  "name": "employment-agent",
  "private": true,
  "workspaces": ["apps/*", "worker", "packages/*", "skills/*"],
  "scripts": {
    "dev": "concurrently -n web,worker -c blue,green \"npm:dev:web\" \"npm:dev:worker\"",
    "dev:web": "npm --workspace=apps/web run dev",
    "dev:worker": "npm --workspace=worker run dev",
    "build": "npm --workspace=apps/web run build && npm --workspace=worker run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio"
  },
  "devDependencies": {
    "concurrently": "^9",
    "drizzle-kit": "^0.27",
    "typescript": "^5.5",
    "vitest": "^2"
  }
}
```

**Justification**:
- `concurrently` runs web + worker side by side in dev.
- Each workspace has its own `dev` script (Astro's dev server for web, `tsx watch` for worker).

## D18 — File-by-file file count estimate

For `apply` planning:
- 7 root files (`package.json`, `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`, `drizzle.config.ts`, `.env.example`, `README.md`)
- 14 schema files (`packages/database/src/schema/*.ts`)
- ~30 source files in `packages/` (domain, llm, resume-engine, browser, skill-runtime, shared)
- ~20 Astro pages and components (`apps/web/src/pages/**`, `apps/web/src/components/**`)
- ~10 worker files (`worker/*.ts`)
- ~15 test files
- ~5 migration SQL files

Total: ~100 files. **Force-chained**: split into 5-7 PRs, each ≤400 lines.

## D19 — Risks and mitigations (design-level)

| Risk | Mitigation |
|---|---|
| Astro + React islands + Tailwind integration drift | Use exact versions in package.json, lock with `npm ci` |
| SQLite locked during heavy worker writes | WAL mode + per-task retry with backoff |
| Playwright not installed at first run | Worker checks for Playwright on boot; warns but doesn't crash |
| pdf-lib layout drifts from expected | Snapshot tests with golden PDFs (hash of bytes) |
| SSE connection through corporate proxies | Heartbeat every 15s + auto-reconnect |
| Windows path separators in cross-platform code | `path.join` everywhere, POSIX for storage paths |

## D20 — Acceptance criteria mapping (design)

| AC# | Design section that delivers |
|---|---|
| 1 | D1, D17 (`npm run dev` uses concurrently) |
| 2 | D2, D3 (Astro routes scaffolded as placeholders) |
| 3 | D2, D13 (upload endpoint, parser, form) |
| 4 | D12 (resume engine) |
| 5 | D9 (cron schedule) |
| 6 | D5, D6 (SSE + nanostores bridge) |
| 7 | D10, D11 (skill healthchecks + LLM stub) |
| 8 | D8 (Vitest config with thresholds) |
| 9 | D12 (no fabrication invariant + tests) |
| 10 | D10 (stub skill has no apply implementation) |
