# Retro Cloud

Biblioteca de metadatos, sesiones, partidas versionadas y logros para Retro Machine.
**Autohospedado: API, MySQL y archivos en tu propio equipo. Los ROMs nunca se suben.**

## Estado

Fase 1: monorepo TypeScript estricto, API Express base, migraciones MySQL y almacenamiento
local persistente, con configuración Zod, logs y pruebas. `agent/` y `web/` están reservados
para futuras fases. Retro Machine está en otro PC y falta revisar cómo ejecuta sus emuladores.

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

`env:init` genera las credenciales de MySQL y la ruta local en `.env`, sin mostrar secretos
ni sobrescribir archivos existentes. Consulta [.env.example](.env.example).
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

## Dónde se guarda todo

- MySQL: volumen Docker `retro-cloud_mysql-data`.
- Saves y capturas en Docker: volumen `retro-cloud_storage-data`, montado en `/data/storage`.
- API ejecutada directamente en Windows: la carpeta absoluta indicada por `STORAGE_ROOT`;
  por defecto `data/storage` dentro del repositorio.

**El volumen Docker y la carpeta de Windows son almacenes distintos.** Elige un modo al trabajar
con archivos reales y copia los archivos y su base de datos conjuntamente al trasladarlos.
`data/`, `backups/` y `.env` están excluidos de Git y de la imagen Docker.

Los archivos se identifican como `saves/<uuid>` o `captures/<uuid>`; los nombres originales y
las rutas arbitrarias no se utilizan. Una clave existente no se sobrescribe.
La API no expone rutas de descarga todavía: la autenticación y la sincronización llegarán después.

## Pruebas y desarrollo

```powershell
npm run check
npm run storage:init
npm run test:integration
npm run db:status
npm run db:diff
```

`check` valida Prisma, los tipos y las pruebas unitarias. La integración usa MySQL local
y el almacén de Windows de `.env`; crea fixtures sintéticos y los elimina.
Comprueba rutas, enlaces simbólicos, escrituras concurrentes, persistencia y restricciones SQL.

Para ejecutar la API en Windows:

```powershell
docker compose stop api
npm run storage:init
npm run dev
```

Mantén MySQL funcionando. Los cambios en `packages/shared` requieren repetir la compilación.
Puedes volver a la API Docker con `docker compose up -d api` después de detener `npm run dev`.

## Migraciones

`db/schema.prisma` describe el modelo; `db/migrations/` conserva el SQL versionado.
No se modifican migraciones aplicadas. La tercera renombra `blob_key` a `storage_key`
sin borrar registros ni modificar las dos anteriores.

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

Fase 2: autenticación, dispositivos y biblioteca. Después: agente, sesiones, sincronización de saves,
portal e integraciones opcionales. La fase 9 será despliegue en tu propio equipo y CI opcional.
Antes de exponer la API a otros dispositivos habrá que completar autenticación y configurar
acceso de red, HTTPS y copias de seguridad. Actualmente solo escucha en loopback del host.

Detalles: [arquitectura](docs/ARCHITECTURE.md), [dependencias](docs/DEPENDENCIES.md)
y [validación](docs/VALIDATION.md).
