# Flujo entre computadores (y entre agentes IA)

Este repositorio está preparado para trabajar desde **varios PC** y con **varias
IA en paralelo** sin pisarse los cambios. Las reglas de oro:

1. **Nunca trabajes directo en `main`**. Todo pasa por una rama de tarea y un Pull Request.
2. **Una tarea = una rama = un worktree** (una IA = un worktree).
3. **Nunca uses `git push --force`**.
4. **Nunca subas `.env`**.
5. **Siempre sincronizá antes de empezar y antes de dejar el PC**.

---

## Antes de comenzar en un PC

```bash
git fetch origin
git switch nombre-rama
git pull --ff-only
```

`--ff-only` evita merges sorpresa: si Git no puede hacer fast-forward, parate y
revisá qué cambió antes de resolver.

## Antes de abandonar un PC

```bash
git status                       # qué cambió
git add .
git commit -m "wip: avance de la tarea"
git push
```

Regla simple: **todo lo importante termina en GitHub**. Si un PC se pierde o se
rompe, el trabajo no se pierde.

## Primera vez que se abre una rama remota en otro PC

```bash
git fetch origin
git switch --track origin/nombre-rama
```

O con worktree (recomendado para agentes en paralelo):

```bash
./scripts/new-worktree.sh feature/mi-tarea
```

Esto crea una carpeta hermana `agente-de-empleos-feature-mi-tarea/` con la rama
nueva basada en `origin/main`.

---

## Reglas que evitan el desastre

| Regla | Por qué |
|---|---|
| No comenzar a trabajar sin actualizar la rama | Evitás conflictos basados en información vieja. |
| No usar `git push --force` | Sobrescribe trabajo ajeno (o el tuyo de otro PC) sin aviso. |
| No trabajar directo en `main` | `main` está protegida; además es la base de todos. |
| No copiar manualmente carpetas del proyecto entre PC | Rompe git, worktrees y estados locales. Usá git. |
| No subir `.env` | Contiene credenciales. Solo `.env.example` se comparte. |
| No dejar cambios importantes solo en un PC | Un PC roto = trabajo perdido. |
| No borrar migraciones existentes | Son versionadas y compartidas; borrarlas rompe otros entornos. |

## Resolver conflictos sin borrar trabajo ajeno

1. Actualizá la rama:
   ```bash
   git fetch origin
   git switch mi-rama
   git merge origin/main   # o git pull --ff-only si tu rama solo tiene tus commits
   ```
2. Git marca los archivos en conflicto. Abrí cada uno, buscá los marcadores
   `<<<<<<<` / `=======` / `>>>>>>>` y decidí qué versión conservar.
   **Nunca** borres el contenido del otro a ciegas: si no estás seguro, preguntá.
3. Cuando esté resuelto:
   ```bash
   git add .
   git commit -m "merge: resolver conflictos con main"
   git push
   ```

Si el otro agente/PC sigue trabajando en la misma rama, avisale antes de resolver:
dos personas resolviendo el mismo conflicto en paralelo generan más conflictos.

## Recuperar trabajo perdido con `git reflog`

Si hiciste un `git reset` o `git checkout` que "borró" commits:

```bash
git reflog
```

Verás la lista de acciones recientes con sus hashes. Para volver a un commit:

```bash
git switch -c rama-de-rescate <hash>
```

El trabajo no se pierde hasta que el commit deja de estar referenciado y Git lo
recolecta (días/semanas después). El `reflog` es local a cada PC: si el trabajo
nunca se pusheó y el PC se perdió, no hay rescate posible — de ahí la regla
"terminar todo en GitHub".

## Worktrees para agentes en paralelo

Cada agente usa **su propio worktree** (rama + carpeta hermana):

```bash
# Agente 1
./scripts/new-worktree.sh feature/dashboard

# Agente 2 (en otra terminal o PC)
./scripts/new-worktree.sh fix/worker-crash
```

Cada uno trabaja en su carpeta. Cuando un agente termina:

```bash
git push -u origin feature/dashboard
# abrir PR hacia main
```

Y cuando el PR está mergeado:

```bash
./scripts/remove-worktree.sh feature/dashboard --delete-branch   # o .ps1 en Windows
```

> Los scripts nunca borran ramas remotas ni tocan `main`. Rechazan nombres de
> rama inválidos y carpetas existentes para no sobrescribir nada.
