import {
  dashboardSchema,
  type AdminOrderView,
  type Dashboard,
  type DashboardBatch,
} from '../../shared/schemas/admin-views.js';
import { compareHHmm, nowIST } from '../../shared/time.js';
import { AppError } from '../lib/app-error.js';
import { fromDbDate, toDbDate } from '../lib/db-date.js';
import type { AdminDeps } from './admin-orders.service.js';
import { toAdminOrderView } from './admin-views.js';
import {
  expressStatus,
  slotStatus,
  toSlotInput,
  type LocationInput,
  type SlotInput,
  type Today,
} from './delivery.service.js';

export interface GroupingInput {
  date: string;
  isToday: boolean;
  today: Today;
  slots: Array<SlotInput & { location: LocationInput }>;
  orders: AdminOrderView[];
}

/**
 * Pure batch grouping algorithm (Spec §5).
 */
export function groupBatches(input: GroupingInput): DashboardBatch[] {
  const slotsMap = new Map<number, SlotInput & { location: LocationInput }>();
  for (const slot of input.slots) {
    slotsMap.set(slot.id, slot);
  }

  interface IntermediateGroup {
    slotId: number;
    slotDeliveryTime: string;
    slot?: SlotInput & { location: LocationInput };
    orders: AdminOrderView[];
  }

  const groups = new Map<string, IntermediateGroup>();

  // If date is today, create an empty group for every active slot (Decision 11)
  if (input.isToday) {
    for (const slot of input.slots) {
      if (slot.isActive && slot.location.isActive) {
        const key = `${slot.id}:${slot.deliveryTime}`;
        groups.set(key, {
          slotId: slot.id,
          slotDeliveryTime: slot.deliveryTime,
          slot,
          orders: [],
        });
      }
    }
  }

  // Add all batch orders of the date to groups
  for (const order of input.orders) {
    if (order.slotId === null || order.slotDeliveryTime === null) continue;
    const key = `${order.slotId}:${order.slotDeliveryTime}`;
    let group = groups.get(key);
    if (!group) {
      const slot = slotsMap.get(order.slotId);
      group = {
        slotId: order.slotId,
        slotDeliveryTime: order.slotDeliveryTime,
        slot,
        orders: [],
      };
      groups.set(key, group);
    }
    group.orders.push(order);
  }

  const result: DashboardBatch[] = [];

  for (const group of groups.values()) {
    const counted = group.orders.filter((o) => o.status !== 'CANCELLED');
    const orderCount = counted.length;
    const openCount = counted.filter((o) => o.status === 'ORDER_RECEIVED').length;
    const itemCount = counted.reduce((sum, o) => sum + o.itemCount, 0);
    const codTotal = counted.reduce((sum, o) => sum + o.total, 0);
    const codPending = counted
      .filter((o) => o.paymentStatus === 'PENDING')
      .reduce((sum, o) => sum + o.total, 0);

    // Merge breakdown by menuItemId
    const breakdownMap = new Map<number, { menuItemId: number; name: string; quantity: number }>();
    for (const order of counted) {
      for (const item of order.items) {
        const existing = breakdownMap.get(item.menuItemId);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          breakdownMap.set(item.menuItemId, {
            menuItemId: item.menuItemId,
            name: item.name,
            quantity: item.quantity,
          });
        }
      }
    }
    const itemBreakdown = [...breakdownMap.values()].sort(
      (a, b) => b.quantity - a.quantity || a.menuItemId - b.menuItemId,
    );

    const slot = group.slot ?? slotsMap.get(group.slotId);
    const slotTimeChanged = slot ? group.slotDeliveryTime !== slot.deliveryTime : false;
    const locationName = slot ? slot.location.name : (group.orders[0]?.locationName ?? '');
    const cutoffTime = slot ? slot.cutoffTime : group.slotDeliveryTime;

    let isOpenNow = false;
    let closedToday = false;
    if (input.isToday && slot) {
      isOpenNow = slotStatus(slot, slot.location, input.today).isOpen;
      closedToday = slot.closedOn === input.today.date;
    }

    // Sort group orders: ORDER_RECEIVED by createdAt asc, then COMPLETED by createdAt asc, then CANCELLED by createdAt asc
    const openOrders = group.orders.filter((o) => o.status === 'ORDER_RECEIVED');
    const compOrders = group.orders.filter((o) => o.status === 'COMPLETED');
    const cancOrders = group.orders.filter((o) => o.status === 'CANCELLED');

    openOrders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    compOrders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
    cancOrders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);

    const sortedOrders = [...openOrders, ...compOrders, ...cancOrders];

    result.push({
      slotId: group.slotId,
      locationName,
      deliveryTime: group.slotDeliveryTime,
      cutoffTime,
      slotTimeChanged,
      isOpenNow,
      closedToday,
      orderCount,
      openCount,
      itemCount,
      codTotal,
      codPending,
      itemBreakdown,
      orders: sortedOrders,
    });
  }

  // Sort groups: deliveryTime asc, then location sortOrder asc, then slotId asc
  result.sort((a, b) => {
    const timeDiff = compareHHmm(a.deliveryTime, b.deliveryTime);
    if (timeDiff !== 0) return timeDiff;

    const aSlot = slotsMap.get(a.slotId);
    const bSlot = slotsMap.get(b.slotId);
    const aSortOrder = aSlot?.location.sortOrder ?? 0;
    const bSortOrder = bSlot?.location.sortOrder ?? 0;
    if (aSortOrder !== bSortOrder) return aSortOrder - bSortOrder;

    return a.slotId - b.slotId;
  });

  return result;
}

/**
 * Sorts express orders: ORDER_RECEIVED by createdAt asc, COMPLETED by createdAt desc, CANCELLED last.
 */
export function sortExpress(orders: AdminOrderView[]): AdminOrderView[] {
  const open = orders.filter((o) => o.status === 'ORDER_RECEIVED');
  const completed = orders.filter((o) => o.status === 'COMPLETED');
  const cancelled = orders.filter((o) => o.status === 'CANCELLED');

  open.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  completed.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  cancelled.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);

  return [...open, ...completed, ...cancelled];
}

/**
 * Loads the dashboard for date D (defaults to today).
 */
export async function getDashboard(deps: AdminDeps, date?: string): Promise<Dashboard> {
  const today = nowIST(deps.clock);
  const D = date ?? today.date;

  if (D > today.date) {
    throw new AppError('VALIDATION_ERROR', 'Please check the highlighted fields.', {
      fieldErrors: { date: ['Pick today or an earlier date.'] },
    });
  }

  const isToday = D === today.date;

  const [settings, rawSlots, rawOrdersOfD, rawEarlierExpress, rawEarlierBatch, stockCounts] =
    await Promise.all([
      deps.prisma.deliverySettings.findUniqueOrThrow({ where: { id: 1 } }),
      deps.prisma.deliverySlot.findMany({ include: { location: true } }),
      deps.prisma.order.findMany({
        where: { deliveryDate: toDbDate(D) },
        include: { items: { orderBy: { id: 'asc' } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      isToday
        ? deps.prisma.order.findMany({
            where: {
              deliveryMode: 'EXPRESS',
              status: 'ORDER_RECEIVED',
              deliveryDate: { lt: toDbDate(D) },
            },
            include: { items: { orderBy: { id: 'asc' } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([]),
      isToday
        ? deps.prisma.order.findMany({
            where: {
              deliveryMode: 'BATCH',
              status: 'ORDER_RECEIVED',
              deliveryDate: { lt: toDbDate(D) },
            },
            include: { items: { orderBy: { id: 'asc' } } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve([]),
      isToday
        ? deps.prisma.menuItem.findMany({
            where: { isActive: true, isAvailable: true },
            select: { stockDate: true },
          })
        : Promise.resolve([]),
    ]);

  let itemsOnMenu = 0;
  let itemsWithoutStockToday = 0;
  if (isToday) {
    itemsOnMenu = stockCounts.length;
    itemsWithoutStockToday = stockCounts.filter(
      (item) => item.stockDate === null || fromDbDate(item.stockDate) !== today.date,
    ).length;
  }

  const allOrdersOfD = rawOrdersOfD.map((o) => toAdminOrderView(o, today.instant));
  const earlierExpress = rawEarlierExpress.map((o) => toAdminOrderView(o, today.instant));
  const earlierBatch = rawEarlierBatch.map((o) => toAdminOrderView(o, today.instant));

  const batchOrdersOfD = allOrdersOfD.filter((o) => o.deliveryMode === 'BATCH');
  const expressOrdersOfD = allOrdersOfD.filter((o) => o.deliveryMode === 'EXPRESS');

  const allExpress = [...earlierExpress, ...expressOrdersOfD];
  const sortedExpress = sortExpress(allExpress);

  const slotsInput = rawSlots.map((s) => ({
    ...toSlotInput(s),
    location: s.location,
  }));

  const batches = groupBatches({
    date: D,
    isToday,
    today,
    slots: slotsInput,
    orders: batchOrdersOfD,
  });

  const newOrders = allOrdersOfD.filter((o) => o.status === 'ORDER_RECEIVED').length;
  const completed = allOrdersOfD.filter((o) => o.status === 'COMPLETED').length;
  const cancelled = allOrdersOfD.filter((o) => o.status === 'CANCELLED').length;
  const nonCancelled = allOrdersOfD.filter((o) => o.status !== 'CANCELLED');
  const codPending = nonCancelled
    .filter((o) => o.paymentStatus === 'PENDING')
    .reduce((sum, o) => sum + o.total, 0);
  const codCollected = nonCancelled
    .filter((o) => o.paymentStatus === 'COLLECTED')
    .reduce((sum, o) => sum + o.total, 0);
  const openOrdersFromEarlierDays = earlierBatch.length;

  const expStatus = expressStatus(settings, today);
  const controls = {
    ordersPaused: settings.ordersPaused,
    expressEnabled: settings.expressEnabled,
    expressAvailableNow: expStatus.available,
    expressOpensAt: settings.expressOpensAt,
    expressClosesAt: settings.expressClosesAt,
  };

  const dash: Dashboard = {
    date: D,
    isToday,
    serverTime: today.time,
    controls,
    stock: {
      itemsOnMenu,
      itemsWithoutStockToday,
    },
    summary: {
      newOrders,
      completed,
      cancelled,
      codPending,
      codCollected,
      openOrdersFromEarlierDays,
    },
    batches,
    express: {
      activeCount: sortedExpress.filter((o) => o.status === 'ORDER_RECEIVED').length,
      orders: sortedExpress,
    },
    earlierOpenOrders: earlierBatch,
  };

  return dashboardSchema.parse(dash);
}
