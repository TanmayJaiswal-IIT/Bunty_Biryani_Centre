import { AppError } from '../lib/app-error.js';
import type {
  LocationCreateOutput,
  LocationUpdateOutput,
} from '../../shared/schemas/admin.js';
import type { AdminLocation } from '../../shared/schemas/admin-views.js';
import type { AdminDeps } from './admin-orders.service.js';

/**
 * Lists all locations with their active slotCount.
 */
export async function listLocations(deps: AdminDeps): Promise<AdminLocation[]> {
  const rows = await deps.prisma.deliveryLocation.findMany({
    include: {
      slots: {
        where: { isActive: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    slotCount: r.slots.length,
  }));
}

/**
 * Creates a new delivery location.
 * Checks for case-insensitive duplicate names -> 409 DUPLICATE { field: 'name' }.
 */
export async function createLocation(
  deps: AdminDeps,
  input: LocationCreateOutput,
): Promise<AdminLocation> {
  const trimmed = input.name.trim();

  const dup = await deps.prisma.deliveryLocation.findFirst({
    where: {
      name: { equals: trimmed, mode: 'insensitive' },
    },
  });
  if (dup) {
    throw new AppError('DUPLICATE', 'A location with this name already exists.', {
      field: 'name',
    });
  }

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const agg = await deps.prisma.deliveryLocation.aggregate({
      _max: { sortOrder: true },
    });
    sortOrder = (agg._max.sortOrder ?? 0) + 1;
  }

  const created = await deps.prisma.deliveryLocation.create({
    data: {
      name: trimmed,
      sortOrder,
    },
  });

  return {
    id: created.id,
    name: created.name,
    isActive: created.isActive,
    sortOrder: created.sortOrder,
    slotCount: 0,
  };
}

/**
 * Updates a delivery location.
 * Checks for case-insensitive duplicate names -> 409 DUPLICATE { field: 'name' }.
 */
export async function updateLocation(
  deps: AdminDeps,
  id: number,
  input: LocationUpdateOutput,
): Promise<AdminLocation> {
  const existing = await deps.prisma.deliveryLocation.findUnique({
    where: { id },
  });
  if (!existing) {
    throw new AppError('NOT_FOUND', 'Location not found.');
  }

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    const dup = await deps.prisma.deliveryLocation.findFirst({
      where: {
        name: { equals: trimmed, mode: 'insensitive' },
        id: { not: id },
      },
    });
    if (dup) {
      throw new AppError('DUPLICATE', 'A location with this name already exists.', {
        field: 'name',
      });
    }
  }

  const updated = await deps.prisma.deliveryLocation.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
    include: {
      slots: {
        where: { isActive: true },
      },
    },
  });

  return {
    id: updated.id,
    name: updated.name,
    isActive: updated.isActive,
    sortOrder: updated.sortOrder,
    slotCount: updated.slots.length,
  };
}
