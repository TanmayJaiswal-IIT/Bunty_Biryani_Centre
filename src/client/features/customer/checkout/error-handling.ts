import type { ApiError } from '../../../lib/api';
import { copy } from '../../../copy';

export interface ShortStockItem {
  menuItemId: number;
  name: string;
  available: number;
}

export function formatOutOfStockMessage(shortItems: ShortStockItem[]): string {
  if (shortItems.length === 0) {
    return copy.customer.checkout.outOfStockCheckAgain;
  }
  if (shortItems.length === 1) {
    const item = shortItems[0]!;
    if (item.available <= 0) {
      return copy.customer.checkout.outOfStockSingleRemoved(item.name);
    }
    return copy.customer.checkout.outOfStockSingleCapped(item.available, item.name);
  }

  const sentences = shortItems.map((item) =>
    item.available <= 0
      ? copy.customer.checkout.outOfStockSoldOut(item.name)
      : copy.customer.checkout.outOfStockOnlyLeft(item.available, item.name),
  );
  const anyCapped = shortItems.some((item) => item.available > 0);
  const joined = sentences.join(' ');
  return anyCapped ? `${joined} ${copy.customer.checkout.outOfStockCheckAgain}` : joined;
}

export interface CheckoutErrorBanner {
  message: string;
  variant?: 'danger' | 'warning' | 'info';
  tryExpress?: boolean;
}

export interface ParsedCheckoutError {
  banner: CheckoutErrorBanner;
  fieldErrors?: Record<string, string>;
  isNetworkOrServer?: boolean;
  clearSlot?: boolean;
  clearLocation?: boolean;
  clearMethod?: boolean;
  shortItems?: ShortStockItem[];
  revalidateMenu?: boolean;
  revalidateOptions?: boolean;
  newIdRequired?: boolean;
}

export function parseCheckoutError(
  error: unknown,
  contactPhone?: string | null,
): ParsedCheckoutError {
  const apiError = error as ApiError | undefined;
  if (!apiError || !apiError.code) {
    return {
      banner: {
        message: copy.customer.checkout.networkError,
        variant: 'danger',
      },
      isNetworkOrServer: true,
    };
  }

  const { code, details } = apiError;

  switch (code) {
    case 'NETWORK_ERROR':
      return {
        banner: {
          message: copy.customer.checkout.networkError,
          variant: 'danger',
        },
        isNetworkOrServer: true,
      };

    case 'VALIDATION_ERROR': {
      const fieldErrors: Record<string, string> = {};
      if (details && typeof details === 'object' && 'fieldErrors' in details) {
        const fe = details.fieldErrors as Record<string, string[] | string>;
        for (const [key, val] of Object.entries(fe)) {
          fieldErrors[key] = Array.isArray(val) ? val[0] || '' : String(val);
        }
      }
      return {
        banner: {
          message: apiError.message || copy.common.genericError,
          variant: 'danger',
        },
        fieldErrors,
      };
    }

    case 'ORDERS_PAUSED':
      return {
        banner: {
          message: copy.customer.checkout.ordersPaused,
          variant: 'danger',
        },
        revalidateOptions: true,
      };

    case 'SLOT_CLOSED': {
      const slotTitle =
        details && typeof details === 'object' && 'slotName' in details
          ? String((details as { slotName: string }).slotName)
          : '';
      const expressAvailable = Boolean(
        details && typeof details === 'object' && (details as { expressAvailable?: boolean }).expressAvailable,
      );
      let message = slotTitle
        ? copy.customer.checkout.slotJustClosed(slotTitle)
        : copy.customer.checkout.slotClosed;
      if (expressAvailable) {
        const locationName =
          details && typeof details === 'object' && 'locationName' in details
            ? String((details as { locationName: string }).locationName)
            : '';
        message = `${message} ${copy.customer.checkout.batchClosedExpressOpen(locationName || 'your location')}`;
      }
      return {
        banner: {
          message,
          variant: 'danger',
          tryExpress: expressAvailable,
        },
        clearSlot: true,
        revalidateOptions: true,
      };
    }

    case 'LOCATION_UNAVAILABLE':
      return {
        banner: {
          message: copy.customer.checkout.locationUnavailable,
          variant: 'danger',
        },
        clearLocation: true,
        revalidateOptions: true,
      };

    case 'EXPRESS_UNAVAILABLE':
      return {
        banner: {
          message: copy.customer.checkout.expressUnavailable,
          variant: 'danger',
        },
        clearMethod: true,
        revalidateOptions: true,
      };

    case 'ITEM_UNAVAILABLE':
      return {
        banner: {
          message: copy.customer.checkout.itemUnavailable,
          variant: 'danger',
        },
        revalidateMenu: true,
      };

    case 'OUT_OF_STOCK': {
      const shortItems =
        details && typeof details === 'object' && 'shortItems' in details
          ? ((details as { shortItems: ShortStockItem[] }).shortItems || [])
          : [];
      return {
        banner: {
          message: formatOutOfStockMessage(shortItems),
          variant: 'danger',
        },
        shortItems,
        revalidateMenu: true,
      };
    }

    case 'PRICE_CHANGED':
      return {
        banner: {
          message: copy.customer.checkout.priceChanged,
          variant: 'warning',
        },
        revalidateMenu: true,
        revalidateOptions: true,
      };

    case 'TOO_MANY_OPEN_ORDERS':
      return {
        banner: {
          message: copy.customer.checkout.tooManyOpenOrders(contactPhone),
          variant: 'danger',
        },
      };

    case 'IDEMPOTENCY_CONFLICT':
      return {
        banner: {
          message: copy.customer.checkout.idempotencyConflict,
          variant: 'danger',
        },
        newIdRequired: true,
      };

    case 'RATE_LIMITED':
      return {
        banner: {
          message: copy.customer.checkout.rateLimited,
          variant: 'danger',
        },
      };

    default:
      if (apiError.status >= 500) {
        return {
          banner: {
            message: copy.customer.checkout.networkError,
            variant: 'danger',
          },
          isNetworkOrServer: true,
        };
      }
      return {
        banner: {
          message: apiError.message || copy.common.genericError,
          variant: 'danger',
        },
      };
  }
}
