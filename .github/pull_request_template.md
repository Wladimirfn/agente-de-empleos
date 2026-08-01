## Objetivo del cambio

<!-- ¿Qué problema resuelve este PR? ¿Qué funcionalidad agrega o corrige? -->

## Archivos o módulos afectados

<!-- Lista de archivos/carpetas tocados y por qué. -->

## Cómo fue probado

<!--
- [ ] `npm test` (Vitest)
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] Validación manual (describir pasos)
-->

## Migraciones incluidas

<!-- Si el PR toca `packages/database/src/schema/`, listar la migración generada
(`drizzle/migrations/XXXX_*.sql`) y si requiere datos de relleno. Si no hay
migraciones, escribir "Ninguna". -->

## Variables de entorno nuevas

<!-- Nombre de cada variable agregada a `.env.example` y para qué sirve.
Si no hay, escribir "Ninguna". NUNCA incluir valores reales. -->

## Riesgos

<!-- Efectos secundarios posibles, áreas sensibles (worker, Playwright, LLM),
o regresiones conocidas. -->

## Capturas (cuando corresponda)

<!-- Pegar screenshots de la UI o resultados relevantes. -->

## Checklist

- [ ] Lint / formato aplicados (si el repo tiene linter configurado)
- [ ] `npm run typecheck` pasa
- [ ] `npm test` pasa
- [ ] `npm run build` pasa
- [ ] No se agregaron secretos ni archivos ignorados (verificá `git status`)
- [ ] No se modificaron archivos fuera del alcance de la tarea
- [ ] No se borraron ni regeneraron migraciones existentes sin razón técnica
- [ ] `.env.example` actualizado si hay variables nuevas
