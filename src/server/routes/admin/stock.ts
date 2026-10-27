import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  stockBulkSchema,
  type StockBulkOutput,
} from '../../../shared/schemas/admin.js';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import {
  saveStock,
} from '../../services/admin-menu.service.js';

export function adminStockRouter(deps: AdminDeps): Router {
  const router = Router();

  router.put(
    '/stock',
    validate({ body: stockBulkSchema }),
    async (req, res, next) => {
      try {
        const input = (req.valid?.body ?? req.body) as StockBulkOutput;
        const items = await saveStock(deps, input);
        res.json({ items });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
