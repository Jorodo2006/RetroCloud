# Validación del almacenamiento autohospedado

Fecha: 7 de octubre de 2026 (Europe/Madrid).

## Entorno

Windows con Node.js 24.14.0, npm 11.9.0 y Docker Desktop con contenedores Linux.
MySQL 8.4, API con usuario node y volumen local storage-data.
Lockfile generado desde manifiestos limpios con npm 11.21.0 y reproducido mediante npm ci.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| Instalación limpia y compilación de la imagen | Correctas |
| Validación Prisma y TypeScript estricto | Correctas en Windows y Docker |
| Pruebas unitarias de configuración, HTTP y disco | 33/33 en Windows y Docker |
| Pruebas de integración MySQL/almacenamiento local | 7/7 en Windows y Docker |
| Migración 003 sobre la base existente | Aplicada correctamente, tres migraciones al día |
| Comparación de MySQL con el esquema Prisma | Sin diferencias |
| Escritura, reinicio real de la API y lectura del mismo archivo | Contenido conservado; fixture eliminado |
| Readiness después del reinicio | HTTP 200, database y storage true |
| Inicializadores migrate y storage-init | Exited (0) |
| npm audit | 0 vulnerabilidades reportadas |
| Paquetes @azure en el lockfile | 0 |
| Contenedor Azurite | Retirado; volumen anterior conservado |

Antes de sustituir Azurite se comprobó que no había versiones de saves en MySQL ni archivos
en sus contenedores saves/captures. No fue necesaria una transferencia de partidas reales.
La columna y el índice se renombraron mediante una nueva migración; el historial SQL anterior
se conserva sin cambios.

## Qué cubren las pruebas

- Rechazo de rutas relativas/absolutas, traversal, separadores alternativos y nombres no válidos.
- Rechazo de symlinks y junctions en categorías y en la raíz.
- Escrituras completas, ausencia de sobrescritura y competencia entre dos escritores.
- Persistencia entre instancias del adaptador y limpieza de probes.
- Healthchecks, errores HTTP y rechazo de descargas por rutas estáticas.
- Unicidad, pertenencia de sesiones/saves, ramas, padres de otra partida y checksums SQL.

Los archivos utilizados son sintéticos; no se han utilizado ROMs ni saves del usuario.

## Repetir

Con MySQL iniciado según el README:

```powershell
npm run check
npm run storage:init
npm run test:integration
npm run db:status
npm run db:diff
npm audit
```

## Límites

No están implementados autenticación, cola offline, sincronización ni resolución de conflictos.
No se ha inspeccionado Retro Machine, que está en otro PC.
No se ha realizado un simulacro completo de backup/restauración; queda para el despliegue local.
La comparación Prisma no representa los CHECK SQL adicionales, que se verifican mediante tests.
