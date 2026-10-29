import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { fork } from 'node:child_process';
import { once } from 'node:events';

const root = fileURLToPath(new URL('../', import.meta.url));
let sandbox, dataFile, usersFile, imagesDir, avatarsDir, child, base;
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const fields = { especie: 'perro', color: 'negro', edad: '0', sexo: 'macho' };

async function start() {
  child = fork(fileURLToPath(new URL('./server.mjs', import.meta.url)), [pathToFileURL(path.join(sandbox, 'src/app.js')).href], { silent: true });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const message = await Promise.race([
      once(child, 'message').then(([value]) => value),
      once(child, 'exit').then(([code]) => { throw new Error(`Servidor terminó con ${code}`); })
    ]);
    base = `http://127.0.0.1:${message.port}`;
  } finally { clearTimeout(timer); }
}
async function stop() {
  if (child && child.exitCode === null) {
    const ended = once(child, 'exit');
    child.send('stop');
    await ended;
  }
}
function form(values = fields, count = 0, type = 'image/png', field = 'img') {
  const body = new FormData();
  for (const [key, value] of Object.entries(values)) body.append(key, value);
  for (let i = 0; i < count; i++) body.append(field, new Blob([image], { type }), `prueba-${i}.png`);
  return body;
}
const request = (route = '/api/pets', options) => fetch(base + route, options);
const create = (count = 0) => request('/api/pets', { method: 'POST', body: form(fields, count) });
const records = async () => JSON.parse(await readFile(dataFile, 'utf8'));
const images = async () => (await readdir(imagesDir)).filter((name) => name !== '.gitkeep');

before(async () => {
  sandbox = await mkdtemp(path.join(root, '.test-'));
  dataFile = path.join(sandbox, 'src/data/pets.json');
  usersFile = path.join(sandbox, 'src/data/users.json');
  imagesDir = path.join(sandbox, 'public/img/pets');
  avatarsDir = path.join(sandbox, 'public/img/users');
  await cp(path.join(root, 'src'), path.join(sandbox, 'src'), { recursive: true });
  await cp(path.join(root, 'public'), path.join(sandbox, 'public'), { recursive: true });
  await start();
});
beforeEach(async () => {
  await writeFile(dataFile, '[]');
  await writeFile(usersFile, '[]');
  for (const name of await images()) await rm(path.join(imagesDir, name));
  for (const name of (await readdir(avatarsDir)).filter((name) => name !== '.gitkeep')) await rm(path.join(avatarsDir, name));
});
after(async () => {
  await stop();
  // Verificar el destino absoluto antes de eliminar recursivamente el entorno temporal.
  if (sandbox && path.dirname(path.resolve(sandbox)) === path.resolve(root) && path.basename(sandbox).startsWith('.test-')) {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test('GET devuelve array vacío', async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});
for (const count of [0, 1, 5]) {
  test(`POST con ${count} imágenes y edad cero guarda datos y URLs accesibles`, async () => {
    const response = await create(count);
    assert.equal(response.status, 201);
    const pet = await response.json();
    assert.equal(pet.id, 1);
    assert.equal(pet.edad, 0);
    assert.equal(pet.img.length, count);
    assert.deepEqual(await records(), [pet]);
    for (const url of pet.img) {
      assert.match(url, /^\/img\/pets\//);
      const photo = await request(url);
      assert.equal(photo.status, 200);
      assert.deepEqual(Buffer.from(await photo.arrayBuffer()), image);
    }
    assert.deepEqual(await (await request('/api/pets/1')).json(), pet);
  });
}
test('POST rechaza seis imágenes sin dejar archivos ni registros', async () => {
  assert.equal((await create(6)).status, 400);
  assert.deepEqual(await records(), []);
  assert.deepEqual(await images(), []);
});
test('POST rechaza campo de archivos incorrecto y tipo no permitido', async () => {
  for (const body of [form(fields, 1, 'image/png', 'foto'), form(fields, 1, 'text/plain')]) {
    assert.equal((await request('/api/pets', { method: 'POST', body })).status, 400);
  }
  assert.deepEqual(await images(), []);
});
test('POST exige cada campo y limpia imágenes tras validación fallida', async () => {
  for (const field of Object.keys(fields)) {
    const values = { ...fields };
    delete values[field];
    const response = await request('/api/pets', { method: 'POST', body: form(values, 1) });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
    assert.deepEqual(await images(), []);
  }
  assert.deepEqual(await records(), []);
});
test('edad negativa, vacía, hexadecimal, no finita y texto se rechazan', async () => {
  for (const edad of ['-1', '', ' ', 'abc', 'Infinity', '0x10', '1,5']) {
    const response = await request('/api/pets', { method: 'POST', body: form({ ...fields, edad }) });
    assert.equal(response.status, 400, edad);
  }
});
test('edad decimal válida se guarda como número', async () => {
  const response = await request('/api/pets', { method: 'POST', body: form({ ...fields, edad: '1.5' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).edad, 1.5);
});
test('JSON admite edad numérica cero y rechaza booleanos, arrays y objetos', async () => {
  for (const edad of [false, null, [], {}]) {
    const response = await request('/api/pets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, edad }) });
    assert.equal(response.status, 400);
  }
  const response = await request('/api/pets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...fields, edad: 0 }) });
  assert.equal(response.status, 201);
});
test('rechaza campos vacíos, repetidos y campos administrados por el servidor', async () => {
  for (const values of [{ ...fields, especie: '  ' }, { ...fields, id: '99' }, { ...fields, img: '/otro.png' }, { ...fields, extra: 'x' }]) {
    assert.equal((await request('/api/pets', { method: 'POST', body: form(values, 1) })).status, 400);
  }
  const repeated = form();
  repeated.append('edad', '2');
  assert.equal((await request('/api/pets', { method: 'POST', body: repeated })).status, 400);
  assert.deepEqual(await images(), []);
});
test('IDs inválidos dan 400 en GET, PUT y DELETE', async () => {
  for (const id of ['abc', '0', '-1', '1.2', '1x', '9007199254740992']) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      assert.equal((await request(`/api/pets/${id}`, { method })).status, 400);
    }
  }
});
test('ID inexistente da 404 y PUT limpia las cargas nuevas', async () => {
  assert.equal((await request('/api/pets/999')).status, 404);
  assert.equal((await request('/api/pets/999', { method: 'DELETE' })).status, 404);
  assert.equal((await request('/api/pets/999', { method: 'PUT', body: form({ color: 'blanco' }, 1) })).status, 404);
  assert.deepEqual(await images(), []);
});
test('PUT parcial conserva ID, campos omitidos e imágenes', async () => {
  const original = await (await create(1)).json();
  const response = await request('/api/pets/1', { method: 'PUT', body: form({ edad: '2' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...original, edad: 2 });
  assert.equal((await request(original.img[0])).status, 200);
});
test('PUT con imágenes reemplaza el array y borra las anteriores', async () => {
  const original = await (await create(5)).json();
  const response = await request('/api/pets/1', { method: 'PUT', body: form({}, 1) });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.img.length, 1);
  assert.equal((await images()).length, 1);
  for (const url of original.img) assert.equal((await request(url)).status, 404);
  assert.equal((await request(updated.img[0])).status, 200);
});
test('PUT vacío, con id o edad inválida no altera datos ni fotos', async () => {
  const original = await (await create(1)).json();
  for (const values of [{}, { id: '77' }, { edad: '-1' }]) {
    const response = await request('/api/pets/1', { method: 'PUT', body: form(values) });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await records(), [original]);
  assert.equal((await images()).length, 1);
});
test('DELETE elimina registro e imágenes y responde 200', async () => {
  const original = await (await create(1)).json();
  const response = await request('/api/pets/1', { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).message, 'string');
  assert.deepEqual(await records(), []);
  assert.deepEqual(await images(), []);
  assert.equal((await request(original.img[0])).status, 404);
});
test('20 creaciones simultáneas no pierden registros ni repiten IDs', async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () => create()));
  assert.ok(responses.every((response) => response.status === 201));
  const saved = await records();
  assert.equal(saved.length, 20);
  assert.deepEqual(saved.map((pet) => pet.id).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
});
test('ID nuevo es máximo existente más uno', async () => {
  await writeFile(dataFile, JSON.stringify([{ id: 9, ...fields, edad: 0, img: [] }]));
  assert.equal((await (await create()).json()).id, 10);
});
test('JSON corrupto produce 500, conserva archivo y limpia cargas', async () => {
  await writeFile(dataFile, '{roto');
  assert.equal((await request()).status, 500);
  const response = await create(1);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Error interno del servidor' });
  assert.equal(await readFile(dataFile, 'utf8'), '{roto');
  assert.deepEqual(await images(), []);
});
test('fallo de escritura conserva datos y fotos anteriores y limpia las nuevas', async () => {
  const original = await (await create(1)).json();
  // Simular fallo de writeFile en el proceso servidor, solo en la copia de pruebas.
  await stop();
  const persistence = path.join(sandbox, 'src/utils/persistence.js');
  const source = await readFile(persistence, 'utf8');
  assert.ok(source.includes('await writeFile(tmp,'));
  await writeFile(persistence, source.replace('await writeFile(tmp,', "await (async () => { throw new Error('Fallo I/O simulado'); })(); await writeFile(tmp,"));
  await start();
  try {
    const response = await request('/api/pets/1', { method: 'PUT', body: form({ color: 'blanco' }, 1) });
    assert.equal(response.status, 500);
    assert.deepEqual(await records(), [original]);
    assert.equal((await images()).length, 1);
    assert.equal((await request(original.img[0])).status, 200);
  } finally {
    await stop();
    await writeFile(persistence, source);
    await start();
  }
});
test('reiniciar proceso conserva registros e imágenes', async () => {
  const original = await (await create(1)).json();
  await stop();
  await start();
  assert.deepEqual(await (await request('/api/pets/1')).json(), original);
  assert.equal((await request(original.img[0])).status, 200);
});

const userFields = { firstname: 'Ana', lastname: 'Pérez', username: 'ana.perez', password: ' Clave de prueba 123 ' };
const userRecords = async () => JSON.parse(await readFile(usersFile, 'utf8'));
const avatars = async () => (await readdir(avatarsDir)).filter((name) => name !== '.gitkeep');
function userForm(values = userFields, count = 0) {
  return form(values, count, 'image/png', 'avatar');
}
const createUser = (count = 0, values = userFields) => request('/api/users', { method: 'POST', body: userForm(values, count) });
function assertPublicUser(user) {
  assert.deepEqual(Object.keys(user).sort(), ['id', 'firstname', 'lastname', 'username', 'avatar'].sort());
}

test('usuarios y mascotas se consultan sin sesión y los listados son arrays', async () => {
  for (const route of ['/api/users', '/api/pets']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  }
});

for (const count of [0, 1]) {
  test(`POST usuario con ${count} avatar guarda hash y responde sin password`, async () => {
    const response = await createUser(count);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('set-cookie'), null);
    const user = await response.json();
    assertPublicUser(user);
    assert.equal(user.id, 1);
    assert.equal(user.firstname, 'Ana');
    assert.equal(user.lastname, 'Pérez');
    const [saved] = await userRecords();
    assert.deepEqual(Object.keys(saved).sort(), [...Object.keys(user), 'password'].sort());
    assert.match(saved.password, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.notEqual(saved.password, userFields.password);
    const [salt, hash] = saved.password.split(':');
    const expected = await promisify(scrypt)(userFields.password, salt, 64);
    assert.equal(hash, expected.toString('hex'), 'se conserva la contraseña exacta, incluidos sus espacios');
    assert.deepEqual(await (await request('/api/users/1')).json(), user);
    assert.deepEqual(await (await request('/api/users')).json(), [user]);
    if (count) {
      assert.match(user.avatar, /^\/img\/users\//);
      const photo = await request(user.avatar);
      assert.equal(photo.status, 200);
      assert.deepEqual(Buffer.from(await photo.arrayBuffer()), image);
    } else assert.equal(user.avatar, '');
  });
}

test('hashes de la misma contraseña tienen salts distintos', async () => {
  assert.equal((await createUser()).status, 201);
  assert.equal((await createUser(0, { ...userFields, username: 'otra.ana' })).status, 201);
  const users = await userRecords();
  assert.notEqual(users[0].password, users[1].password);
});

test('POST usuario exige cada campo y limpia avatar si falla validación', async () => {
  for (const field of Object.keys(userFields)) {
    const values = { ...userFields };
    delete values[field];
    const response = await createUser(1, values);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
    assert.deepEqual(await avatars(), []);
  }
  assert.deepEqual(await userRecords(), []);
});

test('username duplicado se rechaza sin dejar avatar; comparación sin distinguir mayúsculas', async () => {
  await createUser();
  const response = await createUser(1, { ...userFields, username: 'ANA.PEREZ' });
  assert.equal(response.status, 400);
  assert.equal((await userRecords()).length, 1);
  assert.deepEqual(await avatars(), []);
});

test('IDs de usuarios inválidos dan 400 e inexistentes dan 404', async () => {
  for (const id of ['0', '-1', 'abc', '1.2', '9007199254740992']) {
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request(`/api/users/${id}`, { method })).status, 400);
  }
  assert.equal((await request('/api/users/999')).status, 404);
  assert.equal((await request('/api/users/999', { method: 'DELETE' })).status, 404);
  assert.equal((await request('/api/users/999', { method: 'PUT', body: userForm({ firstname: 'Otra' }, 1) })).status, 404);
  assert.deepEqual(await avatars(), []);
});

test('PUT usuario parcial conserva avatar, ID y campos omitidos', async () => {
  const user = await (await createUser(1)).json();
  const previousHash = (await userRecords())[0].password;
  const response = await request('/api/users/1', { method: 'PUT', body: userForm({ firstname: 'Laura' }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...user, firstname: 'Laura' });
  assert.equal((await userRecords())[0].password, previousHash);
  assert.equal((await request(user.avatar)).status, 200);
});

test('PUT contraseña genera hash nuevo sin exigir login ni currentPassword', async () => {
  await createUser();
  const previousHash = (await userRecords())[0].password;
  const response = await request('/api/users/1', { method: 'PUT', body: userForm({ password: 'ClaveNueva456' }) });
  assert.equal(response.status, 200);
  assertPublicUser(await response.json());
  const saved = (await userRecords())[0];
  assert.notEqual(saved.password, previousHash);
  const [salt, hash] = saved.password.split(':');
  assert.equal(hash, (await promisify(scrypt)('ClaveNueva456', salt, 64)).toString('hex'));
});

test('PUT avatar lo reemplaza y limpia el anterior solo tras guardar', async () => {
  const previous = await (await createUser(1)).json();
  const response = await request('/api/users/1', { method: 'PUT', body: userForm({}, 1) });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assertPublicUser(updated);
  assert.notEqual(updated.avatar, previous.avatar);
  assert.equal((await request(previous.avatar)).status, 404);
  assert.equal((await request(updated.avatar)).status, 200);
  assert.equal((await avatars()).length, 1);
});

test('PUT duplicado o inválido conserva datos y avatar anterior', async () => {
  const original = await (await createUser(1)).json();
  await createUser(0, { ...userFields, username: 'otro' });
  const savedBefore = await userRecords();
  for (const changes of [{ username: 'otro' }, { firstname: '' }, { id: '80' }, { sessionKey: 'x' }, { avatar: '/img/users/falso.png' }]) {
    const response = await request('/api/users/1', { method: 'PUT', body: userForm(changes, 1) });
    assert.equal(response.status, 400);
    assert.deepEqual(await userRecords(), savedBefore);
    assert.equal((await avatars()).length, 1);
    assert.equal((await request(original.avatar)).status, 200);
  }
});

test('PUT vacío de usuarios da 400', async () => {
  await createUser();
  assert.equal((await request('/api/users/1', { method: 'PUT', body: userForm({}) })).status, 400);
});

test('DELETE usuario elimina su registro y avatar sin modificar mascotas', async () => {
  const user = await (await createUser(1)).json();
  const pet = await (await create(1)).json();
  const response = await request('/api/users/1', { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.equal(typeof (await response.json()).message, 'string');
  assert.deepEqual(await userRecords(), []);
  assert.deepEqual(await avatars(), []);
  assert.equal((await request(user.avatar)).status, 404);
  assert.deepEqual(await records(), [pet]);
  assert.equal((await request(pet.img[0])).status, 200);
});

test('mascotas no requieren usuarios y tienen exactamente el esquema solicitado', async () => {
  assert.deepEqual(await userRecords(), []);
  const response = await create(1);
  assert.equal(response.status, 201);
  const pet = await response.json();
  assert.deepEqual(Object.keys(pet).sort(), ['id', 'especie', 'color', 'edad', 'sexo', 'img'].sort());
});

test('dos avatares y campos de archivos desconocidos se rechazan y limpian', async () => {
  for (const body of [userForm(userFields, 2), form(userFields, 1)]) {
    assert.equal((await request('/api/users', { method: 'POST', body })).status, 400);
    assert.deepEqual(await avatars(), []);
    assert.deepEqual(await images(), []);
  }
});

test('imágenes con MIME permitido y contenido falso se rechazan para ambos recursos', async () => {
  for (const [resource, values, field] of [['users', userFields, 'avatar'], ['pets', fields, 'img']]) {
    const body = form(values);
    body.append(field, new Blob(['esto no es una imagen'], { type: 'image/png' }), 'falso.png');
    assert.equal((await request(`/api/${resource}`, { method: 'POST', body })).status, 400);
  }
  assert.deepEqual(await avatars(), []);
  assert.deepEqual(await images(), []);
});

test('archivo mayor a 5 MiB es rechazado sin dejar archivos', async () => {
  const body = userForm();
  body.append('avatar', new Blob([Buffer.alloc(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'grande.png');
  assert.equal((await request('/api/users', { method: 'POST', body })).status, 400);
  assert.deepEqual(await avatars(), []);
  assert.deepEqual(await userRecords(), []);
});

test('usuarios simultáneos mantienen IDs únicos y username duplicado solo se crea una vez', async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => createUser(0, { ...userFields, username: `persona${i}` })));
  assert.ok(responses.every((response) => response.status === 201));
  assert.equal(new Set((await userRecords()).map((user) => user.id)).size, 6);
  const duplicates = await Promise.all([createUser(), createUser()]);
  assert.deepEqual(duplicates.map((response) => response.status).sort(), [201, 400]);
  assert.equal((await userRecords()).length, 7);
});

test('JSON de usuarios corrupto o ausente da 500 y se limpian las cargas', async () => {
  await writeFile(usersFile, '{roto');
  assert.equal((await request('/api/users')).status, 500);
  const response = await createUser(1);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Error interno del servidor' });
  assert.equal(await readFile(usersFile, 'utf8'), '{roto');
  assert.deepEqual(await avatars(), []);
  await rm(usersFile);
  assert.equal((await request('/api/users')).status, 500);
});

test('fallo de escritura de usuarios conserva datos y avatar y limpia la carga nueva', async () => {
  const original = await (await createUser(1)).json();
  const before = await userRecords();
  await stop();
  const persistence = path.join(sandbox, 'src/utils/persistence.js');
  const source = await readFile(persistence, 'utf8');
  assert.ok(source.includes('await writeFile(tmp,'));
  await writeFile(persistence, source.replace('await writeFile(tmp,', "await (async () => { throw new Error('Fallo I/O simulado'); })(); await writeFile(tmp,"));
  await start();
  try {
    assert.equal((await request('/api/users/1', { method: 'PUT', body: userForm({ lastname: 'Otra' }, 1) })).status, 500);
    assert.deepEqual(await userRecords(), before);
    assert.equal((await avatars()).length, 1);
    assert.equal((await request(original.avatar)).status, 200);
  } finally {
    await stop();
    await writeFile(persistence, source);
    await start();
  }
});

test('reinicio conserva usuarios, hash y avatar', async () => {
  const original = await (await createUser(1)).json();
  const before = await userRecords();
  await stop();
  await start();
  assert.deepEqual(await (await request('/api/users/1')).json(), original);
  assert.deepEqual(await userRecords(), before);
  assert.equal((await request(original.avatar)).status, 200);
});

test('JSON mal formado da 400 y errores son JSON sin trazas', async () => {
  const response = await request('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{mal' });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'El cuerpo JSON no es válido' });
});

test('productos y login no se exponen', async () => {
  for (const [route, method] of [['/api/products', 'GET'], ['/api/auth/me', 'GET'], ['/api/auth/login', 'POST']]) {
    const response = await request(route, { method });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Ruta no encontrada' });
  }
});

test('inicio, estilos y JavaScript se sirven como frontend sin alterar las rutas de la API', async () => {
  for (const [route, type] of [['/', 'text/html'], ['/css/styles.css', 'text/css'], ['/js/app.js', 'javascript']]) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(type));
    const body = await response.text();
    assert.ok(body.length > 100);
    assert.ok(!body.includes('/api/auth') && !body.includes('/api/products'));
  }
  assert.equal((await request('/api/users')).status, 200);
  assert.equal((await request('/api/pets')).status, 200);
});

test('callback fallido no escribe cambios y la cola continúa operativa', async () => {
  const { updateData } = await import(pathToFileURL(path.join(sandbox, 'src/utils/persistence.js')).href);
  await assert.rejects(updateData('pets', (pets) => {
    pets.push({ id: 1 });
    throw new Error('Abortar cambio');
  }), /Abortar cambio/);
  assert.deepEqual(await records(), []);
  assert.equal((await create()).status, 201);
  assert.equal((await records()).length, 1);
});
