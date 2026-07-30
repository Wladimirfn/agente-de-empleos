# Spec — initial-foundation

## Overview

This spec defines the requirements for the first slice of `employment-agent`:
a runnable shell with web app, worker, database, skill runtime, CV pipeline,
LLM provider abstraction, and SSE-based live updates — all driven by a stub
skill that simulates portal activity. No real portals, no real LLM, no auth.

The spec follows `proposal.md` and is consumed by `design.md` and `tasks.md`.

## Functional requirements

### F1 — Web app shell

- **F1.1** Astro 4.x with `output: 'server'` (Node adapter).
- **F1.2** React 18 islands for interactive components.
- **F1.3** Tailwind CSS for styling.
- **F1.4** shadcn/ui as the component primitive library (button, card, dialog, table, toast).
- **F1.5** Routes (placeholder content allowed, must be navigable):
  - `/` (Inicio)
  - `/perfil`
  - `/curriculums`
  - `/ofertas`
  - `/postulaciones`
  - `/plataformas`
  - `/skills`
  - `/actividad`
  - `/errores`
- **F1.6** Spanish UI copy, English code, English artifact names.

### F2 — Worker process

- **F2.1** Separate Node process (`worker/index.ts`) started by `npm run dev:worker`.
- **F2.2** Uses `tsx watch` for hot reload during development.
- **F2.3** Uses `node-cron` to schedule `SCAN_ACTIVE_PLATFORMS` every 30 minutes.
- **F2.4** Owns a `task-runner` that polls `task_queue` table and dispatches tasks.
- **F2.5** Owns an `event-emitter` that writes structured events to `application_events` table.
- **F2.6** Uses `playwright` for browser automation, capped at 3 concurrent browsers via a pool.

### F3 — Database

- **F3.1** SQLite file at `data/employment-agent.db`.
- **F3.2** Drizzle ORM with `drizzle-kit` for migrations.
- **F3.3** Tables:
  - `candidate_profiles` (id, full_name, email, phone, location, summary, created_at, updated_at)
  - `candidate_experiences` (id, profile_id, company, role, start_date, end_date, description, source: "form" | "cv-parsed" | "cv-corrected")
  - `candidate_skills` (id, profile_id, name, level, years)
  - `candidate_documents` (id, profile_id, kind: "cv_pdf" | "cv_docx" | "generated_pdf" | "generated_docx", file_hash, storage_path, created_at)
  - `platforms` (id, slug, display_name, base_url, status: "active" | "paused" | "broken")
  - `platform_skills` (id, platform_id, skill_slug, version, installed_at, last_success_at, consecutive_failures)
  - `jobs` (id, platform_id, external_id, title, company, location, url, description, raw_payload, first_seen_at, last_seen_at, hash)
  - `job_matches` (id, job_id, profile_id, score, breakdown_json, computed_at)
  - `applications` (id, job_id, profile_id, status: "draft" | "ready" | "submitted" | "failed" | "rejected", prepared_at, submitted_at, evidence_path)
  - `application_events` (id, application_id, kind, message, payload_json, occurred_at)
  - `agent_runs` (id, kind, started_at, finished_at, status, summary)
  - `skill_failures` (id, skill_slug, skill_version, error_code, error_message, screenshot_path, page_html_hash, occurred_at, repaired_at, repair_strategy)
  - `skill_healthchecks` (id, skill_slug, status: "healthy" | "degraded" | "broken" | "needs-human", checked_at, details_json)
  - `task_queue` (id, type, payload_json, status: "pending" | "running" | "completed" | "failed" | "retrying", attempts, max_attempts, scheduled_at, started_at, completed_at, error)
- **F3.4** Unique index on `jobs(platform_id, external_id)` for deduplication.
- **F3.5** Unique index on `candidate_documents(file_hash, kind)` for upload dedup.

### F4 — Skill runtime

- **F4.1** `PlatformSkill` interface (see § Interfaces).
- **F4.2** Registry maps `skill_slug` → `PlatformSkill` instance.
- **F4.3** Worker initializes the registry on boot; logs skill versions and statuses.
- **F4.4** `example-platform` skill (stub) implements the interface:
  - `scan()`: emits 5 fake jobs via event-emitter, returns summary.
  - `apply()`: throws `HumanInterventionRequired("Stub skill does not apply")`.
  - `selfCheck()`: always returns `healthy`.

### F5 — CV pipeline

- **F5.1** User uploads PDF or DOCX from `/curriculums`.
- **F5.2** System reads file → text extraction:
  - PDF: `pdf-parse` library.
  - DOCX: `mammoth` library.
- **F5.3** Extracted text is passed to `LLMProvider.parseResume()` which returns structured data (name, email, phone, experiences, education, skills).
- **F5.4** Stub provider returns deterministic empty result + logs "stub parse called".
- **F5.5** User is shown the structured form pre-filled with extracted data, can edit/add/remove fields.
- **F5.6** On save: persist `candidate_profiles` row + `candidate_experiences` + `candidate_skills`.
- **F5.7** Original CV file is stored in `storage/curriculum/` with a hashed filename.
- **F5.8** Duplicate detection: if file_hash already exists, ask user "¿actualizar perfil existente o crear nuevo?".
- **F5.9** User can skip upload and go directly to form (`/curriculums?mode=manual`).

### F6 — Resume engine

- **F6.1** `generatePdf(profile)` produces a PDF with: header (name, contact), summary, experiences (most recent first), skills, education.
- **F6.2** `generateDocx(profile)` produces a DOCX with the same structure.
- **F6.3** Output stored in `storage/generated/` with timestamped filename.
- **F6.4** Uses `pdf-lib` for PDF, `docx` for DOCX.
- **F6.5** Strict invariant: **never fabricates data**. Empty fields are omitted, never replaced by placeholder text.

### F7 — LLM provider abstraction

- **F7.1** `LLMProvider` interface with:
  - `parseResume(text: string): Promise<StructuredResume>`
  - `scoreMatch(profile, job): Promise<MatchScore>`
  - `summarize(text: string): Promise<string>`
- **F7.2** `DeterministicStubProvider` implements the interface with:
  - `parseResume`: returns empty structured data.
  - `scoreMatch`: returns 0.
  - `summarize`: returns "stub".
- **F7.3** Provider is selected at worker boot via env var `LLM_PROVIDER=stub|ollama|openai|anthropic`.
- **F7.4** Real providers are out of scope for this slice but the interface supports them.

### F8 — SSE live updates

- **F8.1** Astro endpoint `GET /api/eventos` returns `text/event-stream`.
- **F8.2** Server polls `application_events` table every 1 second for new events.
- **F8.3** Events are emitted as SSE `data: {json}\n\n`.
- **F8.4** Client React island (`LiveFeed.tsx`) connects via `EventSource` and updates state via nanostores.
- **F8.5** Reconnect on disconnect with exponential backoff (max 30s).
- **F8.6** Heartbeat comment `:heartbeat` every 15s to keep connection alive.

### F9 — Worker health visibility

- **F9.1** Worker writes a heartbeat row to `agent_runs` every 60 seconds.
- **F9.2** Dashboard "Actividad" page shows worker status: connected (heartbeat < 90s old) | disconnected (with timestamp).
- **F9.3** Worker writes its PID to `data/worker.pid` on boot.

### F10 — Errors and skill health

- **F10.1** Dashboard `/errores` page shows `skill_healthchecks` table.
- **F10.2** Each skill shown with: slug, version, status badge, last self-check timestamp.
- **F10.3** Color coding: green (healthy), yellow (degraded), red (broken), blue (needs-human).
- **F10.4** Stub skill always reports healthy.

## Non-functional requirements

### N1 — Performance

- Dashboard first paint < 2s on a modern laptop.
- SSE event delivery latency < 2s from emission.
- Cron-driven scan completes within 5 minutes for the stub skill (no real network).

### N2 — Security

- No secrets in code or repo. `.env` gitignored.
- Uploaded CVs and generated files are local-only.
- SQL queries use parameterized statements (Drizzle enforces this).
- No eval, no `new Function`, no dynamic require.

### N3 — Reliability

- Worker crash does not crash web app.
- Web app crash does not lose data (all writes go to SQLite first).
- SQLite WAL mode enabled for concurrent reads/writes.

### N4 — Observability

- Structured logs (JSON) from worker and web.
- Log levels: debug, info, warn, error.
- Logs written to `storage/logs/{date}.jsonl` and stdout.

### N5 — Testability

- Vitest with strict TDD for `packages/domain`, `packages/skill-runtime`, `packages/database`.
- Coverage threshold 80% for those packages.
- Tests run on Windows.

### N6 — Portability

- All code runs on Windows (the dev's machine).
- No POSIX-only shell commands in scripts.
- Paths use `path.posix` or `path.join`, never hardcoded separators.

## Domain model (canonical)

```text
CandidateProfile (1) ── (N) Experience
                ├── (N) Skill
                └── (N) Document

Platform (1) ── (N) PlatformSkill (with version)
       └── (1) SkillSlug (logical name)

Job (N) ── (1) Platform
    └── (N) JobMatch ── (1) CandidateProfile
              └── (1) Application ── (N) ApplicationEvent
                                      └── (N) AgentRun

SkillHealthcheck (independent, by skill_slug)

TaskQueue (independent, FIFO with priority via scheduled_at)
```

## Interfaces / contracts

### `PlatformSkill` (packages/skill-runtime/src/types.ts)

```ts
export type SkillStatus = "healthy" | "degraded" | "broken" | "needs-human";

export interface ScanResult {
  jobsFound: number;
  jobsNew: number;
  jobsDuplicate: number;
  errors: number;
  rawEvidencePath?: string;
}

export interface SkillHealth {
  status: SkillStatus;
  lastError?: { code: string; message: string; screenshotPath?: string };
  schemaVersion: string;
  detectedAt: string; // ISO
}

export interface PlatformSkill {
  readonly slug: string;
  readonly version: string;
  readonly displayName: string;
  readonly requiredCandidateFields: ReadonlyArray<keyof CandidateProfile>;
  readonly capabilities: {
    readonly canScan: boolean;
    readonly canApply: boolean;
    readonly canDetectLoggedOut: boolean;
  };
  scan(profile: CandidateProfile, ctx: SkillContext): Promise<ScanResult>;
  apply?(job: Job, profile: CandidateProfile, ctx: SkillContext): Promise<ApplicationResult>;
  selfCheck(): Promise<SkillHealth>;
}
```

### `LLMProvider` (packages/llm/src/types.ts)

```ts
export interface StructuredResume {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  summary?: string;
  experiences: Array<{
    company: string;
    role: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }>;
  education: Array<{
    institution: string;
    degree?: string;
    startDate?: string;
    endDate?: string;
  }>;
  skills: Array<{ name: string; level?: string; years?: number }>;
}

export interface MatchScore {
  score: number; // 0-100
  breakdown: {
    skillsMatch: number;
    experienceMatch: number;
    locationMatch: number;
    seniorityMatch: number;
  };
  reasoning?: string;
}

export interface LLMProvider {
  readonly name: string;
  parseResume(text: string): Promise<StructuredResume>;
  scoreMatch(profile: CandidateProfile, job: Job): Promise<MatchScore>;
  summarize(text: string): Promise<string>;
}
```

### `TaskQueue` row shape

```sql
task_queue(
  id            TEXT PRIMARY KEY,         -- uuid
  type          TEXT NOT NULL,            -- SCAN_ACTIVE_PLATFORMS | SCAN_PLATFORM | GENERATE_CV | APPLY_JOB | ...
  payload_json  TEXT NOT NULL,            -- JSON
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  scheduled_at  TEXT NOT NULL,            -- ISO
  started_at    TEXT,
  completed_at  TEXT,
  error         TEXT
);
```

### `application_events` row shape

```sql
application_events(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER,                 -- nullable: events can belong to a run, not an app
  kind          TEXT NOT NULL,            -- "scan_started" | "scan_progress" | "scan_completed" | "match_found" | "skill_failed" | ...
  message       TEXT NOT NULL,
  payload_json  TEXT,
  occurred_at   TEXT NOT NULL             -- ISO
);
```

## Scenarios (Given/When/Then)

### S1 — Empty start

**Given** a fresh clone with no `data/` directory
**When** the user runs `npm install && npm run dev`
**Then** web app starts on `http://localhost:3000`
**And** worker starts and writes its PID to `data/worker.pid`
**And** SQLite database is auto-created at `data/employment-agent.db`
**And** migrations run on first boot
**And** dashboard loads with placeholder content for all routes.

### S2 — Upload CV and create profile

**Given** the user has no profile yet
**And** is on `/curriculums`
**When** they select a PDF file and click "Subir"
**Then** the system reads the file
**And** extracts text using `pdf-parse`
**And** calls `LLMProvider.parseResume()` which returns empty stub data
**And** shows an empty form
**And** the user fills: full_name, email, 2 experiences, 3 skills
**And** clicks "Guardar"
**Then** a row is inserted in `candidate_profiles`
**And** 2 rows in `candidate_experiences` with `source: "form"`
**And** 3 rows in `candidate_skills`
**And** the original PDF is stored at `storage/curriculum/{hash}.pdf`
**And** a row is inserted in `candidate_documents` with that hash.

### S3 — Skip upload, use form directly

**Given** the user has no profile yet
**And** is on `/curriculums`
**When** they click "Saltar upload y completar form"
**Then** the URL becomes `/curriculums?mode=manual`
**And** the form is shown empty (no upload required)
**And** saving creates the profile as in S2.

### S4 — Duplicate upload

**Given** the user already uploaded `cv.pdf` with hash `abc123`
**When** they upload the same file again
**Then** the system detects the hash collision
**And** shows a dialog: "¿Actualizar el perfil existente o crear uno nuevo?"
**And** if "actualizar": redirects to the edit form pre-filled with current data
**And** if "nuevo": opens a blank form to fill from scratch.

### S5 — Generate PDF resume

**Given** a saved profile
**When** the user clicks "Generar PDF"
**Then** `resume-engine/generatePdf(profile)` runs
**And** produces a PDF with header, summary, experiences, skills
**And** stores it at `storage/generated/{profile_id}-{timestamp}.pdf`
**And** inserts a `candidate_documents` row with `kind: "generated_pdf"`
**And** shows a download link in the UI.

### S6 — Generate DOCX resume

Same as S5 but with `docx` library and `.docx` extension.

### S7 — Cron triggers stub scan

**Given** worker is running and cron is `*/30 * * * *`
**When** 30 minutes elapse
**Then** cron fires
**And** a task with type `SCAN_ACTIVE_PLATFORMS` is enqueued in `task_queue`
**And** the task-runner picks it up
**And** for each active platform, enqueues a `SCAN_PLATFORM` task with the platform slug
**And** the stub skill runs and emits events:
  - `scan_started`
  - `scan_progress` (5 events for 5 fake jobs)
  - `job_found` (5 events, one per fake job)
  - `scan_completed`
**And** all events are written to `application_events` with timestamps.

### S8 — SSE live feed

**Given** worker is emitting events
**And** user is on `/actividad`
**When** a new event is written to `application_events`
**Then** within 2 seconds the SSE endpoint picks it up
**And** pushes it to the browser via `EventSource`
**And** the activity feed prepends a new line with timestamp and message
**And** no page reload occurs.

### S9 — Skill healthcheck in UI

**Given** the stub skill reports `healthy`
**When** user navigates to `/errores`
**Then** the page lists the stub skill
**And** shows a green badge "Saludable"
**And** shows last self-check timestamp.

### S10 — Worker disconnect detection

**Given** worker was running with PID in `data/worker.pid`
**And** last heartbeat is 2 minutes old
**When** user is on `/actividad`
**Then** the page shows "Worker desconectado desde {timestamp}"
**And** the dashboard remains responsive.

### S11 — No fabrication of candidate data

**Given** a profile with no phone number
**And** no summary
**When** the resume engine generates a PDF
**Then** the PDF omits the phone line entirely
**And** does not include placeholder text like "[your phone here]"
**And** does not include a fake summary.

### S12 — Job deduplication

**Given** the stub skill returns the same job twice across two scans
**When** the worker stores them
**Then** the unique index `(platform_id, external_id)` rejects the second insert
**And** the existing job's `last_seen_at` is updated
**And** only one row exists for that job.

### S13 — Task retry on transient failure

**Given** a task fails with a transient error (e.g., Playwright timeout)
**When** the task-runner catches the error
**Then** the task row is updated: `status: "retrying"`, `attempts++`, `error: "..."`
**And** after exponential backoff, the task is re-enqueued
**And** after `max_attempts`, status becomes `failed` and the skill is marked `degraded`.

## Acceptance criteria mapping

| AC# | Criterion | Validated by |
|---|---|---|
| 1 | `npm run dev` levanta web + worker | S1 |
| 2 | Dashboard carga con todas las rutas | S1 |
| 3 | Upload PDF → texto → form → guardar | S2 |
| 4 | Generación PDF y DOCX | S5, S6 |
| 5 | Cron dispara scan stub | S7 |
| 6 | Dashboard muestra eventos en vivo | S8 |
| 7 | Pantalla Errores con healthchecks | S9 |
| 8 | Tests Vitest con coverage >80% | (test suite) |
| 9 | No inventa datos del candidato | S11 |
| 10 | Skill stub NO aplica automáticamente | S7 (no apply events emitted) |

## Edge cases / error handling

- **CV corrupto**: `pdf-parse` throws → UI shows error, allows re-upload or skip.
- **DOCX sin texto embebido**: `mammoth` returns empty → UI allows manual fill.
- **Worker crash mid-scan**: tasks in `running` status stay there; on next worker boot, a sweep marks them as `retrying` if older than 10 minutes.
- **SQLite locked**: writer waits up to 5s, then errors; UI shows "base de datos ocupada, reintentando".
- **Browser pool exhausted**: third concurrent scan waits up to 30s for a slot; then errors with "browser pool full".
- **Resume engine runs on profile with 0 experiences**: produces PDF with only header (no experiences section).
- **Resume engine runs on profile with 50 experiences**: produces all 50, no truncation.
- **SSE client disconnects**: server cleans up the poller; reconnects on next page load.

## Out of scope

Referenced from `proposal.md` § Non-goals:

- Real portals (Chiletrabajos, Computrabajo) → `chiletrabajos-skill`, `computrabajo-skill`.
- Real LLM (Ollama, OpenAI, etc.) → `llm-integration`.
- Auth, multi-tenant, multi-user.
- Notifications (email, desktop push).
- Docker packaging.
- Real E2E tests against portals.
