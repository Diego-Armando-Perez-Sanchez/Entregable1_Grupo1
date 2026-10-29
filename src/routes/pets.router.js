import { Router } from 'express';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readData, updateData } from '../utils/persistence.js';
import { uploadPets, verifyImages } from '../middlewares/multer.middleware.js';

const router = Router();
const imagesDirectory = fileURLToPath(new URL('../../public/img/pets/', import.meta.url));
const uploadImages = uploadPets.array('img', 5);
const allowedFields = ['especie', 'color', 'edad', 'sexo'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function validateId(req, res, next) {
  const value = req.params.id;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    return next(httpError(400, 'El id debe ser un entero positivo.'));
  }
  req.petId = Number(value);
  next();
}

function validateFields(body = {}, partial = false) {
  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) {
      throw httpError(400, `Campo no permitido: ${field}. El id y las imágenes los gestiona el servidor.`);
    }
  }
  const values = {};
  for (const field of allowedFields) {
    if (!Object.hasOwn(body, field)) {
      if (!partial) throw httpError(400, `El campo ${field} es obligatorio.`);
      continue;
    }
    const value = body[field];
    if (field === 'edad') {
      // Multipart envía texto. No usar !edad: cero es un valor válido.
      const validText = typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim());
      if (!(typeof value === 'number' || validText) || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw httpError(400, 'La edad debe ser un número mayor o igual a cero.');
      }
      values.edad = Number(value);
    } else {
      if (typeof value !== 'string' || !value.trim()) {
        throw httpError(400, `El campo ${field} debe ser un texto no vacío.`);
      }
      values[field] = value.trim();
    }
  }
  return values;
}

// Solo elimina nombres simples dentro de public/img/pets, nunca rutas del cliente.
async function removeImages(urls) {
  const results = await Promise.allSettled(urls.map(async (url) => {
    if (typeof url !== 'string' || !url.startsWith('/img/pets/')) return;
    const name = url.slice('/img/pets/'.length);
    if (!name || name === '.' || name === '..' || /[\\/:\x00]/.test(name)) return;
    try {
      await unlink(path.join(imagesDirectory, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }));
  // Una limpieza fallida no convierte un cambio ya guardado en un falso error.
  for (const result of results) {
    if (result.status === 'rejected') console.error('No se pudo limpiar una imagen de mascota:', result.reason);
  }
}

const uploadedUrls = (req) => (req.files ?? []).map((file) => `/img/pets/${file.filename}`);

function receiveImages(req, res, next) {
  uploadImages(req, res, (error) => {
    if (!error) return next();
    // Multer limpia sus archivos ante errores; esta segunda limpieza tolera ENOENT.
    removeImages(uploadedUrls(req)).then(() => next(error));
  });
}

router.get('/', async (req, res, next) => {
  try {
    res.status(200).json(await readData('pets'));
  } catch (error) { next(error); }
});

router.get('/:id', validateId, async (req, res, next) => {
  try {
    const pets = await readData('pets');
    const pet = pets.find((item) => item.id === req.petId);
    if (!pet) throw httpError(404, 'Mascota no encontrada.');
    res.status(200).json(pet);
  } catch (error) { next(error); }
});

router.post('/', receiveImages, verifyImages, async (req, res, next) => {
  let committed = false;
  try {
    const values = validateFields(req.body);
    const pet = await updateData('pets', (pets) => {
      const id = pets.reduce((max, item) => Math.max(max, item.id), 0) + 1;
      if (!Number.isSafeInteger(id)) throw httpError(500, 'No se pudo generar el id.');
      const created = { id, ...values, img: uploadedUrls(req) };
      pets.push(created);
      return created;
    });
    committed = true;
    req.uploadsCommitted = true;
    res.status(201).json(pet);
  } catch (error) {
    if (!committed) await removeImages(uploadedUrls(req));
    next(error);
  }
});

router.put('/:id', validateId, receiveImages, verifyImages, async (req, res, next) => {
  let committed = false;
  try {
    const values = validateFields(req.body, true);
    const images = uploadedUrls(req);
    if (!Object.keys(values).length && !images.length) {
      throw httpError(400, 'Envía al menos un campo válido o una imagen para actualizar.');
    }
    const result = await updateData('pets', (pets) => {
      const index = pets.findIndex((item) => item.id === req.petId);
      if (index === -1) throw httpError(404, 'Mascota no encontrada.');
      const previous = pets[index];
      const pet = { ...previous, ...values, img: images.length ? images : previous.img };
      pets[index] = pet;
      return { pet, replaced: images.length ? previous.img : [] };
    });
    committed = true;
    req.uploadsCommitted = true;
    // Borrar las anteriores únicamente después de confirmar la escritura del JSON.
    await removeImages(result.replaced);
    res.status(200).json(result.pet);
  } catch (error) {
    if (!committed) await removeImages(uploadedUrls(req));
    next(error);
  }
});

router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const images = await updateData('pets', (pets) => {
      const index = pets.findIndex((item) => item.id === req.petId);
      if (index === -1) throw httpError(404, 'Mascota no encontrada.');
      return pets.splice(index, 1)[0].img;
    });
    await removeImages(images);
    res.status(200).json({ message: 'Mascota eliminada correctamente.' });
  } catch (error) { next(error); }
});

export default router;
