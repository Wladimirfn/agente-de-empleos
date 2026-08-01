<#
.SYNOPSIS
    Crea un worktree de Git para trabajar una tarea en una rama nueva,
    basada en origin/main. Seguro para trabajo multi-PC y agentes en paralelo.

.DESCRIPTION
    - Verifica Git y un working tree limpio.
    - Hace git fetch origin.
    - Valida el nombre de rama (convención feature/|fix/|refactor/|docs/|chore/).
    - Crea la rama desde origin/main y el worktree en una carpeta hermana.
    - NO elimina ramas remotas ni toca main.

.EXAMPLE
    .\scripts\new-worktree.ps1 feature/dashboard
    .\scripts\new-worktree.ps1 fix/login-validation
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$BranchName
)

$ErrorActionPreference = 'Stop'

# --- 1. Git disponible -------------------------------------------------------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Git no está instalado o no está en PATH."
    exit 1
}

# --- 2. Raíz del repositorio (scripts/ es un subdirectorio) ------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$RepoName = Split-Path -Leaf $RepoRoot

# --- 3. Repositorio limpio ---------------------------------------------------
$Status = git status --porcelain
if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: no se pudo leer el estado del repositorio."
    exit 1
}
if ($Status) {
    Write-Error "Error: el repositorio tiene cambios sin guardar. Commité o stashé antes de crear un worktree."
    git status --short
    exit 1
}

# --- 4. Fetch de origin ------------------------------------------------------
Write-Host "Actualizando origin..."
git fetch origin
if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: git fetch origin falló. Revisá la conexión y el remote."
    exit 1
}

# --- 5. Validar que origin/main exista ---------------------------------------
git rev-parse --verify --quiet "refs/remotes/origin/main" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: no existe origin/main. ¿Se renombró la rama principal? Verificá con: git ls-remote --heads origin"
    exit 1
}

# --- 6. Validar el nombre de rama --------------------------------------------
$ValidPrefixes = @('feature/', 'fix/', 'refactor/', 'docs/', 'chore/')
$HasPrefix = $ValidPrefixes | Where-Object { $BranchName.StartsWith($_) } | Select-Object -First 1
if (-not $HasPrefix) {
    Write-Error "Error: la rama debe empezar con feature/, fix/, refactor/, docs/ o chore/."
    exit 1
}
if ($BranchName -match '[\s~^:?*\[\\]' -or $BranchName -match '\.\.' -or $BranchName -match '@\{' -or $BranchName.EndsWith('.') -or $BranchName.EndsWith('/')) {
    Write-Error "Error: el nombre de rama contiene caracteres o terminaciones inválidos para Git."
    exit 1
}
git check-ref-format --branch $BranchName
if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: nombre de rama inválido para Git."
    exit 1
}

# --- 7. Rama local no existente ----------------------------------------------
git show-ref --verify --quiet "refs/heads/$BranchName"
if ($LASTEXITCODE -eq 0) {
    Write-Error "Error: la rama local '$BranchName' ya existe."
    exit 1
}

# --- 8. Carpeta destino hermana ----------------------------------------------
$FolderPart = $BranchName.Replace('/', '-')
$TargetPath = Join-Path (Split-Path -Parent $RepoRoot) ("$RepoName-$FolderPart")
if (Test-Path -LiteralPath $TargetPath) {
    Write-Error "Error: la carpeta '$TargetPath' ya existe. Usá otro nombre de rama o eliminá esa carpeta."
    exit 1
}

# --- 9. Crear el worktree ----------------------------------------------------
git worktree add -b $BranchName $TargetPath origin/main
if ($LASTEXITCODE -ne 0) {
    Write-Error "Error: no se pudo crear el worktree."
    exit 1
}

# --- 10. Siguientes pasos ----------------------------------------------------
Write-Host ""
Write-Host "Worktree creado:"
Write-Host "  Rama:      $BranchName"
Write-Host "  Carpeta:   $TargetPath"
Write-Host ""
Write-Host "Próximos pasos:"
Write-Host "  cd '$TargetPath'"
Write-Host "  npm install"
Write-Host "  npm run db:migrate   # si ya existe .env, o ajustá DATABASE_PATH"
Write-Host ""
Write-Host "Cuando termines:"
Write-Host "  git add . && git commit -m \"feat: resumen de la tarea\""
Write-Host "  git push -u origin $BranchName"
Write-Host "  gh pr create --base main   # o abrí el PR desde GitHub"
Write-Host ""
Write-Host "Para quitar el worktree:  scripts\remove-worktree.ps1 $BranchName"
