# Huellas usuarios y mascotas

Entregable 1 de Electiva I Backend. El proyecto implementa dos recursos independientes con Node.js y Express: usuarios y mascotas. Los datos se guardan en archivos JSON locales mediante `fs/promises`; las imágenes se cargan con `multer.diskStorage` y se publican mediante `express.static`. Una interfaz basada en la plantilla original de Huellas permite utilizar esas mismas funciones desde el navegador.

## Integrantes

| Integrante | Responsabilidad acordada |
| --- | --- |
| Kevin Almario | Persona 1: servidor, persistencia, Multer y configuración |
| Daniel Feria | Persona 2: usuarios y hashing de contraseñas |
| Diego Armando Pérez Sánchez | Persona 3: mascotas y documentación |

## Alcance

La entrega contiene los diez endpoints de usuarios y mascotas. Las contraseñas se transforman con `crypto.scrypt` y un salt aleatorio por registro. Ninguna respuesta HTTP devuelve `password`.

Incluye una interfaz en HTML, CSS y JavaScript, conectada a los diez endpoints existentes. Se conserva el estilo de Huellas y se adapta a usuarios y mascotas. No incluye Handlebars, login, JWT, productos, base de datos ni relaciones entre usuarios y mascotas. No se exige iniciar sesión para usar la aplicación o probar la API.

El Word del profesor establece los requisitos de la API. La interfaz se conserva como complemento solicitado para utilizar sus funcionalidades; no agrega recursos nuevos ni cambia sus contratos.

## Requisitos e instalación

- Node.js 18 o superior y npm. La revisión se ejecutó con Node.js 24.14.0.
- Express, Multer y el SDK oficial @vercel/blob son las dependencias externas; las versiones instaladas se conservan en `package-lock.json`.
- Módulos ES mediante `"type": "module"`.

Desde la carpeta donde está `package.json`:

```powershell
npm ci
npm start
```

Aplicación y servidor: `http://localhost:8080`.

Abrir `http://localhost:8080` para ver Huellas. Para consultar la API directamente, abrir `http://localhost:8080/api/pets` o `http://localhost:8080/api/users`. Inicialmente ambas consultas devuelven `[]` y la interfaz muestra estados vacíos hasta crear registros.

La interfaz y la API se sirven juntas con `npm start`. No hace falta ejecutar Live Server ni abrir index.html directamente. Si está en ejecución una versión anterior del proyecto, detenerla con Ctrl+C y arrancar esta carpeta antes de probar la interfaz.

Para reinicio automático durante desarrollo:

```powershell
npm run dev
```

No se necesita `.env` en local. Opcionalmente se puede cambiar el puerto con `PORT`. Para Vercel, seguir [la guía de despliegue](DESPLIEGUE_VERCEL.md) y conectar un almacén Blob privado.

## Estructura

```text
├── public/
│   ├── index.html
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   └── app.js
│   └── img/
│       ├── users/
│       │   └── .gitkeep
│       └── pets/
│           └── .gitkeep
├── src/
│   ├── app.js
│   ├── middlewares/
│   │   └── multer.middleware.js
│   ├── routes/
│   │   ├── users.router.js
│   │   └── pets.router.js
│   ├── utils/
│   │   ├── crypto.js
│   │   ├── persistence.js
│   │   └── storage.js
│   └── data/
│       ├── users.json
│       └── pets.json
├── tests/
│   ├── api.test.mjs
│   ├── storage.test.mjs
│   ├── cloud.test.mjs
│   └── server.mjs
├── DESPLIEGUE_VERCEL.md
├── vercel.json
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── README.md
```

Se conserva la estructura del SRS. `persistence.js` es el auxiliar acordado en el reparto para compartir lectura y escritura. La carpeta `tests` contiene únicamente la validación automática, sin agregar funciones al sistema.

## Usar la interfaz

- **Inicio:** muestra el número real de usuarios, mascotas e imágenes, accesos a los formularios y las mascotas registradas.
- **Mascotas:** galería con búsqueda, categorías por especie, orden por edad o registro y filtros por sexo e imágenes. Cada mascota tiene detalle, visor de fotos y opciones de edición y eliminación.
- **Usuarios:** directorio con búsqueda por nombre, apellido, username o ID. Permite consultar cada registro, crearlo, editarlo y eliminarlo.
- **Imágenes:** selección o arrastre, vistas previas y opción de quitar archivos antes de guardar. El selector rechaza formatos, tamaños o cantidades inválidas y permite limpiar la selección.
- **Edición:** los campos omitidos se conservan. En usuarios, dejar la contraseña vacía mantiene la actual. Las imágenes actuales se conservan si no se eligen otras.
- **Eliminación:** se solicita confirmación; cancelar conserva el registro. Borrar un usuario no elimina mascotas.

Los formularios muestran los errores del servidor sin borrar los datos introducidos. Las vistas se adaptan a escritorio y celular. La búsqueda y los filtros operan sobre los registros que devuelve la API; no crean endpoints adicionales. La contraseña de confirmación solo se usa en el formulario y no se envía como un campo nuevo al backend.

Rutas de la interfaz: `/#/`, `/#/mascotas`, `/#/mascotas/nueva`, `/#/usuarios` y `/#/usuarios/nuevo`. Las rutas de detalle y edición incluyen el ID del registro y pueden recargarse o compartirse dentro del mismo servidor.

## Persistencia compartida

`readData(resource)` devuelve el array del archivo correspondiente. `updateData(resource, callback)` lee el array, permite que el callback lo modifique, espera la escritura y devuelve el resultado del callback. Solo se admiten `users` y `pets`.

Si el callback falla, no se escriben sus cambios. Las modificaciones se ordenan por recurso para evitar pérdida de registros entre peticiones simultáneas. Se escribe un archivo temporal y después se reemplaza el JSON completo. Un archivo ausente o corrupto produce un error 500; no se reemplaza automáticamente por un array vacío.

En modo local, el proyecto debe ejecutarse en un solo proceso Node para que la cola en memoria coordine todas las escrituras. Los JSON se entregan inicializados con `[]`.

## Endpoints

| Método | Ruta | Respuesta exitosa | Estado |
| --- | --- | --- | --- |
| GET | /api/users | Array de usuarios sin password | 200 |
| GET | /api/users/:id | Usuario sin password | 200 |
| POST | /api/users | Usuario creado sin password | 201 |
| PUT | /api/users/:id | Usuario actualizado sin password | 200 |
| DELETE | /api/users/:id | Objeto con message | 200 |
| GET | /api/pets | Array de mascotas | 200 |
| GET | /api/pets/:id | Mascota | 200 |
| POST | /api/pets | Mascota creada | 201 |
| PUT | /api/pets/:id | Mascota actualizada | 200 |
| DELETE | /api/pets/:id | Objeto con message | 200 |

## Campos

| Recurso | Campo | POST | Formato |
| --- | --- | --- | --- |
| Usuario | firstname | Obligatorio | Texto no vacío |
| Usuario | lastname | Obligatorio | Texto no vacío |
| Usuario | username | Obligatorio | Texto único, sin distinguir mayúsculas |
| Usuario | password | Obligatorio | Texto no vacío; se guarda salt:hash |
| Usuario | avatar | Opcional | Un archivo de imagen |
| Mascota | especie | Obligatorio | Texto no vacío |
| Mascota | color | Obligatorio | Texto no vacío |
| Mascota | edad | Obligatorio | Número finito mayor o igual a cero |
| Mascota | sexo | Obligatorio | Texto no vacío |
| Mascota | img | Opcional | De cero a cinco archivos de imagen |

El servidor genera el ID como máximo existente más uno, empezando en 1. El cliente no puede asignarlo ni modificarlo. Según esta regla, un ID máximo eliminado puede reutilizarse en una creación posterior.

Las imágenes son opcionales: un usuario sin imagen guarda `avatar: ""` y una mascota sin fotos guarda `img: []`. En multipart la edad llega como texto y se convierte a número; `0` y `1.5` son válidos. Se rechazan negativos, textos no numéricos, valores vacíos, booleanos y arrays. Especie y sexo son textos libres, pues el SRS no define catálogos.

Los campos desconocidos o administrados por el servidor se rechazan con 400. Los campos de archivo deben enviarse como archivos, no como URLs en el cuerpo.

## Imágenes y multipart en Postman

1. Seleccionar POST o PUT y escribir la URL.
2. En Body elegir `form-data`.
3. Agregar los campos de texto.
4. Para un usuario, agregar una fila `avatar`, cambiar su tipo a File y seleccionar una imagen.
5. Para una mascota, agregar hasta cinco filas con el mismo nombre `img`, cada una de tipo File.
6. Dejar que Postman configure `Content-Type` y el boundary automáticamente.

El campo es `img`, no `img[]`, `foto` ni `images`. No se envían rutas del computador como texto.

En local, Multer usa `diskStorage` para guardar los archivos en `public/img/users` o `public/img/pets`. En Vercel la carga se valida en /tmp y se traslada a Blob privado; sus URLs se mantienen bajo /img. Los nombres combinan fecha, UUID y extensión para evitar colisiones. Se admiten JPG, PNG, GIF y WebP, con máximo 5 MiB por archivo. Además del MIME, se comprueba la cabecera del archivo para rechazar contenido que no corresponda al formato declarado.

## Ejemplos de usuarios

En PowerShell utiliza `curl.exe`. Ejecuta cada ejemplo una vez sobre datos vacíos; cambia las rutas de fotos por archivos que existan en tu computador.

Crear sin avatar:

```powershell
curl.exe -i -X POST "http://localhost:8080/api/users" -F "firstname=Ana" -F "lastname=Perez" -F "username=ana.perez" -F "password=ClaveEjemplo123"
```

Respuesta 201:

```json
{"id":1,"firstname":"Ana","lastname":"Perez","username":"ana.perez","avatar":""}
```

Para crear con avatar, agregar al POST `-F "avatar=@C:/fotos/avatar.png"`. No crear dos usuarios con el mismo username.

Consultar, actualizar y eliminar el usuario:

```powershell
curl.exe "http://localhost:8080/api/users"
curl.exe "http://localhost:8080/api/users/1"
curl.exe -i -X PUT "http://localhost:8080/api/users/1" -F "lastname=Gomez" -F "password=OtraClave456"
curl.exe -i -X PUT "http://localhost:8080/api/users/1" -F "avatar=@C:/fotos/avatar-nuevo.png"
curl.exe -i -X DELETE "http://localhost:8080/api/users/1"
```

GET de listado devuelve un array. GET individual y PUT devuelven el objeto completo sin password. Cada cambio de contraseña genera un hash con un nuevo salt, sin exigir login ni contraseña anterior.

Respuesta de eliminación 200:

```json
{"message":"Usuario 1 eliminado correctamente"}
```

## Ejemplos de mascotas

Crear sin imágenes:

```powershell
curl.exe -i -X POST "http://localhost:8080/api/pets" -F "especie=perro" -F "color=negro" -F "edad=0" -F "sexo=macho"
```

Respuesta 201:

```json
{"id":1,"especie":"perro","color":"negro","edad":0,"sexo":"macho","img":[]}
```

Crear otra mascota con dos fotos:

```powershell
curl.exe -i -X POST "http://localhost:8080/api/pets" -F "especie=gato" -F "color=gris" -F "edad=2" -F "sexo=hembra" -F "img=@C:/fotos/gato1.jpg" -F "img=@C:/fotos/gato2.jpg"
```

Respuesta ilustrativa 201; los nombres reales de archivo son únicos:

```json
{"id":2,"especie":"gato","color":"gris","edad":2,"sexo":"hembra","img":["/img/pets/nombre-unico-1.jpg","/img/pets/nombre-unico-2.jpg"]}
```

Consultar, cambiar solo edad, reemplazar fotos y eliminar:

```powershell
curl.exe "http://localhost:8080/api/pets"
curl.exe "http://localhost:8080/api/pets/2"
curl.exe -i -X PUT "http://localhost:8080/api/pets/2" -F "edad=3"
curl.exe -i -X PUT "http://localhost:8080/api/pets/2" -F "img=@C:/fotos/gato-nueva.jpg"
curl.exe -i -X DELETE "http://localhost:8080/api/pets/2"
```

Respuesta de eliminación 200:

```json
{"message":"Mascota eliminada correctamente."}
```

## Actualizaciones y limpieza de archivos

- PUT modifica únicamente los campos enviados; los omitidos conservan sus valores.
- PUT sin archivos conserva las imágenes actuales.
- Un nuevo avatar reemplaza al anterior. Las nuevas imágenes de mascotas reemplazan todo el array, con máximo cinco.
- Las imágenes anteriores se eliminan únicamente después de confirmar la escritura del JSON.
- Si la validación o la escritura falla, se limpian los archivos nuevos y se conservan los anteriores.
- PUT vacío o con campos inválidos responde 400. No se admite vaciar imágenes enviando `img: []` como texto o JSON.
- DELETE elimina el registro y limpia sus imágenes. Eliminar un usuario no modifica las mascotas.
- Si falla una limpieza física después de guardar, se registra el problema en el servidor; no se informa que falló una operación que ya quedó persistida.

## Errores

| Estado | Significado | Ejemplo |
| --- | --- | --- |
| 400 | Datos o cargas inválidos | Falta especie, edad negativa, username duplicado o seis imágenes |
| 404 | Recurso o ruta inexistente | ID que no existe |
| 500 | Fallo del servidor o de archivos | JSON corrupto, archivo ausente o escritura fallida |

Los IDs deben ser enteros positivos seguros. `0`, `-1`, `01`, `1.2`, `abc` o un entero fuera del rango seguro se rechazan con 400. Los errores tienen formato `{ "error": "Descripción" }` y no muestran trazas internas.

Ejemplo:

```json
{"error":"La edad debe ser un número mayor o igual a cero."}
```

## Comprobar URLs y persistencia manualmente

1. Crear un usuario o mascota con una imagen.
2. Copiar la ruta real que devuelve `avatar` o `img` y anteponer `http://localhost:8080`.
3. Abrir la URL en el navegador. Ejemplo de formato: `http://localhost:8080/img/pets/nombre-real.jpg`. No agregar `/public`.
4. Comprobar el registro en `src/data/users.json` o `src/data/pets.json`. Las rutas de imagen son URLs relativas, sin rutas físicas del computador.
5. Detener el servidor con Ctrl+C, ejecutar de nuevo `npm start` y repetir los GET. Los registros e imágenes deben conservarse.
6. Verificar que users.json contiene un hash y que ninguna respuesta incluye password.
7. Probar los casos de error y las actualizaciones con conservación y reemplazo de imágenes.

## Pruebas automáticas

```powershell
npm test
```

La suite contiene 59 pruebas de API y almacenamiento y utiliza un proceso auxiliar con copias temporales de la aplicación y los datos. No cambia los JSON ni las imágenes del proyecto. Comprueba los diez endpoints, estados HTTP, cargas, hashes, concurrencia, errores de lectura y escritura, limpieza de imágenes e independencia de recursos. También detiene y reinicia el proceso para verificar la persistencia y comprueba que HTML, CSS y JavaScript se sirven correctamente.

Durante la revisión se verificaron además 19 recorridos en Chrome: formularios reales, búsquedas, filtros, detalle, subida y reemplazo de archivos, eliminación, errores y vistas móviles. Estas comprobaciones de navegador se realizaron aparte de `npm test`, sin añadir dependencias a la aplicación. Los datos e imágenes de esas pruebas se crearon en una copia temporal y no forman parte de la entrega.

## Preparar la entrega en GitHub

Versionar el código, README, package-lock.json, pruebas, JSON iniciales con `[]` y `.gitkeep`. No subir node_modules, archivos de entorno, imágenes ni registros de pruebas. Antes de entregar, comprobar `npm ci`, `npm test` y `npm start` desde un clon limpio.

Para Vercel se añadió un modo de almacenamiento persistente con Blob privado. Consulta DESPLIEGUE_VERCEL.md antes de desplegar. En local se conservan los archivos JSON y el almacenamiento en disco del ejercicio.

## Funcionamiento en Vercel

Vercel activa automáticamente el almacenamiento Blob. Los JSON se guardan como archivos privados y las imágenes se publican mediante las mismas rutas /img/users y /img/pets. Multer usa diskStorage temporal en /tmp, valida las imágenes y las traslada al almacén persistente; los temporales se eliminan. No se utiliza /tmp como una base de datos ni para prometer persistencia.

En nube se mantienen hasta cinco fotos por mascota y se limita la suma a 3 MiB por formulario, por el límite de petición de Vercel. El límite local de 5 MiB por archivo no cambia. La interfaz muestra el límite de su entorno automáticamente.

Las escrituras comparan la versión ETag para evitar pérdidas entre distintas instancias. Un conflicto vuelve a leer los datos y reintenta; si persiste, devuelve 503. La falta de conexión a Blob también devuelve 503 y no guarda falsamente en disco temporal. Las ocho pruebas de contratos Blob utilizan un servicio simulado; cuatro pruebas adicionales comprueban el modo Vercel sin credenciales y el límite de cargas. El almacén real requiere la comprobación descrita en la guía.
