import { generateUUID } from '../../../lib/uuid';

export const PENDING_ORDER_KEY = 'bbc.pendingOrder.v1';

export interface PendingOrder {
  clientRequestId: string;
  fingerprint: string;
}

let memoryPending: PendingOrder | null = null;

export interface OrderFingerprintInput {
  deliveryMode: 'BATCH' | 'EXPRESS';
  slotId?: number | null;
  locationId: number;
  customerName: string;
  customerPhone: string;
  addressDetail?: string | null;
  items: { menuItemId: number; quantity: number }[];
  expectedTotal: number;
}

export function computeOrderFingerprint(input: OrderFingerprintInput): string {
  const slotId = input.deliveryMode === 'BATCH' && input.slotId ? input.slotId : null;
  const addressDetail =
    typeof input.addressDetail === 'string' && input.addressDetail.trim()
      ? input.addressDetail.trim()
      : null;
  const normalized = {
    deliveryMode: input.deliveryMode,
    slotId,
    locationId: input.locationId,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    addressDetail,
    items: input.items.map((i: { menuItemId: number; quantity: number }) => ({
      menuItemId: i.menuItemId,
      quantity: i.quantity,
    })),
    expectedTotal: input.expectedTotal,
  };
  return JSON.stringify(normalized);
}

export function getPendingOrder(): PendingOrder | null {
  if (memoryPending) return memoryPending;
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'clientRequestId' in parsed &&
      typeof (parsed as PendingOrder).clientRequestId === 'string' &&
      'fingerprint' in parsed &&
      typeof (parsed as PendingOrder).fingerprint === 'string'
    ) {
      memoryPending = parsed as PendingOrder;
      return memoryPending;
    }
  } catch {
    // sessionStorage blocked or corrupted
  }
  return null;
}

export function setPendingOrder(pending: PendingOrder): void {
  memoryPending = pending;
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(pending));
  } catch {
    // sessionStorage blocked
  }
}

export function clearPendingOrder(): void {
  memoryPending = null;
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PENDING_ORDER_KEY);
  } catch {
    // ignore
  }
}

export function ensureClientRequestId(
  input: OrderFingerprintInput,
): { clientRequestId: string; fingerprint: string } {
  const fingerprint = computeOrderFingerprint(input);
  const existing = getPendingOrder();
  if (existing && existing.fingerprint === fingerprint) {
    return existing;
  }
  const next: PendingOrder = {
    clientRequestId: generateUUID(),
    fingerprint,
  };
  setPendingOrder(next);
  return next;
}
