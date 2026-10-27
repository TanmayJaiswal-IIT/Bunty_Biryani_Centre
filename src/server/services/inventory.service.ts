// Inventory service (Batch 1 §6.4, §7.5; Batch 5 §3).
// The only module allowed to write daily_stock, stock_remaining or stock_date (Rule 4).
// Every function takes a Prisma.TransactionClient and uses tagged-template raw SQL only (Rule 12).

import type { Prisma } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate } from '../lib/db-date.js';

export interface StockRow {
  id: number;
  dailyStock: number;
  stockRemaining: number;
  stockDate: string;
}

/**
 * Reserves stock for an order (Batch 1 S4, Batch 5 §3).
 * Sorts lines in ascending menuItemId order (Rule 6).
 * Returns name and price from the updated rows, so pricing uses the locked rows.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  businessDate: string,
  lines: { menuItemId: number; quantity: number }[],
): Promise<{ id: number; name: string; price: number }[]> {
  const sorted = [...lines].sort((a, b) => a.menuItemId - b.menuItemId);
  const reserved: { id: number; name: string; price: number }[] = [];

  for (const line of sorted) {
    const updated = await tx.$queryRaw<
      { id: number; name: string; price: number; stock_remaining: number }[]
    >`
      UPDATE menu_items
         SET stock_remaining = stock_remaining - ${line.quantity},
             updated_at      = now()
       WHERE id = ${line.menuItemId}
         AND is_active
         AND is_available
         AND stock_date = ${businessDate}::date
         AND stock_remaining >= ${line.quantity}
      RETURNING id, name, price, stock_remaining;
    `;

    if (updated.length === 0) {
      const item = await tx.menuItem.findUnique({
        where: { id: line.menuItemId },
      });
      const name = item?.name ?? 'Item';
      const available =
        item &&
        item.isActive &&
        item.isAvailable &&
        item.stockDate &&
        fromDbDate(item.stockDate) === businessDate
          ? Math.max(0, item.stockRemaining)
          : 0;

      const message =
        available === 0 ? `${name} just sold out.` : `Only ${available} ${name} left.`;
      throw new AppError('OUT_OF_STOCK', message, {
        items: [{ menuItemId: line.menuItemId, name, available }],
      });
    }

    const row = updated[0]!;
    reserved.push({ id: row.id, name: row.name, price: row.price });
  }

  return reserved;
}

/**
 * Restores stock when an order is cancelled (Batch 1 S5, Batch 5 §3).
 * Caller has locked the order row first.
 * Only restores if stock_date matches the order delivery date.
 */
export async function restoreStockForOrder(
  tx: Prisma.TransactionClient,
  order: { deliveryDate: string; items: { menuItemId: number; quantity: number }[] },
): Promise<{ restoredLines: number }> {
  const sorted = [...order.items].sort((a, b) => a.menuItemId - b.menuItemId);
  let restoredLines = 0;

  for (const line of sorted) {
    const updated = await tx.$executeRaw`
      UPDATE menu_items
         SET stock_remaining = stock_remaining + ${line.quantity},
             updated_at      = now()
       WHERE id = ${line.menuItemId}
         AND stock_date = ${order.deliveryDate}::date;
    `;
    if (updated > 0) restoredLines += 1;
  }

  return { restoredLines };
}

/**
 * Sets today's stock (Batch 1 S3, Batch 5 §3).
 * Single SQL statement per item handling both new day and adjusting today.
 * Rejects with STOCK_BELOW_SOLD if requested stock is less than sold today.
 */
export async function setTodayStock(
  tx: Prisma.TransactionClient,
  businessDate: string,
  entries: { menuItemId: number; stock: number }[],
): Promise<StockRow[]> {
  const sorted = [...entries].sort((a, b) => a.menuItemId - b.menuItemId);
  const missingIds: number[] = [];
  const belowSold: { menuItemId: number; sold: number }[] = [];
  const rows: StockRow[] = [];

  for (const entry of sorted) {
    const updated = await tx.$queryRaw<
      { id: number; daily_stock: number; stock_remaining: number; stock_date: Date }[]
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
      RETURNING id, daily_stock, stock_remaining, stock_date;
    `;

    if (updated.length === 0) {
      const item = await tx.menuItem.findUnique({
        where: { id: entry.menuItemId },
      });
      if (!item || !item.isActive) {
        missingIds.push(entry.menuItemId);
      } else {
        const sold =
          item.stockDate && fromDbDate(item.stockDate) === businessDate
            ? item.dailyStock - item.stockRemaining
            : 0;
        belowSold.push({ menuItemId: entry.menuItemId, sold });
      }
    } else {
      const row = updated[0]!;
      rows.push({
        id: row.id,
        dailyStock: row.daily_stock,
        stockRemaining: row.stock_remaining,
        stockDate: fromDbDate(row.stock_date),
      });
    }
  }

  if (belowSold.length > 0) {
    throw new AppError(
      'STOCK_BELOW_SOLD',
      'Cannot set stock below the quantity already sold today.',
      { items: belowSold },
    );
  }

  if (missingIds.length > 0) {
    throw new AppError('NOT_FOUND', `Menu item ${missingIds[0]} not found.`, {
      menuItemId: missingIds[0],
    });
  }

  return rows;
}
