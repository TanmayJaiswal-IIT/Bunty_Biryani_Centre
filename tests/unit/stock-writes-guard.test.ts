import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL_PATTERN =
  /UPDATE\s+menu_items[\s\S]{0,300}?\b(stock_remaining|daily_stock|stock_date)\b/i;
const PRISMA_PATTERN =
  /menuItem\.(update|updateMany|upsert|create|createMany)\([\s\S]{0,400}?\b(stockRemaining|dailyStock|stockDate)\b/;
const STATUS_SQL_PATTERN =
  /UPDATE\s+orders[\s\S]{0,300}?\b(status|payment_status|completed_at|cancelled_at|collected_at)\b/i;
const STATUS_PRISMA_PATTERN =
  /order\.(update|updateMany|upsert)\([\s\S]{0,400}?\b(status|paymentStatus|completedAt|cancelledAt|collectedAt)\b/;
const RAW_UNSAFE_PATTERN = /\$(queryRawUnsafe|executeRawUnsafe)\b/;

function collectFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'generated' || entry === 'node_modules' || entry === '.venv') {
          continue;
        }
        result.push(...collectFiles(full));
      } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
        result.push(full);
      }
    }
  } catch {
    // Directory might not exist (e.g. scripts/)
  }
  return result;
}

describe('Stock writes guard (Batch 5 §3)', () => {
  it('self-test: patterns catch known-bad snippets', () => {
    expect(SQL_PATTERN.test('UPDATE menu_items SET stock_remaining = 5')).toBe(true);
    expect(SQL_PATTERN.test('UPDATE menu_items SET daily_stock = 10')).toBe(true);
    expect(SQL_PATTERN.test('UPDATE menu_items SET stock_date = now()')).toBe(true);

    expect(PRISMA_PATTERN.test('prisma.menuItem.update({ data: { stockRemaining: 5 } })')).toBe(
      true,
    );
    expect(PRISMA_PATTERN.test('prisma.menuItem.create({ data: { dailyStock: 10 } })')).toBe(true);
    expect(PRISMA_PATTERN.test('tx.menuItem.upsert({ data: { stockDate: null } })')).toBe(true);

    expect(RAW_UNSAFE_PATTERN.test('prisma.$queryRawUnsafe("SELECT 1")')).toBe(true);
    expect(RAW_UNSAFE_PATTERN.test('tx.$executeRawUnsafe("DELETE FROM orders")')).toBe(true);

    expect(STATUS_SQL_PATTERN.test('UPDATE orders SET status = "COMPLETED"')).toBe(true);
    expect(STATUS_SQL_PATTERN.test('UPDATE orders SET payment_status = "COLLECTED"')).toBe(true);
    expect(STATUS_PRISMA_PATTERN.test('prisma.order.update({ data: { status: "COMPLETED" } })')).toBe(
      true,
    );
    expect(
      STATUS_PRISMA_PATTERN.test('tx.order.update({ data: { paymentStatus: "COLLECTED" } })'),
    ).toBe(true);
  });

  it('scans src/server/**/*.ts except inventory.service.ts and forbids direct stock writes', () => {
    const serverFiles = collectFiles(resolve('src/server')).filter(
      (f) => !f.endsWith('inventory.service.ts'),
    );

    const violations: { file: string; match: string }[] = [];
    for (const file of serverFiles) {
      const content = readFileSync(file, 'utf8');
      if (SQL_PATTERN.test(content)) {
        violations.push({ file, match: 'SQL direct stock update' });
      }
      if (PRISMA_PATTERN.test(content)) {
        violations.push({ file, match: 'Prisma direct stock write' });
      }
    }

    expect(violations).toEqual([]);
  });

  it('scans prisma/*.ts and scripts/** and forbids direct stock writes in production seeds', () => {
    const files = [...collectFiles(resolve('prisma')), ...collectFiles(resolve('scripts'))].filter(
      (f) => !f.endsWith('seed-dev.ts'), // seed-dev is dev-only and calls setTodayStock, but factory helpers in tests are separate
    );

    const violations: { file: string; match: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (SQL_PATTERN.test(content)) {
        violations.push({ file, match: 'SQL direct stock update' });
      }
      if (PRISMA_PATTERN.test(content)) {
        violations.push({ file, match: 'Prisma direct stock write' });
      }
    }

    expect(violations).toEqual([]);
  });

  it('forbids $queryRawUnsafe and $executeRawUnsafe everywhere outside generated code', () => {
    const allFiles = [
      ...collectFiles(resolve('src')),
      ...collectFiles(resolve('prisma')),
      ...collectFiles(resolve('scripts')),
    ];

    const violations: { file: string; match: string }[] = [];
    for (const file of allFiles) {
      const content = readFileSync(file, 'utf8');
      if (RAW_UNSAFE_PATTERN.test(content)) {
        violations.push({ file, match: 'Raw unsafe query/execute' });
      }
    }

    expect(violations).toEqual([]);
  });

  it('scans src/server/**/*.ts except status-machine.ts and forbids direct order status writes (Batch 7 §10)', () => {
    const serverFiles = collectFiles(resolve('src/server')).filter(
      (f) => !f.endsWith('status-machine.ts'),
    );

    const violations: { file: string; match: string }[] = [];
    for (const file of serverFiles) {
      const content = readFileSync(file, 'utf8');
      if (STATUS_SQL_PATTERN.test(content)) {
        violations.push({ file, match: 'SQL direct order status update' });
      }
      if (STATUS_PRISMA_PATTERN.test(content)) {
        violations.push({ file, match: 'Prisma direct order status write' });
      }
    }

    expect(violations).toEqual([]);
  });
});
