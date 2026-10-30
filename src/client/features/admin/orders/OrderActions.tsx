import type { AdminOrderView } from '@shared/api-types.js';
import { useState } from 'react';
import { Button } from '../../../components/Button.js';
import { OverflowMenu, type OverflowMenuItem } from '../../../components/OverflowMenu.js';
import { CancelOrderDialog } from './CancelOrderDialog.js';
import { useOrderAction } from './use-order-action.js';

export interface OrderActionsProps {
  order: AdminOrderView;
  isToday?: boolean;
}

export function OrderActions({ order, isToday = true }: OrderActionsProps) {
  const { run, pending, error, undo } = useOrderAction(order);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  if (order.status === 'CANCELLED') {
    return (
      <div className="flex items-center justify-end">
        <OverflowMenu
          label="Order options"
          items={[{ label: 'Open details', to: `/admin/orders/${order.id}` }]}
        />
      </div>
    );
  }

  const overflowItems: OverflowMenuItem[] = [];

  if (order.status !== 'COMPLETED') {
    if (order.paymentStatus === 'COLLECTED') {
      overflowItems.push({
        label: 'Cancel order',
        disabled: true,
        hint: 'Undo cash collected first.',
        tone: 'danger',
      });
    } else {
      overflowItems.push({
        label: 'Cancel order',
        tone: 'danger',
        onSelect: () => setCancelDialogOpen(true),
      });
    }
  }

  overflowItems.push({
    label: 'Open details',
    to: `/admin/orders/${order.id}`,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`tel:${order.customerPhone}`}
          className="inline-flex min-h-12 items-center justify-center rounded-control border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-gold-soft active:bg-gold-soft"
        >
          Call
        </a>

        {undo ? (
          <Button
            variant="secondary"
            onClick={() => void run(undo, { undoable: false })}
            loading={pending !== null}
          >
            Undo
          </Button>
        ) : (
          <>
            {order.paymentStatus === 'PENDING' ? (
              <Button
                variant="secondary"
                onClick={() => void run({ paymentStatus: 'COLLECTED' })}
                loading={pending !== null && 'paymentStatus' in pending}
              >
                Cash collected
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void run({ paymentStatus: 'PENDING' })}
                loading={pending !== null && 'paymentStatus' in pending}
              >
                Undo cash
              </Button>
            )}

            {order.status === 'ORDER_RECEIVED' ? (
              <Button
                variant="primary"
                onClick={() => void run({ status: 'COMPLETED' })}
                loading={
                  pending !== null &&
                  'status' in pending &&
                  pending.status === 'COMPLETED'
                }
              >
                Done
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void run({ status: 'ORDER_RECEIVED' })}
                loading={
                  pending !== null &&
                  'status' in pending &&
                  pending.status === 'ORDER_RECEIVED'
                }
              >
                Reopen
              </Button>
            )}
          </>
        )}

        <OverflowMenu label="Order options" items={overflowItems} />
      </div>

      {error && (
        <div className="rounded-control bg-danger-soft p-2 text-xs font-semibold text-danger">
          {error}
        </div>
      )}

      <CancelOrderDialog
        order={order}
        isToday={isToday}
        open={cancelDialogOpen}
        loading={pending !== null}
        onConfirm={() => {
          void run({ status: 'CANCELLED' }).then(() => {
            setCancelDialogOpen(false);
          });
        }}
        onCancel={() => setCancelDialogOpen(false)}
      />
    </div>
  );
}
