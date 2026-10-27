import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  adminLocationSchema,
  adminLocationsResponseSchema,
  adminMenuItemSchema,
  adminMenuResponseSchema,
  adminSettingsSchema,
  adminSlotSchema,
  adminSlotsResponseSchema,
} from '../../src/shared/schemas/admin-views.js';
import { makeApp } from '../helpers/app.js';
import { istInstant } from '../helpers/admin-fixtures.js';
import { TEST_NOW, TEST_TODAY, type TestClock } from '../helpers/clock.js';
import { prisma } from '../helpers/db.js';
import { createAdmin } from '../helpers/factories.js';
import { adminClient, type AdminClient } from '../helpers/http.js';
import { assertInventoryInvariant } from '../helpers/invariant.js';
import { setupOrderTestDb, type SetupOrderResult } from '../helpers/order-fixtures.js';

describe('Admin management integration (Batch 6 Task 5)', () => {
  let fixtures: SetupOrderResult;
  let app: Express;
  let admin: AdminClient;
  let clock: TestClock;

  beforeEach(async () => {
    await createAdmin();
    fixtures = await setupOrderTestDb(prisma, TEST_TODAY);
    const appResult = makeApp({ now: TEST_NOW, prisma });
    app = appResult.app;
    clock = appResult.clock;
    admin = await adminClient(app);
  });

  afterEach(async () => {
    await assertInventoryInvariant(prisma);
  });

  it('#23: menu CRUD, strict validation, pricing integrity and soft delete', async () => {
    // 1. Create -> 201, sortOrder = last + 1, stockDate null, stockSetToday false
    const createRes = await admin.send('post', '/api/admin/menu', {
      name: 'Egg Biryani',
      description: 'Two eggs with aromatic spiced basmati rice',
      price: 120,
      imageUrl: 'https://images.unsplash.com/egg-biryani.jpg',
      isAvailable: true,
    });
    expect(createRes.status).toBe(201);
    const created = adminMenuItemSchema.parse(createRes.body);
    expect(created.name).toBe('Egg Biryani');
    expect(created.sortOrder).toBe(4); // items A, B, C had sortOrders 1, 2, 3
    expect(created.stockDate).toBeNull();
    expect(created.stockSetToday).toBe(false);

    // Validation rejections
    // price: 0 -> 400
    const resZeroPrice = await admin.send('post', '/api/admin/menu', {
      name: 'Free Item',
      price: 0,
    });
    expect(resZeroPrice.status).toBe(400);

    // imageUrl: http -> 400
    const resHttp = await admin.send('post', '/api/admin/menu', {
      name: 'Insecure Image Item',
      price: 100,
      imageUrl: 'http://example.com/item.jpg',
    });
    expect(resHttp.status).toBe(400);

    // stockRemaining in body -> 400 (strict schema)
    const resStockField = await admin.send('post', '/api/admin/menu', {
      name: 'Sneaky Stock Item',
      price: 100,
      stockRemaining: 50,
    });
    expect(resStockField.status).toBe(400);

    // Patch price 150 -> 160 on itemA
    const patchRes = await admin.send('patch', `/api/admin/menu/${fixtures.items.itemA.id}`, {
      price: 160,
    });
    expect(patchRes.status).toBe(200);
    const patched = adminMenuItemSchema.parse(patchRes.body);
    expect(patched.price).toBe(160);

    // GET /api/menu shows 160
    const publicMenuRes = await request(app).get('/api/menu');
    expect(publicMenuRes.status).toBe(200);
    const publicItemA = publicMenuRes.body.items.find((i: { id: number }) => i.id === fixtures.items.itemA.id);
    expect(publicItemA.price).toBe(160);

    // Soft delete itemA -> 204
    const deleteRes = await admin.send('delete', `/api/admin/menu/${created.id}`);
    expect(deleteRes.status).toBe(204);

    // Gone from public menu and admin menu
    const publicAfterDelete = await request(app).get('/api/menu');
    expect(publicAfterDelete.body.items.some((i: { id: number }) => i.id === created.id)).toBe(false);

    const adminAfterDelete = await admin.get('/api/admin/menu');
    const adminMenu = adminMenuResponseSchema.parse(adminAfterDelete.body);
    expect(adminMenu.items.some((i) => i.id === created.id)).toBe(false);

    // Second delete -> 404
    const secondDeleteRes = await admin.send('delete', `/api/admin/menu/${created.id}`);
    expect(secondDeleteRes.status).toBe(404);
  });

  it('#24: stock bulk update and stock below sold prevention', async () => {
    // PUT /api/admin/stock A: 30, B: 10 -> 200 with those two items
    const putRes = await admin.send('put', '/api/admin/stock', {
      items: [
        { menuItemId: fixtures.items.itemA.id, stock: 30 },
        { menuItemId: fixtures.items.itemB.id, stock: 10 },
      ],
    });
    expect(putRes.status).toBe(200);
    const updatedItems = adminMenuResponseSchema.parse(putRes.body).items;
    expect(updatedItems).toHaveLength(2);
    const updatedA = updatedItems.find((i) => i.id === fixtures.items.itemA.id);
    expect(updatedA?.dailyStock).toBe(30);
    expect(updatedA?.stockRemaining).toBe(30);
    expect(updatedA?.stockSetToday).toBe(true);

    // Place an order for 2 x A
    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        clientRequestId: randomUUID(),
        deliveryMode: 'BATCH',
        slotId: fixtures.msh.slotId,
        locationId: fixtures.msh.locationId,
        customerName: 'Aman',
        customerPhone: '9876543210',
        items: [{ menuItemId: fixtures.items.itemA.id, quantity: 2 }],
        expectedTotal: 300,
      });
    expect(orderRes.status).toBe(201);

    // PUT A: 1 -> 409 STOCK_BELOW_SOLD
    const failedPut = await admin.send('put', '/api/admin/stock', {
      items: [
        { menuItemId: fixtures.items.itemA.id, stock: 1 },
        { menuItemId: fixtures.items.itemB.id, stock: 20 },
      ],
    });
    expect(failedPut.status).toBe(409);
    expect(failedPut.body.error.code).toBe('STOCK_BELOW_SOLD');
    expect(failedPut.body.error.details).toEqual({
      items: [{ menuItemId: fixtures.items.itemA.id, sold: 2 }],
    });

    // B must remain unchanged (rollback)
    const checkB = await prisma.menuItem.findUniqueOrThrow({ where: { id: fixtures.items.itemB.id } });
    expect(checkB.dailyStock).toBe(10);

    // Unknown id -> 404
    const unknownRes = await admin.send('put', '/api/admin/stock', {
      items: [{ menuItemId: 999999, stock: 5 }],
    });
    expect(unknownRes.status).toBe(404);
  });

  it('#25: delivery locations CRUD, duplicate detection and deactivation cascade', async () => {
    // Create 'Hall 5' -> 201
    const createRes = await admin.send('post', '/api/admin/locations', {
      name: 'Hall 5',
    });
    expect(createRes.status).toBe(201);
    const created = adminLocationSchema.parse(createRes.body);
    expect(created.name).toBe('Hall 5');

    // Duplicate name case-insensitive: 'msh' -> 409 DUPLICATE { field: 'name' }
    const dupRes = await admin.send('post', '/api/admin/locations', {
      name: 'msh',
    });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('DUPLICATE');
    expect(dupRes.body.error.details?.field).toBe('name');

    // Renaming Kanhar to 'MSH ' (trimmed) -> 409
    const renameDupRes = await admin.send('patch', `/api/admin/locations/${fixtures.kanhar.locationId}`, {
      name: 'MSH ',
    });
    expect(renameDupRes.status).toBe(409);
    expect(renameDupRes.body.error.code).toBe('DUPLICATE');
    expect(renameDupRes.body.error.details?.field).toBe('name');

    // Deactivating Kanhar -> vanishes from /api/delivery-options
    const deactivateRes = await admin.send('patch', `/api/admin/locations/${fixtures.kanhar.locationId}`, {
      isActive: false,
    });
    expect(deactivateRes.status).toBe(200);

    const deliveryOptions = await request(app).get('/api/delivery-options');
    expect(deliveryOptions.status).toBe(200);
    const kanharSlot = deliveryOptions.body.batch.slots.find(
      (s: { locationId: number }) => s.locationId === fixtures.kanhar.locationId,
    );
    expect(kanharSlot).toBeUndefined();
    const kanharExpress = deliveryOptions.body.express.locations.find(
      (l: { id: number }) => l.id === fixtures.kanhar.locationId,
    );
    expect(kanharExpress).toBeUndefined();

    // slotCount reflects active slots
    const listRes = await admin.get('/api/admin/locations');
    const locations = adminLocationsResponseSchema.parse(listRes.body).locations;
    const mshLoc = locations.find((l) => l.id === fixtures.msh.locationId);
    expect(mshLoc?.slotCount).toBe(1);
  });

  it('#26: delivery slots CRUD, cutoff validation and closedToday logic', async () => {
    // Create MSH 21:00 / 20:30 -> 201
    const createRes = await admin.send('post', '/api/admin/delivery-slots', {
      locationId: fixtures.msh.locationId,
      deliveryTime: '21:00',
      cutoffTime: '20:30',
    });
    expect(createRes.status).toBe(201);
    const created = adminSlotSchema.parse(createRes.body);
    expect(created.deliveryTime).toBe('21:00');
    expect(created.cutoffTime).toBe('20:30');

    // Cutoff >= delivery -> 400
    const resBadCutoff = await admin.send('post', '/api/admin/delivery-slots', {
      locationId: fixtures.msh.locationId,
      deliveryTime: '22:00',
      cutoffTime: '22:00',
    });
    expect(resBadCutoff.status).toBe(400);

    // Duplicate deliveryTime for same location -> 409 DUPLICATE { field: 'deliveryTime' }
    const dupSlotRes = await admin.send('post', '/api/admin/delivery-slots', {
      locationId: fixtures.msh.locationId,
      deliveryTime: '20:00',
      cutoffTime: '19:30',
    });
    expect(dupSlotRes.status).toBe(409);
    expect(dupSlotRes.body.error.code).toBe('DUPLICATE');
    expect(dupSlotRes.body.error.details?.field).toBe('deliveryTime');

    // Patch cutoffTime: 20:30 on 20:00 slot -> 400 fieldErrors.cutoffTime
    const badPatchRes = await admin.send('patch', `/api/admin/delivery-slots/${fixtures.msh.slotId}`, {
      cutoffTime: '20:30',
    });
    expect(badPatchRes.status).toBe(400);
    expect(badPatchRes.body.error.details?.fieldErrors?.cutoffTime).toBeDefined();

    // closedToday: true -> /api/delivery-options shows CLOSED_TODAY
    const closeRes = await admin.send('patch', `/api/admin/delivery-slots/${fixtures.msh.slotId}`, {
      closedToday: true,
    });
    expect(closeRes.status).toBe(200);

    const deliveryOptionsToday = await request(app).get('/api/delivery-options');
    const mshSlotOpt = deliveryOptionsToday.body.batch.slots.find(
      (s: { id: number }) => s.id === fixtures.msh.slotId,
    );
    expect(mshSlotOpt?.closedReason).toBe('CLOSED_TODAY');

    // Move clock to 2026-10-05 10:00 -> open again
    clock.set(istInstant('10:00', '2026-10-05'));
    const deliveryOptionsNext = await request(app).get('/api/delivery-options');
    const mshSlotOptNext = deliveryOptionsNext.body.batch.slots.find(
      (s: { id: number }) => s.id === fixtures.msh.slotId,
    );
    expect(mshSlotOptNext?.isOpen).toBe(true);

    // openOrdersToday counts open orders only (2 open + 1 completed -> 2)
    clock.set(TEST_NOW);
    // Unclose slot for order placing
    await admin.send('patch', `/api/admin/delivery-slots/${fixtures.msh.slotId}`, {
      closedToday: false,
    });

    const o1 = await request(app).post('/api/orders').send({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH',
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'User 1',
      customerPhone: '9876543201',
      items: [{ menuItemId: fixtures.items.itemB.id, quantity: 1 }],
      expectedTotal: 130,
    });
    const o2 = await request(app).post('/api/orders').send({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH',
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'User 2',
      customerPhone: '9876543202',
      items: [{ menuItemId: fixtures.items.itemB.id, quantity: 1 }],
      expectedTotal: 130,
    });
    const o3 = await request(app).post('/api/orders').send({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH',
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'User 3',
      customerPhone: '9876543203',
      items: [{ menuItemId: fixtures.items.itemB.id, quantity: 1 }],
      expectedTotal: 130,
    });
    expect(o1.status).toBe(201);
    expect(o2.status).toBe(201);
    expect(o3.status).toBe(201);

    // Complete o1
    const dbO1 = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: o1.body.orderNumber },
    });
    const patchRes = await admin.send('patch', `/api/admin/orders/${dbO1.id}/status`, {
      status: 'COMPLETED',
    });
    expect(patchRes.status).toBe(200);

    const slotsRes = await admin.get('/api/admin/delivery-slots');
    const slots = adminSlotsResponseSchema.parse(slotsRes.body).slots;
    const mshAdminSlot = slots.find((s) => s.id === fixtures.msh.slotId);
    expect(mshAdminSlot?.openOrdersToday).toBe(2);
  });

  it('#27: settings update, fee propagation and order pause', async () => {
    // Patch batchFee: 10 -> /api/delivery-options batch.fee 10
    const feeRes = await admin.send('patch', '/api/admin/settings', {
      batchFee: 10,
    });
    expect(feeRes.status).toBe(200);
    const settings = adminSettingsSchema.parse(feeRes.body);
    expect(settings.batchFee).toBe(10);

    const deliveryOptions = await request(app).get('/api/delivery-options');
    expect(deliveryOptions.body.batch.fee).toBe(10);

    // Validation errors:
    // expressEtaMinMinutes: 50 while max is 40 -> 400
    const resMinMax = await admin.send('patch', '/api/admin/settings', {
      expressEtaMinMinutes: 50,
    });
    expect(resMinMax.status).toBe(400);

    // expressOpensAt: 23:30 (opens >= closes 23:00) -> 400
    const resBadHours = await admin.send('patch', '/api/admin/settings', {
      expressOpensAt: '23:30',
    });
    expect(resBadHours.status).toBe(400);

    // contactPhone: 12345 -> 400
    const resBadPhone = await admin.send('patch', '/api/admin/settings', {
      contactPhone: '12345',
    });
    expect(resBadPhone.status).toBe(400);

    // ordersPaused: true -> /api/menu ordersPaused true, and POST /api/orders -> 409 ORDERS_PAUSED
    await admin.send('patch', '/api/admin/settings', { ordersPaused: true });
    const menuRes = await request(app).get('/api/menu');
    expect(menuRes.body.ordersPaused).toBe(true);

    const orderRes = await request(app).post('/api/orders').send({
      clientRequestId: randomUUID(),
      deliveryMode: 'BATCH',
      slotId: fixtures.msh.slotId,
      locationId: fixtures.msh.locationId,
      customerName: 'Paused Tester',
      customerPhone: '9876543290',
      items: [{ menuItemId: fixtures.items.itemB.id, quantity: 1 }],
      expectedTotal: 140, // 130 + 10 fee
    });
    expect(orderRes.status).toBe(409);
    expect(orderRes.body.error.code).toBe('ORDERS_PAUSED');

    // GET /api/admin/settings has no id or updatedAt
    const getSettingsRes = await admin.get('/api/admin/settings');
    expect(getSettingsRes.status).toBe(200);
    expect(getSettingsRes.body.id).toBeUndefined();
    expect(getSettingsRes.body.updatedAt).toBeUndefined();
  });

  it('MR1 (Review Focus 5): concurrent row-locking PATCHes prevent database CHECK violations', async () => {
    // 1. Settings concurrency: starting from min: 30, max: 40
    // Try to simultaneously update min -> 45 and max -> 35
    const [res1, res2] = await Promise.all([
      admin.send('patch', '/api/admin/settings', { expressEtaMinMinutes: 45 }),
      admin.send('patch', '/api/admin/settings', { expressEtaMaxMinutes: 35 }),
    ]);

    // One must succeed (200) and the other must be rejected with 400 (never 500)
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 400]);

    // Final database state satisfies min <= max
    const finalSettings = await prisma.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(finalSettings.expressEtaMinMinutes).toBeLessThanOrEqual(finalSettings.expressEtaMaxMinutes);

    // 2. Slot concurrency on deliveryTime 20:00, cutoffTime 19:30
    // Try to simultaneously update deliveryTime -> 19:40 and cutoffTime -> 19:50
    const [slotRes1, slotRes2] = await Promise.all([
      admin.send('patch', `/api/admin/delivery-slots/${fixtures.msh.slotId}`, { deliveryTime: '19:40' }),
      admin.send('patch', `/api/admin/delivery-slots/${fixtures.msh.slotId}`, { cutoffTime: '19:50' }),
    ]);

    const slotStatuses = [slotRes1.status, slotRes2.status].sort();
    expect(slotStatuses).toEqual([200, 400]);

    const finalSlot = await prisma.deliverySlot.findUniqueOrThrow({ where: { id: fixtures.msh.slotId } });
    expect(finalSlot.cutoffTime < finalSlot.deliveryTime).toBe(true);
  });
});
