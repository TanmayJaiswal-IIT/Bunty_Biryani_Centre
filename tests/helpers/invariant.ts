import { expect } from 'vitest';
import type { PrismaClient } from '../../src/server/db.js';

export async function assertInventoryInvariant(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT m.id, m.daily_stock, m.stock_remaining, COALESCE(s.qty, 0) AS sold_by_orders
      FROM menu_items m
      LEFT JOIN (
            SELECT oi.menu_item_id, o.delivery_date, SUM(oi.quantity)::int AS qty
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
             WHERE o.status <> 'CANCELLED'
             GROUP BY oi.menu_item_id, o.delivery_date
           ) s ON s.menu_item_id = m.id AND s.delivery_date = m.stock_date
     WHERE m.stock_remaining < 0
        OR m.stock_remaining > m.daily_stock
        OR (m.stock_date IS NOT NULL
            AND m.daily_stock - m.stock_remaining <> COALESCE(s.qty, 0))
  `;
  expect(rows).toEqual([]);
}
