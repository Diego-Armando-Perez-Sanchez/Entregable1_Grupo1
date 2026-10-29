import { Router } from 'express';
import { readData, updateData, nextId } from '../utils/persistence.js';
import { hashPassword } from '../utils/crypto.js';
import { uploadUsers, verifyImages, deleteImages, toUrl } from '../middlewares/multer.middleware.js';
import { httpError, parseId, findIndexById, readFields, text } from '../utils/http.js';

const router = Router();

const FIELDS = { firstname: text, lastname: text, username: text, password: text };
const NOT_FOUND = 'Usuario no encontrado';

const publicUser = ({ password, ...user }) => user;

function assertUniqueUsername(users, username, ownId) {
  const taken = users.some((u) => u.id !== ownId && u.username.toLowerCase() === username.toLowerCase());
  if (taken) throw httpError(400, `El username "${username}" ya está registrado`);
}

// Se valida el ID antes de que Multer guarde cualquier archivo.
router.param('id', (req, res, next, value) => {
  req.id = parseId(value);
  next();
});

router.get('/', async (req, res) => {
  res.json((await readData('users')).map(publicUser));
});

router.get('/:id', async (req, res) => {
  const users = await readData('users');
  res.json(publicUser(users[findIndexById(users, req.id, NOT_FOUND)]));
});

router.post('/', uploadUsers.single('avatar'), verifyImages, async (req, res) => {
  const fields = readFields(req.body, FIELDS, true);
  fields.password = await hashPassword(req.body.password); // Se usa la contraseña original, sin recortar.

  const user = await updateData('users', (users) => {
    assertUniqueUsername(users, fields.username);
    const newUser = { id: nextId(users), ...fields, avatar: req.file ? toUrl(req.file) : '' };
    users.push(newUser);
    return newUser;
  });
  res.status(201).json(publicUser(user));
});

router.put('/:id', uploadUsers.single('avatar'), verifyImages, async (req, res) => {
  const changes = readFields(req.body, FIELDS, false);
  if (!Object.keys(changes).length && !req.file) throw httpError(400, 'No se enviaron campos para actualizar');
  if (changes.password) changes.password = await hashPassword(req.body.password);
  if (req.file) changes.avatar = toUrl(req.file);

  const { user, oldAvatar } = await updateData('users', (users) => {
    const current = users[findIndexById(users, req.id, NOT_FOUND)];
    if (changes.username) assertUniqueUsername(users, changes.username, current.id);
    const previous = current.avatar;
    Object.assign(current, changes);
    return { user: current, oldAvatar: previous };
  });

  // El avatar anterior se borra solo después de guardar el registro.
  if (req.file && oldAvatar) await deleteImages([oldAvatar]);
  res.json(publicUser(user));
});

router.delete('/:id', async (req, res) => {
  const user = await updateData('users', (users) => users.splice(findIndexById(users, req.id, NOT_FOUND), 1)[0]);
  if (user.avatar) await deleteImages([user.avatar]);
  res.json({ message: `Usuario ${user.id} eliminado correctamente` });
});

export default router;
