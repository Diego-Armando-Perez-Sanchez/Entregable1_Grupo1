import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useBlob, cloudImageBudget, storeImage, removeImage } from '../utils/storage.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

const IMG_DIR = useBlob ? path.join(tmpdir(), 'huellas-img') : fileURLToPath(new URL('../../public/img', import.meta.url));
export const MAX_FILE_SIZE_MB = useBlob ? 3 : 5;

// Formatos permitidos: extensión que asigna el servidor y firma binaria esperada.
const TYPES = {
  'image/jpeg': ['.jpg', /^\xff\xd8\xff/],
  'image/png': ['.png', /^\x89PNG\r\n\x1a\n/],
  'image/gif': ['.gif', /^GIF8[79]a/],
  'image/webp': ['.webp', /^RIFF[\s\S]{4}WEBP/],
};

const upload = (folder) => multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      const target = path.join(IMG_DIR, folder);
      mkdir(target, { recursive: true }).then(() => callback(null, target), callback);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${TYPES[file.mimetype][0]}`),
  }),
  fileFilter: (req, file, cb) => (TYPES[file.mimetype]
    ? cb(null, true)
    : cb(httpError(400, 'Formato de imagen no permitido. Use JPG, PNG, GIF o WEBP'))),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
});

export const uploadUsers = upload('users');
export const uploadPets = upload('pets');

const filesOf = (req) => (req.file ? [req.file] : Array.isArray(req.files) ? req.files : []);

// URL pública relativa de un archivo subido, p. ej. /img/users/archivo.png
export const toUrl = (file) => `/img/${path.basename(file.destination)}/${file.filename}`;

// Comprueba que el contenido real de cada archivo coincida con el tipo declarado.
export async function verifyImages(req, res, next) {
  const files = filesOf(req);
  try {
    if (useBlob && files.reduce((total, file) => total + file.size, 0) > cloudImageBudget) {
      throw httpError(400, 'Las imágenes juntas deben pesar como máximo 3 MB.');
    }
    // Validar todas antes de subir la primera al almacén persistente.
    for (const file of files) {
      const header = (await readFile(file.path)).toString('latin1', 0, 12);
      if (!TYPES[file.mimetype][1].test(header)) throw httpError(400, `El archivo "${file.originalname}" no es una imagen válida`);
    }
    if (useBlob) for (const file of files) {
      file.blobPath = `images/${path.basename(file.destination)}/${file.filename}`;
      await storeImage(file.blobPath, await readFile(file.path), file.mimetype);
    }
  } finally {
    if (useBlob) await Promise.all(files.map((file) => unlink(file.path).catch((error) => { if (error.code !== 'ENOENT') throw error; })));
  }
  next();
}

// Elimina imágenes a partir de sus URLs guardadas. Solo acepta nombres generados
// por el servidor dentro de /img/users o /img/pets, así nunca sale de esas carpetas.
// Los fallos se registran en el servidor y no interrumpen la respuesta.
export async function deleteImages(urls) {
  await Promise.all(urls.map(async (url) => {
    const match = /^\/img\/(users|pets)\/([\w-]+\.(?:jpg|png|gif|webp))$/.exec(url);
    if (!match) return console.warn(`Ruta de imagen ignorada: ${url}`);
    try {
      if (useBlob) await removeImage(`images/${match[1]}/${match[2]}`);
      else await unlink(path.join(IMG_DIR, match[1], match[2]));
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(`No se pudo eliminar ${url}:`, error);
    }
  }));
}

// Limpia los archivos recién subidos de una petición que terminó en error.
// Solo considera archivos ya guardados (con `path`): si Multer aborta una carga,
// él mismo elimina lo que alcanzó a escribir.
export async function discardUploads(req) {
  const files = filesOf(req);
  await deleteImages(files.filter((file) => useBlob ? file.blobPath : file.path).map(toUrl));
  if (useBlob) await Promise.all(files.map((file) => unlink(file.path).catch(() => {})));
}

export function uploadErrorMessage(error) {
  if (error.code === 'LIMIT_FILE_SIZE') return `Cada imagen debe pesar como máximo ${MAX_FILE_SIZE_MB} MB`;
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return `Campo de archivo no permitido o se superó el máximo de archivos en "${error.field}"`;
  }
  return `Error al cargar archivos (${error.code})`;
}
