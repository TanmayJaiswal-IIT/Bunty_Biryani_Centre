import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import type { TestClock } from './clock.js';
import { TEST_TODAY } from './clock.js';
import type { SetupOrderResult } from './order-fixtures.js';

export interface PlanOrder {
  at: string;
  date?: string;
  mode: 'BATCH' | 'EXPRESS';
  location: 'msh' | 'kanhar';
  items: { menuItemId: number; quantity: number }[];
  customerName?: string;
}

export function istInstant(time: string, date: string = TEST_TODAY): string {
  return new Date(`${date}T${time}:00+05:30`).toISOString();
}

export function phoneN(i: number): string {
  return `98765432${String(10 + i).padStart(2, '0')}`;
}

export async function placeOrders(
  app: Express,
  w: SetupOrderResult,
  plan: PlanOrder[],
  clock: TestClock,
): Promise<{ orderNumber: string; id: number }[]> {
  const created: { orderNumber: string; id: number }[] = [];

  for (let i = 0; i < plan.length; i += 1) {
    const item = plan[i]!;
    clock.set(istInstant(item.at, item.date ?? TEST_TODAY));

    const location = w[item.location];
    const isExpress = item.mode === 'EXPRESS';

    const foodSubtotal = item.items.reduce((sum, line) => {
      let price = 150;
      if (line.menuItemId === w.items.itemB.id) price = w.items.itemB.price;
      else if (line.menuItemId === w.items.itemC.id) price = w.items.itemC.price;
      else if (line.menuItemId === w.items.itemA.id) price = w.items.itemA.price;
      return sum + price * line.quantity;
    }, 0);

    const deliveryFee = isExpress ? 30 : 0;
    const expectedTotal = foodSubtotal + deliveryFee;

    const body: Record<string, unknown> = {
      clientRequestId: randomUUID(),
      deliveryMode: item.mode,
      locationId: location.locationId,
      customerName: item.customerName ?? `Customer ${i + 1}`,
      customerPhone: phoneN(i),
      addressDetail: 'Room 101',
      items: item.items,
      expectedTotal,
    };

    if (!isExpress) {
      body.slotId = location.slotId;
    }

    const res = await request(app).post('/api/orders').send(body);
    if (res.status !== 201) {
      throw new Error(`Failed to place order in fixture at index ${i}: ${res.status} ${JSON.stringify(res.body)}`);
    }

    created.push({
      orderNumber: res.body.orderNumber as string,
      id: (res.body.id ?? 0) as number,
    });
  }

  return created;
}
