import { describe, expect, it } from 'vitest';
import type { OrderStatus, PaymentStatus } from '../../src/shared/enums';
import { canApply, type OrderAction, type Verdict } from '../../src/server/services/status-machine';

// Batch 6 §4: the transition table, every cell. Rows are the order's current state, columns the
// requested action. `CANCELLED / COLLECTED` can't exist (database check), so it has no row.

type State = { status: OrderStatus; paymentStatus: PaymentStatus };

const COLUMNS: OrderAction[] = [
  { status: 'COMPLETED' },
  { status: 'ORDER_RECEIVED' },
  { status: 'CANCELLED' },
  { paymentStatus: 'COLLECTED' },
  { paymentStatus: 'PENDING' },
];

const TABLE: Array<[State, [Verdict, Verdict, Verdict, Verdict, Verdict]]> = [
  [
    { status: 'ORDER_RECEIVED', paymentStatus: 'PENDING' },
    ['APPLY', 'NOOP', 'APPLY', 'APPLY', 'NOOP'],
  ],
  [
    { status: 'ORDER_RECEIVED', paymentStatus: 'COLLECTED' },
    ['APPLY', 'NOOP', 'INVALID', 'NOOP', 'APPLY'],
  ],
  [
    { status: 'COMPLETED', paymentStatus: 'PENDING' },
    ['NOOP', 'APPLY', 'INVALID', 'APPLY', 'NOOP'],
  ],
  [
    { status: 'COMPLETED', paymentStatus: 'COLLECTED' },
    ['NOOP', 'APPLY', 'INVALID', 'NOOP', 'APPLY'],
  ],
  [
    { status: 'CANCELLED', paymentStatus: 'PENDING' },
    ['INVALID', 'INVALID', 'NOOP', 'INVALID', 'NOOP'],
  ],
];

const label = (a: OrderAction): string => ('status' in a ? a.status : a.paymentStatus);

const CELLS = TABLE.flatMap(([state, verdicts]) =>
  COLUMNS.map((action, i) => ({ state, action, expected: verdicts[i] as Verdict })),
);

describe('canApply', () => {
  it('#1 the table has all 25 cells', () => {
    expect(CELLS).toHaveLength(25);
  });

  it.each(CELLS)(
    '#1 $state.status / $state.paymentStatus + $action -> $expected',
    ({ state, action, expected }) => {
      expect(
        canApply(state, action),
        `${state.status}/${state.paymentStatus} + ${label(action)}`,
      ).toBe(expected);
    },
  );
});
