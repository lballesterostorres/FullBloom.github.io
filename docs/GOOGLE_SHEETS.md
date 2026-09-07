# Captura y análisis en Google Sheets · Full Bloom

1. Crea o abre la Google Sheet que recibirá los datos.
2. En **Extensiones → Apps Script**, pega [`Code.gs`](../google-apps-script/Code.gs).
3. Despliega como **Aplicación web**, ejecutada como tú y accesible por cualquier persona.
4. Copia la URL terminada en `/exec` en `CONFIG.sheetEndpoint`.

La app envía checkpoints acumulativos no bloqueantes con `no-cors` y `text/plain`. Si no hay red, conserva los eventos en el navegador y vuelve a intentarlo al recuperar la conexión.

El receptor crea y mantiene:

- `Eventos`: una fila por respuesta. Los identificadores únicos impiden duplicados durante reintentos.
- `Sesiones`: una fila por `sessionId`, actualizada con los totales acumulados.
- `Gaps`: cinco consultas automáticas para detección, primer intento, respuestas equivocadas, retos y onboarding.

Las pestañas históricas `respuestas` e `interacciones` no se borran, pero este receptor ya no las actualiza.

## Comprobación

1. Abre la URL `/exec` y confirma la respuesta JSON `{ "ok": true }`.
2. Completa una partida de prueba y verifica que aparecen datos en `Eventos` y `Sesiones`.
3. Confirma que `Gaps` contiene los cinco bloques de análisis y que las tasas aparecen como porcentajes.

Cada cambio en `Code.gs` requiere **Implementar → Gestionar implementaciones → Editar → Versión nueva**. La URL `/exec` se conserva.

Solo se almacena el alias del equipo; no se solicitan nombres individuales ni cuentas personales.
