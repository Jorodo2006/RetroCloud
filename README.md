# Retro Cloud

Capa cloud para Retro Machine: biblioteca de **metadatos**, sesiones, partidas versionadas y logros.
**Los ROMs nunca se suben.**

## Estado: fase 1

Implementados: monorepo TypeScript estricto, API Express base, modelo MySQL, migración inicial,
almacenamiento privado en Azurite, configuración Zod, logs y pruebas de infraestructura.
`agent/` y `web/` son workspaces reservados: aún no ejecutan servicios.

Retro Machine está en otro PC. Falta verificar si emula en navegador o mediante procesos locales.
No se han supuesto rutas de ROMs/saves ni se ha cambiado el menú o mando existentes.

## Requisitos en Windows

- Node.js 24.14 o posterior de la rama 24 y npm 11.
- Docker Desktop con motor de contenedores Linux y Docker Compose.
- Ejecutar los comandos desde la raíz del repositorio, en PowerShell.
- Si PowerShell bloquea `npm.ps1`, usar `npm.cmd` en lugar de `npm`.

## Arranque local

```powershell
npm ci
npm run env:init
docker compose up --build -d
docker compose ps -a
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

`env:init` crea un `.env` con contraseñas y clave de Azurite aleatorias.
No imprime secretos y nunca sobrescribe un archivo existente.
Todas las variables están explicadas en [.env.example](.env.example).

Compose inicia MySQL y Azurite, aplica migraciones con `migrate`, crea los contenedores
privados con `storage-init` y después arranca la API. Los dos servicios de inicialización
deben terminar con `Exited (0)`; es su estado correcto.

La respuesta de readiness esperada es:

```json
{"status":"ok","checks":{"database":true,"storage":true}}
```

Puertos locales: API `3000`, MySQL `3307`, Blob `10000`. Solo se publican en `127.0.0.1`.
Si cambias puertos o credenciales en `.env`, actualiza también `DATABASE_URL` y
`STORAGE_BLOB_ENDPOINT` para las herramientas ejecutadas desde Windows.
Los contenedores usan internamente `mysql:3306` y `azurite:10000`.

## Desarrollo y comprobaciones

```powershell
npm run check
npm run build
npm run test:integration
npm run db:status
npm run db:diff
```

- `check`: valida Prisma, compila con tipos estrictos y ejecuta pruebas unitarias.
- `test:integration`: requiere MySQL y Azurite inicializados. Inserta únicamente fixtures
  con UUID aleatorios, comprueba restricciones y acceso privado a blobs, y elimina esos fixtures.
  No usar esta configuración local contra una base de producción.
- `db:diff`: comprueba que el esquema representable por Prisma no tenga diferencias.
  Los CHECK SQL adicionales se verifican con las pruebas de integración.
- Tests de identificación de ROMs, sincronización y resolución de conflictos se añadirán
  cuando se implemente esa lógica en las fases 3 y 5.

Para ejecutar la API directamente en Windows:

```powershell
docker compose stop api
npm run dev
```

Mantén MySQL y Azurite funcionando. `dev` carga `.env` y recompila al iniciar.
Los cambios en `packages/shared` requieren repetir la compilación.
La API aún no contiene endpoints de autenticación o biblioteca.

## Migraciones versionadas

`db/schema.prisma` describe el modelo y `db/migrations/` conserva el SQL.
Las migraciones aplicadas no se editan: cada cambio futuro requiere una nueva migración.

```powershell
npm run db:migrate
npm run db:generate
```

Para generar una migración futura sin conceder permisos globales al usuario de la aplicación:

```powershell
npx prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script --output db/migrations/AAAAMMDDHHMMSS_descripcion/migration.sql
```

Crea antes la carpeta, revisa el SQL, aplica la migración y ejecuta las pruebas.
Ese diff parte de la base local: verifica primero que tenga todas las migraciones anteriores.
Los cambios a CHECK u otras restricciones SQL requieren SQL explícito.
No se utiliza `db push` ni creación automática de tablas al arrancar la API.

## Logs y persistencia

```powershell
docker compose logs --tail 100 api migrate storage-init
docker compose down
```

`down` conserva los volúmenes de MySQL y Azurite.
Cambiar `MYSQL_PASSWORD` no modifica contraseñas de una base ya inicializada.
No borres volúmenes para aplicar migraciones o reiniciar servicios.

Los logs son JSON con identificador de petición. No registran cuerpos, cabeceras de
autenticación, URLs de conexión ni detalles internos de errores HTTP.
La API escucha en `0.0.0.0` dentro del contenedor para permitir su comprobación de salud.

## Límites y siguientes fases

No hay JWT, usuarios de ejemplo, credenciales de dispositivos, subidas/restauración de partidas,
portal, caché de proveedor activa ni conexión con RetroAchievements.
Los contenedores de saves y capturas están preparados, pero no hay endpoints de subida.
No es un despliegue de producción: TLS de MySQL, autenticación, límites de uso,
secretos de Azure y CI se concretarán en sus fases.

La fase 2 será autenticación, registro de dispositivos y biblioteca, previa aprobación.
Antes de la fase 3 hay que revisar el proyecto Retro Machine existente.

Más detalles en [ARCHITECTURE.md](docs/ARCHITECTURE.md) y [VALIDATION.md](docs/VALIDATION.md).
