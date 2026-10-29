import { Router } from 'express';
import { readData, updateData, nextId } from '../utils/persistence.js';
import { hashPassword } from '../utils/crypto.js';
import { uploadUsers, verifyImages, deleteImages, toUrl } from '../middlewares/multer.middleware.js';

const router = Router();
const FIELDS = { firstname: text, lastname: text, username: text, password: text };
const NOT_FOUND = 'Usuario no encontrado';
const withoutPassword = ({ password, ...user }) => user;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function idParam(req, res, next, value) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw httpError(400, 'El ID debe ser un número entero positivo');
  }
  req.id = Number(value);
  next();
}

function findIndexById(users, id, message) {
  const index = users.findIndex((user) => user.id === id);
  if (index === -1) throw httpError(404, message);
  return index;
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw httpError(400, `El campo ${name} debe ser un texto no vacío`);
  return value.trim();
}

function readFields(body = {}, parsers, required) {
  for (const name of Object.keys(body)) {
    if (!Object.hasOwn(parsers, name)) throw httpError(400, `Campo no permitido: ${name}`);
  }
  const fields = {};
  for (const name of Object.keys(parsers)) {
    if (!Object.hasOwn(body, name)) {
      if (required) throw httpError(400, `El campo ${name} es obligatorio`);
      continue;
    }
    fields[name] = parsers[name](body[name], name);
  }
  return fields;
}

function assertUniqueUsername(users, username, ownId) {
  const taken = users.some((user) => user.id !== ownId && user.username.toLowerCase() === username.toLowerCase());
  if (taken) throw httpError(400, 'El username ya está registrado');
}

router.param('id', idParam);

router.get('/', async (req, res) => {
  res.status(200).json((await readData('users')).map(withoutPassword));
});

router.get('/:id', async (req, res) => {
  const users = await readData('users');
  res.status(200).json(withoutPassword(users[findIndexById(users, req.id, NOT_FOUND)]));
});

router.post('/', uploadUsers.single('avatar'), verifyImages, async (req, res) => {
  const fields = readFields(req.body, FIELDS, true);
  // Se valida que no esté vacía, pero el hash conserva la contraseña exacta enviada.
  fields.password = await hashPassword(req.body.password);
  const user = await updateData('users', (users) => {
    assertUniqueUsername(users, fields.username);
    const created = { id: nextId(users), ...fields, avatar: req.file ? toUrl(req.file) : '' };
    users.push(created);
    return created;
  });
  req.uploadsCommitted = true;
  res.status(201).json(withoutPassword(user));
});

router.put('/:id', uploadUsers.single('avatar'), verifyImages, async (req, res) => {
  const changes = readFields(req.body, FIELDS, false);
  if (!Object.keys(changes).length && !req.file) throw httpError(400, 'No se enviaron campos para actualizar');
  if (Object.hasOwn(changes, 'password')) changes.password = await hashPassword(req.body.password);
  if (req.file) changes.avatar = toUrl(req.file);

  const { user, oldAvatar } = await updateData('users', (users) => {
    const current = users[findIndexById(users, req.id, NOT_FOUND)];
    if (changes.username) assertUniqueUsername(users, changes.username, current.id);
    const previous = current.avatar;
    Object.assign(current, changes);
    return { user: current, oldAvatar: previous };
  });
  req.uploadsCommitted = true;
  if (req.file && oldAvatar) await deleteImages([oldAvatar]);
  res.status(200).json(withoutPassword(user));
});

router.delete('/:id', async (req, res) => {
  const user = await updateData('users', (users) => users.splice(findIndexById(users, req.id, NOT_FOUND), 1)[0]);
  // Usuarios y mascotas son recursos independientes; no se modifican las mascotas.
  if (user.avatar) await deleteImages([user.avatar]);
  res.status(200).json({ message: `Usuario ${user.id} eliminado correctamente` });
});

export default router;
