# API local — fase 2

Base de desarrollo: `http://localhost:3000`. JSON, máximo 32 KiB por petición.
Las fechas son UTC ISO 8601 y los tamaños de archivo son cadenas decimales.
Cada respuesta incluye `X-Request-Id` y `Cache-Control: no-store`.

## Autenticación de usuarios

| Método / ruta | Credencial | Resultado |
| --- | --- | --- |
| POST /auth/register | Cabecera de cliente | Crea cuenta y sesión; 201. |
| POST /auth/login | Cabecera de cliente | Inicia sesión; 200. |
| POST /auth/refresh | Cookie + cabecera de cliente | Rota refresh y devuelve JWT; 200. |
| POST /auth/logout | Cookie + cabecera de cliente | Revoca esa sesión y borra cookie; 204, repetible. |
| GET /auth/me | Bearer JWT | Perfil propio. |

La cabecera de cliente es `X-Retro-Client: web`. Si se envía `Origin`, debe coincidir
exactamente con `APP_ORIGIN`. No hay CORS habilitado. El portal usará el mismo origen
(o un proxy de desarrollo). Las herramientas de consola pueden omitir Origin, pero
deben enviar la cabecera de cliente. El JWT se envía como `Authorization: Bearer <token>`.

Registro: `{ "email": "...", "password": "...", "displayName": "..." }`.
Login: email y password. Las contraseñas nuevas admiten entre 12 y 128 caracteres;
no se recortan ni se altera su contenido. El email se recorta y convierte a minúsculas.
Refresh y logout admiten un objeto vacío.

Registro/login devuelven `user`, `accessToken`, `tokenType: "Bearer"` y `expiresIn: 900`.
Refresh devuelve los tres campos del token. El refresh **solo** viaja en la cookie
`retro_refresh`: HttpOnly, SameSite=Strict, Path=/auth, sin Domain, Secure según configuración.
La sesión vence a los 30 días del login; la renovación no amplía ese plazo.
La API guarda hashes SHA-256 de refresh y comprueba la sesión en MySQL en cada uso del JWT.

Cada refresh se usa una vez. Reutilizarlo revoca toda su sesión, incluidos JWT ya emitidos.
El cliente debe coordinar la renovación entre pestañas y no reintentar automáticamente
un refresh cuya respuesta se haya perdido: en ese caso, iniciar sesión de nuevo.
Logout necesita la cookie de esa sesión; eliminar el JWT del cliente por sí solo no la revoca.

`REGISTRATION_MODE=first-user` permite la primera cuenta y cierra el registro mediante
un indicador permanente en MySQL, incluso si después se elimina esa cuenta manualmente.
`open` permite más cuentas y `closed` impide todas las altas. Cambiarlo requiere reiniciar
la API con el entorno actualizado. Una migración sobre usuarios existentes deja el registro cerrado.

Registro y login comparten un límite de 20 peticiones por IP cada 15 minutos; refresh permite 120.
Se devuelve 429 con Retry-After. El contador está en memoria y se reinicia con la API.
En Docker varios clientes pueden compartir la IP del proxy. No se confía en X-Forwarded-For;
el despliegue con proxy y varios procesos queda para la fase 9.

## Dispositivos y biblioteca

| Método / ruta | Credencial | Resultado |
| --- | --- | --- |
| POST /devices | JWT | Alta con `{ "name": "Retro Machine" }`; devuelve dispositivo y API key una sola vez. |
| GET /devices | JWT | Dispositivos propios, incluidos revocados; limit y offset. |
| POST /devices/:id/key | JWT | Rota clave propia; invalida las anteriores y muestra la nueva una vez. |
| DELETE /devices/:id | JWT | Revoca dispositivo y claves, conservando historial; 204 repetible. |
| GET /consoles | JWT | Catálogo inicial: id, slug y nombre. |
| GET /library | JWT | Biblioteca propia; filtros deviceId, consoleSlug, limit y offset. |
| GET /library/:id | JWT | Entrada propia activa; 404 si no existe o pertenece a otra cuenta. |
| POST /agent/library | X-Api-Key | Upsert de 1–50 entradas de metadatos del dispositivo autenticado. |
| DELETE /agent/library/:id | X-Api-Key | Baja lógica de una entrada del propio dispositivo; 204 repetible. |

Los listados paginados devuelven `{ items, total, limit, offset }`.
Limit vale 20 por defecto, máximo 100; offset admite 0–100000.
El listado de biblioteca excluye bajas lógicas, pero conserva entradas de dispositivos revocados.
Una API key no sirve como JWT y un JWT no sirve como API key.
Las claves no se incrustarán en código público del navegador.

Ejemplo de cuerpo de sincronización con **metadatos sintéticos**:

```json
{
  "items": [{
    "consoleSlug": "snes",
    "title": "Juego de prueba",
    "hashAlgorithm": "SHA256",
    "checksum": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sizeBytes": "4096"
  }]
}
```

Solo se admite SHA-256 del archivo completo en esta fase; no es el hash específico de RetroAchievements.
El catálogo inicial se consulta en /consoles. Añadir consolas se hará mediante migraciones;
no se infiere todavía qué consolas usa Retro Machine.

El lote es atómico: un error no deja entradas parciales. La clave de identificación es
algoritmo + checksum + tamaño; la entrada es única por dispositivo y archivo.
Repetir el envío actualiza lastSeenAt/título sin duplicar. Reenviar una entrada dada de baja
la reactiva conservando id y firstSeenAt. Omitirla en un lote **no** la elimina.
Un mismo fingerprint asociado a otra consola produce 409 FINGERPRINT_CONFLICT.
Las carreras entre dispositivos se resuelven mediante restricciones SQL y reintentos acotados.

El título enviado pertenece a la entrada del dispositivo. El juego compartido queda pendiente
de identificación canónica por un proveedor; un usuario no cambia el título de otro.
La respuesta incluye id de entrada, dispositivo, gameId, título local, consola, fingerprint y fechas.
Nunca incluye rutas locales, claves ni contenido ROM. Los objetos Zod son estrictos:
campos adicionales como rom, data, path, userId o deviceId en el lote se rechazan.

## Probar desde PowerShell

Primero ejecuta `npm run env:init` y `docker compose up --build -d`.
El siguiente alta consume el registro de la primera cuenta; usa tus datos.
La contraseña se solicita sin escribirla en el historial de comandos.

```powershell
$retroUrl = "http://localhost:3000"
$retroClientHeaders = @{ "X-Retro-Client" = "web" }
$retroEmail = Read-Host "Email"
$retroSecurePassword = Read-Host "Contraseña (mínimo 12 caracteres)" -AsSecureString
$retroRegistration = @{
  email = $retroEmail
  password = [System.Net.NetworkCredential]::new("", $retroSecurePassword).Password
  displayName = Read-Host "Nombre"
} | ConvertTo-Json
$retroAccount = Invoke-RestMethod -Method Post -Uri "$retroUrl/auth/register" -Headers $retroClientHeaders -ContentType "application/json" -Body $retroRegistration -SessionVariable retroHttpSession
$retroRegistration = $null
$retroAuthHeaders = @{ Authorization = "Bearer $($retroAccount.accessToken)" }

Invoke-RestMethod "$retroUrl/auth/me" -Headers $retroAuthHeaders
Invoke-RestMethod "$retroUrl/consoles" -Headers $retroAuthHeaders
$retroDevice = Invoke-RestMethod -Method Post -Uri "$retroUrl/devices" -Headers $retroAuthHeaders -ContentType "application/json" -Body '{"name":"Retro Machine Windows"}'
Invoke-RestMethod "$retroUrl/library" -Headers $retroAuthHeaders
```

La clave está en `$retroDevice.apiKey`; guarda la del futuro agente en su entorno privado.
La API no permite recuperarla; si la pierdes, rótala. No la pegues en Git ni en capturas.

Para una cuenta existente, usa /auth/login con email y password y conserva
`-SessionVariable retroHttpSession`. Para renovar y cerrar:

```powershell
$retroRenewed = Invoke-RestMethod -Method Post -Uri "$retroUrl/auth/refresh" -Headers $retroClientHeaders -WebSession $retroHttpSession -ContentType "application/json" -Body '{}'
$retroAuthHeaders = @{ Authorization = "Bearer $($retroRenewed.accessToken)" }
Invoke-RestMethod -Method Post -Uri "$retroUrl/auth/logout" -Headers $retroClientHeaders -WebSession $retroHttpSession -ContentType "application/json" -Body '{}'
```

El JWT renovado también queda revocado al hacer logout.

## Errores y límites del alcance

Formato: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
400 indica validación/JSON/consola desconocida, 401 credenciales inválidas, 403 registro u origen
rechazado, 404 recurso ajeno/inexistente, 409 conflicto, 413 cuerpo excesivo, 429 límite de peticiones.
500 no expone excepciones, SQL ni secretos. Los logs solo registran requestId, estado, duración
y códigos de error; no cuerpos, cookies o tokens.

Esta fase no incluye recuperación/cambio de contraseña, verificación de correo, gestión de roles,
limpieza automática de sesiones vencidas, frontend, agente ni transferencias de saves.
Los tokens usados se conservan para detectar replays mientras su sesión siga siendo válida.

## Sesiones y estadísticas (fase 4 provisional)

POST /agent/sessions con API key; GET /sessions y GET /stats con JWT del propietario.
Contrato, reenvíos, filtros y ejemplos en [SESSIONS.md](SESSIONS.md).
