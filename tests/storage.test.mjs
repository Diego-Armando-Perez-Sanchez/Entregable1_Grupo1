import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlobDataStore } from '../src/utils/storage.js';
import { BlobPreconditionFailedError } from '@vercel/blob';

function fakeStore() {
  const objects = new Map();
  let revision = 0;
  const client = {
    async get(key, options) {
      assert.equal(options.access, 'private');
      assert.equal(options.useCache, false);
      const record = objects.get(key);
      if (!record) return null;
      return { statusCode: 200, blob: { etag: record.etag }, stream: new Response(record.text).body };
    },
    async put(key, text, options) {
      assert.equal(options.access, 'private');
      assert.equal(options.addRandomSuffix, false);
      const current = objects.get(key);
      if (options.ifMatch && current?.etag !== options.ifMatch) {
        throw new BlobPreconditionFailedError();
      }
      if (!options.allowOverwrite && current) throw new Error('Ya existe');
      objects.set(key, { text, etag: `etag-${++revision}` });
    },
  };
  return { objects, client };
}

test('Blob inicializa los JSON privados una sola vez y conserva registros', async () => {
  const { client, objects } = fakeStore();
  const store = createBlobDataStore(client);
  assert.deepEqual(await store.read('users'), []);
  await store.update('users', (users) => { users.push({ id: 1, password: 'salt:hash' }); });
  const anotherInstance = createBlobDataStore(client);
  assert.deepEqual(await anotherInstance.read('users'), [{ id: 1, password: 'salt:hash' }]);
  assert.equal(objects.size, 1);
  assert.ok(objects.has('data/users.json'));
});

test('instancias independientes no pierden creaciones concurrentes ni repiten IDs', async () => {
  const { client } = fakeStore();
  const stores = Array.from({ length: 20 }, () => createBlobDataStore(client));
  const ids = await Promise.all(stores.map((store) => store.update('pets', (pets) => {
    const id = pets.reduce((max, pet) => Math.max(max, pet.id), 0) + 1;
    pets.push({ id });
    return id;
  })));
  assert.equal(new Set(ids).size, 20);
  assert.equal((await stores[0].read('pets')).length, 20);
});

test('callback fallido no sobrescribe el JSON remoto', async () => {
  const { client } = fakeStore();
  const store = createBlobDataStore(client);
  await store.update('pets', (pets) => pets.push({ id: 1 }));
  await assert.rejects(store.update('pets', (pets) => { pets.length = 0; throw new Error('Abortar'); }), /Abortar/);
  assert.deepEqual(await store.read('pets'), [{ id: 1 }]);
});

test('un JSON remoto corrupto produce error y no se reemplaza por []', async () => {
  const { client, objects } = fakeStore();
  objects.set('data/users.json', { text: '{roto', etag: 'e1' });
  await assert.rejects(createBlobDataStore(client).read('users'), SyntaxError);
  assert.equal(objects.get('data/users.json').text, '{roto');
});

test('se rechazan recursos ajenos y archivos que no contengan un array', async () => {
  const { client, objects } = fakeStore();
  const store = createBlobDataStore(client);
  await assert.rejects(store.read('products'), /Recurso no permitido/);
  objects.set('data/users.json', { text: '{}', etag: 'e1' });
  await assert.rejects(store.read('users'), /array/);
});

test('un error de permisos al inicializar no se disfraza como datos vacíos', async () => {
  const store = createBlobDataStore({ get: async () => null, put: async () => { throw new Error('Sin permiso'); } });
  await assert.rejects(store.read('users'), /Sin permiso/);
});

test('fallo de escritura distinto a conflicto se propaga y conserva el estado', async () => {
  const { client } = fakeStore();
  const store = createBlobDataStore(client);
  await store.read('users');
  const put = client.put;
  client.put = async () => { throw new Error('Sin conexión'); };
  await assert.rejects(store.update('users', (users) => users.push({ id: 1 })), /Sin conexión/);
  client.put = put;
  assert.deepEqual(await store.read('users'), []);
});

test('conflictos persistentes devuelven 503 en lugar de informar un guardado inexistente', async () => {
  const { client } = fakeStore();
  const store = createBlobDataStore(client);
  await store.read('pets');
  client.put = async () => { throw new BlobPreconditionFailedError(); };
  await assert.rejects(store.update('pets', (pets) => pets.push({ id: 1 })), { status: 503 });
  assert.deepEqual(await store.read('pets'), []);
});
