import { test, before, after } from 'node:test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

let child, base;
before(async () => {
  const env = { ...process.env, VERCEL: '1' };
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.BLOB_STORE_ID;
  child = fork(fileURLToPath(new URL('./server.mjs', import.meta.url)), [new URL('../src/app.js', import.meta.url).href], { env, silent: true });
  const [message] = await once(child, 'message');
  base = `http://127.0.0.1:${message.port}`;
});
after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit'); child.send('stop'); await exited;
  }
});

test('Vercel entrega interfaz y límites de carga dinámicos sin necesitar disco público', async () => {
  assert.equal((await fetch(base)).status, 200);
  const config = await fetch(base + '/config.js');
  assert.equal(config.status, 200);
  assert.match(config.headers.get('cache-control'), /no-store/);
  const text = await config.text();
  assert.match(text, /"maxImageMB":3/);
  assert.match(text, /"maxTotalImageBytes":3145728/);
  assert.ok(!text.includes('TOKEN'));
});

test('sin Blob conectado informa 503 y no promete guardar datos temporales', async () => {
  const response = await fetch(base + '/api/users');
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Conecta un almacén privado/);
});

test('los JSON privados nunca quedan expuestos por las rutas de imágenes o estáticos', async () => {
  for (const url of ['/img/data/users.json', '/data/users.json', '/src/data/users.json']) {
    assert.equal((await fetch(base + url)).status, 404);
  }
});

test('se rechaza la suma de imágenes superior a 3 MiB antes de contactar Blob', async () => {
  const body = new FormData();
  for (const [key, value] of Object.entries({ especie: 'gato', color: 'gris', edad: '0', sexo: 'macho' })) body.append(key, value);
  const photo = Buffer.alloc(1600000);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(photo);
  for (let i = 0; i < 2; i++) body.append('img', new Blob([photo], { type: 'image/png' }), `${i}.png`);
  const response = await fetch(base + '/api/pets', { method: 'POST', body });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /juntas.*3 MB/);
});
