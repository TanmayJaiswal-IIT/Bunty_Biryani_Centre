import type { DeliveryOptions } from '@shared/api-types.js';
import { MAX_OPEN_ORDERS_PER_PHONE } from '@shared/limits.js';
import type { CreateOrderOutput } from '@shared/schemas/order.js';
import { formatTime12h } from '@shared/time.js';
import { copy } from '../../../copy';
import type { ApiError } from '../../../lib/api';
import { FIELD_ORDER, type FieldErrors, type OrderField } from './build-order-request';

const text = copy.customer.checkout;

/** What the checkout shows and does after `POST /api/orders` fails (Batch 5 §7.3). */
export interface SubmitFailure {
  /** `null`: field errors only. */
  banner: string | null;
  /** `SLOT_CLOSED` express hint. */
  bannerExtra: string | null;
  fieldErrors: FieldErrors;
  revalidateMenu: boolean;
  revalidateOptions: boolean;
  selection: 'keep' | 'clearSlot' | 'clearLocation' | 'clearMethod';
  stockFixes: Array<{ menuItemId: number; available: number }>;
  tryExpressLocationId: number | null;
  /** `TOO_MANY_OPEN_ORDERS` and a contact number is set. */
  showContact: boolean;
  /** `IDEMPOTENCY_CONFLICT`: the next attempt needs a new id. */
  newRequestId: boolean;
  /** Network error, status 500 or above, or a code this screen doesn't know: "Try again" resends the same request. */
  retryable: boolean;
}

function failure(over: Partial<SubmitFailure>): SubmitFailure {
  return {
    banner: null,
    bannerExtra: null,
    fieldErrors: {},
    revalidateMenu: false,
    revalidateOptions: false,
    selection: 'keep',
    stockFixes: [],
    tryExpressLocationId: null,
    showContact: false,
    newRequestId: false,
    retryable: false,
    ...over,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isOrderField(key: string): key is OrderField {
  return FIELD_ORDER.some((field) => field === key);
}

/** `details.items` as a list of records; anything else is an empty list. */
function detailItems(details: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const items = details?.items;
  return Array.isArray(items) ? (items as unknown[]).filter(isRecord) : [];
}

/** First message per known field; an unknown key lands on `deliveryMode` rather than vanishing. */
function mapFieldErrors(details: Record<string, unknown> | undefined): FieldErrors {
  const raw = details?.fieldErrors;
  const errors: FieldErrors = {};
  if (!isRecord(raw)) return errors;
  for (const [key, messages] of Object.entries(raw)) {
    const first: unknown = Array.isArray(messages) ? (messages as unknown[])[0] : undefined;
    if (typeof first !== 'string') continue;
    errors[isOrderField(key) ? key : 'deliveryMode'] ??= first;
  }
  return errors;
}

function slotClosed(
  error: ApiError,
  request: CreateOrderOutput,
  options: DeliveryOptions | undefined,
): SubmitFailure {
  const slot =
    request.deliveryMode === 'BATCH'
      ? options?.batch.slots.find((s) => s.id === request.slotId)
      : undefined;
  const expressAvailable = error.details?.expressAvailable === true;
  const locationName =
    slot?.locationName ?? options?.express.locations.find((l) => l.id === request.locationId)?.name;
  return failure({
    banner: slot
      ? text.slotJustClosed(text.slotTitle(slot.locationName, formatTime12h(slot.deliveryTime)))
      : text.slotClosed,
    bannerExtra:
      expressAvailable && locationName ? text.batchClosedExpressOpen(locationName) : null,
    selection: 'clearSlot',
    revalidateOptions: true,
    tryExpressLocationId: expressAvailable ? request.locationId : null,
  });
}

function outOfStock(error: ApiError): SubmitFailure {
  const stockFixes: SubmitFailure['stockFixes'] = [];
  const sentences: string[] = [];
  let capped = false;
  for (const item of detailItems(error.details)) {
    const { menuItemId, name, available } = item;
    if (typeof menuItemId !== 'number' || typeof name !== 'string') continue;
    const left = typeof available === 'number' ? Math.max(0, available) : 0;
    stockFixes.push({ menuItemId, available: left });
    if (left > 0) {
      capped = true;
      sentences.push(text.onlyLeftInOrder(left, name));
    } else {
      sentences.push(text.soldOutRemoved(name));
    }
  }
  if (sentences.length === 0)
    return failure({ banner: text.itemUnavailable, revalidateMenu: true });
  if (capped) sentences.push(text.orderUpdated);
  return failure({ banner: sentences.join(' '), stockFixes, revalidateMenu: true });
}

export function describeSubmitError(
  error: ApiError,
  ctx: { request: CreateOrderOutput; options: DeliveryOptions | undefined },
): SubmitFailure {
  const { request, options } = ctx;
  switch (error.code) {
    case 'VALIDATION_ERROR': {
      const fieldErrors = mapFieldErrors(error.details);
      if (Object.keys(fieldErrors).length > 0) return failure({ fieldErrors });
      return failure({ banner: copy.common.genericError });
    }
    case 'ORDERS_PAUSED':
      return failure({ banner: text.paused, revalidateOptions: true });
    case 'SLOT_CLOSED':
      return slotClosed(error, request, options);
    case 'LOCATION_UNAVAILABLE':
      return failure({
        banner: text.locationUnavailable,
        selection: 'clearLocation',
        revalidateOptions: true,
      });
    case 'EXPRESS_UNAVAILABLE':
      return failure({
        banner: text.expressUnavailable,
        selection: 'clearMethod',
        revalidateOptions: true,
      });
    case 'ITEM_UNAVAILABLE': {
      const stockFixes = detailItems(error.details).flatMap((item) =>
        typeof item.menuItemId === 'number' ? [{ menuItemId: item.menuItemId, available: 0 }] : [],
      );
      return failure({ banner: text.itemUnavailable, stockFixes, revalidateMenu: true });
    }
    case 'OUT_OF_STOCK':
      return outOfStock(error);
    case 'PRICE_CHANGED':
      return failure({
        banner: text.priceChanged,
        revalidateMenu: true,
        revalidateOptions: true,
      });
    case 'TOO_MANY_OPEN_ORDERS': {
      const limit =
        typeof error.details?.limit === 'number' ? error.details.limit : MAX_OPEN_ORDERS_PER_PHONE;
      return failure({
        banner: text.tooManyOpen(limit),
        showContact: Boolean(options?.contactPhone),
      });
    }
    case 'IDEMPOTENCY_CONFLICT':
      return failure({ banner: text.idempotencyConflict, newRequestId: true });
    case 'RATE_LIMITED':
      return failure({ banner: text.rateLimited });
    default:
      // NETWORK_ERROR, 5xx and anything unexpected: the order may or may not exist, so offer
      // "Try again" with the same id (it either places the order or replays the one that exists).
      return failure({ banner: text.network, retryable: true });
  }
}
