// Development data: sample menu stocked for today, plus the initial locations and slots.
// Never runs in production. Wipes orders, order items and menu items first.
import { loadDatabaseUrl } from '../src/server/config.js';
import { createPrisma, type PrismaClient } from '../src/server/db.js';
import { createClock } from '../src/server/lib/clock.js';
import { setTodayStock } from '../src/server/services/inventory.service.js';
import { nowIST, type Clock } from '../src/shared/time.js';
import { seedInitial } from './seed-initial.js';

// Placeholder prices (Batch 1 Q9). The real menu is entered by the vendor in the admin.
const SAMPLE_ITEMS = [
  { name: 'Chicken Biryani', description: 'Full plate with raita', price: 150, stock: 30 },
  { name: 'Paneer Biryani', description: null, price: 130, stock: 20 },
  { name: 'Egg Biryani', description: null, price: 120, stock: 20 },
  { name: 'Veg Biryani', description: null, price: 110, stock: 15 },
  { name: 'Raita', description: null, price: 20, stock: 40 },
  { name: 'Gulab Jamun', description: null, price: 30, stock: null }, // disabled
] as const;

export async function seedDev(prisma: PrismaClient, clock: Clock = createClock()): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev refuses to run when NODE_ENV=production.');
  }
  const today = nowIST(clock).date;

  await prisma.$transaction(async (tx) => {
    await tx.orderItem.deleteMany();
    await tx.order.deleteMany();
    await tx.menuItem.deleteMany();
    await tx.$executeRaw`ALTER SEQUENCE order_number_seq RESTART WITH 1001`;
  });

  await seedInitial(prisma);

  const stocked: Array<{ menuItemId: number; stock: number }> = [];
  for (const [sortOrder, item] of SAMPLE_ITEMS.entries()) {
    const created = await prisma.menuItem.create({
      data: {
        name: item.name,
        description: item.description,
        price: item.price,
        sortOrder,
        isAvailable: item.stock !== null,
      },
    });
    if (item.stock !== null) stocked.push({ menuItemId: created.id, stock: item.stock });
  }
  // Stock goes through the inventory service like everywhere else (Rule 4).
  await prisma.$transaction((tx) => setTodayStock(tx, today, stocked));
  console.log(`created  ${SAMPLE_ITEMS.length} sample menu items (stocked for today)`);
}

if (import.meta.main) {
  // Check before connecting to anything.
  if (process.env.NODE_ENV === 'production') {
    console.error('seed-dev refuses to run when NODE_ENV=production.');
    process.exit(1);
  }
  const prisma = createPrisma(loadDatabaseUrl(process.env));
  try {
    await seedDev(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
