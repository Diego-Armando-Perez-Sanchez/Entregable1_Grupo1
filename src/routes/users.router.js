import { Router } from 'express';
import { readData, updateData, nextId } from '../utils/persistence.js';
import { hashPassword, verifyPassword, randomKey } from '../utils/crypto.js';
import { uploadUsers, verifyImages, deleteImages, toUrl } from '../middlewares/multer.middleware.js';
import { requireAuth, startSession, endSession } from '../middlewares/auth.middleware.js';
import { httpError, idParam, findIndexById, readFields, text } from '../utils/http.js';

const router = Router();

const FIELDS = { firstname: text, lastname: text, username: text, password: text };
const NOT_FOUND = 'Usuario no encontrado';

// Perfil propio (sin password ni sessionKey) y perfil público que ven los demás usuarios.
export const ownProfile = ({ password, sessionKey, ...user }) => user;
export const publicProfile = ({ id, username, avatar }) => ({ id, username, avatar });

function assertUniqueUsername(users, username, ownId) {
  const taken = users.some((u) => u.id !== ownId && u.username.toLowerCase() === username.toLowerCase());
  if (taken) throw httpError(400, `El username "${username}" ya está registrado`);
}

// Sin roles de administrador: cada usuario solo puede modificar su propia cuenta.
async function onlySelf(req, res, next) {
  if (req.id !== req.user.id) {
    findIndexById(await readData('users'), req.id, NOT_FOUND); // 404 si no existe
    throw httpError(403, 'Solo puedes modificar tu propia cuenta');
  }
  next();
}

router.param('id', idParam);

// Registro: única ruta pública de usuarios.
router.post('/', uploadUsers.single('avatar'), verifyImages, async (req, res) => {
  const fields = readFields(req.body, FIELDS, true);
  fields.password = await hashPassword(req.body.password); // Se usa la contraseña original, sin recortar.

  const user = await updateData('users', (users) => {
    assertUniqueUsername(users, fields.username);
    const newUser = { id: nextId(users), ...fields, avatar: req.file ? toUrl(req.file) : '', sessionKey: randomKey() };
    users.push(newUser);
    return newUser;
  });
  res.status(201).json(ownProfile(user));
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json((await readData('users')).map(publicProfile));
});

router.get('/:id', async (req, res) => {
  const users = await readData('users');
  const user = users[findIndexById(users, req.id, NOT_FOUND)];
  res.json(user.id === req.user.id ? ownProfile(user) : publicProfile(user));
});

router.put('/:id', onlySelf, uploadUsers.single('avatar'), verifyImages, async (req, res) => {
  const changes = readFields(req.body, FIELDS, false);
  if (!Object.keys(changes).length && !req.file) throw httpError(400, 'No se enviaron campos para actualizar');
  if (changes.password) {
    if (!(await verifyPassword(req.body.currentPassword ?? '', req.user.password))) {
      throw httpError(400, 'La contraseña actual no es correcta');
    }
    changes.password = await hashPassword(req.body.password);
    changes.sessionKey = randomKey(); // Cierra las demás sesiones abiertas.
  }
  if (req.file) changes.avatar = toUrl(req.file);

  const { user, oldAvatar } = await updateData('users', (users) => {
    const current = users[findIndexById(users, req.id, NOT_FOUND)];
    if (changes.username) assertUniqueUsername(users, changes.username, current.id);
    const previous = current.avatar;
    Object.assign(current, changes);
    return { user: current, oldAvatar: previous };
  });

  if (changes.sessionKey) startSession(res, user); // La sesión actual continúa con un token nuevo.
  // El avatar anterior se borra solo después de guardar el registro.
  if (req.file && oldAvatar) await deleteImages([oldAvatar]);
  res.json(ownProfile(user));
});

router.delete('/:id', onlySelf, async (req, res) => {
  const user = await updateData('users', (users) => users.splice(findIndexById(users, req.id, NOT_FOUND), 1)[0]);
  // Sus mascotas se eliminan después: así ningún usuario futuro que reciba el mismo ID las hereda.
  const pets = await updateData('pets', (list) => {
    const removed = list.filter((pet) => pet.ownerId === user.id);
    list.splice(0, list.length, ...list.filter((pet) => pet.ownerId !== user.id));
    return removed;
  });
  await deleteImages([user.avatar, ...pets.flatMap((pet) => pet.img)].filter(Boolean));
  endSession(res);
  res.json({ message: `Usuario ${user.id} eliminado correctamente` });
});

export default router;
