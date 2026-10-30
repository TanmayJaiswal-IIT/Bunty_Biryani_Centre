import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  settingsUpdateSchema,
  type SettingsUpdateOutput,
} from '../../../shared/schemas/admin.js';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import {
  getAdminSettings,
  updateSettings,
} from '../../services/settings.service.js';

export function adminSettingsRouter(deps: AdminDeps): Router {
  const router = Router();

  router.get('/settings', async (_req, res, next) => {
    try {
      const settings = await getAdminSettings(deps);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/settings',
    validate({ body: settingsUpdateSchema }),
    async (req, res, next) => {
      try {
        const patch = (req.valid?.body ?? req.body) as SettingsUpdateOutput;
        const updated = await updateSettings(deps, patch);
        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
