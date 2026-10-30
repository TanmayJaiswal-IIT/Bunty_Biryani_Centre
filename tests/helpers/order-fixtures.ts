import type { PrismaClient } from '../../src/server/db.js';
import { seedInitial } from '../../prisma/seed-initial.js';
import { toDbDate } from '../../src/server/lib/db-date.js';
import { TEST_TODAY } from './clock.js';

export interface TestItems {
  itemA: { id: number; name: string; price: number };
  itemB: { id: number; name: string; price: number };
  itemC: { id: number; name: string; price: number };
}

export interface SetupOrderResult {
  items: TestItems;
  msh: { locationId: number; slotId: number };
  kanhar: { locationId: number; slotId: number };
}

export async function setupOrderTestDb(
  prisma: PrismaClient,
  businessDate: string = TEST_TODAY,
): Promise<SetupOrderResult> {
  await seedInitial(prisma);

  const mshLocation = await prisma.deliveryLocation.findUniqueOrThrow({ where: { name: 'MSH' } });
  const kanharLocation = await prisma.deliveryLocation.findUniqueOrThrow({ where: { name: 'Kanhar' } });
  const mshSlot = await prisma.deliverySlot.findFirstOrThrow({
    where: { locationId: mshLocation.id, deliveryTime: '20:00' },
  });
  const kanharSlot = await prisma.deliverySlot.findFirstOrThrow({
    where: { locationId: kanharLocation.id, deliveryTime: '20:45' },
  });

  // A: Chicken Biryani ₹150 (stock 5)
  // B: Paneer Biryani ₹130 (stock 5)
  // C: Raita ₹20 (stock 1)
  const itemA = await prisma.menuItem.create({
    data: {
      name: 'Chicken Biryani',
      price: 150,
      dailyStock: 5,
      stockRemaining: 5,
      stockDate: toDbDate(businessDate),
      isAvailable: true,
      isActive: true,
      sortOrder: 1,
    },
  });

  const itemB = await prisma.menuItem.create({
    data: {
      name: 'Paneer Biryani',
      price: 130,
      dailyStock: 5,
      stockRemaining: 5,
      stockDate: toDbDate(businessDate),
      isAvailable: true,
      isActive: true,
      sortOrder: 2,
    },
  });

  const itemC = await prisma.menuItem.create({
    data: {
      name: 'Raita',
      price: 20,
      dailyStock: 1,
      stockRemaining: 1,
      stockDate: toDbDate(businessDate),
      isAvailable: true,
      isActive: true,
      sortOrder: 3,
    },
  });

  return {
    items: {
      itemA: { id: itemA.id, name: itemA.name, price: itemA.price },
      itemB: { id: itemB.id, name: itemB.name, price: itemB.price },
      itemC: { id: itemC.id, name: itemC.name, price: itemC.price },
    },
    msh: { locationId: mshLocation.id, slotId: mshSlot.id },
    kanhar: { locationId: kanharLocation.id, slotId: kanharSlot.id },
  };
}
