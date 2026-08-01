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
├── drizzle/                # Migraciones Drizzle versionadas (NO ignoradas)
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
- Ver `AGENTS.md` para las convenciones obligatorias de trabajo con agentes IA.

---

# Desarrollo desde varios computadores

Este proyecto está preparado para trabajar desde **varios PC** y con **varias IA
en paralelo**, sin pisarse los cambios. La rama principal es `main` y está
protegida: todo cambio entra por **Pull Request**. Detalle completo en
[`docs/MULTI_PC_WORKFLOW.md`](docs/MULTI_PC_WORKFLOW.md).

## Requisitos

- **Node 22 LTS** (ver `.nvmrc`). Con `nvm`: `nvm use`.
- **Git** reciente (2.30+).
- `npm` (viene con Node).
- Opcional: [GitHub CLI](https://cli.github.com/) (`gh`) para abrir PRs desde la terminal.

## Instalación

```bash
npm install
```

## Configuración de `.env`

```bash
# Linux/macOS
cp .env.example .env
# Windows
copy .env.example .env
```

Completá los valores localmente. `.env` está en `.gitignore`: nunca se sube.

## Inicio del proyecto

```bash
npm run dev          # Astro web (3000) + worker en paralelo
npm test             # Vitest
```

## Ejecución de pruebas

```bash
npm test             # suite completa
npm run typecheck    # chequeo de tipos
npm run build        # build de Astro
npm run db:migrate   # aplicar migraciones de la base de datos
```

## Migraciones de base de datos

- Las migraciones Drizzle están **versionadas** en `drizzle/migrations/`.
- Después de cada `git pull` o al clonar en un PC nuevo: `npm run db:migrate`.
- Para cambios de esquema: editá `packages/database/src/schema/`, luego
  `npm run db:generate` para crear la migración nueva. **Nunca** borres ni
  regeneres migraciones existentes.
- La base local (`data/*.db`) está gitignored; cada PC reconstruye la suya.

## Creación de una rama

```bash
git fetch origin
git switch -c feature/nombre-tarea origin/main
```

Convención: `feature/`, `fix/`, `refactor/`, `docs/`, `chore/`. Las ramas
representan **tareas**, no computadores.

## Creación de un worktree (recomendado para agentes en paralelo)

```bash
# Linux/macOS
./scripts/new-worktree.sh feature/dashboard
# Windows
.\scripts\new-worktree.ps1 feature/dashboard
```

Crea la rama desde `origin/main` y una carpeta hermana `agente-de-empleos-feature-dashboard/`.
Cuando termines y merges el PR: `scripts/remove-worktree.sh feature/dashboard --delete-branch`.

## Continuación desde otro PC

```bash
git fetch origin
git switch nombre-rama
git pull --ff-only
```

Y antes de dejar el PC, SIEMPRE: `git add . && git commit -m "wip: avance" && git push`.

## Apertura de Pull Request

```bash
git push -u origin feature/nombre-tarea
gh pr create --base main
```

El workflow `validate.yml` corre typecheck, tests, build, migraciones y escaneo
de secretos automáticamente. `main` está protegida: no hay push directo ni force push.

## Procedimiento de actualización desde `main`

Cuando tu rama quedó atrás de `main`:

```bash
git fetch origin
git switch feature/nombre-tarea
git merge origin/main     # o: git pull --ff-only si tu rama no diverge
```

Resolver conflictos: ver [`docs/MULTI_PC_WORKFLOW.md`](docs/MULTI_PC_WORKFLOW.md#resolver-conflictos-sin-borrar-trabajo-ajeno).