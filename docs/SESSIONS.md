# Sesiones y estadísticas — fase 4 provisional

La API está preparada para recibir sesiones simuladas o enviadas por un cliente de confianza.
Todavía no hay detección de EmulatorJS, cola de sesiones en el agente ni integración con el navegador.
No incluyas la API key del dispositivo en código web público. El transporte seguro desde Retro Machine
se decidirá cuando podamos revisar ese proyecto.

## Registrar una sesión

POST /agent/sessions requiere X-Api-Key del dispositivo. Envía un objeto (no un lote):

```json
{
  "clientSessionId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "gameId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "startedAt": "2026-01-01T12:00:00.000Z",
  "endedAt": "2026-01-01T12:10:00.000Z",
  "durationSeconds": 540
}
```

gameId debe corresponder a un juego de la biblioteca de ese dispositivo. También se admiten
entradas dadas de baja para recibir historial que estuvo offline. Usa un UUID nuevo por partida,
conservándolo al reintentar. No envíes userId ni deviceId: se obtienen de la API key.

Las fechas son UTC, con exactamente tres cifras de milisegundos, desde el año 2000.
Se toleran hasta cinco minutos de adelanto del reloj. No se limita la antigüedad de las sesiones.
durationSeconds es un entero no negativo, menor o igual al intervalo completo en segundos;
puede descontar pausas. Las pausas no se detectan automáticamente.

Para enviar una sesión abierta, omite endedAt y durationSeconds o envía ambos como null.
El cierre puede llegar directamente sin inicio previo. Respuesta 200 con id, deviceId, gameId,
clientSessionId, startedAt, endedAt y durationSeconds, tanto al crear como al reenviar.

- Un reenvío idéntico devuelve la misma sesión.
- El inicio reenviado después del cierre devuelve la sesión cerrada.
- Cambiar juego, inicio o un cierre ya guardado devuelve 409 SESSION_CONFLICT.
- Las sesiones abiertas no se cierran por tiempo ni acumulan duración estimada.
- Un fallo de red después de guardar permite reenviar el mismo objeto sin duplicar estadísticas.

## Consultar

GET /sessions y GET /stats requieren Authorization: Bearer <JWT del usuario>.
Solo devuelven datos del propietario, también para dispositivos posteriormente revocados.

Ambos aceptan deviceId, gameId, from, to, limit (1–100, por defecto 20)
y offset (0–100000, por defecto 0). from es inclusivo y to exclusivo: filtran startedAt.
Una sesión que cruza el límite aporta su duración completa si su inicio está incluido.

GET /sessions devuelve items, total, limit y offset; ordena por inicio descendente y después id.
GET /stats devuelve completedSessions, openSessions, durationSeconds, lastPlayedAt y games.
Los totales incluyen todo el filtro, independientemente de la paginación. games es una página
agrupada por gameId con completedSessions, durationSeconds y lastPlayedAt; ordenada por el
último inicio cerrado, con gameId como desempate. hasMore indica si quedan grupos.
lastPlayedAt considera únicamente sesiones cerradas. Si no hay ninguna, es null.
Los identificadores de juego se pueden relacionar con GET /library.

Las duraciones se suman por sesión: no se eliminan solapamientos entre dispositivos.
No se aceptan capturas, ROMs ni rutas locales en estos endpoints.

## Probar sin alterar tu biblioteca

Con Docker/MySQL iniciado, ejecuta desde la raíz:

```powershell
npm run check
npm run test:integration
```

La suite crea usuarios, dispositivos y metadatos sintéticos en una base temporal.
Simula inicio, cierre, reenvío de una respuesta perdida, concurrencia, conflictos,
estadísticas, retirada de biblioteca y revocación. Elimina sus fixtures al terminar.
No necesita registrar tu primera cuenta ni archivos ROM.

Para probar manualmente en tu instalación, crea primero una cuenta y un dispositivo según
[API.md](API.md), sincroniza un juego de prueba y usa su gameId real. Las sesiones manuales
sí quedarán en tu historial; no hay endpoint de borrado/corrección en esta fase.

## Pendiente

Revisar la versión y forma de uso real de EmulatorJS, definir el canal de autenticación desde
el navegador, conectar eventos, pausas y señales de actividad, persistir sesiones offline en
el productor y acordar cómo recuperar sesiones cuyo cierre se pierde al cerrar una pestaña.
No se han supuesto eventos concretos del emulador ni comportamiento del proyecto inaccesible.

Para comprobar esta instalación usa http://127.0.0.1:3000/health/ready, la dirección IPv4 publicada por Docker. Si localhost apunta a otro servicio en tu equipo, utiliza esa dirección explícita.
