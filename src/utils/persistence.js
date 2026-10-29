import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { useBlob, readBlobData, updateBlobData } from './storage.js';

const FILES = {
  users: fileURLToPath(new URL('../data/users.json', import.meta.url)),
  pets: fileURLToPath(new URL('../data/pets.json', import.meta.url)),
};

// Una cola de promesas por recurso: las operaciones de un mismo archivo se
// ejecutan en orden y las de recursos distintos no se bloquean entre sí.
const queues = Object.fromEntries(Object.keys(FILES).map((resource) => [resource, Promise.resolve()]));

function fileOf(resource) {
  if (!Object.hasOwn(FILES, resource)) throw new Error(`Recurso desconocido: ${resource}`);
  return FILES[resource];
}

export async function readData(resource) {
  const file = fileOf(resource);
  if (useBlob) return readBlobData(resource);
  const text = await readFile(file, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new Error(`El archivo ${resource}.json contiene JSON inválido`, { cause });
  }
  if (!Array.isArray(data)) throw new Error(`El archivo ${resource}.json no contiene un array`);
  return data;
}

export async function updateData(resource, callback) {
  const file = fileOf(resource);
  if (useBlob) {
    const run = queues[resource].then(() => updateBlobData(resource, callback));
    queues[resource] = run.catch(() => {});
    return run;
  }
  const run = queues[resource].then(async () => {
    const data = await readData(resource);
    const result = await callback(data); // Si lanza un error, no se escribe nada.
    const tmp = `${file}.tmp`;
    try {
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
      await rename(tmp, file); // Reemplazo atómico: nunca queda un JSON a medio escribir.
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return result;
  });
  queues[resource] = run.catch(() => {});
  return run;
}

export function nextId(list) {
  const id = list.reduce((max, item) => Math.max(max, item.id), 0) + 1;
  if (!Number.isSafeInteger(id)) throw new Error('No se pudo generar un ID seguro');
  return id;
}
