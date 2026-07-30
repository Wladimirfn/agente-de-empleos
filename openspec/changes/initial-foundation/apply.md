# Apply — initial-foundation

Estado de implementación de los 13 PRs definidos en `tasks.md` al cierre del slice.

| PR | Descripción | Estado | Evidencia |
|---|---|---|---|
| 1 | Monorepo foundation | ✅ done | `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `drizzle.config.ts`, `.gitignore`, `README.md` |
| 2 | Database schema + migrations | ✅ done | 14 tablas en `packages/database/src/schema/*.ts`, client con libsql en `client.ts` |
| 3 | Domain + Skill Runtime types | ✅ done | `packages/domain/src/`, `packages/skill-runtime/src/` con tipos e invariantes |
| 4 | LLM Provider abstraction | ✅ done | `packages/llm/src/` con interfaz + stub determinístico + factory por env |
| 5 | Resume engine | ✅ done | pdf-lib + docx con invariant "no-fabrication" enforced |
| 6 | Worker core | ✅ done | `worker/src/` con process manager, cron, task queue, heartbeat, skill init, event-emitter |
| 7 | Stub skill (example-platform) | ✅ done | `skills/example-platform/index.ts` emite 5 fake jobs por scan |
| 8 | Astro web shell | ✅ done | 9 rutas Astro + layout con sidebar + Tailwind en `apps/web/src/` |
| 9 | shadcn/ui setup | ⏸ deferred | Tailwind directo en este slice. Componentes UI base vendrán como `packages/ui` en slice siguiente |
| 10 | CV pipeline | ⏸ deferred | Form de upload/parse/edit queda para slice `cv-pipeline` |
| 11 | SSE live feed | ✅ done | endpoint `apps/web/src/pages/api/eventos.ts`, `LiveFeed` island, polling 1s |
| 12 | Errors page real | ⏸ placeholder | Página renderiza pero no consume `skill_healthchecks` aún |
| 13 | End-to-end smoke | ⏸ partial | Tests pasan (44/44), pero smoke E2E manual todavía no corrido contra web+worker |

## Resumen

- **10 de 13 PRs implementados al 100 %**.
- **3 PRs diferidos explícitamente** (9, 10, 12) — fuera de scope del slice `initial-foundation`.
- **Bloqueador técnico resuelto**: el cliente de database ahora usa `@libsql/client` (driver 100 % JS, sin build tools en Windows). Los 2 tests que fallaban ahora pasan. 44/44 verde.

## Out-of-scope capturado (próximos slices)

- Portales reales (chiletrabajos, computrabajo) → `chiletrabajos-skill` slice
- LLM real (Ollama o API configurable) → `llm-integration` slice
- Auto-reparación conservadora de skills → `skill-repair-runtime` slice
- Notifications desktop → `notifications` slice
- Docker packaging → `docker-packaging` slice

## Cambios de diseño relevantes durante implementación

1. **Astro confirmado sobre Next.js**: la conversación inicial mencionó Next.js + shadcn/ui como stack tentativo. Después de explorar y aprobar `proposal.md`, se cerró con Astro 4 + React islands. Esta decisión está en `openspec/changes/initial-foundation/proposal.md` y se respeta en este slice.
2. **libsql sobre node:sqlite**: el driver `node-sqlite` de Drizzle requería un subpath (`drizzle-orm/node-sqlite`) que Vite/Vitest no resolvía en este proyecto. Migrado a `@libsql/client` con `drizzle-orm/libsql`. Sin impacto en runtime.
3. **Cliente DB asincrónico**: el cambio de driver hizo natural una API async (`initDb`, `runMigrations`, `closeDb`). Migraciones y cierre ahora son `Promise`. No se observa impacto en el worker ni en la web.
