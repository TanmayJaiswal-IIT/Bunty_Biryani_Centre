import { Router } from 'express';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import { adminDashboardRouter } from './dashboard.js';
import { adminOrdersRouter } from './orders.js';
import { adminMenuRouter } from './menu.js';
import { adminStockRouter } from './stock.js';
import { adminLocationsRouter } from './locations.js';
import { adminSlotsRouter } from './slots.js';
import { adminSettingsRouter } from './settings.js';

export function mountAdminRoutes(router: Router, deps: AdminDeps): void {
  router.use(adminOrdersRouter(deps));
  router.use(adminDashboardRouter(deps));
  router.use(adminMenuRouter(deps));
  router.use(adminStockRouter(deps));
  router.use(adminLocationsRouter(deps));
  router.use(adminSlotsRouter(deps));
  router.use(adminSettingsRouter(deps));
}
