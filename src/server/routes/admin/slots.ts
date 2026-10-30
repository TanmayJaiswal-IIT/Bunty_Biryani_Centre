import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { pathId } from '../../lib/path-id.js';
import {
  slotCreateSchema,
  slotUpdateSchema,
  type SlotCreateOutput,
  type SlotUpdateOutput,
} from '../../../shared/schemas/admin.js';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import {
  listSlots,
  createSlot,
  updateSlot,
} from '../../services/slots.service.js';

export function adminSlotsRouter(deps: AdminDeps): Router {
  const router = Router();

  router.get('/delivery-slots', async (_req, res, next) => {
    try {
      const slots = await listSlots(deps);
      res.json({ slots });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/delivery-slots',
    validate({ body: slotCreateSchema }),
    async (req, res, next) => {
      try {
        const input = (req.valid?.body ?? req.body) as SlotCreateOutput;
        const created = await createSlot(deps, input);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/delivery-slots/:id',
    validate({ body: slotUpdateSchema }),
    async (req, res, next) => {
      try {
        const rawId = typeof req.params.id === 'string' ? req.params.id : undefined;
        const id = pathId(rawId);
        const input = (req.valid?.body ?? req.body) as SlotUpdateOutput;
        const updated = await updateSlot(deps, id, input);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
