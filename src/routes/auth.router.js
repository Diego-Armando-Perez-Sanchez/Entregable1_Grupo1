import { Router } from 'express';
import { readData, updateData } from '../utils/persistence.js';
import { hashPassword, verifyPassword, verifyToken, randomKey } from '../utils/crypto.js';
import { requireAuth, startSession, endSession, readToken } from '../middlewares/auth.middleware.js';
import { httpError, readFields, text } from '../utils/http.js';
import { JWT_SECRET } from '../config.js';
import { ownProfile } from './users.router.js';

const router = Router();

// Hash de relleno: si el usuario no existe se verifica igual, para que el tiempo de
// respuesta no revele qué nombres de usuario están registrados.
const DUMMY_HASH = await hashPassword(randomKey());

router.post('/login', async (req, res) => {
  const { username } = readFields(req.body, { username: text, password: text }, true);
  const found = (await readData('users')).find((u) => u.username.toLowerCase() === username.toLowerCase());
  const valid = await verifyPassword(req.body.password, found?.password ?? DUMMY_HASH);
  if (!found || !valid) throw httpError(401, 'Usuario o contraseña incorrectos');

  // Usuarios creados antes de existir el login reciben su sessionKey en el primer inicio de sesión.
  const user = found.sessionKey ? found : await updateData('users', (users) => {
    const current = users.find((u) => u.id === found.id);
    if (!current) throw httpError(401, 'Usuario o contraseña incorrectos');
    current.sessionKey ??= randomKey();
    return current;
  });
  startSession(res, user);
  res.json(ownProfile(user));
});

// Cierra la sesión en todos los dispositivos: rota la sessionKey y borra la cookie.
router.post('/logout', async (req, res) => {
  const payload = verifyToken(readToken(req), JWT_SECRET);
  if (payload) {
    await updateData('users', (users) => {
      const user = users.find((u) => u.id === payload.sub && u.sessionKey === payload.sk);
      if (user) user.sessionKey = randomKey();
    });
  }
  endSession(res);
  res.json({ message: 'Sesión cerrada' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(ownProfile(req.user));
});

export default router;
