import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { pathId } from '../../lib/path-id.js';
import {
  locationCreateSchema,
  locationUpdateSchema,
  type LocationCreateOutput,
  type LocationUpdateOutput,
} from '../../../shared/schemas/admin.js';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import {
  listLocations,
  createLocation,
  updateLocation,
} from '../../services/locations.service.js';

export function adminLocationsRouter(deps: AdminDeps): Router {
  const router = Router();

  router.get('/locations', async (_req, res, next) => {
    try {
      const locations = await listLocations(deps);
      res.json({ locations });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/locations',
    validate({ body: locationCreateSchema }),
    async (req, res, next) => {
      try {
        const input = (req.valid?.body ?? req.body) as LocationCreateOutput;
        const created = await createLocation(deps, input);
        res.status(201).json(created);
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/locations/:id',
    validate({ body: locationUpdateSchema }),
    async (req, res, next) => {
      try {
        const rawId = typeof req.params.id === 'string' ? req.params.id : undefined;
        const id = pathId(rawId);
        const input = (req.valid?.body ?? req.body) as LocationUpdateOutput;
        const updated = await updateLocation(deps, id, input);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
