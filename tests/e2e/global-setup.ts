import { seedInitial } from '../../prisma/seed-initial.js';
import { createPrisma } from '../../src/server/db.js';
import { createAdmin } from '../../src/server/services/auth.service.js';
import { setTodayStock } from '../../src/server/services/inventory.service.js';
import { resetSchema } from '../helpers/reset-schema.js';
import { E2E_DATABASE_URL, E2E_DATE } from './helpers/db.js';

export const E2E_ADMIN_USERNAME = 'e2e_admin';
export const E2E_ADMIN_PASSWORD = 'e2e-password-12345';

export default async function globalSetup(): Promise<void> {
  console.log('\n[E2E Global Setup] Resetting e2e schema on', E2E_DATABASE_URL);
  await resetSchema(E2E_DATABASE_URL);

  const prisma = createPrisma(E2E_DATABASE_URL);
  try {
    console.log('[E2E Global Setup] Seeding initial delivery locations and slots');
    await seedInitial(prisma, () => {});

    console.log('[E2E Global Setup] Seeding default delivery settings');
    await prisma.deliverySettings.upsert({
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

    console.log('[E2E Global Setup] Creating e2e fixture menu items');
    const itemsData = [
      { name: 'Chicken Biryani', description: 'Full plate with raita', price: 150, sortOrder: 0, stock: 30 },
      { name: 'Paneer Biryani', description: 'Fresh cottage cheese', price: 130, sortOrder: 1, stock: 20 },
      { name: 'Raita', description: 'Cool spiced yogurt', price: 20, sortOrder: 2, stock: 10 },
      { name: 'Egg Biryani', description: 'Two boiled eggs', price: 120, sortOrder: 3, stock: 0 },
    ];

    const stockEntries: Array<{ menuItemId: number; stock: number }> = [];
    for (const item of itemsData) {
      const created = await prisma.menuItem.create({
        data: {
          name: item.name,
          description: item.description,
          price: item.price,
          sortOrder: item.sortOrder,
          isAvailable: true,
        },
      });
      stockEntries.push({ menuItemId: created.id, stock: item.stock });
    }

    console.log('[E2E Global Setup] Stocking items for date', E2E_DATE);
    await prisma.$transaction((tx) => setTodayStock(tx, E2E_DATE, stockEntries));

    console.log('[E2E Global Setup] Creating e2e admin account:', E2E_ADMIN_USERNAME);
    await createAdmin(prisma, E2E_ADMIN_USERNAME, E2E_ADMIN_PASSWORD);

    console.log('[E2E Global Setup] Completed successfully.\n');
  } finally {
    await prisma.$disconnect();
  }
}
