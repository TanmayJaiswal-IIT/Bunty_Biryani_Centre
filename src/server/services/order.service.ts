// Order service (Batch 1 §6.12, Batch 5 §4–5).
// Creates orders with atomic stock reservation, idempotency, and concurrency protection.

import type { PublicOrderView } from '../../shared/api-types.js';
import type { DeliveryMode } from '../../shared/enums.js';
import { MAX_OPEN_ORDERS_PER_PHONE, MAX_QTY_PER_ITEM } from '../../shared/limits.js';
import { computeTotals } from '../../shared/pricing.js';
import {
  lookupSchema,
  publicOrderViewSchema,
  type CreateOrderOutput,
  type LookupOrderOutput,
} from '../../shared/schemas/order.js';
import {
  addMinutesIST,
  etaText,
  nowIST,
  type Clock,
  type IstNow,
} from '../../shared/time.js';
import type { Prisma, PrismaClient } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate, toDbDate } from '../lib/db-date.js';
import { isRetryableTxError, isUniqueViolation } from '../lib/db-errors.js';
import type { Logger } from '../lib/logger.js';
import {
  expressStatus,
  slotStatus,
  toSlotInput,
} from './delivery.service.js';
import { reserveStock } from './inventory.service.js';

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

/**
 * Computes express ETA window for an order.
 */
export function expressWindowFor(order: {
  deliveryMode: DeliveryMode;
  createdAt: Date;
  expressEtaMinMinutes: number | null;
  expressEtaMaxMinutes: number | null;
}): { from: string; to: string; etaText: string } | null {
  const isExpress = order.deliveryMode === 'EXPRESS';
  const hasWindow =
    isExpress &&
    order.expressEtaMinMinutes !== null &&
    order.expressEtaMaxMinutes !== null;

  return hasWindow
    ? {
        from: addMinutesIST(order.createdAt, order.expressEtaMinMinutes!),
        to: addMinutesIST(order.createdAt, order.expressEtaMaxMinutes!),
        etaText: etaText(order.expressEtaMinMinutes!, order.expressEtaMaxMinutes!),
      }
    : null;
}

/**
 * Transforms an internal Order row into the strict public view.
 * Omits internal id, phone and non-creation timestamps.
 */
export function toPublicOrderView(
  order: OrderWithItems,
  contactPhone: string | null,
): PublicOrderView {
  const view = {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    deliveryMode: order.deliveryMode,
    deliveryDate: fromDbDate(order.deliveryDate),
    locationName: order.locationName,
    slotDeliveryTime: order.slotDeliveryTime,
    expressWindow: expressWindowFor(order),
    customerName: order.customerName,
    addressDetail: order.addressDetail,
    items: order.items.map((i) => ({
      name: i.itemName,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    foodSubtotal: order.foodSubtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
    contactPhone: contactPhone ?? null,
  };

  return publicOrderViewSchema.parse(view);
}

/**
 * Creates an order following Batch 1 §6.12 and Batch 5 §4.
 */
export async function createOrder(
  deps: { prisma: PrismaClient; clock: Clock; logger: Logger },
  input: CreateOrderOutput,
  ctx: { reqId: string },
): Promise<{ order: PublicOrderView; replayed: boolean }> {
  // Step 1: Idempotency fast path outside transaction
  const existing = await deps.prisma.order.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { items: { orderBy: { id: 'asc' } } },
  });
  if (existing) {
    if (existing.customerPhone === input.customerPhone) {
      const settings = await deps.prisma.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
      return {
        order: toPublicOrderView(existing, settings.contactPhone),
        replayed: true,
      };
    }
    throw new AppError('IDEMPOTENCY_CONFLICT', 'Something went wrong. Please tap Place order again.');
  }

  // Same business timestamp used across retries so a retry doesn't drift past cutoff (Batch 5 §4 step 6)
  const today: IstNow = nowIST(deps.clock);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const created = await deps.prisma.$transaction(
        async (tx) => {
          // 3.1: Settings and pause check
          const settings = await tx.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
          if (settings.ordersPaused) {
            throw new AppError('ORDERS_PAUSED', 'Orders are temporarily paused. Please check again shortly.');
          }

          // 3.2: Merge duplicate items
          const mergedMap = new Map<number, number>();
          for (const line of input.items) {
            const cur = mergedMap.get(line.menuItemId) ?? 0;
            const sum = cur + line.quantity;
            if (sum > MAX_QTY_PER_ITEM) {
              throw new AppError('VALIDATION_ERROR', 'Quantity exceeds maximum per item', {
                fieldErrors: { items: [`Cannot order more than ${MAX_QTY_PER_ITEM} of this item`] },
              });
            }
            mergedMap.set(line.menuItemId, sum);
          }

          const mergedLines: { menuItemId: number; quantity: number }[] = [];
          const seen = new Set<number>();
          for (const line of input.items) {
            if (!seen.has(line.menuItemId)) {
              seen.add(line.menuItemId);
              mergedLines.push({ menuItemId: line.menuItemId, quantity: mergedMap.get(line.menuItemId)! });
            }
          }

          // 3.4: Delivery rules
          let locationName = '';
          let slotDeliveryTime: string | null = null;

          if (input.deliveryMode === 'BATCH') {
            const slot = await tx.deliverySlot.findUnique({
              where: { id: input.slotId },
              include: { location: true },
            });
            if (!slot) {
              throw new AppError('VALIDATION_ERROR', 'Delivery slot not found.', {
                fieldErrors: { slotId: ['Delivery slot not found.'] },
              });
            }
            if (slot.locationId !== input.locationId) {
              throw new AppError('VALIDATION_ERROR', 'Slot does not belong to this location.', {
                fieldErrors: { slotId: ['Slot does not belong to this location.'] },
              });
            }
            if (!slot.location.isActive) {
              throw new AppError('LOCATION_UNAVAILABLE', 'Delivery to this location is not available right now.');
            }
            const status = slotStatus(toSlotInput(slot), slot.location, today);
            if (!status.isOpen) {
              const express = expressStatus(settings, today);
              throw new AppError('SLOT_CLOSED', 'This delivery slot is closed.', {
                reason: status.closedReason,
                expressAvailable: express.available,
              });
            }
            locationName = slot.location.name;
            slotDeliveryTime = slot.deliveryTime;
          } else {
            const express = expressStatus(settings, today);
            if (!express.available) {
              throw new AppError('EXPRESS_UNAVAILABLE', 'Express delivery is currently unavailable.', {
                reason: express.unavailableReason,
              });
            }
            const location = await tx.deliveryLocation.findUnique({
              where: { id: input.locationId },
            });
            if (!location) {
              throw new AppError('VALIDATION_ERROR', 'Delivery location not found.', {
                fieldErrors: { locationId: ['Delivery location not found.'] },
              });
            }
            if (!location.isActive) {
              throw new AppError('LOCATION_UNAVAILABLE', 'Delivery to this location is not available right now.');
            }
            locationName = location.name;
          }

          // 3.5: Per-phone open orders cap
          const openCount = await tx.order.count({
            where: {
              customerPhone: input.customerPhone,
              deliveryDate: toDbDate(today.date),
              status: 'ORDER_RECEIVED',
            },
          });
          if (openCount >= MAX_OPEN_ORDERS_PER_PHONE) {
            throw new AppError(
              'TOO_MANY_OPEN_ORDERS',
              `You already have ${MAX_OPEN_ORDERS_PER_PHONE} orders waiting for delivery today.`,
              { limit: MAX_OPEN_ORDERS_PER_PHONE },
            );
          }

          // 3.6: Item pre-check
          const itemIds = mergedLines.map((l) => l.menuItemId);
          const loadedItems = await tx.menuItem.findMany({
            where: { id: { in: itemIds } },
          });
          const itemMap = new Map(loadedItems.map((i) => [i.id, i]));

          const unavailableIds: number[] = [];
          for (const id of itemIds) {
            const it = itemMap.get(id);
            if (!it || !it.isActive || !it.isAvailable) {
              unavailableIds.push(id);
            }
          }
          if (unavailableIds.length > 0) {
            throw new AppError('ITEM_UNAVAILABLE', 'Some items are no longer available.', {
              items: unavailableIds.map((menuItemId) => ({ menuItemId })),
            });
          }

          const outOfStockItems: { menuItemId: number; name: string; available: number }[] = [];
          for (const line of mergedLines) {
            const it = itemMap.get(line.menuItemId)!;
            const available =
              it.stockDate && fromDbDate(it.stockDate) === today.date
                ? Math.max(0, it.stockRemaining)
                : 0;
            if (available < line.quantity) {
              outOfStockItems.push({
                menuItemId: line.menuItemId,
                name: it.name,
                available,
              });
            }
          }
          if (outOfStockItems.length > 0) {
            const msg =
              outOfStockItems.length === 1 && outOfStockItems[0]!.available === 0
                ? `${outOfStockItems[0]!.name} just sold out.`
                : 'Some items do not have enough stock.';
            throw new AppError('OUT_OF_STOCK', msg, { items: outOfStockItems });
          }

          // 3.7: Authoritative stock reservation
          const reserved = await reserveStock(tx, today.date, mergedLines);

          // 3.8: Totals
          const priceMap = new Map(reserved.map((r) => [r.id, r]));
          const pricedLines = mergedLines.map((line) => {
            const r = priceMap.get(line.menuItemId)!;
            return {
              menuItemId: line.menuItemId,
              name: r.name,
              unitPrice: r.price,
              quantity: line.quantity,
              lineTotal: r.price * line.quantity,
            };
          });

          const deliveryFee =
            input.deliveryMode === 'BATCH' ? settings.batchFee : settings.expressFee;
          const totals = computeTotals(pricedLines, deliveryFee);

          // 3.9: Price check
          if (totals.total !== input.expectedTotal) {
            throw new AppError('PRICE_CHANGED', 'Prices changed since you opened the menu.', {
              total: totals.total,
            });
          }

          // 3.10: Insert order with snapshots
          const newOrder = await tx.order.create({
            data: {
              clientRequestId: input.clientRequestId,
              status: 'ORDER_RECEIVED',
              paymentMethod: 'COD',
              paymentStatus: 'PENDING',
              deliveryMode: input.deliveryMode,
              deliveryDate: toDbDate(today.date),
              locationId: input.locationId,
              locationName,
              slotId: input.deliveryMode === 'BATCH' ? input.slotId : null,
              slotDeliveryTime,
              expressEtaMinMinutes:
                input.deliveryMode === 'EXPRESS' ? settings.expressEtaMinMinutes : null,
              expressEtaMaxMinutes:
                input.deliveryMode === 'EXPRESS' ? settings.expressEtaMaxMinutes : null,
              customerName: input.customerName,
              customerPhone: input.customerPhone,
              addressDetail: input.addressDetail ?? null,
              foodSubtotal: totals.foodSubtotal,
              deliveryFee: totals.deliveryFee,
              total: totals.total,
              createdAt: today.instant,
              items: {
                create: pricedLines.map((l) => ({
                  menuItemId: l.menuItemId,
                  itemName: l.name,
                  unitPrice: l.unitPrice,
                  quantity: l.quantity,
                  lineTotal: l.lineTotal,
                })),
              },
            },
            include: { items: { orderBy: { id: 'asc' } } },
          });

          return { order: newOrder, settings };
        },
        { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 10_000 },
      );

      deps.logger.info('order.created', {
        reqId: ctx.reqId,
        orderNumber: created.order.orderNumber,
        deliveryMode: created.order.deliveryMode,
        total: created.order.total,
      });

      return {
        order: toPublicOrderView(created.order, created.settings.contactPhone),
        replayed: false,
      };
    } catch (err) {
      // Step 4: Unique violation check (concurrent duplicate won)
      if (isUniqueViolation(err)) {
        const winner = await deps.prisma.order.findUnique({
          where: { clientRequestId: input.clientRequestId },
          include: { items: { orderBy: { id: 'asc' } } },
        });
        if (winner) {
          if (winner.customerPhone === input.customerPhone) {
            const settings = await deps.prisma.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
            return {
              order: toPublicOrderView(winner, settings.contactPhone),
              replayed: true,
            };
          }
          throw new AppError('IDEMPOTENCY_CONFLICT', 'Something went wrong. Please tap Place order again.');
        }
        throw err;
      }

      // Step 5: Rejection re-check
      if (err instanceof AppError) {
        deps.logger.info('order.rejected', { reqId: ctx.reqId, code: err.code });
        const winner = await deps.prisma.order.findUnique({
          where: { clientRequestId: input.clientRequestId },
          include: { items: { orderBy: { id: 'asc' } } },
        });
        if (winner) {
          if (winner.customerPhone === input.customerPhone) {
            const settings = await deps.prisma.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
            return {
              order: toPublicOrderView(winner, settings.contactPhone),
              replayed: true,
            };
          }
          throw new AppError('IDEMPOTENCY_CONFLICT', 'Something went wrong. Please tap Place order again.');
        }
        throw err;
      }

      // Step 6: Deadlock or serialization retry
      if (attempt === 0 && isRetryableTxError(err)) {
        deps.logger.warn('order.retry', { reqId: ctx.reqId });
        continue;
      }

      throw err;
    }
  }

  throw new AppError('INTERNAL_ERROR', 'Could not process order. Please try again.');
}

/**
 * Looks up an order by orderNumber + customerPhone (Batch 1 §8.4, Batch 5 §5).
 */
export async function lookupOrder(
  prisma: PrismaClient,
  input: LookupOrderOutput,
): Promise<PublicOrderView> {
  const normalized = lookupSchema.parse(input);
  const order = await prisma.order.findUnique({
    where: { orderNumber: normalized.orderNumber },
    include: { items: { orderBy: { id: 'asc' } } },
  });

  if (!order || order.customerPhone !== normalized.phone) {
    throw new AppError(
      'ORDER_NOT_FOUND',
      "We couldn't find an order with that ID and mobile number.",
    );
  }

  const settings = await prisma.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
  return toPublicOrderView(order, settings.contactPhone);
}
