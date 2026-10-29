import express from 'express';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import usersRouter from './routes/users.router.js';
import petsRouter from './routes/pets.router.js';
import productsRouter from './routes/products.router.js';
import { discardUploads, uploadErrorMessage } from './middlewares/multer.middleware.js';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.use('/api/users', usersRouter);
app.use('/api/pets', petsRouter);
app.use('/api/products', productsRouter); // Ruta del ejemplo de clase, fuera del alcance de la actividad.

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Manejo centralizado de errores. Express 5 envía aquí también los errores de
// las funciones async de los routers.
app.use(async (error, req, res, next) => {
  await discardUploads(req); // Ninguna imagen de una operación fallida queda huérfana.
  if (res.headersSent) return next(error);

  const isUploadError = error instanceof multer.MulterError;
  const status = isUploadError ? 400 : error.status ?? error.statusCode ?? 500;

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  const message = isUploadError ? uploadErrorMessage(error)
    : error.type === 'entity.parse.failed' ? 'El cuerpo JSON no es válido'
      : error.expose ? error.message : 'Solicitud inválida';
  res.status(status).json({ error: message });
});

app.listen(PORT, (error) => {
  if (error) throw error;
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
