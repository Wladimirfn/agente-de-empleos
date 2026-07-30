# Explore — initial-foundation

## Estado del proyecto

Greenfield. No hay código de aplicación todavía. Repo recién inicializado en `C:\dev\employment-agent`.

```
.git/
.gitignore
README.md
openspec/
├── config.yaml
└── changes/
    ├── README.md
    └── initial-foundation/   (este directorio)
```

## Contexto capturado

- **Memoria en engram** (topic keys):
  - `architecture/employment-agent` (id 4265): decisiones de stack y arquitectura aprobadas por el usuario
  - `sdd-init/employment-agent` (id 4266): preflight SDD capturado
- **Stack definido**: Astro + React islands + Tailwind + shadcn/ui + SQLite + Drizzle + Playwright + LLM provider-agnostic
- **Modo confirmado**: asistido (no auto-postulación)
- **LLM**: provider-agnostic, stub determinístico al inicio
- **PR strategy**: force-chained (siempre dividir)
- **Review budget**: 400 líneas

## Herramientas y skills disponibles

- **Vitest**: configurado en `openspec/config.yaml` como test runner con TDD estricto
- **Playwright MCP**: disponible para que el agente explore portales durante el diseño
- **Ollama (opcional)**: el usuario aún no instaló. Interfaz provider-agnostic permite arrancar sin él
- **Engram**: memoria cross-session activa, project `employment-agent` detectado

## Riesgos identificados

1. **Project Core falta**: no hay Project Core/Constitution. Solo config SDD. No es bloqueante para arrancar, pero a futuro conviene formalizar.
2. **Master Plan falta**: no hay `master-plan.md`. Esta propuesta (`initial-foundation`) será el primer slice.
3. **Ollama no instalado**: si arrancamos con stub y después queremos usar LLM real, hay gap de setup.
4. **OneDrive residual**: la versión vieja del proyecto sigue en OneDrive. No debe interferir, pero conviene tenerla como solo lectura o eliminarla después.
5. **Browser pool**: con 2-3 navegadores Playwright simultáneos, hay que diseñar el lifecycle desde el inicio (no después).

## Decisiones pendientes (no bloquean esta propuesta)

- ¿Qué portales priorizar primero? (chiletrabajos, computrabajo, linkedin, etc.)
- ¿Cómo manejar la cola de ofertas borderline? (umbral de scoring configurable)
- ¿Multi-idioma en CVs? (español + inglés)
- ¿Logging estructurado? (qué campos, qué niveles)

## Próxima fase: sdd-proposal

Voy a hacer una pregunta de producto/negocio antes de escribir `proposal.md`. Es la convención del workflow en modo interactivo.
