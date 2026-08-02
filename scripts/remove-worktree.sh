#!/usr/bin/env bash
#
# remove-worktree.sh — Elimina un worktree de Git y opcionalmente su rama local,
# sin tocar el remoto.
#
# Uso:
#   ./scripts/remove-worktree.sh feature/dashboard
#   ./scripts/remove-worktree.sh feature/dashboard --delete-branch
#
# Notas:
#   - Nunca elimina ramas remotas.
#   - Solo borra la rama local con --delete-branch y si está mergeada en main.

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Uso: $0 <tipo/nombre-tarea> [--delete-branch]" >&2
  exit 1
fi

BRANCH_NAME="$1"
DELETE_BRANCH=0
if [[ "${2:-}" == "--delete-branch" ]]; then
  DELETE_BRANCH=1
elif [[ $# -eq 2 ]]; then
  echo "Error: argumento desconocido '$2'. Usá --delete-branch para borrar la rama local." >&2
  exit 1
fi

# --- 1. Git disponible -------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  echo "Error: Git no está instalado o no está en PATH." >&2
  exit 1
fi

# --- 2. Raíz del repositorio --------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- 3. Encontrar el worktree asociado a la rama ------------------------------
MATCH="$(git worktree list | grep "\[$BRANCH_NAME\]$" || true)"
if [[ -z "$MATCH" ]]; then
  echo "Error: no hay un worktree activo para la rama '$BRANCH_NAME'." >&2
  echo ""
  echo "Worktrees actuales:"
  git worktree list
  exit 1
fi

WORKTREE_PATH="$(echo "$MATCH" | awk '{print $1}')"

# --- 4. Worktree limpio ---------------------------------------------------------
if [[ -n "$(git -C "$WORKTREE_PATH" status --porcelain)" ]]; then
  echo "Error: el worktree '$WORKTREE_PATH' tiene cambios sin guardar. Commiteá, stashéá o descartalos antes de eliminarlo." >&2
  git -C "$WORKTREE_PATH" status --short
  exit 1
fi

# --- 5. Eliminar el worktree -----------------------------------------------------
echo "Eliminando worktree en '$WORKTREE_PATH'..."
git worktree remove "$WORKTREE_PATH"

# --- 6. Borrar rama local (opcional, nunca remota) --------------------------------
if [[ "$DELETE_BRANCH" -eq 1 ]]; then
  if git branch --merged main | grep -qE "^[* ]+$BRANCH_NAME$"; then
    git branch -d "$BRANCH_NAME"
    echo "Rama local '$BRANCH_NAME' eliminada (estaba mergeada en main)."
  else
    echo "AVISO: la rama local '$BRANCH_NAME' NO está mergeada en main; no se borró."
    echo "Cuando la mergees:  git branch -d $BRANCH_NAME"
  fi
else
  echo "Rama local '$BRANCH_NAME' conservada."
  echo "Si ya está mergeada, eliminála con:  git branch -d $BRANCH_NAME"
fi

echo "Listo."
