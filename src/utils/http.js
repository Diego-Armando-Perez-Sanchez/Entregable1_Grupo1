// Utilidades compartidas por los routers: errores HTTP controlados y validación.

export function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

export function parseId(value) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw httpError(400, 'El ID debe ser un número entero positivo');
  }
  return Number(value);
}

// Para router.param('id', idParam): valida el ID antes de que Multer guarde archivos.
export function idParam(req, res, next, value) {
  req.id = parseId(value);
  next();
}

export function findIndexById(list, id, notFoundMessage) {
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) throw httpError(404, notFoundMessage);
  return index;
}

// Lee del body solo los campos indicados en `parsers`.
// - required = true: todos deben venir (POST).
// - required = false: los omitidos se ignoran y conservan su valor (PUT).
// Un campo enviado vacío o inválido siempre es un error 400.
export function readFields(body = {}, parsers, required) {
  const names = Object.keys(parsers);
  if (required) {
    const missing = names.filter((name) => !Object.hasOwn(body, name));
    if (missing.length) throw httpError(400, `Faltan campos obligatorios: ${missing.join(', ')}`);
  }
  const fields = {};
  for (const name of names) {
    if (Object.hasOwn(body, name)) fields[name] = parsers[name](body[name], name);
  }
  return fields;
}

export function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw httpError(400, `El campo "${name}" debe ser un texto no vacío`);
  }
  return value.trim();
}

// En multipart/form-data los números llegan como texto; en JSON pueden llegar como número.
export function nonNegativeNumber(value, name) {
  const valid = typeof value === 'number' || (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value));
  const number = Number(value);
  if (!valid || !Number.isFinite(number) || number < 0) {
    throw httpError(400, `El campo "${name}" debe ser un número mayor o igual a 0`);
  }
  return number;
}
