# Dependencias

Las dependencias directas se fijan a versiones exactas; `package-lock.json` se versiona.
Se utiliza Prisma 7.10 con su adaptador MySQL/MariaDB, manteniendo CLI, cliente y adaptador
en la misma versión.

## Overrides transitivos

La auditoría inicial señaló dependencias transitivas vulnerables.
Se fijan las siguientes versiones corregidas, sin cambiar la API pública de Retro Cloud:

- `mariadb`: 3.5.4, utilizado por el adaptador Prisma de MySQL.
- `mysql2`: 3.24.5 (utilizado por herramientas de Prisma).
- `deepmerge-ts`: 8.0.2 (utilizado por la configuración de Prisma).

Tras cualquier cambio de estos overrides deben ejecutarse validación de Prisma,
generación, compilación, migraciones y pruebas contra MySQL/Azurite.
Se podrán retirar cuando las dependencias superiores incorporen versiones corregidas.

Los resultados de la auditoría y comprobaciones de esta fase están en [VALIDATION.md](VALIDATION.md).

## Compatibilidad de almacenamiento

Se fija @azure/storage-blob 12.33.0 para usar la API 2026-06-06, soportada por Azurite 3.37.0.
No se desactiva la validación de versión del emulador.

Fuente: [historial oficial del SDK](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/storage/storage-blob/CHANGELOG.md).
