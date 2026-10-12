import type { RequestHandler, Router } from 'express';
import type { CompleteManyResult } from '../../../shared/api-types.js';
import {
  completeManySchema,
  orderActionSchema,
  type CompleteManyOutput,
  type OrderAction,
} from '../../../shared/schemas/admin.js';
import { pathId } from '../../lib/path-id.js';
import { validate } from '../../middleware/validate.js';
import {
  completeMany,
  getAdminOrder,
  updateOrderStatus,
  type AdminDeps,
} from '../../services/admin-orders.service.js';

/**
 * Admin order routes (Batch 1 §8.5). The router is already behind `requireAdmin` and, for writes,
 * the Origin check. `GET /orders` (the list) arrives with the search in Batch 6 Task 4.
 */
export function mountOrderRoutes(router: Router, deps: AdminDeps): void {
  const detail: RequestHandler<{ id: string }> = async (req, res) => {
    res.json(await getAdminOrder(deps, pathId(req.params.id)));
  };

  const setStatus: RequestHandler<{ id: string }> = async (req, res) => {
    const id = pathId(req.params.id);
    res.json(await updateOrderStatus(deps, id, req.valid.body as OrderAction));
  };

  const doneMany: RequestHandler = async (req, res) => {
    const result: CompleteManyResult = await completeMany(
      deps,
      req.valid.body as CompleteManyOutput,
    );
    res.json(result);
  };

  router.post('/orders/complete-many', validate({ body: completeManySchema }), doneMany);
  router.get('/orders/:id', detail);
  router.patch('/orders/:id/status', validate({ body: orderActionSchema }), setStatus);
}
