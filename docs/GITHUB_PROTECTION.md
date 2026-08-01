# Protección de GitHub — `main`

Este repositorio usa **`main`** como rama principal (renombrada desde `master`).
Nadie debe pushear directo a `main`: todo cambio entra por **Pull Request**.

> ⚠️ `gh` CLI no está disponible en la máquina donde se preparó este repo, por eso
> este documento contiene los pasos **manuales**. Si en algún momento querés
> automatizarlo, instalá [GitHub CLI](https://cli.github.com/) y podés usar el
> Ruleset equivalente con `gh api`.

## 1. Renombrar la rama principal a `main` (si aún no se hizo en GitHub)

Como este repo todavía tiene `master` como default branch en GitHub:

1. Abrí **Settings → Branches** (o **Settings → General → Default branch**).
2. En **Default branch**, cambiá de `master` a `main`.
3. Confirmá. GitHub te ofrece actualizar las PRs y borrar la rama antigua; aceptá
   que **master** quede obsoleta y borrála **después** de confirmar que `main` está sana.
4. En cada copia local:
   ```bash
   git fetch origin
   git branch -u origin/main main
   git remote prune origin
   ```

## 2. Ruleset de rama para `main`

Crear un **Ruleset** (recomendado) o un **Branch protection rule** en
**Settings → Rules → Rulesets → New ruleset**.

### Ruleset (recomendado)

1. **Name**: `main-protection`
2. **Target**: Branches → **Include**: `main`
3. **Enforcement status**: `Active`
4. **Branch rules**:
   - [x] **Require a pull request before merging**
     - Required approvals: **0** (repo de un solo desarrollador)
     - [x] Dismiss stale pull request approvals when new commits are pushed
     - [ ] Require review from Code Owners (solo si agregás CODEOWNERS)
   - [x] **Require status checks to pass before merging**
     - Añadí el check `build-and-test` (y `secret-scan` si querés) que genera el
       workflow `validate.yml`. Debe marcarse como *required* después de que el
       workflow haya corrido al menos una vez en el repo.
     - [ ] Require branches to be up to date (opcional; con un solo dev no es crítico)
   - [x] **Block force pushes**
   - [x] **Block deletions**
   - [ ] Restrict bypass (dejar vacío: solo el admin del repo puede saltar las reglas)
5. **Metadata rules** (opcional pero recomendado):
   - [x] Require conversation resolution before merging
   - [x] Restrict deletions (cubierto arriba)
6. Guardar.

### Alternativa: Branch protection rule (clásica)

En **Settings → Branches → Branch protection rules → Add rule**:

- **Branch name pattern**: `main`
- [x] Require a pull request before merging
  - Required approvals: `0`
- [x] Require status checks to pass before merging
  - Añadir `build-and-test` y `secret-scan` (una vez que el workflow haya corrido)
- [x] Require conversation resolution before merging
- [x] Do not allow bypassing the above settings
- [x] Lock branch (opcional)
- [x] Block force pushes
- [x] Block deletions

Guardar.

## 3. Verificar

Después de aplicar:

```bash
git push origin main              # funciona solo si es tu PR base
git push origin main --force      # DEBE fallar con "protected branch"
git branch -d main                # DEBE fallar (rama principal no se borra)
```

O en la web: Settings → Branches → ver la regla activa sobre `main`.

## 4. Resumen del flujo esperado

```
rama de tarea (feature/..., fix/...)
→ Draft Pull Request hacia main
→ validaciones automáticas (validate.yml)
→ revisión y conversaciones resueltas
→ Squash and merge
→ eliminación de la rama
```
