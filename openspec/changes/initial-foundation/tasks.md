# Tasks — initial-foundation

This document decomposes `design.md` into discrete implementation units.
Each task belongs to a PR slice (force-chained: ≤400 lines modified per PR).

Total: **13 PRs**, each independently mergeable.

## PR slices overview

| # | PR | Tasks | Approx lines |
|---|---|---|---|
| 1 | Monorepo foundation | T1.1–T1.6 | ~150 |
| 2 | Database schema + migrations | T2.1–T2.4 | ~350 |
| 3 | Domain + Skill Runtime types | T3.1–T3.4 | ~300 |
| 4 | LLM Provider abstraction | T4.1–T4.3 | ~150 |
| 5 | Resume engine | T5.1–T5.3 | ~250 |
| 6 | Worker core | T6.1–T6.5 | ~350 |
| 7 | Stub skill (example-platform) | T7.1–T7.2 | ~100 |
| 8 | Astro web shell | T8.1–T8.3 | ~300 |
| 9 | shadcn/ui setup | T9.1–T9.2 | ~200 |
| 10 | CV pipeline | T10.1–T10.3 | ~300 |
| 11 | SSE live feed | T11.1–T11.3 | ~250 |
| 12 | Errors page | T12.1–T12.2 | ~150 |
| 13 | End-to-end smoke | T13.1–T13.2 | ~100 |

## PR 1 — Monorepo foundation

### T1.1 — Root `package.json` with workspaces
- **File**: `package.json` (root)
- **Action**: Add workspaces field, scripts (dev, dev:web, dev:worker, build, test, db:generate, db:migrate), devDeps (typescript, vitest, drizzle-kit, concurrently).
- **Tests**: none (config).
- **AC**: `npm install` from root succeeds; `npm ls --workspaces` lists all expected workspaces.

### T1.2 — Root `tsconfig.base.json`
- **File**: `tsconfig.base.json`
- **Action**: Strict TypeScript, ESM, target ES2022, module NodeNext, paths aliases for `@employment-agent/*`.
- **Tests**: none.
- **AC**: Each package extends this and `tsc --noEmit` per package succeeds (when packages exist).

### T1.3 — Root `vitest.config.ts`
- **File**: `vitest.config.ts`
- **Action**: Vitest config with v8 coverage, path aliases, thresholds for domain/skill-runtime/database.
- **Tests**: T1.3.1 placeholder test in `tests/smoke.test.ts` to verify Vitest works.
- **AC**: `npm test` from root runs and reports coverage.

### T1.4 — Root `drizzle.config.ts`
- **File**: `drizzle.config.ts`
- **Action**: Drizzle Kit config pointing to `packages/database/src/schema` and `drizzle/migrations`.
- **Tests**: none.
- **AC**: `npx drizzle-kit generate` reads config without error.

### T1.5 — `.env.example`
- **File**: `.env.example`
- **Action**: Document env vars: `DATABASE_PATH`, `LLM_PROVIDER`, `LOG_LEVEL`, `WEB_PORT`.
- **Tests**: none.
- **AC**: Copying to `.env` and running any command picks up the vars.

### T1.6 — Update `.gitignore` and `README.md`
- **Files**: `.gitignore`, `README.md`
- **Action**: Already done in init phase. Verify completeness for new build outputs.

## PR 2 — Database schema + migrations

### T2.1 — Database package setup
- **Files**: `packages/database/package.json`, `packages/database/tsconfig.json`, `packages/database/src/index.ts`
- **Action**: Workspace package, exports `db` (Drizzle client) and `runMigrations()`. Uses `better-sqlite3` with WAL mode.
- **Tests**: T2.1.1 — `tests/client.test.ts` verifies DB file is created and migrations can run.
- **AC**: `npm --workspace=@employment-agent/database run build` succeeds; importing `@employment-agent/database` works.

### T2.2 — Schema: candidate, document
- **Files**: `packages/database/src/schema/candidate.ts`, `packages/database/src/schema/document.ts`
- **Action**: Drizzle schema for `candidate_profiles`, `candidate_experiences`, `candidate_skills`, `candidate_documents`. Unique index on `(file_hash, kind)`.
- **Tests**: T2.2.1 — insert + read + dedup test.
- **AC**: `drizzle-kit generate` produces SQL; migrations apply cleanly.

### T2.3 — Schema: platform, jobs
- **Files**: `packages/database/src/schema/platform.ts`, `packages/database/src/schema/jobs.ts`
- **Action**: Schemas for `platforms`, `platform_skills`, `jobs`, `job_matches`, `applications`, `application_events`. Unique index on `jobs(platform_id, external_id)`.
- **Tests**: T2.3.1 — insert + dedup test for jobs.
- **AC**: Migrations apply; unique constraint enforced.

### T2.4 — Schema: agent, task queue
- **Files**: `packages/database/src/schema/agent.ts`, `packages/database/src/schema/task-queue.ts`
- **Action**: Schemas for `agent_runs`, `skill_failures`, `skill_healthchecks`, `task_queue`.
- **Tests**: T2.4.1 — enqueue, claim, complete, retry flow.
- **AC**: Full schema is migrated; queue supports atomic claim.

## PR 3 — Domain types + Skill Runtime interfaces

### T3.1 — Domain package
- **Files**: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`, `packages/domain/src/types.ts`
- **Action**: Export canonical types: `CandidateProfile`, `Experience`, `Skill`, `Job`, `Application`, `ApplicationStatus`, `AgentRun`, `SkillFailure`.
- **Tests**: T3.1.1 — type-only sanity tests (compile checks).
- **AC**: Types compile and are importable from `@employment-agent/domain`.

### T3.2 — Domain invariants
- **File**: `packages/domain/src/invariants.ts`
- **Action**: Functions `assertNoFabrication(profile)` and `safeProfileField(profile, key)`. Documented as load-bearing.
- **Tests**: T3.2.1 — invariants.test.ts with cases:
  - Profile without phone → assertion passes.
  - Profile with summary longer than max → assertion fails.
  - Empty experience list → no error.
- **AC**: Invariants exported and used in resume engine.

### T3.3 — Skill runtime package: types
- **Files**: `packages/skill-runtime/package.json`, `packages/skill-runtime/src/types.ts`, `packages/skill-runtime/src/index.ts`
- **Action**: `PlatformSkill`, `ScanResult`, `SkillHealth`, `SkillStatus`, `SkillContext`, `SkillCapabilities`.
- **Tests**: T3.3.1 — interface conformance (compile-time via test fixtures).
- **AC**: Package builds; types importable.

### T3.4 — Skill runtime: registry, errors, context
- **Files**: `packages/skill-runtime/src/registry.ts`, `packages/skill-runtime/src/errors.ts`, `packages/skill-runtime/src/context.ts`
- **Action**: `register(skill)`, `get(slug)`, `list()`, `unregister(slug)`. Errors: `HumanInterventionRequired`, `TransientSkillError`, `FatalSkillError`. Context provides `events` and `browserPool` accessors.
- **Tests**: T3.4.1 — register, get, unregister, list.
  T3.4.2 — error classes can be caught as AppError.
- **AC**: Registry works; errors are catchable; coverage >80%.

## PR 4 — LLM Provider abstraction

### T4.1 — LLM package types
- **Files**: `packages/llm/package.json`, `packages/llm/src/types.ts`, `packages/llm/src/index.ts`
- **Action**: `LLMProvider` interface with `name`, `parseResume`, `scoreMatch`, `summarize`. `StructuredResume` and `MatchScore` types.
- **Tests**: T4.1.1 — type compile-checks.
- **AC**: Package builds; types importable.

### T4.2 — DeterministicStubProvider
- **File**: `packages/llm/src/providers/stub.ts`
- **Action**: Stub implementation returning empty/zero/fixed values.
- **Tests**: T4.2.1 — `parseResume('any text')` returns empty; `scoreMatch` returns 0; `summarize` returns 'stub'.
- **AC**: All three methods behave deterministically.

### T4.3 — Factory
- **File**: `packages/llm/src/factory.ts`
- **Action**: `createLLMProvider()` reads `LLM_PROVIDER` env var, returns matching implementation. Stub-only for this slice.
- **Tests**: T4.3.1 — factory returns stub when env unset or `stub`.
  T4.3.2 — factory throws on unknown provider.
- **AC**: Default is stub; unknown values throw.

## PR 5 — Resume engine

### T5.1 — Resume engine package setup
- **Files**: `packages/resume-engine/package.json`, `packages/resume-engine/src/index.ts`, `packages/resume-engine/tsconfig.json`
- **Action**: Workspace package, exports `generatePdf` and `generateDocx`. Depends on `@employment-agent/domain`.
- **Tests**: T5.1.1 — module exports test.
- **AC**: Package builds.

### T5.2 — PDF generation with no-fabrication invariant
- **File**: `packages/resume-engine/src/pdf.ts`
- **Action**: `generatePdf(profile: CandidateProfile): Promise<Uint8Array>` using pdf-lib. Omits empty fields, no placeholder text.
- **Tests**: T5.2.1 — empty phone: PDF does not contain 10-digit string.
  T5.2.2 — empty summary: PDF has no "Summary" header.
  T5.2.3 — full profile: PDF contains name, all experiences, all skills.
  T5.2.4 — 50 experiences: PDF renders all (no truncation).
- **AC**: Invariants enforced; coverage >80%.

### T5.3 — DOCX generation with no-fabrication invariant
- **File**: `packages/resume-engine/src/docx.ts`
- **Action**: `generateDocx(profile: CandidateProfile): Promise<Buffer>` using `docx` library. Same omission rules.
- **Tests**: T5.3.1 — same invariants as PDF, applied to DOCX content extraction.
- **AC**: Invariants enforced.

## PR 6 — Worker core

### T6.1 — Worker package setup
- **Files**: `worker/package.json`, `worker/tsconfig.json`, `worker/index.ts`
- **Action**: Workspace, entry point `index.ts`, scripts `dev` (tsx watch) and `start`. Depends on `@employment-agent/database`, `@employment-agent/domain`, `@employment-agent/skill-runtime`, `@employment-agent/shared`.
- **Tests**: none (entry point).
- **AC**: `npm --workspace=worker run dev` starts worker (no-op for now).

### T6.2 — Event emitter
- **File**: `worker/event-emitter.ts`
- **Action**: `EventEmitter` class writing to `application_events` table. Methods: `emit({ kind, message, payload? })`.
- **Tests**: T6.2.1 — emit writes a row; emits are sequential.
- **AC**: Events appear in DB.

### T6.3 — Task queue operations
- **File**: `worker/task-queue.ts`
- **Action**: `enqueueTask({ type, payload, scheduledAt? })`, `claimNextTask()` (atomic UPDATE RETURNING), `markCompleted(id)`, `markFailed(id, error)`, `markRetrying(id, error, nextAttemptAt)`.
- **Tests**: T6.3.1 — enqueue, claim, complete.
  T6.3.2 — enqueue, claim, fail, retry, fail-again → max_attempts reached.
  T6.3.3 — concurrent claims return different tasks (atomic).
- **AC**: Queue behaves correctly under contention.

### T6.4 — Task runner
- **File**: `worker/task-runner.ts`
- **Action**: Polls queue every 5s, dispatches `SCAN_ACTIVE_PLATFORMS`, `SCAN_PLATFORM`, `GENERATE_CV`, `APPLY_JOB` handlers. Uses registry to get skill. Catches errors and routes to retry/fail per error type.
- **Tests**: T6.3 covered most. Add T6.4.1 — handler resolution by task type.
- **AC**: Tasks flow through correctly.

### T6.5 — Scheduler + heartbeat
- **Files**: `worker/scheduler.ts`, `worker/heartbeat.ts`
- **Action**: `node-cron` for `*/30 * * * *` enqueues `SCAN_ACTIVE_PLATFORMS`. Heartbeat loop inserts row in `agent_runs` every 60s with `kind: 'heartbeat'`.
- **Tests**: T6.5.1 — heartbeat loop inserts rows.
- **AC**: Cron registered; heartbeat runs.

## PR 7 — Stub skill (example-platform)

### T7.1 — Stub skill implementation
- **File**: `skills/example-platform/index.ts`
- **Action**: Implements `PlatformSkill`. `scan()` emits 5 fake jobs via `ctx.events.emit`. `apply()` throws `HumanInterventionRequired`. `selfCheck()` returns `healthy`.
- **Tests**: T7.1.1 — calling scan emits events.
  T7.1.2 — apply throws expected error.
  T7.1.3 — selfCheck returns healthy.
- **AC**: Skill conforms to PlatformSkill interface.

### T7.2 — Skill initialization
- **File**: `worker/skill-init.ts`
- **Action**: Registers `examplePlatformSkill` on worker boot. Logs registered skills with versions.
- **Tests**: T7.2.1 — registry contains example-platform after init.
- **AC**: Skill available at runtime.

## PR 8 — Astro web shell

### T8.1 — Astro app setup
- **Files**: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/astro.config.mjs`, `apps/web/tailwind.config.mjs`, `apps/web/src/styles/global.css`
- **Action**: Astro 4.x, React 18, Tailwind, Node adapter. Workspace package.
- **Tests**: none.
- **AC**: `npm --workspace=apps/web run dev` starts on port 3000.

### T8.2 — Base layout + 9 placeholder routes
- **Files**: `apps/web/src/layouts/Base.astro`, `apps/web/src/pages/{index,perfil/index,curriculums/index,ofertas/index,postulaciones/index,plataformas/index,skills/index,actividad/index,errores/index}.astro`
- **Action**: Sidebar nav, main content area, placeholder text per route.
- **Tests**: none (UI).
- **AC**: All 9 routes load at `http://localhost:3000/<route>`.

### T8.3 — Shared components (header, sidebar, empty state)
- **Files**: `apps/web/src/components/astro/Sidebar.astro`, `Header.astro`, `EmptyState.astro`
- **Action**: Reusable server-rendered components.
- **Tests**: none.
- **AC**: Sidebar links to all routes; empty state on routes with no data.

## PR 9 — shadcn/ui setup

### T9.1 — components.json + utils
- **Files**: `apps/web/components.json`, `apps/web/src/lib/utils.ts`
- **Action**: shadcn config + `cn()` helper (clsx + tailwind-merge).
- **Tests**: none.
- **AC**: `npx shadcn@latest add button` works inside `apps/web/`.

### T9.2 — Scaffold core components
- **Files**: `apps/web/src/components/ui/{button,card,dialog,input,label,table,toast,badge,tabs,textarea,select}.tsx`
- **Action**: Run `shadcn` for each. Customise lightly for Astro+Tailwind setup.
- **Tests**: T9.2.1 — render test for `Button` (happy-dom).
- **AC**: Components importable; render with no errors.

## PR 10 — CV pipeline

### T10.1 — Domain CV parser
- **File**: `packages/domain/src/cv-parser.ts`
- **Action**: `extractTextFromPdf(buffer): Promise<string>`, `extractTextFromDocx(buffer): Promise<string>`. Uses `pdf-parse` and `mammoth`.
- **Tests**: T10.1.1 — small PDF fixture returns expected text.
  T10.1.2 — small DOCX fixture returns expected text.
- **AC**: Parsers handle both formats.

### T10.2 — Upload endpoint
- **File**: `apps/web/src/pages/api/upload-cv.ts`
- **Action**: POST endpoint, multipart form, reads file, computes SHA-256, checks dedup, extracts text, calls LLMProvider.parseResume, returns structured data.
- **Tests**: T10.2.1 — endpoint integration test (happy-dom + mock multipart).
- **AC**: Endpoint returns 200 with structured data; duplicate returns dedup info.

### T10.3 — UploadCvForm + ProfileForm islands
- **Files**: `apps/web/src/components/islands/UploadCvForm.tsx`, `apps/web/src/components/islands/ProfileForm.tsx`
- **Action**: React islands. UploadCvForm posts to endpoint, shows duplicate dialog, redirects to form. ProfileForm pre-fills from parsed data, validates, submits to save endpoint.
- **Tests**: T10.3.1 — render snapshot.
- **AC**: Forms work end-to-end.

## PR 11 — SSE live feed

### T11.1 — SSE endpoint
- **File**: `apps/web/src/pages/api/eventos.ts`
- **Action**: GET endpoint, polls SQLite every 1s, emits new events as SSE data lines. Heartbeat every 15s. Cleanup on request abort.
- **Tests**: T11.1.1 — endpoint returns text/event-stream; first poll yields events.
- **AC**: Endpoint streams events.

### T11.2 — SSE client + nanostores bridge
- **Files**: `apps/web/src/lib/sse-client.ts`, `apps/web/src/stores/activity.ts`
- **Action**: `connectToEventStream(onEvent)` opens EventSource, calls callback. `recentEvents` nanostore atom. Client populates atom.
- **Tests**: T11.2.1 — store updates on emit.
- **AC**: Events flow to client store.

### T11.3 — LiveFeed island + /actividad page
- **Files**: `apps/web/src/components/islands/LiveFeed.tsx`, update `apps/web/src/pages/actividad/index.astro`
- **Action**: LiveFeed subscribes to store, renders list with timestamp+message. Page uses island.
- **Tests**: T11.3.1 — render snapshot.
- **AC**: Live updates in UI.

## PR 12 — Errors page

### T12.1 — Health endpoint
- **File**: `apps/web/src/pages/api/health.ts`
- **Action**: GET endpoint returns latest `skill_healthchecks` rows + last heartbeat timestamp.
- **Tests**: T12.1.1 — returns expected shape.
- **AC**: Endpoint returns JSON with skills + heartbeat.

### T12.2 — /errores page + HealthBadge island
- **Files**: `apps/web/src/components/islands/HealthBadge.tsx`, update `apps/web/src/pages/errores/index.astro`
- **Action**: Page fetches from /api/health on load. HealthBadge renders status with color coding.
- **Tests**: T12.2.1 — HealthBadge renders correctly per status.
- **AC**: Errors page shows skills with badges.

## PR 13 — End-to-end smoke

### T13.1 — npm run dev smoke
- **Action**: Manually run `npm run dev`. Verify both processes start. Open browser to localhost:3000, click through all routes. Trigger cron manually (e.g., reduce interval or call enqueueTask). Verify events appear in /actividad.
- **AC**: All 10 acceptance criteria from `proposal.md` validated manually.

### T13.2 — Coverage check
- **Action**: Run `npm run test:coverage`. Confirm coverage >80% in domain, skill-runtime, database.
- **AC**: Coverage threshold met.

## Cross-cutting concerns

- **Dependency installation**: Each PR's first task includes `npm install` from root.
- **Strict TDD**: For every task in domain/skill-runtime/database, write failing test first.
- **Force-chained**: Each PR is a separate branch + PR.
- **Documentation**: Each PR updates README if user-facing behavior changes.

## Risk gates between PRs

Before merging each PR, verify:
1. `npm test` from root passes.
2. `npm run typecheck` (after PR 2) passes.
3. No more than 400 lines modified.
4. Acceptance criteria for that PR met.
5. No new TODO comments without a tracking task.

If any gate fails, the PR is blocked and the issue is fixed before merge.
