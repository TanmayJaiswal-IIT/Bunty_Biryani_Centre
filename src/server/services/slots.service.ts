import { AppError } from '../lib/app-error.js';
import { nowIST } from '../../shared/time.js';
import { toDbDate } from '../lib/db-date.js';
import type {
  SlotCreateOutput,
  SlotUpdateOutput,
} from '../../shared/schemas/admin.js';
import type { AdminSlot } from '../../shared/schemas/admin-views.js';
import type { AdminDeps } from './admin-orders.service.js';
import { ADMIN_TX_OPTIONS } from './admin-orders.service.js';
import { toAdminSlot } from './admin-views.js';

/**
 * Lists all delivery slots sorted by location sortOrder, deliveryTime, and slot id.
 */
export async function listSlots(deps: AdminDeps): Promise<AdminSlot[]> {
  const today = nowIST(deps.clock);
  const slots = await deps.prisma.deliverySlot.findMany({
    include: { location: true },
    orderBy: [
      { location: { sortOrder: 'asc' } },
      { deliveryTime: 'asc' },
      { id: 'asc' },
    ],
  });

  const counts = await deps.prisma.order.groupBy({
    by: ['slotId'],
    where: {
      deliveryDate: toDbDate(today.date),
      status: 'ORDER_RECEIVED',
      slotId: { not: null },
    },
    _count: { id: true },
  });

  const countMap = new Map<number, number>();
  for (const c of counts) {
    if (c.slotId !== null) {
      countMap.set(c.slotId, c._count.id);
    }
  }

  return slots.map((s) => toAdminSlot(s, today.date, countMap.get(s.id) ?? 0));
}

/**
 * Creates a new delivery slot.
 */
export async function createSlot(
  deps: AdminDeps,
  input: SlotCreateOutput,
): Promise<AdminSlot> {
  const location = await deps.prisma.deliveryLocation.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError('VALIDATION_ERROR', 'Location does not exist.', {
      fieldErrors: { locationId: ['Location does not exist.'] },
    });
  }

  const dup = await deps.prisma.deliverySlot.findFirst({
    where: {
      locationId: input.locationId,
      deliveryTime: input.deliveryTime,
    },
  });
  if (dup) {
    throw new AppError('DUPLICATE', 'A slot with this delivery time already exists for this location.', {
      field: 'deliveryTime',
    });
  }

  const created = await deps.prisma.deliverySlot.create({
    data: {
      locationId: input.locationId,
      deliveryTime: input.deliveryTime,
      cutoffTime: input.cutoffTime,
      isActive: input.isActive ?? true,
    },
    include: { location: true },
  });

  return toAdminSlot(created, nowIST(deps.clock).date, 0);
}

/**
 * Updates a delivery slot using row-level locking (Decision 6) to merge and validate cutoff < delivery.
 */
export async function updateSlot(
  deps: AdminDeps,
  id: number,
  input: SlotUpdateOutput,
): Promise<AdminSlot> {
  return await deps.prisma.$transaction(async (tx) => {
    // 1. Lock the row
    const rows = await tx.$queryRaw<
      Array<{
        id: number;
        location_id: number;
        delivery_time: string;
        cutoff_time: string;
        is_active: boolean;
        closed_on: Date | null;
      }>
    >`SELECT id, location_id, delivery_time, cutoff_time, is_active, closed_on FROM delivery_slots WHERE id = ${id} FOR UPDATE`;

    const [current] = rows;
    if (!current) {
      throw new AppError('NOT_FOUND', 'Slot not found.');
    }

    // 2. Merge patch
    const mergedDeliveryTime = input.deliveryTime ?? current.delivery_time;
    const mergedCutoffTime = input.cutoffTime ?? current.cutoff_time;

    // 3. Validate merged row
    if (mergedCutoffTime >= mergedDeliveryTime) {
      throw new AppError('VALIDATION_ERROR', 'Cutoff must be before the delivery time.', {
        fieldErrors: { cutoffTime: ['Cutoff must be before the delivery time.'] },
      });
    }

    if (input.deliveryTime !== undefined && input.deliveryTime !== current.delivery_time) {
      const dup = await tx.deliverySlot.findFirst({
        where: {
          locationId: current.location_id,
          deliveryTime: input.deliveryTime,
          id: { not: id },
        },
      });
      if (dup) {
        throw new AppError('DUPLICATE', 'A slot with this delivery time already exists for this location.', {
          field: 'deliveryTime',
        });
      }
    }

    const today = nowIST(deps.clock);
    let newClosedOn: Date | null | undefined = undefined;
    if (input.closedToday !== undefined) {
      newClosedOn = input.closedToday ? toDbDate(today.date) : null;
    }

    const updated = await tx.deliverySlot.update({
      where: { id },
      data: {
        ...(input.deliveryTime !== undefined ? { deliveryTime: input.deliveryTime } : {}),
        ...(input.cutoffTime !== undefined ? { cutoffTime: input.cutoffTime } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(newClosedOn !== undefined ? { closedOn: newClosedOn } : {}),
      },
      include: { location: true },
    });

    const openCount = await tx.order.count({
      where: {
        deliveryDate: toDbDate(today.date),
        status: 'ORDER_RECEIVED',
        slotId: id,
      },
    });

    return toAdminSlot(updated, today.date, openCount);
  }, ADMIN_TX_OPTIONS);
}
