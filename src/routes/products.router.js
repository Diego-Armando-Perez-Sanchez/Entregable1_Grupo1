import { Router } from 'express';
const router = Router();

const data = [
  { id: 1, name: 'Product 1', price: 10.99 },
  { id: 2, name: 'Product 2', price: 19.99 },
  { id: 3, name: 'Product 3', price: 5.99 },
];

router.get('/', (req, res) => {
  res.json(data);
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const product = data.find((p) => p.id === parseInt(id));
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(product);
});

router.post('/', (req, res) => {
  const { id, name, price } = req.body;
  if (!id || !name || !price) {
    return res.status(400).json({ error: 'Missing fields to create a product' });
  }
  const newProduct = { id, name, price };
  data.push(newProduct);
  res.status(201).json(newProduct);
});

export default router;