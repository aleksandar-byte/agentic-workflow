# Distribución segura para Codex

> 🇬🇧 [English version](README.md)

Este directorio es una distribución específica del fork y limitada al proyecto para Codex. Está separada deliberadamente del árbol upstream `skills/` y solo se instala en la ubicación oficial del repositorio `<proyecto>/.agents/skills`.

## Límite de seguridad

- **No** ejecutar `npx skills add .` desde la raíz del repositorio; eso expone el flujo upstream completo.
- Solo las ocho habilidades R0 de hallazgos sin escritura incluidas en `release-manifest.json` pueden instalarse.
- Cada habilidad incluida usa el prefijo `agentic-` y tiene `policy.allow_implicit_invocation: false`.
- El instalador rechaza destinos globales, colisiones, sobrescrituras, symlinks, archivos alterados y un recibo ya existente.
- La instalación usa el modo de prueba por defecto y exige la opción explícita `--apply`.
- `--apply` exige un checkout limpio cuyo `HEAD` tenga la etiqueta de publicación fijada `codex-safe-v0.1.0`.
- Quedan excluidos el paquete Pi, los hooks, la estructura del espacio de trabajo, la verificación mutable, commits, pushes, comentarios, etiquetas y merges.

## Comandos

Construir y validar la distribución:

```text
node scripts/build-codex-safe.mjs
node --test scripts/codex-safe.test.mjs
```

Previsualizar una futura instalación limitada al proyecto sin cambiar nada:

```text
node scripts/install-codex-safe.mjs --project <ruta-absoluta-del-proyecto> --dry-run
```

No debe usarse `--apply` hasta que se revise el pull request de refuerzo, se superen todas las comprobaciones de aceptación y el usuario apruebe explícitamente el proyecto de destino nombrado.

## Habilidades incluidas

- `agentic-review-a11y`
- `agentic-review-brand`
- `agentic-review-code`
- `agentic-review-debt`
- `agentic-review-design`
- `agentic-review-implementation`
- `agentic-review-security`
- `agentic-review-seo`

La justificación completa de inclusiones y exclusiones está en `manifest.json`.

El descubrimiento de habilidades locales del repositorio y la invocación solo explícita siguen la [documentación oficial de habilidades de OpenAI Codex](https://learn.chatgpt.com/docs/build-skills).
