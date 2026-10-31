import { createPrisma, type PrismaClient } from '../../../src/server/db.js';
import { setTodayStock } from '../../../src/server/services/inventory.service.js';

export const E2E_DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://bbc:bbc@localhost:5432/bbc_e2e';
export const E2E_DATE = '2026-10-04';

let sharedPrisma: PrismaClient | null = null;

export function getE2EPrisma(): PrismaClient {
  if (!sharedPrisma) {
    sharedPrisma = createPrisma(E2E_DATABASE_URL);
  }
  return sharedPrisma;
}

export async function resetOrdersAndStock(): Promise<void> {
  const prisma = getE2EPrisma();

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany();
    await tx.order.deleteMany();
    await tx.$executeRaw`ALTER SEQUENCE order_number_seq RESTART WITH 1001`;
    await tx.menuItem.deleteMany({
      where: {
        name: {
          notIn: ['Chicken Biryani', 'Paneer Biryani', 'Raita', 'Egg Biryani'],
        },
      },
    });
    await tx.menuItem.updateMany({
      data: {
        dailyStock: 0,
        stockRemaining: 0,
        stockDate: null,
      },
    });

    // Restore settings
    await tx.deliverySettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        ordersPaused: false,
        expressEnabled: true,
        expressFee: 30,
        batchFee: 0,
        expressEtaMinMinutes: 30,
        expressEtaMaxMinutes: 40,
        expressOpensAt: '11:00',
        expressClosesAt: '23:00',
      },
      update: {
        ordersPaused: false,
        expressEnabled: true,
        expressFee: 30,
        batchFee: 0,
        expressEtaMinMinutes: 30,
        expressEtaMaxMinutes: 40,
        expressOpensAt: '11:00',
        expressClosesAt: '23:00',
      },
    });

    // Restore slots to default
    await tx.deliverySlot.updateMany({
      where: { location: { name: 'MSH' } },
      data: { deliveryTime: '20:00', cutoffTime: '19:30', isActive: true, closedOn: null },
    });
    await tx.deliverySlot.updateMany({
      where: { location: { name: 'Kanhar' } },
      data: { deliveryTime: '20:45', cutoffTime: '20:15', isActive: true, closedOn: null },
    });
  });

  // Reset stock
  const items = await prisma.menuItem.findMany({ where: { isActive: true } });
  const chicken = items.find((i) => i.name === 'Chicken Biryani');
  const paneer = items.find((i) => i.name === 'Paneer Biryani');
  const raita = items.find((i) => i.name === 'Raita');
  const egg = items.find((i) => i.name === 'Egg Biryani');

  const stockEntries: Array<{ menuItemId: number; stock: number }> = [];
  if (chicken) stockEntries.push({ menuItemId: chicken.id, stock: 30 });
  if (paneer) stockEntries.push({ menuItemId: paneer.id, stock: 20 });
  if (raita) stockEntries.push({ menuItemId: raita.id, stock: 10 });
  if (egg) stockEntries.push({ menuItemId: egg.id, stock: 0 });

  await prisma.$transaction((tx) => setTodayStock(tx, E2E_DATE, stockEntries));

  // Ensure isAvailable and prices match defaults
  if (chicken) await prisma.menuItem.update({ where: { id: chicken.id }, data: { price: 150, isAvailable: true } });
  if (paneer) await prisma.menuItem.update({ where: { id: paneer.id }, data: { price: 130, isAvailable: true } });
  if (raita) await prisma.menuItem.update({ where: { id: raita.id }, data: { price: 20, isAvailable: true } });
  if (egg) await prisma.menuItem.update({ where: { id: egg.id }, data: { price: 120, isAvailable: true } });
}

export async function setSlotCutoff(locationName: string, cutoffTime: string): Promise<void> {
  const prisma = getE2EPrisma();
  await prisma.deliverySlot.updateMany({
    where: { location: { name: locationName } },
    data: { cutoffTime },
  });
}

export async function setItemStock(name: string, stock: number): Promise<void> {
  const prisma = getE2EPrisma();
  const item = await prisma.menuItem.findFirst({ where: { name } });
  if (!item) throw new Error(`Item not found: ${name}`);
  await prisma.$transaction((tx) => setTodayStock(tx, E2E_DATE, [{ menuItemId: item.id, stock }]));
}

export async function setItemPrice(name: string, price: number): Promise<void> {
  const prisma = getE2EPrisma();
  await prisma.menuItem.updateMany({
    where: { name },
    data: { price },
  });
}

export async function setOrdersPaused(paused: boolean): Promise<void> {
  const prisma = getE2EPrisma();
  await prisma.deliverySettings.update({
    where: { id: 1 },
    data: { ordersPaused: paused },
  });
}

export async function setExpressEnabled(enabled: boolean): Promise<void> {
  const prisma = getE2EPrisma();
  await prisma.deliverySettings.update({
    where: { id: 1 },
    data: { expressEnabled: enabled },
  });
}

export async function countOrders(): Promise<number> {
  const prisma = getE2EPrisma();
  return prisma.order.count();
}

export async function getOrder(orderNumber: string) {
  const prisma = getE2EPrisma();
  return prisma.order.findUnique({
    where: { orderNumber },
    include: { items: true },
  });
}

export async function getFixtures() {
  const prisma = getE2EPrisma();
  const msh = await prisma.deliveryLocation.findUniqueOrThrow({
    where: { name: 'MSH' },
    include: { slots: true },
  });
  const kanhar = await prisma.deliveryLocation.findUniqueOrThrow({
    where: { name: 'Kanhar' },
    include: { slots: true },
  });
  const items = await prisma.menuItem.findMany({
    where: { isActive: true },
  });
  return { msh, kanhar, items };
}
