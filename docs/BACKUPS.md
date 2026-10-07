# Copias de seguridad locales

La persistencia de Docker no protege contra fallo de disco o eliminación de volúmenes.
Una copia útil incluye la base MySQL, el almacén de archivos y el .env protegido.
Guárdala también en otro disco. No añadas estas copias a Git.

## Docker en Windows (PowerShell)

Desde la raíz del proyecto, detén primero la API para no mezclar cambios de MySQL y archivos:

```powershell
docker compose stop api
New-Item -ItemType Directory -Force backups
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --single-transaction --no-tablespaces --set-gtid-purged=OFF --user="$MYSQL_USER" "$MYSQL_DATABASE" --result-file=/tmp/retro-cloud.sql'
docker compose cp mysql:/tmp/retro-cloud.sql ./backups/retro-cloud.sql
docker compose run --rm --no-deps --user root --volume "${PWD}/backups:/backup" api tar -czf /backup/storage.tar.gz -C /data/storage .
docker compose start api
```

Comprueba que cada comando termina correctamente y que ambos archivos existen antes de considerar
la copia válida. Usa una carpeta nueva por fecha si quieres conservar versiones; los nombres del
ejemplo se sobrescriben. Conserva las credenciales de .env de forma privada junto a la copia.

El contenedor temporal comparte el volumen de almacenamiento. Solo se usa root para leer
todos los archivos del backup; la API habitual se ejecuta como node.
No es necesario parar MySQL para un dump consistente de sus tablas InnoDB.

## API ejecutada directamente en Windows

Detén su proceso, realiza el dump MySQL y copia completa la carpeta STORAGE_ROOT.
El volumen Docker de archivos no contiene los archivos de esta modalidad.
No copies carpetas de datos internas de MySQL mientras el servidor esté ejecutándose.

## Restauración

Restaura el dump en una base local vacía y los archivos en un almacén local vacío, con la API
detenida y con la versión de aplicación correspondiente al backup. Conserva las claves lógicas
y los permisos del usuario de la API (node en Docker). Después aplica las migraciones posteriores
que correspondan y comprueba /health/ready.

La restauración no se ejecuta automáticamente. Un simulacro completo de recuperación y la
automatización de backups forman parte del futuro despliegue autohospedado.
Nunca uses docker compose down -v como parte de una copia: elimina los volúmenes.
