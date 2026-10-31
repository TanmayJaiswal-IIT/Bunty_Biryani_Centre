import { describe, expect, it } from 'vitest';
import type { OrderStatus, PaymentStatus } from '../../src/shared/enums.js';
import {
  canApply,
  type OrderAction,
  type Verdict,
} from '../../src/server/services/status-machine.js';

interface TestCase {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  action: OrderAction;
  expected: Verdict;
}

const table: TestCase[] = [
  // 1. ORDER_RECEIVED / PENDING
  { status: 'ORDER_RECEIVED', paymentStatus: 'PENDING', action: { status: 'COMPLETED' }, expected: 'APPLY' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'PENDING', action: { status: 'ORDER_RECEIVED' }, expected: 'NOOP' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'PENDING', action: { status: 'CANCELLED' }, expected: 'APPLY' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'PENDING', action: { paymentStatus: 'COLLECTED' }, expected: 'APPLY' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'PENDING', action: { paymentStatus: 'PENDING' }, expected: 'NOOP' },

  // 2. ORDER_RECEIVED / COLLECTED
  { status: 'ORDER_RECEIVED', paymentStatus: 'COLLECTED', action: { status: 'COMPLETED' }, expected: 'APPLY' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'COLLECTED', action: { status: 'ORDER_RECEIVED' }, expected: 'NOOP' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'COLLECTED', action: { status: 'CANCELLED' }, expected: 'INVALID' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'COLLECTED', action: { paymentStatus: 'COLLECTED' }, expected: 'NOOP' },
  { status: 'ORDER_RECEIVED', paymentStatus: 'COLLECTED', action: { paymentStatus: 'PENDING' }, expected: 'APPLY' },

  // 3. COMPLETED / PENDING
  { status: 'COMPLETED', paymentStatus: 'PENDING', action: { status: 'COMPLETED' }, expected: 'NOOP' },
  { status: 'COMPLETED', paymentStatus: 'PENDING', action: { status: 'ORDER_RECEIVED' }, expected: 'APPLY' },
  { status: 'COMPLETED', paymentStatus: 'PENDING', action: { status: 'CANCELLED' }, expected: 'INVALID' },
  { status: 'COMPLETED', paymentStatus: 'PENDING', action: { paymentStatus: 'COLLECTED' }, expected: 'APPLY' },
  { status: 'COMPLETED', paymentStatus: 'PENDING', action: { paymentStatus: 'PENDING' }, expected: 'NOOP' },

  // 4. COMPLETED / COLLECTED
  { status: 'COMPLETED', paymentStatus: 'COLLECTED', action: { status: 'COMPLETED' }, expected: 'NOOP' },
  { status: 'COMPLETED', paymentStatus: 'COLLECTED', action: { status: 'ORDER_RECEIVED' }, expected: 'APPLY' },
  { status: 'COMPLETED', paymentStatus: 'COLLECTED', action: { status: 'CANCELLED' }, expected: 'INVALID' },
  { status: 'COMPLETED', paymentStatus: 'COLLECTED', action: { paymentStatus: 'COLLECTED' }, expected: 'NOOP' },
  { status: 'COMPLETED', paymentStatus: 'COLLECTED', action: { paymentStatus: 'PENDING' }, expected: 'APPLY' },

  // 5. CANCELLED / PENDING
  { status: 'CANCELLED', paymentStatus: 'PENDING', action: { status: 'COMPLETED' }, expected: 'INVALID' },
  { status: 'CANCELLED', paymentStatus: 'PENDING', action: { status: 'ORDER_RECEIVED' }, expected: 'INVALID' },
  { status: 'CANCELLED', paymentStatus: 'PENDING', action: { status: 'CANCELLED' }, expected: 'NOOP' },
  { status: 'CANCELLED', paymentStatus: 'PENDING', action: { paymentStatus: 'COLLECTED' }, expected: 'INVALID' },
  { status: 'CANCELLED', paymentStatus: 'PENDING', action: { paymentStatus: 'PENDING' }, expected: 'NOOP' },
];

describe('status-machine: canApply (#1)', () => {
  it('covers all 25 cells of the state machine transition table', () => {
    expect(table).toHaveLength(25);
  });

  it.each(table)(
    '$status / $paymentStatus -> $action -> $expected',
    ({ status, paymentStatus, action, expected }) => {
      const verdict = canApply({ status, paymentStatus }, action);
      expect(verdict).toBe(expected);
    },
  );
});
