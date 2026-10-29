import express from 'express';
import multer from 'multer';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { useBlob, cloudImageBudget, readImage } from './utils/storage.js';
import usersRouter from './routes/users.router.js';
import petsRouter from './routes/pets.router.js';
import { discardUploads, uploadErrorMessage } from './middlewares/multer.middleware.js';

export const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/config.js', (req, res) => {
  res.set('Cache-Control', 'no-store').type('application/javascript').send(`window.HUELLAS_CONFIG = ${JSON.stringify({ maxImageMB: useBlob ? 3 : 5, maxTotalImageBytes: useBlob ? cloudImageBudget : null })};`);
});
if (useBlob) app.get('/img/:resource/:filename', async (req, res) => {
  const { resource, filename } = req.params;
  if (!['users', 'pets'].includes(resource) || !/^[\w-]+\.(jpg|png|gif|webp)$/.test(filename)) return res.status(404).json({ error: 'Imagen no encontrada' });
  const image = await readImage(`images/${resource}/${filename}`);
  if (!image || image.statusCode !== 200) return res.status(404).json({ error: 'Imagen no encontrada' });
  res.set({ 'Content-Type': image.blob.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  await pipeline(Readable.fromWeb(image.stream), res);
});
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.use('/api/users', usersRouter);
app.use('/api/pets', petsRouter);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Express 5 dirige aquí los errores de los routers asíncronos y de Multer.
app.use(async (error, req, res, next) => {
  if (!req.uploadsCommitted) await discardUploads(req);
  if (res.headersSent) return next(error);

  const isUploadError = error instanceof multer.MulterError;
  const status = isUploadError ? 400 : error.status ?? error.statusCode ?? 500;

  if (status >= 500 && !error.expose) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  const message = isUploadError ? uploadErrorMessage(error)
    : error.type === 'entity.parse.failed' ? 'El cuerpo JSON no es válido'
      : error.status === 400 || error.status === 404 || error.expose ? error.message : 'Solicitud inválida';
  res.status(status).json({ error: message });
});

// Al importar app para pruebas no se ocupa el puerto de uso normal.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => console.log(`Huellas disponible en http://localhost:${port}`));
}

export default app;
