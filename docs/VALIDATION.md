# Validación de la fase 1

Fecha: 7 de octubre de 2026 (Europe/Madrid).

## Entorno comprobado

- Windows, Node.js 24.14.0 y npm 11.9.0.
- Docker Desktop con motor Linux y Docker Compose 5.3.0.
- MySQL 8.4 y Azurite 3.37.0.
- Lockfile generado desde manifiestos limpios con npm 11.21.0;
  instalación reproducida con npm ci 11.9.0 en Windows y en Docker.

## Resultados

| Comprobación | Resultado |
| --- | --- |
| Instalación limpia desde package-lock.json | Correcta en Windows y en la imagen Linux |
| Validación del esquema Prisma | Correcta |
| Generación y compilación TypeScript estricta | Correctas en Windows y Docker |
| Pruebas unitarias de configuración y HTTP | 15/15 en Windows y Docker |
| Pruebas de integración MySQL/Azurite | 7/7 en Windows y Docker |
| Dos migraciones sobre MySQL inicialmente vacío | Aplicadas correctamente |
| Repetición de migrate deploy | Sin migraciones pendientes |
| Comparación de la base con el esquema Prisma | Sin diferencias |
| Contenedores de API, MySQL y Azurite | Healthy |
| Contenedores migrate y storage-init | Exited (0) |
| GET /health/live | HTTP 200, status ok |
| GET /health/ready | HTTP 200, database y storage true |
| npm audit | 0 vulnerabilidades reportadas al validar |
| Exclusión de secretos y artefactos generados en Git | .env, node_modules, .tmp y cliente Prisma ignorados |

La integración comprueba unicidad de fingerprints y biblioteca, identificadores de sesión
idempotentes, propiedad de dispositivos y saves, fechas inválidas, ramas de versiones,
reintentos de subida, padres de otra partida, versiones positivas y checksums.
También sube un blob sintético, comprueba su contenido y verifica que una lectura anónima falla.
Los fixtures se eliminan al terminar; no se han utilizado ROMs ni partidas reales.

## Repetir comprobaciones

Con el entorno iniciado según el README:

```powershell
npm run check
npm run test:integration
npm run db:status
npm run db:diff
npm audit
```

También se han ejecutado check e integración en un contenedor temporal de la imagen final.
La comparación de Prisma no representa los CHECK SQL adicionales; las pruebas de integración
verifican sus restricciones críticas.

## Alcance no probado todavía

No hay lógica de identificación de ROMs, cola offline, sincronización, restauración o resolución
de conflictos. Sus pruebas llegarán con las fases correspondientes.
No se ha inspeccionado Retro Machine, que está en otro PC, ni se ha desplegado nada en Azure.
