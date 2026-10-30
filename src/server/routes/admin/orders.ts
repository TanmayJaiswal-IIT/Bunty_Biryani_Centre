import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { pathId } from '../../lib/path-id.js';
import {
  orderActionSchema,
  completeManySchema,
  ordersQuerySchema,
  type CompleteManyOutput,
  type OrderAction,
  type OrdersQueryOutput,
} from '../../../shared/schemas/admin.js';
import {
  type AdminDeps,
  getAdminOrder,
  updateOrderStatus,
  completeMany,
  listOrders,
} from '../../services/admin-orders.service.js';

export function adminOrdersRouter(deps: AdminDeps): Router {
  const router = Router();

  router.get(
    '/orders',
    validate({ query: ordersQuerySchema }),
    async (req, res, next) => {
      try {
        const query = (req.valid?.query ?? req.query) as OrdersQueryOutput;
        const result = await listOrders(deps, query);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/orders/complete-many',
    validate({ body: completeManySchema }),
    async (req, res, next) => {
      try {
        const input = (req.valid?.body ?? req.body) as CompleteManyOutput;
        const result = await completeMany(deps, input);
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/orders/:id', async (req, res, next) => {
    try {
      const rawId = typeof req.params.id === 'string' ? req.params.id : undefined;
      const id = pathId(rawId);
      const order = await getAdminOrder(deps, id);
      res.json(order);
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/orders/:id/status',
    validate({ body: orderActionSchema }),
    async (req, res, next) => {
      try {
        const rawId = typeof req.params.id === 'string' ? req.params.id : undefined;
        const id = pathId(rawId);
        const action = (req.valid?.body ?? req.body) as OrderAction;
        const order = await updateOrderStatus(deps, id, action);
        res.json(order);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
