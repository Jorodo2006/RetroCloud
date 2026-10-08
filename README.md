# Retro Cloud

Biblioteca de metadatos, sesiones, partidas versionadas y logros para Retro Machine.
**Autohospedado: API, MySQL y archivos en tu propio equipo. Los ROMs nunca se suben.**

## Estado

Fases 1–3: monorepo TypeScript estricto, MySQL con migraciones, almacenamiento local,
autenticación de usuarios, dispositivos con claves revocables y biblioteca privada de metadatos.
`agent/` ya escanea carpetas locales, calcula SHA-256 y sincroniza metadatos con cola persistente.
Fase 4 provisional: API de sesiones idempotentes, historial y estadísticas; ver [SESSIONS.md](docs/SESSIONS.md).
La detección en EmulatorJS y la cola de sesiones siguen pendientes.
`web/` sigue reservado. La conexión con Retro Machine del otro PC queda pendiente.

No se necesita una cuenta cloud. La instalación inicial descarga dependencias e imágenes;
una vez instaladas, los servicios locales funcionan sin Internet.
RetroAchievements y los proveedores de metadatos/portadas serán integraciones opcionales.

## Arranque en Windows

Requisitos: Node.js 24.14 o posterior de la rama 24, npm 11 y Docker Desktop con contenedores Linux.
Ejecuta desde la raíz del repositorio en PowerShell; usa `npm.cmd` si se bloquea `npm.ps1`.

```powershell
npm ci
npm run env:init
docker compose up --build -d --remove-orphans
docker compose ps -a
Invoke-RestMethod http://localhost:3000/health/ready
```

`env:init` genera las credenciales MySQL, la clave JWT y la ruta local en `.env`, sin mostrarlas.
Si `.env` ya existe, conserva sus valores y añade JWT_SECRET solo cuando falta. Consulta [.env.example](.env.example).
En una configuración anterior, sustituye las variables de Azure/Azurite por `STORAGE_ROOT`,
con una ruta absoluta; conserva las credenciales actuales de MySQL.

Compose inicia MySQL, aplica migraciones con `migrate`, prepara las carpetas con `storage-init`
y arranca la API. Los inicializadores terminan con `Exited (0)`; es correcto.
La API utiliza un usuario sin privilegios de root y su volumen de archivos le pertenece.

```json
{"status":"ok","checks":{"database":true,"storage":true}}
```

Puertos locales: API `3000` y MySQL `3307`, publicados solo en `127.0.0.1`.
No hay servidor de archivos ni puerto de almacenamiento.
Si cambias credenciales/puerto de MySQL, actualiza también `DATABASE_URL` para Windows.

## Primera cuenta y API

Todavía no hay pantalla web de registro. Sigue los ejemplos PowerShell de [API.md](docs/API.md)
para crear tu cuenta, iniciar sesión, registrar dispositivos y consultar la biblioteca.
La contraseña se solicita sin guardarla en el historial de comandos.

Por defecto, REGISTRATION_MODE=first-user permite la primera cuenta y cierra el registro.
Puedes usar open para más cuentas o closed para impedir altas; reinicia la API al cambiarlo.
El indicador se conserva en MySQL. Las pruebas usan otra base y no consumen tu primera cuenta.

- Usuarios: registro, login, perfil, refresh y logout. JWT de 15 minutos y sesión de 30 días.
- Dispositivos: alta, listado, rotación de API key y revocación; se guardan solo hashes.
- Biblioteca: filtros y sincronización idempotente de metadatos, aislados por usuario.
- Los lotes aceptan título, consola, SHA-256 y tamaño; nunca ROMs ni rutas locales.

Si cambias el puerto de API, ajusta APP_ORIGIN. El portal futuro usará el mismo origen
o un proxy de desarrollo; no hay CORS habilitado.

## Agente local: prueba sin ROMs ni cuenta

```powershell
npm run build
npm run agent:demo
```

La demo escanea un archivo sintético y no hace peticiones de red. Para configurar tus carpetas,
credenciales, comandos y el perfil Docker opcional, consulta [agent/README.md](agent/README.md).
El agente lee los ROMs por bloques y envía solo metadatos; conserva la cola durante desconexiones
y reinicios. En este alcance provisional no elimina entradas remotas al desaparecer archivos.

## Dónde se guarda todo

- Estado del agente: AGENT_STATE_ROOT en Windows; volumen `retro-cloud_agent-data` en Docker.
- MySQL: volumen Docker `retro-cloud_mysql-data`.
- Saves y capturas en Docker: volumen `retro-cloud_storage-data`, montado en `/data/storage`.
- API ejecutada directamente en Windows: la carpeta absoluta indicada por `STORAGE_ROOT`;
  por defecto `data/storage` dentro del repositorio.

**El volumen Docker y la carpeta de Windows son almacenes distintos.** Elige un modo al trabajar
con archivos reales y copia los archivos y su base de datos conjuntamente al trasladarlos.
`data/`, `backups/` y `.env` están excluidos de Git y de la imagen Docker.

Los archivos se identifican como `saves/<uuid>` o `captures/<uuid>`; los nombres originales y
las rutas arbitrarias no se utilizan. Una clave existente no se sobrescribe.
La API no expone todavía rutas de subida/descarga de saves; corresponden a la fase 5.

## Pruebas y desarrollo

```powershell
npm run check
npm run test:integration
npm run test:unit:docker
npm run test:integration:docker
npm run db:status
npm run db:diff
```

`check` valida Prisma, TypeScript y pruebas unitarias. La integración requiere MySQL iniciado
mediante Compose: crea una base retro_test_<aleatorio>, aplica migraciones y usa archivos
temporales. Al terminar elimina base, permisos temporales y archivos, sin usar tus datos.

`test:integration` ejecuta Node en Windows; `test:integration:docker` lo ejecuta en Linux como node.
Construye la imagen con `docker compose build api` después de cambiar código antes de las pruebas Docker.
Vitest usa carga nativa y caché desactivada en Docker para no escribir en el código de la imagen.
Se comprueban autenticación, revocación, aislamiento, reintentos concurrentes y restricciones SQL.

Para ejecutar la API en Windows:

```powershell
docker compose stop api
npm run db:migrate
npm run storage:init
npm run dev
```

Mantén MySQL funcionando. Los cambios en `packages/shared` requieren repetir la compilación.
Puedes volver a la API Docker con `docker compose up -d api` después de detener `npm run dev`.

## Migraciones

`db/schema.prisma` describe el modelo; `db/migrations/` conserva el SQL versionado.
No se modifican migraciones aplicadas. La tercera renombra `blob_key` a `storage_key`
sin borrar registros ni modificar las dos anteriores. La cuarta añade sesiones de autenticación,
refresh tokens, cierre del primer registro, títulos privados y catálogo inicial de consolas.

```powershell
npm run db:migrate
npm run db:generate
```

Para futuros cambios, crea una carpeta nueva y genera/revisa el SQL:

```powershell
npx prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script --output db/migrations/AAAAMMDDHHMMSS_descripcion/migration.sql
```

La base de partida debe tener todas las migraciones anteriores. Los CHECK adicionales se
mantienen como SQL explícito y se prueban en integración. La API no modifica el esquema al arrancar.

## Parada y copias de seguridad

```powershell
docker compose logs --tail 100 api migrate storage-init
docker compose down
```

`down` conserva los volúmenes. No uses `down -v` si quieres conservar tus datos.
Los volúmenes persistentes no sustituyen a una copia de seguridad.

Consulta [BACKUPS.md](docs/BACKUPS.md) para copiar MySQL y archivos de forma coherente.
El volumen antiguo de Azurite se ha conservado como precaución, aunque no se utiliza.
Se comprobó que no contenía archivos ni versiones de partidas al hacer este cambio.

## Pendiente

Fase 4: queda la detección real y el envío persistente de sesiones. Antes de conectarlos habrá que revisar cómo ejecuta juegos
Retro Machine y cómo proporciona eventos desde la web. Después: saves, portal e integraciones opcionales. La fase 9 será despliegue en tu propio equipo y CI opcional.
Antes de exponer la API a otros dispositivos habrá que configurar acceso de red, HTTPS
y copias de seguridad. Actualmente solo escucha en loopback del host.

Detalles: [API](docs/API.md), [arquitectura](docs/ARCHITECTURE.md), [dependencias](docs/DEPENDENCIES.md)
y [validación](docs/VALIDATION.md).
