import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import {
  dashboardQuerySchema,
  type DashboardQueryOutput,
} from '../../../shared/schemas/admin.js';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import { getDashboard } from '../../services/dashboard.service.js';

export function adminDashboardRouter(deps: AdminDeps): Router {
  const router = Router();

  router.get(
    '/dashboard',
    validate({ query: dashboardQuerySchema }),
    async (req, res, next) => {
      try {
        const query = (req.valid?.query ?? req.query) as DashboardQueryOutput;
        const dashboard = await getDashboard(deps, query.date);
        res.json(dashboard);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
