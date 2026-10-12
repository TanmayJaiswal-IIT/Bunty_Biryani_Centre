import type { PublicOrderView } from '../../shared/api-types.js';
import type {
  DeliveryMode,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../shared/enums.js';
import { MAX_OPEN_ORDERS_PER_PHONE, MAX_QTY_PER_ITEM } from '../../shared/limits.js';
import { computeTotals } from '../../shared/pricing.js';
import type { CreateOrderOutput, LookupOutput } from '../../shared/schemas/order.js';
import { addMinutesIST, etaText, nowIST, type Clock } from '../../shared/time.js';
import { Prisma, type PrismaClient } from '../db.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate, toDbDate } from '../lib/db-date.js';
import { isRetryableTxError, isUniqueViolation } from '../lib/db-errors.js';
import type { Logger } from '../lib/logger.js';
import {
  expressStatus,
  slotStatus,
  toSlotInput,
  type SettingsInput,
  type Today,
} from './delivery.service.js';
import { availableToday, reserveStock, type StockLine } from './inventory.service.js';

// Order creation (Batch 5 §4, which implements Batch 1 §6.12). Step numbers in this file are
// Batch 5 §4's: 1 the idempotency fast path, 2–3 the transaction (3.1–3.10), 4–6 the fallbacks.
// The server decides prices, the fee, the total, stock and whether the slot or express is open;
// the client's expectedTotal is only compared. Every business check, the stock reservation and
// the insert (3.1–3.10) run in one Read Committed transaction, so a rejection leaves no order and
// no stock change. The clientRequestId lookups run outside it on purpose: step 1 before it (so a
// retry gets its order even if orders were paused since, D19), steps 4–5 after it rolled back.
// Messages are customer-safe; the client shows its own copy per code.

type Tx = Prisma.TransactionClient;

export interface OrderDeps {
  prisma: PrismaClient;
  clock: Clock;
  logger: Logger;
}

/** What the public view needs. A Prisma `Order & { items: OrderItem[] }` satisfies it. */
export interface OrderForView {
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  deliveryMode: DeliveryMode;
  deliveryDate: Date;
  locationName: string;
  slotDeliveryTime: string | null;
  expressEtaMinMinutes: number | null;
  expressEtaMaxMinutes: number | null;
  customerName: string;
  addressDetail: string | null;
  foodSubtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: Date;
  items: Array<{
    id: number;
    itemName: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
}

const VALIDATION_MESSAGE = 'Please check the highlighted fields.';

function fieldError(field: 'slotId' | 'locationId' | 'items', message: string): AppError {
  return new AppError('VALIDATION_ERROR', VALIDATION_MESSAGE, {
    fieldErrors: { [field]: [message] },
  });
}

/**
 * E4: an express order's delivery window is `createdAt + min` to `createdAt + max` minutes, in IST,
 * from the ETA the order snapshotted. Null for batch orders. Shared by the customer and admin views.
 */
export function expressWindowFor(
  order: Pick<
    OrderForView,
    'deliveryMode' | 'expressEtaMinMinutes' | 'expressEtaMaxMinutes' | 'createdAt'
  >,
): { from: string; to: string; etaText: string } | null {
  const min = order.expressEtaMinMinutes;
  const max = order.expressEtaMaxMinutes;
  if (order.deliveryMode !== 'EXPRESS' || min === null || max === null) return null;
  return {
    from: addMinutesIST(order.createdAt, min),
    to: addMinutesIST(order.createdAt, max),
    etaText: etaText(min, max),
  };
}

/**
 * Batch 1 §8.4. Fields are picked one by one, so the internal id, the phone, the request id and
 * the other timestamps can't reach the response. Items follow `order_items.id` (the cart order).
 */
export function toPublicOrderView(
  order: OrderForView,
  contactPhone: string | null,
): PublicOrderView {
  return {
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
    items: [...order.items]
      .sort((a, b) => a.id - b.id)
      .map((item) => ({
        name: item.itemName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
    foodSubtotal: order.foodSubtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    createdAt: order.createdAt.toISOString(),
    contactPhone,
  };
}

/** Sums duplicate menuItemIds; each item keeps its first position. */
export function mergeLines(lines: readonly StockLine[]): StockLine[] {
  const merged = new Map<number, number>();
  for (const { menuItemId, quantity } of lines) {
    merged.set(menuItemId, (merged.get(menuItemId) ?? 0) + quantity);
  }
  return [...merged].map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

const withItems = { items: { orderBy: { id: 'asc' } } } satisfies Prisma.OrderInclude;

function findByRequestId(prisma: PrismaClient, clientRequestId: string) {
  return prisma.order.findUnique({ where: { clientRequestId }, include: withItems });
}

type StoredOrder = NonNullable<Awaited<ReturnType<typeof findByRequestId>>>;

/** Step 1's rules: the same phone gets its order back; anyone else reusing the id is refused. */
async function replayOrConflict(
  prisma: PrismaClient,
  existing: StoredOrder,
  customerPhone: string,
): Promise<{ order: PublicOrderView; replayed: true }> {
  if (existing.customerPhone !== customerPhone) {
    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      'Something went wrong. Please tap Place order again.',
    );
  }
  const settings = await prisma.deliverySettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { contactPhone: true },
  });
  return { order: toPublicOrderView(existing, settings.contactPhone), replayed: true };
}

/** Delivery rules (step 3.4), on rows read inside the transaction. */
async function resolveDelivery(
  tx: Tx,
  input: CreateOrderOutput,
  settings: Pick<SettingsInput, 'expressEnabled' | 'expressOpensAt' | 'expressClosesAt'>,
  today: Today,
) {
  const express = expressStatus(settings, today);

  if (input.deliveryMode === 'BATCH') {
    const slot = await tx.deliverySlot.findUnique({
      where: { id: input.slotId },
      include: { location: true },
    });
    if (!slot || slot.locationId !== input.locationId) {
      throw fieldError('slotId', 'Choose a delivery slot');
    }
    if (!slot.location.isActive) throw locationUnavailable();
    const status = slotStatus(toSlotInput(slot), slot.location, today);
    if (!status.isOpen) {
      throw new AppError('SLOT_CLOSED', 'Orders for this delivery slot are closed.', {
        reason: status.closedReason,
        expressAvailable: express.available,
      });
    }
    return { location: slot.location, slot };
  }

  if (!express.available) {
    throw new AppError('EXPRESS_UNAVAILABLE', 'Express delivery is currently unavailable.', {
      reason: express.unavailableReason,
    });
  }
  const location = await tx.deliveryLocation.findUnique({ where: { id: input.locationId } });
  if (!location) throw fieldError('locationId', 'Choose where to deliver');
  if (!location.isActive) throw locationUnavailable();
  return { location, slot: null };
}

function locationUnavailable(): AppError {
  return new AppError(
    'LOCATION_UNAVAILABLE',
    "Delivery to this location isn't available right now. Please choose another.",
  );
}

/** Item pre-check (step 3.6): every unavailable id first, else every short item. */
async function precheckItems(tx: Tx, lines: readonly StockLine[], businessDate: string) {
  const ids = lines.map((l) => l.menuItemId);
  const rows = await tx.menuItem.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ascending = [...lines].sort((a, b) => a.menuItemId - b.menuItemId);

  const unavailable = ascending.filter((line) => {
    const item = byId.get(line.menuItemId);
    return !item || !item.isActive || !item.isAvailable;
  });
  if (unavailable.length > 0) {
    throw new AppError('ITEM_UNAVAILABLE', 'Some items are no longer available.', {
      items: unavailable.map((line) => ({ menuItemId: line.menuItemId })),
    });
  }

  const short = ascending.flatMap((line) => {
    const item = byId.get(line.menuItemId)!;
    const available = availableToday(item, businessDate);
    return available < line.quantity ? [{ menuItemId: item.id, name: item.name, available }] : [];
  });
  if (short.length > 0) {
    throw new AppError('OUT_OF_STOCK', 'Some items are out of stock.', { items: short });
  }
}

/**
 * Steps 3.1–3.10, in order, inside the caller's transaction. Any AppError rolls the
 * transaction back, so stock reserved in step 3.7 is returned when a later step rejects.
 */
async function placeOrderTx(tx: Tx, input: CreateOrderOutput, clock: Clock) {
  // 3.1 pause
  const settings = await tx.deliverySettings.findUniqueOrThrow({ where: { id: 1 } });
  if (settings.ordersPaused) {
    throw new AppError(
      'ORDERS_PAUSED',
      'Orders are temporarily paused. Please check again shortly.',
    );
  }

  // 3.2 merge duplicate lines, then re-check the per-item cap
  const lines = mergeLines(input.items);
  if (lines.some((line) => line.quantity > MAX_QTY_PER_ITEM)) {
    throw fieldError('items', `Max ${MAX_QTY_PER_ITEM} of each item per order`);
  }

  // 3.3 one "now" for every check and timestamp in this order
  const today = nowIST(clock);
  const deliveryDate = toDbDate(today.date);

  // 3.4 delivery rules
  const { location, slot } = await resolveDelivery(tx, input, settings, today);

  // 3.5 per-phone cap (soft: two simultaneous requests can both pass)
  const open = await tx.order.count({
    where: { customerPhone: input.customerPhone, deliveryDate, status: 'ORDER_RECEIVED' },
  });
  if (open >= MAX_OPEN_ORDERS_PER_PHONE) {
    throw new AppError(
      'TOO_MANY_OPEN_ORDERS',
      `You already have ${MAX_OPEN_ORDERS_PER_PHONE} orders waiting for delivery today.`,
      { limit: MAX_OPEN_ORDERS_PER_PHONE },
    );
  }

  // 3.6 pre-check, 3.7 authoritative reservation (prices come from the locked rows)
  await precheckItems(tx, lines, today.date);
  const reserved = new Map(
    (await reserveStock(tx, today.date, lines)).map((item) => [item.id, item]),
  );
  const priced = lines.map((line) => {
    const item = reserved.get(line.menuItemId)!;
    return {
      menuItemId: line.menuItemId,
      itemName: item.name,
      unitPrice: item.price,
      quantity: line.quantity,
      lineTotal: item.price * line.quantity,
    };
  });

  // 3.8 totals, 3.9 the customer never pays more than they saw
  const fee = input.deliveryMode === 'BATCH' ? settings.batchFee : settings.expressFee;
  const totals = computeTotals(priced, fee);
  if (totals.total !== input.expectedTotal) {
    throw new AppError('PRICE_CHANGED', 'Prices changed. Please check the new total.', {
      total: totals.total,
    });
  }

  // 3.10 insert with snapshots; the database fills orderNumber
  const isBatch = input.deliveryMode === 'BATCH';
  const order = await tx.order.create({
    data: {
      clientRequestId: input.clientRequestId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      addressDetail: input.addressDetail,
      deliveryMode: input.deliveryMode,
      deliveryDate,
      locationId: location.id,
      locationName: location.name,
      slotId: slot?.id ?? null,
      slotDeliveryTime: slot?.deliveryTime ?? null,
      expressEtaMinMinutes: isBatch ? null : settings.expressEtaMinMinutes,
      expressEtaMaxMinutes: isBatch ? null : settings.expressEtaMaxMinutes,
      foodSubtotal: totals.foodSubtotal,
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      createdAt: today.instant,
      items: { create: priced },
    },
    include: withItems,
  });

  return { order, contactPhone: settings.contactPhone };
}

const TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 10_000,
};

/**
 * Steps 2–3: the transaction. Step 6: a deadlock or serialization failure runs the whole
 * transaction once more. With the fixed lock order that shouldn't happen, hence the warning.
 * The retry reuses the first attempt's instant (step 3.3: one "now" per order), so the safety net
 * can't push an order past a cutoff or into the next business day.
 */
async function placeWithRetry(deps: OrderDeps, input: CreateOrderOutput, reqId: string) {
  let instant: Date | undefined;
  const clock: Clock = {
    now: () => {
      instant ??= deps.clock.now();
      return instant;
    },
  };
  const attempt = () =>
    deps.prisma.$transaction((tx) => placeOrderTx(tx, input, clock), TX_OPTIONS);
  try {
    return await attempt();
  } catch (err) {
    if (!isRetryableTxError(err)) throw err;
    deps.logger.warn('order.retry', { reqId });
    return await attempt();
  }
}

/**
 * Steps 4–5 (Batch 1 §6.12 steps 13–14), once the last attempt has rolled back. A unique
 * violation, or a rejection from an overlapping retry that waited on the original's row locks and
 * then saw its effects (stock gone, cap reached), can mean an order with this clientRequestId was
 * committed meanwhile. Look it up once more: found → step 1's rules; otherwise the original error.
 */
async function replayIfPlaced(
  prisma: PrismaClient,
  input: CreateOrderOutput,
  err: unknown,
): Promise<{ order: PublicOrderView; replayed: true }> {
  if (err instanceof AppError || isUniqueViolation(err)) {
    const winner = await findByRequestId(prisma, input.clientRequestId);
    if (winner) return replayOrConflict(prisma, winner, input.customerPhone);
  }
  throw err;
}

/**
 * `POST /api/orders/lookup` (Batch 5 §5). An unknown order number and a wrong phone leave through
 * the same throw, so the two answers can't differ in status or body (Batch 1 §9.3: stops
 * enumeration of sequential order numbers).
 */
export async function lookupOrder(
  prisma: PrismaClient,
  input: LookupOutput,
): Promise<PublicOrderView> {
  const order = await prisma.order.findUnique({
    where: { orderNumber: input.orderNumber },
    include: withItems,
  });
  if (!order || order.customerPhone !== input.phone) {
    throw new AppError(
      'ORDER_NOT_FOUND',
      "We couldn't find an order with that ID and mobile number.",
    );
  }
  const settings = await prisma.deliverySettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { contactPhone: true },
  });
  return toPublicOrderView(order, settings.contactPhone);
}

/**
 * `POST /api/orders`. Idempotent on clientRequestId, also when requests overlap: the same phone
 * gets the stored order back, even if orders were paused since (D19) or the request lost a race
 * to its own duplicate (steps 4–5). `order.rejected` is logged once, for the error finally
 * returned; a rejection that turns into a replay isn't one.
 */
export async function createOrder(
  deps: OrderDeps,
  input: CreateOrderOutput,
  ctx: { reqId: string },
): Promise<{ order: PublicOrderView; replayed: boolean }> {
  const { prisma, logger } = deps;
  try {
    // Step 1: idempotency fast path, before the transaction and before the pause check.
    const existing = await findByRequestId(prisma, input.clientRequestId);
    if (existing) return await replayOrConflict(prisma, existing, input.customerPhone);

    // Steps 2–3 and 6; steps 4–5 on the outcome of the last attempt.
    let placed: Awaited<ReturnType<typeof placeOrderTx>>;
    try {
      placed = await placeWithRetry(deps, input, ctx.reqId);
    } catch (err) {
      return await replayIfPlaced(prisma, input, err);
    }

    const { order, contactPhone } = placed;
    logger.info('order.created', {
      orderNumber: order.orderNumber,
      deliveryMode: order.deliveryMode,
      total: order.total,
      reqId: ctx.reqId,
    });
    return { order: toPublicOrderView(order, contactPhone), replayed: false };
  } catch (err) {
    if (err instanceof AppError) {
      logger.info('order.rejected', { code: err.code, reqId: ctx.reqId });
    }
    throw err;
  }
}
