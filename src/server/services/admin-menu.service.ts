import { AppError } from '../lib/app-error.js';
import { nowIST } from '../../shared/time.js';
import type {
  MenuItemCreateOutput,
  MenuItemUpdateOutput,
  StockBulkOutput,
} from '../../shared/schemas/admin.js';
import type { AdminMenuItem } from '../../shared/schemas/admin-views.js';
import type { AdminDeps } from './admin-orders.service.js';
import { ADMIN_TX_OPTIONS } from './admin-orders.service.js';
import { toAdminMenuItem } from './admin-views.js';
import { setTodayStock } from './inventory.service.js';

/**
 * Lists all active menu items for admin.
 */
export async function listAdminMenu(deps: AdminDeps): Promise<AdminMenuItem[]> {
  const today = nowIST(deps.clock).date;
  const rows = await deps.prisma.menuItem.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
  return rows.map((r) => toAdminMenuItem(r, today));
}

/**
 * Creates a new menu item. sortOrder defaults to current max + 1.
 */
export async function createMenuItem(
  deps: AdminDeps,
  input: MenuItemCreateOutput,
): Promise<AdminMenuItem> {
  const today = nowIST(deps.clock).date;
  const agg = await deps.prisma.menuItem.aggregate({
    _max: { sortOrder: true },
  });
  const nextSortOrder = (agg._max.sortOrder ?? 0) + 1;

  const created = await deps.prisma.menuItem.create({
    data: {
      name: input.name,
      description: input.description,
      price: input.price,
      imageUrl: input.imageUrl,
      isAvailable: input.isAvailable ?? true,
      sortOrder: nextSortOrder,
    },
  });

  return toAdminMenuItem(created, today);
}

/**
 * Updates a menu item.
 */
export async function updateMenuItem(
  deps: AdminDeps,
  id: number,
  input: MenuItemUpdateOutput,
): Promise<AdminMenuItem> {
  const today = nowIST(deps.clock).date;
  const existing = await deps.prisma.menuItem.findFirst({
    where: { id, isActive: true },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Menu item not found.');
  }

  const updated = await deps.prisma.menuItem.update({
    where: { id },
    data: input,
  });

  return toAdminMenuItem(updated, today);
}

/**
 * Soft-deletes a menu item by setting isActive = false.
 */
export async function deleteMenuItem(deps: AdminDeps, id: number): Promise<void> {
  const existing = await deps.prisma.menuItem.findFirst({
    where: { id, isActive: true },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Menu item not found.');
  }

  await deps.prisma.menuItem.update({
    where: { id },
    data: { isActive: false },
  });
}

/**
 * Saves daily stock in bulk via inventory.service.
 * Returns only the updated items.
 */
export async function saveStock(
  deps: AdminDeps,
  input: StockBulkOutput,
): Promise<AdminMenuItem[]> {
  const today = nowIST(deps.clock).date;
  const entries = input.items.map((i) => ({
    menuItemId: i.menuItemId,
    stock: i.stock,
  }));

  await deps.prisma.$transaction(async (tx) => {
    await setTodayStock(tx, today, entries);
  }, ADMIN_TX_OPTIONS);

  const ids = input.items.map((i) => i.menuItemId);
  const rows = await deps.prisma.menuItem.findMany({
    where: { id: { in: ids } },
    orderBy: { id: 'asc' },
  });

  return rows.map((r) => toAdminMenuItem(r, today));
}
