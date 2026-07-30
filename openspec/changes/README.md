# Cambios activos

Las propuestas, specs, diseños y tasks viven en subcarpetas por cambio.

## Estructura de un cambio

```
openspec/changes/<nombre>/
├── proposal.md      # Por qué, qué, impacto, non-goals
├── spec.md          # Requisitos + escenarios Given/When/Then
├── design.md        # Decisiones técnicas detalladas
├── tasks.md         # Unidades discretas de implementación
├── apply.md         # Progreso de implementación (generado por sdd-apply)
├── verify.md        # Reporte de verificación (generado por sdd-verify)
└── sync.md          # Reporte de sincronización (generado por sdd-sync)
```

## Cambios en curso

| Cambio | Estado | Última fase |
|---|---|---|
| `initial-foundation` | init | 2026-07-30 |
