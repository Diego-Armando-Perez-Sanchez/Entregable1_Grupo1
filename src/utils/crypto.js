import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const randomKey = () => randomBytes(16).toString('hex');

// Devuelve "salt:hash" en hexadecimal; el salt es aleatorio para cada contraseña.
export async function hashPassword(password) {
  const salt = randomKey();
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

// Recalcula scrypt con el salt guardado y compara en tiempo constante.
export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(String(password), salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// JWT HS256 con el módulo nativo crypto.
const encode = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString());
const sign = (data, secret) => createHmac('sha256', secret).update(data).digest();

export function signToken(payload, secret, expiresIn) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ ...payload, iat: now, exp: now + expiresIn })}`;
  return `${data}.${sign(data, secret).toString('base64url')}`;
}

// Devuelve el payload si la firma, el algoritmo y la expiración son válidos; si no, null.
export function verifyToken(token, secret) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  const given = Buffer.from(parts[2], 'base64url');
  const expected = sign(`${parts[0]}.${parts[1]}`, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (header.alg !== 'HS256' || !(payload.exp > Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
