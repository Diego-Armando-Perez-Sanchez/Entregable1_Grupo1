import { Router } from 'express';
import { readData, updateData, nextId } from '../utils/persistence.js';
import { uploadPets, verifyImages, deleteImages, toUrl } from '../middlewares/multer.middleware.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { httpError, idParam, findIndexById, readFields, text, nonNegativeNumber } from '../utils/http.js';

const router = Router();

const FIELDS = { especie: text, color: text, edad: nonNegativeNumber, sexo: text };
const NOT_FOUND = 'Mascota no encontrada';

// Solo el propietario puede modificar o eliminar. Las mascotas creadas antes de existir
// las cuentas no tienen ownerId: se muestran, pero nadie puede modificarlas.
function assertOwner(pet, user) {
  if (pet.ownerId === undefined) throw httpError(403, 'Esta mascota se registró antes de las cuentas de usuario y no puede modificarse');
  if (pet.ownerId !== user.id) throw httpError(403, 'Solo puedes modificar tus propias mascotas');
}

router.use(requireAuth); // Se comprueba antes de que Multer guarde cualquier archivo.
router.param('id', idParam);

// Galería compartida entre usuarios autenticados; ?owner=me devuelve solo las propias.
router.get('/', async (req, res) => {
  const pets = await readData('pets');
  res.json(req.query.owner === 'me' ? pets.filter((pet) => pet.ownerId === req.user.id) : pets);
});

router.get('/:id', async (req, res) => {
  const pets = await readData('pets');
  res.json(pets[findIndexById(pets, req.id, NOT_FOUND)]);
});

router.post('/', uploadPets.array('img', 5), verifyImages, async (req, res) => {
  const fields = readFields(req.body, FIELDS, true);
  const pet = await updateData('pets', async (pets) => {
    // El propietario sale del token verificado; la cuenta pudo eliminarse mientras llegaba la petición.
    if (!(await readData('users')).some((u) => u.id === req.user.id)) throw httpError(401, 'La cuenta ya no existe');
    const newPet = { id: nextId(pets), ownerId: req.user.id, ...fields, img: (req.files ?? []).map(toUrl) };
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
    assertOwner(current, req.user);
    const previous = current.img;
    Object.assign(current, changes);
    return { pet: current, oldImages: previous };
  });

  // Las imágenes reemplazadas se borran solo después de guardar el registro.
  if (changes.img) await deleteImages(oldImages);
  res.json(pet);
});

router.delete('/:id', async (req, res) => {
  const pet = await updateData('pets', (pets) => {
    const index = findIndexById(pets, req.id, NOT_FOUND);
    assertOwner(pets[index], req.user);
    return pets.splice(index, 1)[0];
  });
  await deleteImages(pet.img);
  res.json({ message: `Mascota ${pet.id} eliminada correctamente` });
});

export default router;
