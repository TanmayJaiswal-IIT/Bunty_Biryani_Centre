import type { CreateOrderInput, CreateOrderResponse } from '@shared/api-types.js';
import { api, ApiError } from '../../../lib/api';

export const ORDER_SUBMIT_TIMEOUT_MS = 15_000;

export async function submitOrder(
  request: CreateOrderInput,
  options: { timeoutMs?: number } = {},
): Promise<CreateOrderResponse> {
  const timeoutMs = options.timeoutMs ?? ORDER_SUBMIT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await api<CreateOrderResponse>('/api/orders', {
      method: 'POST',
      body: request,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'NETWORK_ERROR', 'Request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
