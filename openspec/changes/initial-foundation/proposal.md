# Proposal — initial-foundation

## Why

Construir un buscador de empleo automatizado localmente: el usuario quiere ser **uno de los primeros** en postular a cada oferta nueva. Hoy el flujo es manual: revisar portales, filtrar, llenar formularios, una y otra vez. Cada hora que pasa desde que aparece una oferta hasta que se postula es desventaja competitiva.

Hay una oportunidad real: capturar ofertas apenas aparecen, evaluarlas contra el CV del candidato, preparar la postulación completa y dejar al usuario un solo click para confirmar. Sin servicios externos, sin cloud, sin compartir datos.

## What (este slice)

Este cambio establece la **fundación técnica** del proyecto. Es el slice mínimo que hace funcionar el flujo end-to-end con datos reales, sin todavía incluir portales reales.

Incluye:

1. **Web app (Astro + React islands)** con dashboard navegable: Inicio, Perfil, Currículums, Ofertas (placeholder), Postulaciones (placeholder), Plataformas, Skills, Actividad, Errores.
2. **Worker (Node process)** con `node-cron`, task queue en SQLite, event-emitter que escribe a SQLite para que el dashboard los consuma por SSE.
3. **SQLite + Drizzle** con el schema base: `candidate_profiles`, `candidate_experiences`, `candidate_skills`, `platforms`, `platform_skills`, `jobs`, `job_matches`, `applications`, `application_events`, `agent_runs`, `skill_failures`, `skill_versions`, `task_queue`.
4. **Skill runtime** con la interfaz `PlatformSkill` y un registry. Una skill **stub** (`example-platform`) que simula escaneos para validar el flujo.
5. **CV upload + parse + edit form**: el usuario sube PDF/DOCX, el sistema extrae texto (stub determinístico al inicio), el usuario revisa y completa campos faltantes. Puede saltarse el upload y completar el form directamente.
6. **Resume engine**: genera PDF con `pdf-lib` y DOCX con `docx` desde el perfil estructurado.
7. **LLM provider-agnostic**: interfaz `LLMProvider` con un `DeterministicStubProvider` que devuelve respuestas fijas. Diseñado para que mañana se enchufe Ollama o cualquier API.
8. **SSE funcionando**: el dashboard muestra actividad en vivo (los escaneos stub emiten eventos que llegan al navegador).
9. **Pantalla de errores con healthcheck de skills**.

## Impact

Para el usuario:
- Ve un dashboard local en `http://localhost:3000` con su perfil, sus CVs y (todavía) ofertas placeholder.
- Puede subir un CV real y editar los campos extraídos.
- Ve cómo se vería un escaneo "en vivo" cuando una skill corre (aunque todavía con datos stub).
- Tiene la confianza de que la infraestructura está lista para agregar portales reales.

Para el proyecto:
- Se establece el monorepo (`apps/web`, `worker`, `packages/*`) que soporta el resto de los slices.
- Se validan las decisiones de stack antes de invertir tiempo en integraciones reales.
- Se prueba el flujo SSE, la cola, los eventos, la auto-reparación, en un entorno controlado.

## Non-goals (explícitos)

- **No hay portales reales todavía**. Chiletrabajos y Computrabajo vienen en slices separados (`chiletrabajos-skill`, `computrabajo-skill`).
- **No hay LLM real**. El stub devuelve datos fijos. Ollama o APIs vienen en `llm-integration` slice.
- **No hay auth, no hay multi-tenant**. Un usuario, una máquina.
- **No hay notificaciones push, emails, mobile**. Solo el dashboard.
- **No hay Docker todavía**. Setup es `npm install` + `npm run dev` por proceso.
- **No hay tests E2E contra portales reales** (obvio: no hay portales todavía).

## Acceptance criteria

Este slice está **done** cuando:

1. `npm run dev` levanta web (Astro) y worker (Node) en paralelo desde la raíz del repo.
2. El dashboard en `http://localhost:3000` carga con todas las rutas navegables (pueden ser placeholders).
3. El usuario puede subir un PDF/DOCX, ver el texto extraído, completar el formulario de perfil y guardar.
4. El sistema genera un PDF y un DOCX con los datos del perfil.
5. El cron del worker corre cada 30 minutos, agenda un escaneo de la skill stub, y la skill emite eventos a SQLite.
6. El dashboard muestra esos eventos en vivo (SSE) en la pantalla "Actividad".
7. La pantalla "Errores" muestra healthchecks de skills (la stub siempre devuelve `healthy`).
8. Los tests unitarios (Vitest) corren y la cobertura de `packages/domain` y `packages/skill-runtime` supera el 80%.
9. El sistema **no inventa** datos del candidato: la generación de CV opera solo sobre `candidate_profiles`, sin fabricación.
10. La skill stub **no aplica** automáticamente: emite "preparada para revisión" y queda esperando.

## Edge cases y reglas de negocio

- **CV corrupto o no parseable**: el sistema muestra qué pudo extraer y pide al usuario completar lo que falta. No falla silenciosamente.
- **Doble upload del mismo CV**: detecta por hash, pregunta "¿actualizar perfil existente o crear nuevo?".
- **Worker caído**: el dashboard sigue funcionando. La pantalla "Actividad" muestra "Worker desconectado desde {timestamp}".
- **Browser cerrado durante escaneo**: el task queda en `running` por X minutos, después se marca `retrying`. Si supera N reintentos, `failed` con notificación en UI.
- **Playwright lock conflict en Windows**: misma mitigación que ya usamos en este Pi session (cerrar procesos que lockean, no usar OneDrive).
- **Ofertas duplicadas** entre escaneos: el sistema deduplica por `external_id` + `platform_slug`. El placeholder de "Ofertas" demuestra esto con datos fake.

## Constraints

- **Local-first**: todo corre en la máquina del usuario. Sin cloud, sin servicios externos pagos.
- **Sin secretos en el repo**: API keys, tokens, etc. van a `.env` (gitignored).
- **Strict TDD**: para cada unidad de código en `packages/domain`, `packages/skill-runtime`, `packages/database`, hay test que falla primero.
- **Force-chained PRs**: cada cambio entrega un slice chiquito revisable, máximo 400 líneas modificadas.
- **Idioma**: la UI en español, código y artefactos SDD en inglés (convención del harness).
- **Windows-compatible**: el dev usa Windows, los tests deben pasar en Windows. CI opcional más adelante.

## Open questions (para resolver durante implementación)

1. **Versión de Astro**: ¿Astro 4.x o 5.x? Asumimos Astro 4.x LTS por estabilidad.
2. **Versión de Playwright**: última estable al momento de implementar.
3. **Vitest config**: ¿jsdom o happy-dom para los islands React? Default a happy-dom (más rápido).
4. **Path aliases en TS**: ¿`@/` apunta a `src/`? Convención a definir en el primer task.

## Slices planeados (no incluidos en este cambio)

Estos vienen después, cada uno como un cambio SDD separado:

| Slice | Nombre | Qué entrega |
|---|---|---|
| 2 | `cv-pipeline-real` | LLM real para parseo de CV (Ollama o API configurable) |
| 3 | `chiletrabajos-skill` | Primera skill real end-to-end (scan + match + apply asistida) |
| 4 | `apply-assisted-flow` | UI completa para revisar y aprobar postulaciones |
| 5 | `computrabajo-skill` | Segunda skill real, con habilidad de reparar cambios |
| 6 | `skill-repair-runtime` | Sistema de auto-reparación conservadora + healthchecks |
| 7 | `llm-integration` | Ollama + APIs configurables (OpenAI, Anthropic, etc.) |
| 8 | `notifications` | Desktop notifications cuando hay match alto |
| 9 | `docker-packaging` | `docker compose up` para distribución |

## Risks

| Riesgo | Mitigación |
|---|---|
| Astro + SSR + SQLite tiene gotchas en Windows | Validar el shell en slice 1 antes de invertir en skills reales |
| React islands vs SSR streaming: SSE puede romperse | Probar SSE explícitamente en acceptance criteria #6 |
| pdf-lib y docx generan layouts diferentes en cada plataforma | Aceptable: la generación es local, no necesita pixel-perfect |
| Force-chained puede generar PRs muy chiquitos que ralentizan | OK si los slices están bien definidos; revisar en `sdd-tasks` |
| El usuario aún no instaló Ollama ni confirmó GPU | Slice 1 no depende de Ollama. Slice 7 lo requerirá explícitamente |
| OneDrive residual puede confundir | Documentar en README que el repo activo está en `C:\dev` |

## Resumen de asunciones (verificar antes de spec)

1. ✅ Un usuario, sin auth, todo local
2. ✅ Primer portal: Chiletrabajos (luego Computrabajo)
3. ✅ CV input: upload PDF/DOCX con parseo, después edit form
4. ✅ Threshold agresivo para captar ofertas rápido (cola de revisión solo si estrictamente necesaria)
5. ✅ LLM: stub al inicio, provider-agnostic para futuro
6. ✅ Modo asistido: la app nunca submitea sola

¿Algo de esto querés corregir antes de pasar a `spec.md`?
