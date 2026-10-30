import type { RequestHandler } from 'express';
import type { CreateOrderOutput, LookupOrderOutput } from '../../shared/schemas/order.js';
import type { Clock } from '../../shared/time.js';
import type { PrismaClient } from '../db.js';
import type { Logger } from '../lib/logger.js';
import { createOrder, lookupOrder } from '../services/order.service.js';

export function ordersHandler(deps: {
  prisma: PrismaClient;
  clock: Clock;
  logger: Logger;
}): RequestHandler {
  return async (req, res) => {
    const input = (req.valid?.body ?? req.body) as CreateOrderOutput;
    const reqId = req.id ?? '';
    const result = await createOrder(deps, input, { reqId });
    res.status(result.replayed ? 200 : 201).json({
      ...result.order,
      replayed: result.replayed,
    });
  };
}

export function lookupHandler(prisma: PrismaClient): RequestHandler {
  return async (req, res) => {
    const input = (req.valid?.body ?? req.body) as LookupOrderOutput;
    const order = await lookupOrder(prisma, input);
    res.status(200).json(order);
  };
}
