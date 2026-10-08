# Agente local — fase 3

Servicio Node.js para escanear carpetas por consola y enviar **solo metadatos** a Retro Cloud.
La integración con Retro Machine del otro PC sigue pendiente. Este agente funciona con archivos
locales accesibles por Node; no accede al almacenamiento interno del navegador.

## Probar sin cuenta ni ROMs

Desde la raíz del repositorio:

```powershell
npm ci
npm run env:init
npm run build
npm run agent:demo
```

La demo crea un archivo de texto sintético en data/agent-demo/roms/snes, calcula su SHA-256
y muestra contadores. No llama a la API, no necesita credenciales y no modifica un archivo existente
si tiene otro contenido. No es un juego ejecutable.

## Configurar carpetas

Copia library.example.json a agent/library.json si aún no tienes configuración propia.
Ese archivo local está excluido de Git y de la imagen Docker. Ejemplo:

```json
{
  "roots": [
    { "directory": "snes", "consoleSlug": "snes", "extensions": [".sfc", ".smc"] },
    { "directory": "nes", "consoleSlug": "nes", "extensions": [".nes"] }
  ]
}
```

directory es una subcarpeta relativa a AGENT_ROMS_ROOT. No admite rutas absolutas ni componentes `.` o `..`. Usa subcarpetas separadas por consola. El escaneo es recursivo, con máximo 64 niveles.
Todas las carpetas configuradas deben existir. Los enlaces simbólicos y junctions interiores
se omiten; una raíz redirigida por enlace se rechaza. No se escriben ni borran archivos de ROM.

Las extensiones se configuran en minúsculas; los nombres se comparan sin distinguir mayúsculas.
La consola se asigna por configuración: usa los slugs de GET /consoles descritos en [API.md](../docs/API.md).
No se detecta la consola por extensión ni se consulta un proveedor externo.

Edita las variables correspondientes en el .env de la raíz:

```dotenv
AGENT_ROMS_ROOT=C:/Retro/roms
AGENT_STATE_ROOT=C:/Retro/agent-state
AGENT_LIBRARY_CONFIG=C:/ruta/Retro cloud/agent/library.json
AGENT_API_URL=http://localhost:3000
```

Son ejemplos: sustituye las rutas por las de tu equipo. No copies aquí una carpeta del navegador
sin comprobar antes cómo almacena los juegos. La integración real se decidirá cuando esté disponible.

## Comandos

| Comando desde la raíz | Acción |
| --- | --- |
| npm run agent:demo | Escanea el ejemplo sintético, sin red ni credenciales. |
| npm run agent:scan | Escanea tus carpetas sin enviar datos ni guardar cola; recalcula hashes. |
| npm run agent:once | Escanea, guarda observaciones y procesa los envíos pendientes que ya pueden reintentarse. |
| npm run agent:start | Mantiene el servicio activo; escanea cada 300 segundos por defecto y revisa la cola cada 5. |
| npm run agent:sync | Procesa la cola sin volver a escanear. |
| npm run agent:status | Muestra contadores y códigos de error de la cola. |
| npm run agent:retry | Habilita un nuevo intento de los pendientes/bloqueados; no envía por sí solo. |

Repite npm run build después de cambiar código. Ctrl+C cierra el agente y libera su estado.
Los comandos que utilizan la cola requieren configurar dispositivo y clave.
Código de salida: 0 completado, 1 fallo local/configuración, 2 quedan envíos pendientes o bloqueados
en una ejecución once/sync. El servicio continuo conserva el trabajo y sigue reintentando.

## Registrar el dispositivo

Crea tu cuenta y un dispositivo siguiendo [API.md](../docs/API.md).
Guarda exclusivamente en .env los valores recibidos:

- AGENT_DEVICE_ID: id del dispositivo.
- AGENT_API_KEY: clave mostrada una sola vez al crearlo o rotarla.

El agente usa la API key, no tu contraseña, JWT ni credenciales de MySQL.
Nunca pongas esa clave en un frontend público. Las peticiones no siguen redirecciones.
El estado se vincula al origen de API y al id de dispositivo para evitar reutilizar una cola
con otra instalación. Rotar la clave del mismo dispositivo conserva la cola.
Después de cambiar .env, reinicia el agente; en Docker, vuelve a ejecutar Compose up para aplicar el entorno.

Tras configurar ambos valores:

```powershell
docker compose up -d
npm run agent:once
npm run agent:status
npm run agent:start
```

Usa solo una instancia por carpeta de estado; también status/retry requieren detener antes
el servicio si está usando esa misma carpeta.

## Cola, reintentos e identificación

El hash es SHA-256 de los bytes completos del archivo, leído en bloques de 1 MiB.
El tamaño se conserva como cadena decimal. Se comprueba identidad, tamaño y marcas de tiempo
antes/después; un archivo cambiante o una lectura incompleta hace fallar el escaneo.
El título provisional procede del nombre sin extensión. Archivos idénticos en una consola
producen una sola entrada; ante dos títulos se elige el primero del recorrido ordenado.
El mismo contenido asignado a dos consolas hace fallar el escaneo para revisar la configuración.

La caché usa ruta, dispositivo/inodo, tamaño, mtime y ctime. Evita recalcular archivos sin cambios;
presupone un sistema de archivos local con metadatos fiables. Un escaneo fallido no sustituye la caché
ni vacía la cola. Los hashes de archivos comprimidos corresponden al contenedor completo:
no hay extracción ZIP, agrupación multidisco ni normalización de RetroAchievements.

SQLite guarda la caché y la cola en AGENT_STATE_ROOT, con transacciones y modo WAL/FULL.
Las rutas completas se quedan en esa caché local; la API recibe solo título, consola, hash y tamaño.
El estado no contiene la API key ni contraseñas. Usa una carpeta local dedicada, no una unidad de red
o una carpeta sincronizada, y protégela con los permisos de tu cuenta.

Los lotes respetan 50 elementos y un máximo preventivo de 28 KiB UTF-8.
Solo se confirman tras validar toda la respuesta: dispositivo, fingerprints, títulos y consolas.
Si la API guardó el lote pero se perdió la respuesta, el reintento idempotente no crea duplicados.
Una respuesta antigua tampoco confirma una observación más reciente.

Los fallos de red, 408, 429 y 5xx se reintentan con espera creciente, variación aleatoria y un límite
de 5 minutos; Retry-After puede ampliar la espera hasta 24 horas. 401/403/404 suspenden los envíos
al menos un minuto: revisa clave, dispositivo y URL. La espera se conserva al reiniciar.

Los errores permanentes por elemento (por ejemplo 400/409) dividen el lote para aislar los rechazos.
Los válidos continúan y los rechazados quedan blocked. Consulta agent:status, corrige la causa
y ejecuta agent:retry seguido de agent:sync. Un fingerprint ya asociado a otra consola en la API
requiere revisar también ese registro; cambiar solo el mapeo local no reasigna el juego canónico.

**Esta fase solo añade o actualiza observaciones.** Retirar un archivo local no borra su entrada
remota ni cancela observaciones ya encoladas. La reconciliación de bajas queda pendiente junto a la
integración real; así una carpeta desconectada no provoca eliminaciones automáticas.

Node 24.14 incluye node:sqlite como API experimental y puede mostrar ese aviso al arrancar.
No requiere instalar un servidor SQLite ni paquetes nativos adicionales.
Referencia: [documentación de Node 24.14](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html).

## Ejecutar el agente en Docker

El perfil es opcional, para no arrancarlo sin rutas ni credenciales:

```powershell
docker compose --profile agent up --build -d
docker compose logs --tail 50 agent
docker compose --profile agent stop agent
```

Compose monta AGENT_ROMS_ROOT como /roms y AGENT_LIBRARY_CONFIG como /config/library.json,
ambos en solo lectura. No crea carpetas host inexistentes. Dentro del contenedor usa api:3000
y guarda su cola en el volumen retro-cloud_agent-data (/data/agent), como usuario node.

La carpeta de estado Windows y el volumen Docker son distintos. Elige un modo por dispositivo;
para usar otro agente independiente, registra otro dispositivo. No ejecutes ambos contra el mismo
dispositivo. Copia el estado completo con el agente detenido si lo trasladas: incluye SQLite y sus
archivos auxiliares. No borres estado con trabajo pendiente; perderías esa cola local.

## Alcance pendiente

No se han inspeccionado ROMs reales ni el emulador web. Quedan integración con el navegador,
bajas remotas automáticas, agrupación/normalización de formatos especiales, instalación como servicio
del sistema, sesiones de juego, saves, logros y portal para sus fases correspondientes.
