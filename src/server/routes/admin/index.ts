import type { Router } from 'express';
import type { AdminDeps } from '../../services/admin-orders.service.js';
import { mountOrderRoutes } from './orders.js';

/**
 * Mounts the admin routes behind the session check on `router` (app.ts adds `requireAdmin` and the
 * Origin check before calling this, so nothing registered here can skip them).
 */
export function mountAdminRoutes(router: Router, deps: AdminDeps): void {
  mountOrderRoutes(router, deps);
}
