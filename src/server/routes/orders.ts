import type { RequestHandler } from 'express';
import type { CreateOrderResponse } from '../../shared/api-types.js';
import type { CreateOrderOutput, LookupOutput } from '../../shared/schemas/order.js';
import { createOrder, lookupOrder, type OrderDeps } from '../services/order.service.js';

/**
 * `POST /api/orders` (Batch 1 §8.4): `201` for a new order, `200` for an idempotent replay.
 * `POST /api/orders/lookup`: `200` with the public view (no `replayed`), or `404 ORDER_NOT_FOUND`.
 */
export function orderHandlers(deps: OrderDeps) {
  const create: RequestHandler = async (req, res) => {
    const input = req.valid.body as CreateOrderOutput;
    const { order, replayed } = await createOrder(deps, input, { reqId: req.id });
    const body: CreateOrderResponse = { ...order, replayed };
    res.status(replayed ? 200 : 201).json(body);
  };

  const lookup: RequestHandler = async (req, res) => {
    const input = req.valid.body as LookupOutput;
    res.json(await lookupOrder(deps.prisma, input));
  };

  return { create, lookup };
}
