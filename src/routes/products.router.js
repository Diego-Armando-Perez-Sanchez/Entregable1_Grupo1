import { Router } from 'express';
import { readData, updateData, nextId } from '../utils/persistence.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { httpError, idParam, findIndexById, readFields, text, nonNegativeNumber } from '../utils/http.js';

const router = Router();

// Campos del modelo original del ejemplo: { id, name, price }.
const FIELDS = { name: text, price: nonNegativeNumber };
const NOT_FOUND = 'Producto no encontrado';

// Catálogo compartido: el proyecto no define roles, así que cualquier usuario
// autenticado puede gestionarlo. Sin sesión no se puede leer ni modificar.
router.use(requireAuth);
router.param('id', idParam);

router.get('/', async (req, res) => {
  res.json(await readData('products'));
});

router.get('/:id', async (req, res) => {
  const products = await readData('products');
  res.json(products[findIndexById(products, req.id, NOT_FOUND)]);
});

router.post('/', async (req, res) => {
  const fields = readFields(req.body, FIELDS, true);
  const product = await updateData('products', (products) => {
    const newProduct = { id: nextId(products), ...fields };
    products.push(newProduct);
    return newProduct;
  });
  res.status(201).json(product);
});

router.put('/:id', async (req, res) => {
  const changes = readFields(req.body, FIELDS, false);
  if (!Object.keys(changes).length) throw httpError(400, 'No se enviaron campos para actualizar');
  const product = await updateData('products', (products) => {
    const current = products[findIndexById(products, req.id, NOT_FOUND)];
    return Object.assign(current, changes);
  });
  res.json(product);
});

router.delete('/:id', async (req, res) => {
  const product = await updateData('products', (products) => products.splice(findIndexById(products, req.id, NOT_FOUND), 1)[0]);
  res.json({ message: `Producto ${product.id} eliminado correctamente` });
});

export default router;
