import type { Prisma } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate } from '../lib/db-date.js';

// The only module that writes stock columns (daily_stock, stock_remaining, stock_date). Batch 1
// §7.5 has the SQL, §6.4 the rules S1-S8. Every function takes the caller's transaction, sorts its
// lines by menuItemId itself (one global lock order: order row first, then items ascending), and
// uses tagged-template SQL only.

type Tx = Prisma.TransactionClient;

export interface StockLine {
  menuItemId: number;
  quantity: number;
}

export interface ReservedItem {
  id: number;
  name: string;
  price: number;
}

export interface StockEntry {
  menuItemId: number;
  stock: number;
}

export interface StockRow {
  id: number;
  dailyStock: number;
  stockRemaining: number;
  stockDate: string;
}

const byMenuItemId = (a: { menuItemId: number }, b: { menuItemId: number }) =>
  a.menuItemId - b.menuItemId;

function assertQuantities(lines: readonly StockLine[]): void {
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new RangeError(`Invalid quantity ${String(line.quantity)} for item ${line.menuItemId}`);
    }
  }
}

/** Orderable quantity today: 0 unless the item is active, available and stocked for businessDate (MN2, S2). */
export function availableToday(
  item: {
    isActive: boolean;
    isAvailable: boolean;
    stockDate: Date | null;
    stockRemaining: number;
  },
  businessDate: string,
): number {
  if (!item.isActive || !item.isAvailable || item.stockDate === null) return 0;
  if (fromDbDate(item.stockDate) !== businessDate) return 0;
  return Math.max(0, item.stockRemaining);
}

/**
 * S4. Conditionally decrements each line in ascending menuItemId. Returns the rows in that order,
 * with name and price read from the UPDATE itself. A line that can't be served throws
 * OUT_OF_STOCK for that item; the caller's transaction rolls back every earlier decrement.
 */
export async function reserveStock(
  tx: Tx,
  businessDate: string,
  lines: readonly StockLine[],
): Promise<ReservedItem[]> {
  assertQuantities(lines);
  const reserved: ReservedItem[] = [];

  for (const line of [...lines].sort(byMenuItemId)) {
    const rows = await tx.$queryRaw<Array<{ id: number; name: string; price: number }>>`
      UPDATE menu_items
         SET stock_remaining = stock_remaining - ${line.quantity},
             updated_at      = now()
       WHERE id = ${line.menuItemId}
         AND is_active
         AND is_available
         AND stock_date = ${businessDate}::date
         AND stock_remaining >= ${line.quantity}
      RETURNING id, name, price, stock_remaining`;

    const row = rows[0];
    if (!row) {
      const current = await tx.menuItem.findUnique({ where: { id: line.menuItemId } });
      throw new AppError('OUT_OF_STOCK', 'Some items are out of stock.', {
        items: [
          {
            menuItemId: line.menuItemId,
            name: current?.name ?? '',
            available: current ? availableToday(current, businessDate) : 0,
          },
        ],
      });
    }
    reserved.push({ id: row.id, name: row.name, price: row.price });
  }

  return reserved;
}

/**
 * S5. The caller holds the order row lock. Adds each line back in ascending menuItemId, only where
 * the item is still stocked for the order's delivery date; other-day stock is left alone.
 */
export async function restoreStockForOrder(
  tx: Tx,
  order: { deliveryDate: string; items: readonly StockLine[] },
): Promise<{ restoredLines: number }> {
  assertQuantities(order.items);
  let restoredLines = 0;

  for (const line of [...order.items].sort(byMenuItemId)) {
    restoredLines += await tx.$executeRaw`
      UPDATE menu_items
         SET stock_remaining = stock_remaining + ${line.quantity},
             updated_at      = now()
       WHERE id = ${line.menuItemId}
         AND stock_date = ${order.deliveryDate}::date`;
  }

  return { restoredLines };
}

/**
 * S3. Sets today's stock, one statement per entry in ascending menuItemId. Units already sold today
 * stay sold; a new day starts from the new number. Collects every failure and throws after the loop
 * (STOCK_BELOW_SOLD wins over NOT_FOUND); the caller's transaction rolls everything back.
 */
export async function setTodayStock(
  tx: Tx,
  businessDate: string,
  entries: readonly StockEntry[],
): Promise<StockRow[]> {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.menuItemId)) {
      throw new RangeError(`Duplicate menuItemId ${entry.menuItemId}`);
    }
    seen.add(entry.menuItemId);
    if (!Number.isSafeInteger(entry.stock) || entry.stock < 0) {
      throw new RangeError(`Invalid stock ${String(entry.stock)} for item ${entry.menuItemId}`);
    }
  }

  const updated: StockRow[] = [];
  const belowSold: Array<{ menuItemId: number; sold: number }> = [];
  const notFound: Array<{ menuItemId: number }> = [];

  for (const entry of [...entries].sort(byMenuItemId)) {
    const rows = await tx.$queryRaw<
      Array<{ id: number; daily_stock: number; stock_remaining: number; stock_date: Date }>
    >`
      UPDATE menu_items
         SET daily_stock     = ${entry.stock},
             stock_remaining = CASE WHEN stock_date = ${businessDate}::date
                                    THEN ${entry.stock} - (daily_stock - stock_remaining)
                                    ELSE ${entry.stock} END,
             stock_date      = ${businessDate}::date,
             updated_at      = now()
       WHERE id = ${entry.menuItemId}
         AND is_active
         AND (stock_date IS DISTINCT FROM ${businessDate}::date
              OR ${entry.stock} >= daily_stock - stock_remaining)
      RETURNING id, daily_stock, stock_remaining, stock_date`;

    const row = rows[0];
    if (row) {
      updated.push({
        id: row.id,
        dailyStock: row.daily_stock,
        stockRemaining: row.stock_remaining,
        stockDate: fromDbDate(row.stock_date),
      });
      continue;
    }

    const current = await tx.menuItem.findUnique({ where: { id: entry.menuItemId } });
    if (!current || !current.isActive) {
      notFound.push({ menuItemId: entry.menuItemId });
    } else {
      belowSold.push({
        menuItemId: entry.menuItemId,
        sold: current.dailyStock - current.stockRemaining,
      });
    }
  }

  if (belowSold.length > 0) {
    throw new AppError(
      'STOCK_BELOW_SOLD',
      "Stock can't be lower than what has already been sold today.",
      { items: belowSold },
    );
  }
  if (notFound.length > 0) {
    throw new AppError('NOT_FOUND', 'Not found.', { items: notFound });
  }
  return updated;
}
