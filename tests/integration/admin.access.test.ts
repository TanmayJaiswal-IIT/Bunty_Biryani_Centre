import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeApp } from '../helpers/app.js';
import { TEST_NOW, TEST_TODAY } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { createAdmin } from '../helpers/factories.js';
import { loginCookie } from '../helpers/http.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

/**
 * Route table of all admin endpoints from Batch 1 §8.3 (excluding login).
 * Parameterized with dynamic IDs from the test world.
 */
function getAdminRoutes(fixtures: SetupOrderResult): Array<{
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  isWrite: boolean;
  dummyBody?: Record<string, unknown>;
}> {
  return [
    { method: 'post', path: '/api/admin/logout', isWrite: true },
    { method: 'get', path: '/api/admin/me', isWrite: false },
    { method: 'get', path: '/api/admin/dashboard', isWrite: false },
    { method: 'get', path: '/api/admin/orders', isWrite: false },
    { method: 'get', path: `/api/admin/orders/1`, isWrite: false },
    { method: 'patch', path: `/api/admin/orders/1/status`, isWrite: true, dummyBody: {} },
    { method: 'post', path: '/api/admin/orders/complete-many', isWrite: true, dummyBody: {} },
    { method: 'get', path: '/api/admin/menu', isWrite: false },
    { method: 'post', path: '/api/admin/menu', isWrite: true, dummyBody: {} },
    { method: 'patch', path: `/api/admin/menu/${fixtures.items.itemA.id}`, isWrite: true, dummyBody: {} },
    { method: 'delete', path: `/api/admin/menu/999999`, isWrite: true },
    { method: 'put', path: '/api/admin/stock', isWrite: true, dummyBody: {} },
    { method: 'get', path: '/api/admin/locations', isWrite: false },
    { method: 'post', path: '/api/admin/locations', isWrite: true, dummyBody: {} },
    { method: 'patch', path: `/api/admin/locations/${fixtures.msh.locationId}`, isWrite: true, dummyBody: {} },
    { method: 'get', path: '/api/admin/delivery-slots', isWrite: false },
    { method: 'post', path: '/api/admin/delivery-slots', isWrite: true, dummyBody: {} },
    { method: 'patch', path: `/api/admin/delivery-slots/${fixtures.msh.slotId}`, isWrite: true, dummyBody: {} },
    { method: 'get', path: '/api/admin/settings', isWrite: false },
    { method: 'patch', path: '/api/admin/settings', isWrite: true, dummyBody: {} },
  ];
}

describe('Admin access control integration (Batch 6 Task 6)', () => {
  let fixtures: SetupOrderResult;
  let app: Express;
  let adminCookie: string;
  const validOrigin = 'http://localhost:3000';

  beforeEach(async () => {
    await createAdmin();
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    const appResult = makeApp({ now: TEST_NOW, prisma });
    app = appResult.app;
    adminCookie = await loginCookie(app);
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  it('#4: unauthenticated requests return 401 UNAUTHENTICATED on all admin endpoints', async () => {
    const routes = getAdminRoutes(fixtures);
    for (const route of routes) {
      const req = request(app)[route.method](route.path);
      if (route.dummyBody) {
        req.send(route.dummyBody);
      }
      const res = await req;
      expect(res.status, `Expected 401 for ${route.method.toUpperCase()} ${route.path}`).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('#5: CSRF protection on writes rejects requests without Origin or with forbidden Origin', async () => {
    const writeRoutes = getAdminRoutes(fixtures).filter((r) => r.isWrite);

    for (const route of writeRoutes) {
      // 1. Missing Origin header -> 403
      const reqNoOrigin = request(app)[route.method](route.path).set('Cookie', adminCookie);
      if (route.dummyBody) {
        reqNoOrigin.send(route.dummyBody);
      }
      const resNoOrigin = await reqNoOrigin;
      expect(
        resNoOrigin.status,
        `Expected 403 for missing Origin on ${route.method.toUpperCase()} ${route.path}`,
      ).toBe(403);
      expect(resNoOrigin.body.error?.code).toBe('FORBIDDEN_ORIGIN');

      // 2. Forbidden Origin header -> 403
      const reqEvilOrigin = request(app)[route.method](route.path)
        .set('Cookie', adminCookie)
        .set('Origin', 'https://evil.example');
      if (route.dummyBody) {
        reqEvilOrigin.send(route.dummyBody);
      }
      const resEvilOrigin = await reqEvilOrigin;
      expect(
        resEvilOrigin.status,
        `Expected 403 for evil Origin on ${route.method.toUpperCase()} ${route.path}`,
      ).toBe(403);
      expect(resEvilOrigin.body.error?.code).toBe('FORBIDDEN_ORIGIN');
    }
  });

  it('AC1: route-table completeness: all routes defined in Batch 1 §8.3 return status other than 404', async () => {
    const routes = getAdminRoutes(fixtures);

    for (const route of routes) {
      const req = request(app)[route.method](route.path)
        .set('Cookie', adminCookie)
        .set('Origin', validOrigin);

      if (route.dummyBody) {
        req.send(route.dummyBody);
      }

      const res = await req;
      // All routes must be mounted and registered (not 404)
      // Note: /menu/999999 DELETE returns 404 because item 999999 does not exist, but route is matched
      if (route.path === '/api/admin/menu/999999') {
        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe('NOT_FOUND');
      } else if (route.path === '/api/admin/orders/1') {
        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe('NOT_FOUND');
      } else {
        expect(
          res.status,
          `Expected route ${route.method.toUpperCase()} ${route.path} to be handled (not 404), got ${res.status}`,
        ).not.toBe(404);
      }
    }
  });
});
