# employment-agent

Asistente local de búsqueda de empleo con IA. Analiza tu CV, monitorea portales,
detecta ofertas compatibles y prepara postulaciones en modo asistido. Se repara
solo cuando los portales cambian, sin inventar datos del candidato.

## Estado actual — foundation slice (cerrada)

- 13 PRs definidos en `openspec/changes/initial-foundation/tasks.md`. **10 hechos, 3 pendientes** (ver más abajo).
- **44/44 tests pasando** (`npm test`).
- Ciclo SDD cerrado: `apply.md`, `verify.md`, `archive.md` en `openspec/changes/initial-foundation/`.

## Cómo correrlo

```bash
npm install
npm run dev          # Astro web (3000) + worker en paralelo
npm test             # Vitest
```

## Cómo está organizado

```
employment-agent/
├── apps/
│   └── web/                # Astro 4 + React islands + Tailwind
│                            # 9 rutas placeholder + SSE live feed
├── worker/                 # Node process separado
│                            # cron (30 min) + task queue + heartbeat + event emitter
├── packages/
│   ├── database/           # Drizzle ORM (14 tablas) + driver libsql
│   ├── domain/             # Tipos compartidos, scoring, invariantes (no-fabrication)
│   ├── llm/                # Interfaz provider-agnostic + DeterministicStubProvider
│   ├── resume-engine/      # Generación CVs PDF (pdf-lib) y DOCX (docx)
│   ├── skill-runtime/      # Runtime de skills + registry + errores tipados
│   └── shared/             # Logger, paths, errores
├── skills/
│   └── example-platform/   # Skill stub para desarrollo (5 fake jobs por scan)
├── data/                   # SQLite local (gitignored)
├── storage/                # CVs, screenshots, sesiones (gitignored)
├── drizzle/                # Migraciones (gitignored)
└── openspec/
    └── changes/
        └── initial-foundation/   # Spec, design, tasks, apply, verify, archive
```

## Decisiones de arquitectura clave

- **Stack**: Astro 4 + React islands + Tailwind + SQLite + Drizzle (libsql) + LLM provider-agnostic.
- **Modo**: Asistido. El agente arma la postulación, vos hacés el submit final.
- **No invención**: el sistema nunca inventa datos del candidato. Invariante enforced en código (`packages/domain/src/invariants.ts`).
- **Worker aislado**: si Playwright se cuelga, el dashboard sigue funcionando.
- **Auto-reparación conservadora**: las skills se adaptan a cambios en portales, pero la lógica core no se modifica sin intervención humana.

Más detalle en `openspec/changes/initial-foundation/design.md` y en engram (topic `architecture/employment-agent`).

## PRs pendientes (próximo slice)

- **PR 9** — Componentes UI base en Astro (Button, Card, Badge, Input, Dialog). Reemplaza el Tailwind crudo en las rutas placeholder.
- **PR 10** — CV pipeline: upload PDF/DOCX → parser → form de edición → guardar en `candidate_profiles`.
- **PR 12** — Errors page real: integrar `skill_failures` y healthchecks, no placeholder.

## Cómo contribuir

- Toda propuesta pasa por SDD con gentle-ai: `openspec/changes/{nombre}/`.
- Tests con Vitest (TDD estricto).
- Reviews por debajo de 400 líneas por PR (`openspec/config.yaml`).