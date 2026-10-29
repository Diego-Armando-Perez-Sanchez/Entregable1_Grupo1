# Publicar Huellas completo en Vercel

La nube utiliza un almacén **Vercel Blob privado** para los JSON y las imágenes. En local se conserva fs/promises, src/data y Multer diskStorage en public/img, como pide el ejercicio. El frontend y todos los endpoints se despliegan juntos en Vercel.

## Configurar el proyecto existente

1. Abrir `entregable1-grupo1` en la cuenta `diego-perez1` de Vercel.
2. En Settings, Build and Deployment, configurar **Root Directory** como la raíz del repositorio (`./`), no public ni src.
3. Seleccionar **Express** como Framework Preset. Dejar Build Command y Output Directory sin personalizaciones de un despliegue estático anterior. No se necesita un script build.
4. Seleccionar Node.js 24.x.
5. Comprobar que el repositorio conectado sea Diego-Armando-Perez-Sanchez/Entregable1_Grupo1 y la rama de producción sea main.

El archivo vercel.json declara Express y src/app.js exporta la aplicación por defecto. Los archivos de public se sirven estáticamente y el backend atiende /api, /config.js y las URLs de imágenes subidas.

## Conectar almacenamiento persistente

1. Dentro del proyecto, abrir **Storage**.
2. Crear o conectar un almacén **Blob** exclusivo para este proyecto.
3. Elegir acceso **Private**. No utilizar Public: los JSON de usuarios contienen hashes.
4. Conectarlo al entorno **Production**. Si se conecta también a Preview, ambos entornos compartirán los registros.
5. Comprobar que Vercel añadió **BLOB_READ_WRITE_TOKEN**, o que habilitó OIDC con BLOB_STORE_ID. Las credenciales permanecen en el servidor; no se pegan en GitHub ni en el frontend.
6. Revisar el plan y los límites que muestre tu cuenta antes de aceptar cualquier contratación.

No hace falta crear los JSON manualmente: la primera consulta inicializa data/users.json y data/pets.json solo si no existen. Nunca se sobrescriben registros existentes con arrays vacíos.

## Volver a desplegar

Tras conectar el almacén o modificar variables, abrir **Deployments** y realizar **Redeploy** del último commit de main. Las variables nuevas necesitan un despliegue nuevo.

Abrir el dominio de producción indicado por Vercel. Un enlace de preview puede pedir la sesión de Vercel según la protección del proyecto; esa pantalla no es un login de Huellas.

## Comprobar el despliegue real

1. Abrir la página e ingresar un usuario con avatar.
2. Editar su nombre, avatar y contraseña.
3. Crear una mascota con edad 0 y varias fotos.
4. Recargar y abrir desde otro navegador: los registros e imágenes deben permanecer.
5. Editar datos sin fotos y comprobar que conserva imágenes; subir fotos nuevas debe reemplazarlas.
6. Eliminar un usuario y comprobar que no cambia las mascotas.
7. Realizar otro despliegue y comprobar que los registros se conservan.
8. En Storage aparecerán data/users.json, data/pets.json e images/users o images/pets. Los JSON son privados y no se sirven mediante rutas públicas.

## Diferencias con el modo local

| Aspecto | Local | Vercel |
| --- | --- | --- |
| Registros | JSON bajo src/data | JSON en Blob privado |
| Carga inicial | Multer diskStorage en public/img | Multer diskStorage en /tmp y traslado a Blob |
| Imágenes persistentes | Disco local | Blob privado servido por /img/users o /img/pets |
| Contraseñas | scrypt con salt | El mismo hash en JSON privado |
| Concurrencia | Cola por recurso | Cola y comparación ETag entre instancias |
| Cantidad | Hasta cinco fotos | Hasta cinco fotos |
| Tamaño | 5 MiB por archivo | 3 MiB entre todas las imágenes del formulario |

El límite de nube deja margen frente al tamaño máximo de petición de Vercel. La interfaz muestra el límite automáticamente. Los callbacks de actualización deben limitarse a modificar el array, porque pueden repetirse si otra instancia cambia su versión.

El modo local conserva los mecanismos del SRS. La nube no debe presentarse como escritura persistente en src/data o public/img: su almacenamiento es Blob privado. Los registros usan lecturas sin caché y escrituras condicionales para no perder cambios.

## Diagnóstico

- **503 al consultar:** conectar Blob privado, comprobar variables y volver a desplegar.
- **Página sin API:** comprobar Root Directory ./, preset Express y retirar Output Directory public de una configuración anterior.
- **Error de acceso a Blob:** verificar que sea Private y esté conectado al entorno del despliegue.
- **413 antes de llegar al servidor:** reducir las fotos; el formulario admite 3 MiB en total.
- **Versión antigua:** abrir el despliegue del último commit y comprobar el dominio utilizado.

## Validación

Se ejecutaron 59 pruebas locales de API, imágenes, hashes, reinicio, errores, contratos de Blob y concurrencia entre adaptadores independientes. Las pruebas de Blob usan un servicio simulado que aplica las condiciones del SDK. No sustituyen la prueba del almacén real conectado a la cuenta.

La comprobación final requiere iniciar sesión en Vercel, conectar el almacén y probar la URL publicada. Un resultado local no confirma por sí mismo un despliegue remoto funcionando.

Referencias: [Express en Vercel](https://vercel.com/docs/frameworks/backend/express), [Blob privado](https://vercel.com/docs/vercel-blob/private-storage), [SDK Blob](https://vercel.com/docs/vercel-blob/using-blob-sdk), [límites de funciones](https://vercel.com/docs/functions/limitations).
