import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { pathId } from '../../lib/path-id.js';
import {
  menuItemCreateSchema,
  menuItemUpdateSchema,
  type MenuItemCreateOutput,
  type MenuItemUpdateOutput,
} from '../../../shared/schemas/admin.js';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import {
  listAdminMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from '../../services/admin-menu.service.js';

export function adminMenuRouter(deps: AdminDeps): Router {
  const router = Router();

  router.get('/menu', async (_req, res, next) => {
    try {
      const items = await listAdminMenu(deps);
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/menu',
    validate({ body: menuItemCreateSchema }),
    async (req, res, next) => {
      try {
        const input = (req.valid?.body ?? req.body) as MenuItemCreateOutput;
        const created = await createMenuItem(deps, input);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/menu/:id',
    validate({ body: menuItemUpdateSchema }),
    async (req, res, next) => {
      try {
        const rawId = typeof req.params.id === 'string' ? req.params.id : undefined;
        const id = pathId(rawId);
        const input = (req.valid?.body ?? req.body) as MenuItemUpdateOutput;
        const updated = await updateMenuItem(deps, id, input);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/menu/:id', async (req, res, next) => {
    try {
      const rawId = typeof req.params.id === 'string' ? req.params.id : undefined;
      const id = pathId(rawId);
      await deleteMenuItem(deps, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
