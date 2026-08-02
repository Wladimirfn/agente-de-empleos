<#
.SYNOPSIS
    Elimina un worktree de Git y su rama local (si se pide), sin tocar remoto.

.DESCRIPTION
    - Verifica Git y que el worktree exista.
    - Verifica que el worktree no tenga cambios sin guardar.
    - Ejecuta git worktree remove.
    - Si se pasa -DeleteBranch, elimina la rama local asociada.
    - NUNCA elimina ramas remotas.

.EXAMPLE
    .\scripts\remove-worktree.ps1 feature/dashboard
    .\scripts\remove-worktree.ps1 feature/dashboard -DeleteBranch
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BranchName,

    [switch]$DeleteBranch
)

$ErrorActionPreference = 'Stop'

# --- 1. Git disponible -------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Git no está instalado o no está en PATH."
    exit 1
}

# --- 2. Raíz del repositorio -------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# --- 3. Encontrar el worktree asociado a la rama ------------------------------
$WorktreeLine = git worktree list --porcelain | Select-String -Pattern "branch refs/heads/$([regex]::Escape($BranchName))" -Context 0,0
$Worktrees = git worktree list
$Match = $Worktrees | Where-Object { $_ -match "\[$([regex]::Escape($BranchName))\]$" }

if (-not $Match) {
    Write-Error "Error: no hay un worktree activo para la rama '$BranchName'."
    Write-Host ""
    Write-Host "Worktrees actuales:"
    git worktree list
    exit 1
}

$Path = ($Match -split '\s+')[0]

# --- 4. Worktree limpio --------------------------------------------------------
Push-Location $Path
$Status = git status --porcelain
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Error "Error: no se pudo leer el estado del worktree."
    exit 1
}
if ($Status) {
    Pop-Location
    Write-Error "Error: el worktree '$Path' tiene cambios sin guardar. Commité, stashé o descartalos antes de eliminarlo."
    git -C $Path status --short
    exit 1
}
Pop-Location

# --- 5. Eliminar el worktree ---------------------------------------------------
Write-Host "Eliminando worktree en '$Path'..."
git worktree remove $Path
if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: no se pudo eliminar el worktree."
    exit 1
}

# --- 6. Borrar rama local (opcional, nunca remota) ------------------------------
if ($DeleteBranch) {
    $HasMerged = git branch --merged main | Select-String -Pattern "^[* ]+$([regex]::Escape($BranchName))$"
    if ($HasMerged) {
        git branch -d $BranchName
        Write-Host "Rama local '$BranchName' eliminada (estaba mergeada en main)."
    } else {
        Write-Host "AVISO: la rama local '$BranchName' NO está mergeada en main; no se borró."
        Write-Host "Cuando la mergees:  git branch -d $BranchName"
    }
} else {
    Write-Host "Rama local '$BranchName' conservada."
    Write-Host "Si ya está mergeada, eliminála con:  git branch -d $BranchName"
}

Write-Host "Listo."
