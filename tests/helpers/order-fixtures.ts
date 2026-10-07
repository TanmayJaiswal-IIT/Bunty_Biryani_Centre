import { randomUUID } from 'node:crypto';
import type {
  DeliveryLocation,
  DeliverySlot,
  MenuItem,
} from '../../src/server/generated/prisma/client';
import { seedInitial } from '../../prisma/seed-initial';
import { createMenuItem } from './factories';
import { prisma } from './db';

export interface OrderWorld {
  msh: DeliveryLocation;
  kanhar: DeliveryLocation;
  mshSlot: DeliverySlot;
  kanharSlot: DeliverySlot;
  A: MenuItem;
  B: MenuItem;
  C: MenuItem;
}

/**
 * seedInitial (quiet) plus three items stocked for today:
 * A Chicken Biryani ₹150 (5), B Paneer Biryani ₹130 (5), C Raita ₹20 (1).
 */
export async function seedOrderWorld(
  over: { stock?: Partial<Record<'A' | 'B' | 'C', number>> } = {},
): Promise<OrderWorld> {
  await seedInitial(prisma, () => undefined);
  const [msh, kanhar] = await Promise.all([
    prisma.deliveryLocation.findUniqueOrThrow({ where: { name: 'MSH' } }),
    prisma.deliveryLocation.findUniqueOrThrow({ where: { name: 'Kanhar' } }),
  ]);
  const [mshSlot, kanharSlot] = await Promise.all([
    prisma.deliverySlot.findFirstOrThrow({ where: { locationId: msh.id, deliveryTime: '20:00' } }),
    prisma.deliverySlot.findFirstOrThrow({
      where: { locationId: kanhar.id, deliveryTime: '20:45' },
    }),
  ]);
  const A = await createMenuItem({
    name: 'Chicken Biryani',
    price: 150,
    stock: over.stock?.A ?? 5,
    sortOrder: 0,
  });
  const B = await createMenuItem({
    name: 'Paneer Biryani',
    price: 130,
    stock: over.stock?.B ?? 5,
    sortOrder: 1,
  });
  const C = await createMenuItem({
    name: 'Raita',
    price: 20,
    stock: over.stock?.C ?? 1,
    sortOrder: 2,
  });
  return { msh, kanhar, mshSlot, kanharSlot, A, B, C };
}

/** '90000000' + two digits: a distinct valid-looking phone per request. */
export function phoneN(n: number): string {
  return `90000000${String(n).padStart(2, '0')}`;
}

type Line = { menuItemId: number; quantity: number };

function foodSubtotal(w: OrderWorld, items: Line[]): number {
  const price = new Map([
    [w.A.id, w.A.price],
    [w.B.id, w.B.price],
    [w.C.id, w.C.price],
  ]);
  return items.reduce((sum, l) => sum + (price.get(l.menuItemId) ?? 0) * l.quantity, 0);
}

const CUSTOMER = {
  customerName: 'Rahul Verma',
  customerPhone: '9876543210',
  addressDetail: 'Room 214, B block',
};

/** A BATCH MSH 20:00 body with a fresh clientRequestId; `over` replaces any key. */
export function batchBody(
  w: OrderWorld,
  items: Line[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientRequestId: randomUUID(),
    deliveryMode: 'BATCH',
    locationId: w.msh.id,
    slotId: w.mshSlot.id,
    ...CUSTOMER,
    items,
    expectedTotal: foodSubtotal(w, items),
    ...over,
  };
}

/** An EXPRESS body (Kanhar unless `over.locationId` says otherwise); the total includes the ₹30 fee. */
export function expressBody(
  w: OrderWorld,
  items: Line[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientRequestId: randomUUID(),
    deliveryMode: 'EXPRESS',
    locationId: w.kanhar.id,
    ...CUSTOMER,
    items,
    expectedTotal: foodSubtotal(w, items) + 30,
    ...over,
  };
}
