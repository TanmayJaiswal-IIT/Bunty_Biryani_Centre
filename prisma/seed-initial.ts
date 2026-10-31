// Initial data: the two locations and their daily slots (brief §5). Safe to run in production,
// and safe to run twice: it only creates what is missing and never changes an existing row.
import { resolve } from 'node:path';
import { loadDatabaseUrl } from '../src/server/config.js';
import { createPrisma, type PrismaClient } from '../src/server/db.js';

const LOCATIONS = [
  { name: 'MSH', sortOrder: 0, deliveryTime: '20:00', cutoffTime: '19:30' },
  { name: 'Kanhar', sortOrder: 1, deliveryTime: '20:45', cutoffTime: '20:15' },
] as const;

export interface SeedResult {
  created: string[];
  skipped: string[];
}

export async function seedInitial(
  prisma: PrismaClient,
  log: (line: string) => void = console.log,
): Promise<SeedResult> {
  const result: SeedResult = { created: [], skipped: [] };

  for (const loc of LOCATIONS) {
    let location = await prisma.deliveryLocation.findUnique({ where: { name: loc.name } });
    if (location) {
      result.skipped.push(`location ${loc.name}`);
    } else {
      location = await prisma.deliveryLocation.create({
        data: { name: loc.name, sortOrder: loc.sortOrder },
      });
      result.created.push(`location ${loc.name}`);
    }

    const slotLabel = `slot ${loc.name} ${loc.deliveryTime}`;
    const slot = await prisma.deliverySlot.findUnique({
      where: {
        locationId_deliveryTime: { locationId: location.id, deliveryTime: loc.deliveryTime },
      },
    });
    if (slot) {
      result.skipped.push(slotLabel);
    } else {
      await prisma.deliverySlot.create({
        data: {
          locationId: location.id,
          deliveryTime: loc.deliveryTime,
          cutoffTime: loc.cutoffTime,
        },
      });
      result.created.push(slotLabel);
    }
  }

  for (const line of result.created) log(`created  ${line}`);
  for (const line of result.skipped) log(`skipped  ${line} (already exists)`);
  return result;
}

const isMain =
  Boolean(import.meta.main) ||
  (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]));

if (isMain) {
  const prisma = createPrisma(loadDatabaseUrl(process.env));
  try {
    await seedInitial(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
