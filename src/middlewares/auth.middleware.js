import { readData } from '../utils/persistence.js';
import { signToken, verifyToken } from '../utils/crypto.js';
import { httpError } from '../utils/http.js';
import { JWT_SECRET, JWT_EXPIRES_IN, COOKIE_SECURE } from '../config.js';

// El token viaja en una cookie httpOnly: el JavaScript del navegador no puede leerlo
// y SameSite=Strict impide que otros sitios la envíen.
const COOKIE = 'token';
const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' };

export const readToken = (req) => /(?:^|;\s*)token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];

// `sessionKey` es un valor aleatorio guardado en el usuario. Cambia al cerrar sesión o
// cambiar la contraseña, lo que invalida los tokens anteriores aunque no hayan vencido.
export function startSession(res, user) {
  const token = signToken({ sub: user.id, sk: user.sessionKey }, JWT_SECRET, JWT_EXPIRES_IN);
  res.cookie(COOKIE, token, { ...cookieOptions, maxAge: JWT_EXPIRES_IN * 1000 });
}

export const endSession = (res) => res.clearCookie(COOKIE, cookieOptions);

// Verifica firma, expiración e identidad: el usuario debe existir y conservar la misma sessionKey.
export async function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) throw httpError(401, 'Debes iniciar sesión');
  const payload = verifyToken(token, JWT_SECRET);
  const user = payload && (await readData('users')).find((u) => u.id === payload.sub);
  if (!user?.sessionKey || user.sessionKey !== payload.sk) {
    endSession(res);
    throw httpError(401, 'Tu sesión expiró o no es válida. Inicia sesión de nuevo');
  }
  req.user = user;
  next();
}
