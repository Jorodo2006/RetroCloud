# Dependencias

Las dependencias directas se fijan a versiones exactas y package-lock.json se versiona.
Prisma CLI, cliente y adaptador MySQL utilizan 7.10.0.

El almacenamiento utiliza exclusivamente las APIs de archivos de Node.js.
Se ha eliminado @azure/storage-blob y sus dependencias transitivas de almacenamiento.
No hace falta una cuenta cloud ni un SDK de proveedor para el funcionamiento local.

## Overrides transitivos

Se mantienen las versiones corregidas:

- mariadb: 3.5.4, para el adaptador MySQL.
- mysql2: 3.24.5, utilizado por las herramientas de Prisma.
- deepmerge-ts: 8.0.2, utilizado por la configuración de Prisma.

El lockfile se genera con npm 11.21.0 desde los manifiestos limpios, para evitar reutilizar
instalaciones parciales de los workspaces. npm ci reproduce el árbol fijado.
Tras cambiar estos overrides deben pasar compilación, migraciones y pruebas contra MySQL
y el almacenamiento local. Se podrán retirar cuando las dependencias superiores incluyan
las versiones corregidas.

Los resultados están en [VALIDATION.md](VALIDATION.md).
