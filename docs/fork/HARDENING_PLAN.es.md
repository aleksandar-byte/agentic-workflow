# Plan de refuerzo para una instalación segura en Codex

> 🇬🇧 [English version](HARDENING_PLAN.md)

## Estado

Implementado como candidato de publicación en `hardening/codex-distribution`; no instalado. Las comprobaciones de aceptación en Windows y Linux se superaron. No instalar hasta que el pull request del fork sea revisado, fusionado y etiquetado.

- Upstream: `gtrabanco/agentic-workflow`
- Base auditada: `9a312e97ea334efbd851827357aff19f9f0e9d94` (incluye una auditoría del delta desde la revisión original `b535866633bbc4afbd75f013ad957d3068e64976`)
- Entorno previsto: Codex en Windows
- Límite de distribución: solo habilidades seleccionadas; sin instalación global; sin paquete Pi

El candidato de publicación contiene ocho habilidades de revisión con espacio de nombres, invocación solo explícita y salida limitada a hallazgos. El registro completo de riesgos de las 39 habilidades excluye todos los flujos de autoría, verificación mutable, git, forge, hooks, piloto automático y scripts no empaquetados. El instalador apunta únicamente a la ruta oficial del repositorio `<proyecto>/.agents/skills`, usa el modo de prueba por defecto, verifica hashes y falla ante colisiones o sobrescrituras.

## Objetivo

Crear una distribución pequeña y revisable para Codex que no pueda ampliar silenciosamente la autorización del usuario, invocar de forma implícita flujos de alto impacto ni depender de archivos que el instalador no haya copiado.

## Reglas de seguridad

1. La instalación se limita al proyecto y usa una lista permitida. Durante el desarrollo o las pruebas no se copia nada al directorio global de habilidades de Codex.
2. Una habilidad puede inspeccionar o planificar dentro de la solicitud del usuario, pero los commits, pushes, cambios en pull requests, comentarios en issues, etiquetas, merges, inicialización del espacio de trabajo y otras mutaciones externas requieren autorización explícita para el objetivo nombrado.
3. Cada habilidad seleccionada es solo de invocación explícita en Codex; las habilidades que cambian estado y las de orquestación amplia no se distribuyen.
4. El merge totalmente automático y los hooks de sesión opcionales quedan deshabilitados en la distribución para Codex.
5. El paquete Pi y su árbol de dependencias quedan excluidos.
6. Cada habilidad instalada es autosuficiente: todos los scripts y referencias usados se incluyen dentro de su carpeta o mediante un paquete compartido versionado que el instalador verifica.
7. Las actualizaciones del upstream se revisan y vuelven a auditar antes de incorporarse a la rama reforzada.

## Fases de implementación

### P1 — Definir la lista de instalación y las clases de riesgo

- Inventariar cada habilidad y clasificarla como:
  - `R0`: análisis o revisión de solo lectura.
  - `R1`: escrituras en archivos locales.
  - `R2`: mutación de git o de sistemas externos.
- Empezar con un conjunto piloto mínimo `R0`. Añadir habilidades `R1` o `R2` solo después de probar sus límites de autorización.
- Producir un manifiesto de instalación legible por máquinas con los nombres, versiones y recursos requeridos de las habilidades seleccionadas.
- Fallar de forma cerrada ante colisiones de nombres, recursos ausentes o un destino inesperado.

### P2 — Añadir controles de invocación de Codex

- Añadir `agents/openai.yaml` a cada habilidad seleccionada.
- Definir `policy.allow_implicit_invocation: false` para cada habilidad seleccionada.
- Mantener nombres y descripciones suficientemente específicos para evitar activaciones no relacionadas.
- Validar cada habilidad seleccionada con el validador nativo de habilidades de Codex.

### P3 — Aplicar límites de autorización

- Excluir del candidato de publicación las instrucciones con capacidad de escritura; cualquier inclusión futura requiere un adaptador revisado por separado.
- Antes de cualquier mutación, exigir una vista previa que nombre el repositorio, rama, archivos, issue o pull request, destino externo y acción exacta.
- Añadir un punto de parada para commits, pushes, comentarios, etiquetas, merges, eliminaciones, sobrescrituras o creación de estructura del espacio de trabajo, salvo que se haya solicitado esa acción exacta.
- Deshabilitar `ship-roadmap --fullauto`, el wrapper transitorio de merge y la instalación automática de hooks en la compilación para Codex.
- Hacer que el modo de prueba o solo lectura sea el predeterminado cuando sea práctico.

### P4 — Hacer las habilidades seleccionadas autosuficientes y portables

- Empaquetar cada script auxiliar requerido con la habilidad que lo llama, o proporcionar un único runtime compartido fijado con un manifiesto de integridad.
- Sustituir las rutas no resueltas a scripts de la raíz del repositorio.
- Usar `os.tmpdir()`, normalizar separadores de rutas y eliminar supuestos de symlinks privilegiados.
- Sustituir comandos exclusivos de Unix por equivalentes multiplataforma basados en Node o alternativas documentadas.
- Mantener la distribución para Codex independiente del paquete Pi.

### P5 — Construir la puerta de verificación y publicación

- Probar en Windows y Linux contra el commit auditado.
- Ejecutar comprobaciones de secretos, vulnerabilidades de dependencias, ejecución sospechosa, enlaces, presupuesto de contexto y resolución de rutas.
- Instalar la lista permitida en un proyecto desechable y demostrar que no cambian directorios globales ni archivos no relacionados.
- Probar solicitudes realistas para los límites de solo lectura, escritura local y escritura externa.
- Registrar el commit upstream, el commit del fork, el digest del manifiesto, los resultados de las pruebas y la lista aprobada de habilidades en un recibo de publicación.

### P6 — Piloto y mantenimiento

- Probar las habilidades reforzadas en un repositorio no productivo.
- Revisar cada mutación propuesta durante el piloto; no habilitar merges automáticos.
- Promover habilidades de forma individual después de superar las comprobaciones de comportamiento.
- Sincronizar el upstream mediante una rama dedicada, inspeccionar el diff completo, volver a ejecutar la puerta y fusionar solo los cambios revisados.

## Puerta de aceptación

La instalación solo se permite cuando se cumpla todo lo siguiente:

- Cada habilidad y recurso seleccionado figura en el manifiesto.
- Cada ruta referenciada por una habilidad instalada se resuelve después de la instalación.
- Todas las habilidades incluidas son solo de invocación explícita; se excluyen todas las habilidades `R1`, `R2`, de enrutamiento y de orquestación.
- Las pruebas de mutación se detienen antes de actuar sin autorización específica para el objetivo.
- El merge totalmente automático y los hooks opcionales están ausentes o deshabilitados.
- Las comprobaciones en Windows y Linux pasan sin symlinks privilegiados ni rutas temporales fijas.
- Una instalación desechable limitada al proyecto modifica únicamente el destino esperado.
- Los análisis de seguridad no muestran hallazgos graves sin resolver.
- El recibo de publicación fija commits y hashes exactos.

## Siguiente unidad recomendada

Después de superar el pull request y la puerta de aceptación, obtener aprobación explícita para un repositorio no productivo nombrado y ejecutar el piloto limitado al proyecto. Mantener indisponibles todos los flujos excluidos.
