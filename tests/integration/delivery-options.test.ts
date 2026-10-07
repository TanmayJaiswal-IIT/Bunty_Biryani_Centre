import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedInitial } from '../../prisma/seed-initial';
import { toDbDate } from '../../src/server/lib/db-date';
import type { DeliveryOptions } from '../../src/shared/api-types';
import { deliveryOptionsSchema } from '../../src/shared/schemas/delivery';
import { makeApp } from '../helpers/app';
import { istInstant } from '../helpers/clock';
import { prisma } from '../helpers/db';

const get = (now: string) => request(makeApp({ now }).app).get('/api/delivery-options');

async function options(hhmm: string): Promise<DeliveryOptions> {
  const res = await get(istInstant(hhmm));
  expect(res.status).toBe(200);
  return res.body as DeliveryOptions;
}

beforeEach(async () => {
  await seedInitial(prisma, () => undefined);
});

describe('GET /api/delivery-options', () => {
  it('13.4-1 lists both slots open before the first cutoff, with the default fees', async () => {
    const body = await options('19:10');
    expect(body.batch.slots.map((s) => [s.locationName, s.deliveryTime, s.cutoffTime])).toEqual([
      ['MSH', '20:00', '19:30'],
      ['Kanhar', '20:45', '20:15'],
    ]);
    for (const slot of body.batch.slots) {
      expect(slot).toMatchObject({ isOpen: true, closedReason: null });
    }
    expect(body.batch.fee).toBe(0);
    expect(body.express).toMatchObject({
      available: true,
      unavailableReason: null,
      fee: 30,
      etaText: '30–40 minutes',
    });
    expect(body.serverTime).toBe('19:10');
    expect(body.businessDate).toBe('2026-10-04');
  });

  it('13.4-2 closes the MSH slot at its cutoff and leaves Kanhar open', async () => {
    const { batch } = await options('19:30');
    const by = Object.fromEntries(batch.slots.map((s) => [s.locationName, s]));
    expect(by.MSH).toMatchObject({ isOpen: false, closedReason: 'CUTOFF_PASSED' });
    expect(by.Kanhar).toMatchObject({ isOpen: true, closedReason: null });
  });

  it('13.4-3 closes both slots after the last cutoff', async () => {
    const { batch } = await options('20:15');
    expect(batch.slots.map((s) => [s.isOpen, s.closedReason])).toEqual([
      [false, 'CUTOFF_PASSED'],
      [false, 'CUTOFF_PASSED'],
    ]);
  });

  it('13.4-4 reports a slot the vendor closed for today as CLOSED_TODAY', async () => {
    await prisma.deliverySlot.updateMany({
      where: { deliveryTime: '20:00' },
      data: { closedOn: toDbDate('2026-10-04') },
    });
    const { batch } = await options('19:10');
    const msh = batch.slots.find((s) => s.locationName === 'MSH');
    expect(msh).toMatchObject({ isOpen: false, closedReason: 'CLOSED_TODAY' });
    expect(batch.slots.find((s) => s.locationName === 'Kanhar')?.isOpen).toBe(true);
  });

  it('13.4-4 ignores a slot closed for a different day', async () => {
    await prisma.deliverySlot.updateMany({
      where: { deliveryTime: '20:00' },
      data: { closedOn: toDbDate('2026-10-03') },
    });
    const { batch } = await options('19:10');
    expect(batch.slots.find((s) => s.locationName === 'MSH')?.isOpen).toBe(true);
  });

  it('13.4-5 reports express as DISABLED when the vendor switches it off', async () => {
    await prisma.deliverySettings.update({ where: { id: 1 }, data: { expressEnabled: false } });
    const { express } = await options('19:10');
    expect(express).toMatchObject({ available: false, unavailableReason: 'DISABLED' });
  });

  it('13.4-6 reports express as OUTSIDE_HOURS before it opens', async () => {
    const { express } = await options('09:00');
    expect(express).toMatchObject({ available: false, unavailableReason: 'OUTSIDE_HOURS' });
  });

  it('13.4-7 reports paused orders', async () => {
    await prisma.deliverySettings.update({ where: { id: 1 }, data: { ordersPaused: true } });
    expect((await options('19:10')).ordersPaused).toBe(true);
  });

  it('13.4-8 returns a null contact phone until the vendor sets one', async () => {
    expect((await options('19:10')).contactPhone).toBeNull();
  });

  it('13.4-9 is not cached', async () => {
    const res = await get(istInstant('19:10'));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('matches the response schema and exposes exactly the public slot fields', async () => {
    const body = await options('19:10');
    expect(() => deliveryOptionsSchema.parse(body)).not.toThrow();
    for (const slot of body.batch.slots) {
      expect(Object.keys(slot).sort()).toEqual([
        'closedReason',
        'cutoffTime',
        'deliveryTime',
        'id',
        'isOpen',
        'locationId',
        'locationName',
      ]);
    }
  });

  it('omits a deactivated location from the slots and from express', async () => {
    await prisma.deliveryLocation.updateMany({
      where: { name: 'Kanhar' },
      data: { isActive: false },
    });
    const body = await options('19:10');
    expect(body.batch.slots.map((s) => s.locationName)).toEqual(['MSH']);
    expect(body.express.locations).toEqual([{ id: 1, name: 'MSH' }]);
  });
});
