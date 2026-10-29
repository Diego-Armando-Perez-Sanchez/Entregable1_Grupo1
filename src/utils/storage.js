import * as blob from '@vercel/blob';
import { setTimeout } from 'node:timers/promises';

export const useBlob = process.env.VERCEL === '1' || process.env.STORAGE_DRIVER === 'blob';
export const cloudImageBudget = 3 * 1024 * 1024;

function credentials() {
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    throw Object.assign(new Error('Conecta un almacén privado Vercel Blob al proyecto y vuelve a desplegar.'), { status: 503, expose: true });
  }
}

export function createBlobDataStore(client = blob) {
  const key = (resource) => {
    if (!['users', 'pets'].includes(resource)) throw new Error('Recurso no permitido');
    return `data/${resource}.json`;
  };
  async function snapshot(resource) {
    const result = await client.get(key(resource), { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob.etag) throw new Error('Respuesta de almacenamiento inválida');
    const data = JSON.parse(await new Response(result.stream).text());
    if (!Array.isArray(data)) throw new Error('El archivo debe contener un array');
    return { data, etag: result.blob.etag };
  }
  async function initialize(resource) {
    let current = await snapshot(resource);
    if (current) return current;
    // Solo crea un archivo ausente. Nunca sobrescribe registros existentes.
    try {
      await client.put(key(resource), '[]', { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    } catch (error) {
      current = await snapshot(resource);
      if (current) return current; // Otra instancia lo creó al mismo tiempo.
      throw error;
    }
    current = await snapshot(resource);
    if (!current) throw new Error('No se pudo inicializar el almacenamiento');
    return current;
  }
  return {
    async read(resource) { return (await initialize(resource)).data; },
    async update(resource, callback) {
      for (let attempt = 0; attempt < 16; attempt++) {
        const { data, etag } = await initialize(resource);
        const result = await callback(data);
        try {
          await client.put(key(resource), JSON.stringify(data), {
            access: 'private', addRandomSuffix: false, allowOverwrite: true,
            contentType: 'application/json', ifMatch: etag,
          });
          return result;
        } catch (error) {
          if (!(error instanceof blob.BlobPreconditionFailedError)) throw error;
          await setTimeout(10 + Math.random() * Math.min(300, 25 * (attempt + 1)));
        }
      }
      throw Object.assign(new Error('Hay varias operaciones simultáneas. Vuelve a intentarlo.'), { status: 503, expose: true });
    },
  };
}

const dataStore = createBlobDataStore();
export const readBlobData = (resource) => { credentials(); return dataStore.read(resource); };
export const updateBlobData = (resource, callback) => { credentials(); return dataStore.update(resource, callback); };
export async function storeImage(key, content, contentType) {
  credentials();
  await blob.put(key, content, { access: 'private', addRandomSuffix: false, contentType });
}
export async function removeImage(key) { credentials(); await blob.del(key); }
export async function readImage(key) { credentials(); return blob.get(key, { access: 'private', useCache: false }); }
