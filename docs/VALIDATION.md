# Validación — fase 3

Pruebas: 7 de octubre de 2026 (Europe/Madrid). Cierre documental: 8 de octubre.

## Entorno

Windows, Node.js 24.14.0, npm 11.9.0, Docker Desktop con contenedores Linux y MySQL 8.4.
Lockfile generado con npm 11.21.0 desde manifiestos limpios y reproducido con npm ci.
API y pruebas Docker ejecutadas como node (uid 1000), sin root.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| Validación Prisma y TypeScript estricto | Correctas |
| Construcción de imagen retro-cloud-local:phase3 | Correcta |
| Pruebas unitarias Windows | 89/89 |
| Pruebas unitarias Linux/Docker | 89/89 |
| Integración Windows con MySQL real | 28/28 |
| Integración Linux/Docker con MySQL real | 28/28 |
| Migración 004 en bases temporales desde cero | Correcta en ambas plataformas |
| Migración 004 sobre la base local existente | Aplicada; cuatro migraciones al día |
| Comparación de MySQL con db/schema.prisma | Sin diferencias |
| GET /health/ready en la API arrancada | 200; database y storage true |
| Rutas /auth/me, /library y /agent/library sin credenciales | 401 |
| Registro con cuerpo inválido | 400 VALIDATION_ERROR, sin crear cuenta |
| Inicializadores migrate y storage-init | Exited (0) |
| Usuario real de la API | uid=1000(node) |
| Auditoría durante npm ci de la imagen final | 0 vulnerabilidades |
| Estado de la base real tras las pruebas | 0 usuarios, primera cuenta disponible, 18 consolas, 0 versiones de saves |

Los temporales de Vitest se ajustaron para poder probar como node: cargador de configuración
nativo, caché desactivada en Docker y archivos de prueba en la carpeta temporal del sistema.
La prueba que realiza varias derivaciones scrypt tiene 15 segundos de margen para equipos
con carga; no se redujeron los parámetros de seguridad de las contraseñas.

## Cobertura añadida en fase 3

- SHA-256 por bloques, cambios durante lectura, archivos vacíos y cancelación.
- Escaneo recursivo, filtros, caché, duplicados y rechazo de enlaces o rutas inseguras.
- Cola SQLite persistente, bloqueo de instancia, vinculación a dispositivo y confirmaciones por revisión.
- Reintentos automáticos tras desconexión/reinicio, backoff, Retry-After y aislamiento de elementos inválidos.
- Respuesta perdida después de confirmar en MySQL: reenvío sin duplicados.
- Rotación de API key y ejecución real del CLI compilado.
- Demo sintética en Windows y escaneo mediante el perfil Docker opcional; montajes de ROMs y configuración comprobados como solo lectura.

No se añadieron migraciones MySQL en esta fase. Las comprobaciones de salud, esquema y base real de la tabla se verificaron durante la fase 2; las suites completas y la imagen se verificaron de nuevo en fase 3.

## Cobertura anterior

- Contraseñas con sal independiente; verificación correcta, incorrecta y de usuario inexistente.
- JWT: firma, emisor, audiencia, algoritmo, caducidad y sesión obligatoria.
- Registro de primera cuenta bajo dos peticiones simultáneas; modos cerrado y abierto.
- Cookies HttpOnly/SameSite, cabecera de cliente, origen, rate limit y perfiles sin secretos.
- Refresh rotativo, replay, renovaciones simultáneas, logout y caducidad de sesión.
- Registro, listado, rotación y revocación de dispositivos; acceso a recursos de otro usuario rechazado.
- Lotes de biblioteca idempotentes, fingerprints compartidos y concurrencia entre dispositivos.
- Títulos privados, filtros, aislamiento por usuario, baja lógica y reactivación.
- Rollback del lote completo ante conflicto de consola, sin inserciones parciales.
- Rechazo de campos ROM/ruta/usuario adicionales, hashes incorrectos, tamaños fuera de rango y paginación inválida.
- Restricciones MySQL de sesiones y saves previstas en fase 1.
- Disco: claves seguras, symlinks/junctions, escrituras concurrentes, ausencia de sobrescritura y persistencia.

Las pruebas de integración crean una base retro_test_<aleatorio> y un almacén temporal.
Al terminar eliminan la base, sus permisos y los archivos. No crean cuentas en la base real,
no consumen su primer registro y no usan ROMs ni saves del usuario.

## Repetir

Desde PowerShell, con MySQL iniciado mediante Compose:

```powershell
npm ci
npm run env:init
npm run check
docker compose up --build -d
npm run test:integration
npm run test:unit:docker
npm run test:integration:docker
npm run db:status
npm run db:diff
```

La imagen debe reconstruirse después de cambiar código antes de las pruebas Docker.
Los ejemplos para utilizar los endpoints y crear la primera cuenta están en [API.md](API.md).

## Pendiente de otras fases

Integración con las carpetas reales de Retro Machine, sesiones de juego, sincronización/versionado de saves,
resolución de conflictos, portal e integraciones opcionales. No se ha inspeccionado Retro Machine,
que sigue en otro PC. No hay recuperación/cambio de contraseña, correo, limpieza automática de
sesiones caducadas, despliegue LAN/HTTPS ni simulacro completo de backup/restauración.

La comparación Prisma no representa los CHECK SQL adicionales; estos se verifican en integración.
El límite de peticiones usa memoria de un proceso y se reinicia con la API.

## Antecedente: almacenamiento local de fase 1

La sustitución de Azurite se validó con 33 pruebas unitarias y 7 de integración en ambas plataformas.
Se comprobó persistencia tras reiniciar la API y ausencia de archivos/versiones reales que trasladar.
Las migraciones 001–003 se conservan intactas y el volumen antiguo no participa en Compose.

## Estado al cerrar la fase (8 de octubre)

Docker Desktop no estaba disponible y el intento de iniciarlo no habilitó el motor Linux. Por ello no se pudo ejecutar hoy `docker compose up -d` para actualizar la API en ejecución. La imagen de fase 3 y las suites Windows/Docker indicadas arriba se validaron el 7 de octubre. Cuando Docker esté iniciado, ejecuta `docker compose up -d` y comprueba `/health/ready`. El agente real no se ha arrancado: faltan sus carpetas y credenciales de dispositivo.
