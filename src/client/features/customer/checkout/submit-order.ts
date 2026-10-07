import type { CreateOrderResponse, DeliveryOptions } from '@shared/api-types.js';
import { formatINR } from '@shared/money.js';
import type { CreateOrderOutput } from '@shared/schemas/order.js';
import { copy } from '../../../copy';
import { ApiError, api } from '../../../lib/api';
import { isBatchOpen, isExpressOpen } from './selection';

const text = copy.customer.checkout;

/** After this long the attempt is abandoned and treated as a network error (Batch 5 §7.2). */
export const SUBMIT_TIMEOUT_MS = 15_000;

/** `POST /api/orders`. A timeout aborts the request and becomes `ApiError(0, 'NETWORK_ERROR')`. */
export async function submitOrder(
  request: CreateOrderOutput,
  timeoutMs: number = SUBMIT_TIMEOUT_MS,
): Promise<CreateOrderResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await api<CreateOrderResponse>('/api/orders', {
      method: 'POST',
      body: request,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'NETWORK_ERROR', 'Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface SubmitButtonState {
  disabled: boolean;
  loading: boolean;
  label: string;
}

/**
 * The one button at the end of checkout. While a frozen request is waiting for "Try again" it stays
 * enabled even if orders were paused since: the server checks the id before the pause, so the retry
 * returns the order that was already placed (Batch 5 decision 6).
 */
export function submitButtonState(args: {
  submitting: boolean;
  retrying: boolean;
  options: DeliveryOptions | undefined;
  total: number;
}): SubmitButtonState {
  const { submitting, retrying, options, total } = args;
  if (submitting) return { disabled: true, loading: true, label: text.placing };
  if (retrying) return { disabled: false, loading: false, label: copy.common.tryAgain };
  const label = text.placeOrder(formatINR(total));
  if (!options) return { disabled: true, loading: false, label };
  if (options.ordersPaused) return { disabled: true, loading: false, label: text.pausedButton };
  if (!isBatchOpen(options) && !isExpressOpen(options)) {
    return { disabled: true, loading: false, label };
  }
  return { disabled: false, loading: false, label };
}
