# AGENTS.md — Convenciones para agentes de IA

Este repositorio se trabaja desde **varios computadores** y con **varias IA en
paralelo**. Seguí estas reglas SIEMPRE, sin excepciones.

> ## Regla central
>
> **Un agente, una tarea, una rama y un worktree.**
>
> Antes de empezar a tocar código: ¿tenés una tarea asignada? ¿Tenés una rama
> propia creada desde `origin/main`? ¿Estás trabajando en tu propio worktree?
> Si la respuesta a cualquiera es NO, parate y avisá al usuario antes de continuar.

## Reglas obligatorias

1. **Nunca modifiques directamente `main`.** Todo cambio entra por una rama de
   tarea y un Pull Request. Si el usuario te pide "cambiar main", explicá que el
   flujo es: rama → PR → validaciones → merge.
2. **Trabajá en una rama propia.** Convención de nombres:
   - `feature/nombre-tarea`
   - `fix/nombre-error`
   - `refactor/nombre-cambio`
   - `docs/nombre-documentacion`
   - `chore/nombre-mantenimiento`
3. **No uses `git reset --hard` sobre trabajo que no creaste vos.**
4. **No uses `git clean -fd` sin revisar** exactamente qué archivos va a borrar
   (`git clean -nd` primero). En este repo `storage/`, `data/` y archivos locales
   contienen información personal del usuario.
5. **No uses `git push --force`** (ni `--force-with-lease` salvo autorización
   explícita del usuario sobre TU propia rama y solo si es necesario).
6. **No borres ni regeneres migraciones existentes.** Las migraciones de Drizzle
   en `drizzle/migrations/` son versionadas y compartidas. Para cambios de
   esquema: editá `packages/database/src/schema/` y generá UNA migración nueva
   con `npm run db:generate`.
7. **No modifiques archivos fuera del alcance de la tarea.**
8. **Revisá `git status` antes y después** de trabajar, y reportá qué cambió.
9. **Ejecutá lint, pruebas y build antes de entregar**: `npm test`, `npm run
   typecheck`, `npm run build`. No entregues nada que no pase las validaciones
   (si algo ya fallaba en `main` antes de tu cambio, decilo explícitamente).
10. **Informá los archivos modificados** en tu resumen final.
11. **Informá las pruebas ejecutadas** (cuáles y resultado).
12. **Creá commits pequeños y comprensibles.** Mensajes en inglés siguiendo
    [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
    `refactor:`, `docs:`, `chore:`, `test:`. Un commit = una unidad lógica.
    Ejemplo: `feat(web): add job search filters`.
13. **Mantené compatibilidad con otros computadores.** No dependas de rutas
    absolutas locales ni de datos que solo existen en una máquina. Todo lo que
    necesita otro entorno va versionado (`.env.example`, migraciones, seeds).
14. **No guardes decisiones importantes solamente en memoria externa de IA**
    (Engram, notas del agente). Documentá las decisiones relevantes **dentro del
    repositorio** (README, docs/ o el PR).
15. **Usá un worktree independiente cuando haya más de un agente trabajando
    simultáneamente.** Un agente = una carpeta de trabajo = una rama. Nunca dos
    agentes en el mismo working directory a la vez.
16. **Sincronizá antes de empezar**: `git fetch origin`, y si tu rama ya existe en
    el remoto, `git pull --ff-only`.

## Flujo de trabajo estándar

```bash
# 1. Crear (o unirse a) un worktree con la rama de la tarea
./scripts/new-worktree.sh feature/mi-tarea        # Windows: .\scripts\new-worktree.ps1 feature/mi-tarea

# 2. Trabajar en esa carpeta
cd ../agente-de-empleos-feature-mi-tarea
npm install

# 3. Commits pequeños y comprensibles
git add <archivos-de-la-unidad>
git commit -m "feat(web): ..."

# 4. Push y PR al terminar
git push -u origin feature/mi-tarea
gh pr create --base main   # o abrir PR desde GitHub
```

## Entorno

- **Node 22 LTS** (`.nvmrc`). Otros Node pueden fallar.
- **npm** con lockfile (`package-lock.json`). Usá `npm ci` para instalaciones
  reproducibles; no edites el lockfile a mano.
- El archivo de entorno es **`.env`** (gitignored). Copiá `.env.example` a `.env`
  y completá los valores localmente. Nunca subas `.env`.
- Base de datos: SQLite local en `data/` (gitignored). Migraciones Drizzle
  versionadas en `drizzle/migrations/`.

## En caso de duda

Parate y preguntá al usuario. No "resuelvas" asumiendo el flujo de git o el
alcance de la tarea. Trabajamos en paralelo y sobre ramas compartidas: un error
de git de un agente puede costarle horas a otro.
