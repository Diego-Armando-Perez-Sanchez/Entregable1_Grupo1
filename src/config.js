import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';


try {
  process.loadEnvFile?.(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const env = process.env;

export const PORT = Number(env.PORT) || 8080;
export const JWT_EXPIRES_IN = Number(env.JWT_EXPIRES_IN) || 2 * 60 * 60; // segundos
export const COOKIE_SECURE = env.COOKIE_SECURE === 'true';
export const JWT_SECRET = env.JWT_SECRET || randomBytes(32).toString('hex');

if (!env.JWT_SECRET) {
  console.warn('JWT_SECRET no está definido: se usa una clave temporal y las sesiones se cerrarán al reiniciar. Copia .env.example a .env.');
} else if (env.JWT_SECRET.length < 32) {
  console.warn('JWT_SECRET debería tener al menos 32 caracteres aleatorios.');
}
