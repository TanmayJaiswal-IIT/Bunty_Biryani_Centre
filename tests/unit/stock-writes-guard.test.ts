import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Stock columns are written only in inventory.service.ts (S7, Batch 5 §3). This is a heuristic
// backed by code review; the self-test below keeps the patterns from passing vacuously.
const SQL_STOCK_WRITE =
  /UPDATE\s+menu_items[\s\S]{0,300}?\b(stock_remaining|daily_stock|stock_date)\b/i;
const PRISMA_STOCK_WRITE =
  /menuItem\.(update|updateMany|upsert|create|createMany)\([\s\S]{0,400}?\b(stockRemaining|dailyStock|stockDate)\b/;

const ROOT = process.cwd();

function posix(p: string): string {
  return p.split('\\').join('/');
}

function walk(dir: string, recursive: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && entry.name !== 'node_modules') walk(full, recursive, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const isGenerated = (file: string) =>
  posix(relative(ROOT, file)).startsWith('src/server/generated/');
const isInventoryService = (file: string) =>
  posix(relative(ROOT, file)) === 'src/server/services/inventory.service.ts';

const stockScanned = [
  ...walk(join(ROOT, 'src/server'), true),
  ...walk(join(ROOT, 'prisma'), false),
  ...walk(join(ROOT, 'scripts'), true),
].filter((f) => !isGenerated(f) && !isInventoryService(f));

const unsafeScanned = [
  ...walk(join(ROOT, 'src'), true),
  ...walk(join(ROOT, 'prisma'), false),
  ...walk(join(ROOT, 'scripts'), true),
].filter((f) => !isGenerated(f));

describe('stock-writes guard', () => {
  it('#35 no file outside inventory.service.ts writes stock columns', () => {
    expect(stockScanned.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of stockScanned) {
      const text = readFileSync(file, 'utf8');
      if (SQL_STOCK_WRITE.test(text)) offenders.push(`${posix(relative(ROOT, file))} (SQL)`);
      if (PRISMA_STOCK_WRITE.test(text)) offenders.push(`${posix(relative(ROOT, file))} (Prisma)`);
    }
    expect(
      offenders,
      `stock columns written outside inventory.service.ts: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('G1 no unsafe raw SQL anywhere outside generated code', () => {
    expect(unsafeScanned.length).toBeGreaterThan(20);
    const offenders = unsafeScanned
      .filter((file) => /\$(query|execute)RawUnsafe/.test(readFileSync(file, 'utf8')))
      .map((file) => posix(relative(ROOT, file)));
    expect(offenders, `unsafe raw SQL in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('G2 the patterns match known-bad snippets and ignore a harmless update', () => {
    expect(SQL_STOCK_WRITE.test('UPDATE menu_items SET stock_remaining = 0')).toBe(true);
    expect(
      PRISMA_STOCK_WRITE.test('tx.menuItem.update({ where: { id }, data: { stockRemaining: 0 } })'),
    ).toBe(true);
    expect(
      PRISMA_STOCK_WRITE.test('tx.menuItem.update({ where: { id }, data: { price: 10 } })'),
    ).toBe(false);
  });
});
