#!/usr/bin/env bash
#
# new-worktree.sh — Crea un worktree de Git para una tarea en una rama nueva,
# basada en origin/main. Seguro para trabajo multi-PC y agentes en paralelo.
#
# Requisitos:
#   - Git instalado y en PATH.
#   - Ejecutar desde la raíz del repositorio (o un subdirectorio).
#
# Uso:
#   ./scripts/new-worktree.sh feature/dashboard
#   ./scripts/new-worktree.sh fix/login-validation
#
# Resultado esperado:
#   proyecto/
#   proyecto-feature-dashboard/   <- worktree nuevo en la rama feature/dashboard

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 <tipo/nombre-tarea>" >&2
  echo "  tipos válidos: feature | fix | refactor | docs | chore" >&2
  exit 1
fi

BRANCH_NAME="$1"

# --- 1. Git disponible -------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  echo "Error: Git no está instalado o no está en PATH." >&2
  exit 1
fi

# --- 2. Raíz del repositorio (sube hasta encontrar .git) ----------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_NAME="$(basename "$REPO_ROOT")"
cd "$REPO_ROOT"

# --- 3. Repositorio limpio ----------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: el repositorio tiene cambios sin guardar. Commiteá o stashéa antes de crear un worktree." >&2
  git status --short
  exit 1
fi

# --- 4. Fetch de origin --------------------------------------------------------
echo "Actualizando origin..."
git fetch origin

# --- 5. Validar que origin/main exista -----------------------------------------
if ! git rev-parse --verify --quiet "refs/remotes/origin/main" >/dev/null; then
  echo "Error: no existe origin/main. ¿Se renombró la rama principal? Verificá con: git ls-remote --heads origin" >&2
  exit 1
fi

# --- 6. Validar el nombre de rama ----------------------------------------------
case "$BRANCH_NAME" in
  feature/*|fix/*|refactor/*|docs/*|chore/*) ;;
  *)
    echo "Error: la rama debe empezar con feature/, fix/, refactor/, docs/ o chore/." >&2
    exit 1
    ;;
esac

if [[ "$BRANCH_NAME" =~ [\ ~^:?*\[\\\\] ]] \
  || [[ "$BRANCH_NAME" == *..* ]] \
  || [[ "$BRANCH_NAME" == *'@{'* ]] \
  || [[ "$BRANCH_NAME" == *. ]] \
  || [[ "$BRANCH_NAME" == */ ]]; then
  echo "Error: el nombre de rama contiene caracteres o terminaciones inválidos para Git." >&2
  exit 1
fi

if ! git check-ref-format --branch "$BRANCH_NAME"; then
  echo "Error: nombre de rama inválido para Git." >&2
  exit 1
fi

# --- 7. Rama local no existente ------------------------------------------------
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "Error: la rama local '$BRANCH_NAME' ya existe." >&2
  exit 1
fi

# --- 8. Carpeta destino hermana -------------------------------------------------
FOLDER_PART="${BRANCH_NAME//\//-}"
TARGET_PATH="$(dirname "$REPO_ROOT")/$REPO_NAME-$FOLDER_PART"

if [[ -e "$TARGET_PATH" ]]; then
  echo "Error: la carpeta '$TARGET_PATH' ya existe. Usá otro nombre de rama o eliminá esa carpeta." >&2
  exit 1
fi

# --- 9. Crear el worktree --------------------------------------------------------
git worktree add -b "$BRANCH_NAME" "$TARGET_PATH" origin/main

# --- 10. Siguientes pasos ---------------------------------------------------------
echo ""
echo "Worktree creado:"
echo "  Rama:      $BRANCH_NAME"
echo "  Carpeta:   $TARGET_PATH"
echo ""
echo "Próximos pasos:"
echo "  cd '$TARGET_PATH'"
echo "  npm install"
echo "  npm run db:migrate   # si ya existe .env, o ajustá DATABASE_PATH"
echo ""
echo "Cuando termines:"
echo "  git add . && git commit -m \"feat: resumen de la tarea\""
echo "  git push -u origin $BRANCH_NAME"
echo "  gh pr create --base main   # o abrí el PR desde GitHub"
echo ""
echo "Para quitar el worktree:  scripts/remove-worktree.sh $BRANCH_NAME"
