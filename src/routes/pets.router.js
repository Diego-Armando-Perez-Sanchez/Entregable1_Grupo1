import { Router } from 'express';
import { readData, updateData, nextId } from '../utils/persistence.js';
import { uploadPets, verifyImages, deleteImages, toUrl } from '../middlewares/multer.middleware.js';
import { httpError, parseId, findIndexById, readFields, text } from '../utils/http.js';

const router = Router();

// En multipart/form-data la edad llega como texto; en JSON puede llegar como número.
function age(value, name) {
  const valid = typeof value === 'number' || (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value));
  const number = Number(value);
  if (!valid || !Number.isFinite(number) || number < 0) {
    throw httpError(400, `El campo "${name}" debe ser un número mayor o igual a 0`);
  }
  return number;
}

const FIELDS = { especie: text, color: text, edad: age, sexo: text };
const NOT_FOUND = 'Mascota no encontrada';

router.param('id', (req, res, next, value) => {
  req.id = parseId(value);
  next();
});

router.get('/', async (req, res) => {
  res.json(await readData('pets'));
});

router.get('/:id', async (req, res) => {
  const pets = await readData('pets');
  res.json(pets[findIndexById(pets, req.id, NOT_FOUND)]);
});

router.post('/', uploadPets.array('img', 5), verifyImages, async (req, res) => {
  const fields = readFields(req.body, FIELDS, true);
  const pet = await updateData('pets', (pets) => {
    const newPet = { id: nextId(pets), ...fields, img: (req.files ?? []).map(toUrl) };
    pets.push(newPet);
    return newPet;
  });
  res.status(201).json(pet);
});

router.put('/:id', uploadPets.array('img', 5), verifyImages, async (req, res) => {
  const changes = readFields(req.body, FIELDS, false);
  if (req.files?.length) changes.img = req.files.map(toUrl); // Reemplaza el array completo.
  if (!Object.keys(changes).length) throw httpError(400, 'No se enviaron campos para actualizar');

  const { pet, oldImages } = await updateData('pets', (pets) => {
    const current = pets[findIndexById(pets, req.id, NOT_FOUND)];
    const previous = current.img;
    Object.assign(current, changes);
    return { pet: current, oldImages: previous };
  });

  // Las imágenes reemplazadas se borran solo después de guardar el registro.
  if (changes.img) await deleteImages(oldImages);
  res.json(pet);
});

router.delete('/:id', async (req, res) => {
  const pet = await updateData('pets', (pets) => pets.splice(findIndexById(pets, req.id, NOT_FOUND), 1)[0]);
  await deleteImages(pet.img);
  res.json({ message: `Mascota ${pet.id} eliminada correctamente` });
});

export default router;
