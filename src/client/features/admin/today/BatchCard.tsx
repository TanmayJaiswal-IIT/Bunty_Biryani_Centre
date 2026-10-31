import type { DashboardBatch } from '@shared/api-types.js';
import { formatTime12h } from '@shared/time.js';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { Chip } from '../../../components/Chip.js';
import { ConfirmDialog } from '../../../components/ConfirmDialog.js';
import { OverflowMenu, type OverflowMenuItem } from '../../../components/OverflowMenu.js';
import { ADMIN_SLOTS_KEY, dashboardKey } from '../api/keys.js';
import { completeOrders, refreshOrders, updateSlot } from '../api/mutations.js';
import { OrderRow } from '../orders/OrderRow.js';
import { breakdownLine, countLine, openIds, slotChip } from './today-logic.js';

export interface BatchCardProps {
  batch: DashboardBatch;
  isToday: boolean;
  date?: string | null;
}

export function BatchCard({ batch, isToday, date = null }: BatchCardProps) {
  const { mutate } = useSWRConfig();
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [markCollected, setMarkCollected] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [slotUpdating, setSlotUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chip = slotChip(batch, isToday);
  const openOrderIds = openIds(batch);

  const handleToggleClosed = async (closed: boolean) => {
    if (!batch.slotId) return;
    setSlotUpdating(true);
    setError(null);
    try {
      await updateSlot(batch.slotId, { closedToday: closed });
      await Promise.all([
        mutate(dashboardKey(date)),
        mutate(ADMIN_SLOTS_KEY),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update slot');
    } finally {
      setSlotUpdating(false);
    }
  };

  const handleCompleteAll = async () => {
    if (openOrderIds.length === 0) return;
    setCompleting(true);
    setError(null);
    try {
      await completeOrders({
        orderIds: openOrderIds,
        markCollected,
      });
      await refreshOrders(mutate);
      setCompleteDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete orders');
    } finally {
      setCompleting(false);
    }
  };

  const overflowItems: OverflowMenuItem[] = [];
  if (isToday && batch.slotId) {
    overflowItems.push({
      label: batch.closedToday ? 'Reopen for today' : 'Close for today',
      onSelect: () => void handleToggleClosed(!batch.closedToday),
      disabled: slotUpdating,
    });
  }

  // Zero-order slot rendered as a single line
  if (batch.orderCount === 0) {
    return (
      <section className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-ink">
              {batch.locationName} — {formatTime12h(batch.deliveryTime)}
            </h2>
            {chip && <Chip tone={chip.tone}>{chip.text}</Chip>}
            <span className="text-sm text-ink-muted">No orders yet</span>
          </div>

          {overflowItems.length > 0 && (
            <OverflowMenu label="Batch options" items={overflowItems} />
          )}
        </div>

        {error && (
          <div className="mt-1 rounded-control bg-danger-soft p-2 text-xs font-semibold text-danger">
            {error}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      {/* Header: Location & Time, Chip, Overflow */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-ink">
            {batch.locationName} — {formatTime12h(batch.deliveryTime)}
          </h2>
          {chip && <Chip tone={chip.tone}>{chip.text}</Chip>}
        </div>

        <div className="flex items-center gap-2">
          {openOrderIds.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => setCompleteDialogOpen(true)}
            >
              Mark all done
            </Button>
          )}

          {overflowItems.length > 0 && (
            <OverflowMenu label="Batch options" items={overflowItems} />
          )}
        </div>
      </div>

      {batch.slotTimeChanged && (
        <div className="rounded-control bg-warning-soft p-2 text-xs font-medium text-warning">
          Slot time changed to {formatTime12h(batch.deliveryTime)}. These customers were told {formatTime12h(batch.deliveryTime)}.
        </div>
      )}

      {/* Summary lines */}
      <div className="flex flex-col gap-0.5 text-sm">
        <div className="font-semibold text-ink">{countLine(batch)}</div>
        <div className="text-ink-muted">{breakdownLine(batch)}</div>
      </div>

      {error && (
        <div className="rounded-control bg-danger-soft p-2 text-xs font-semibold text-danger">
          {error}
        </div>
      )}

      {/* Collapsible orders list */}
      <details className="mt-2 group">
        <summary className="cursor-pointer font-semibold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand">
          Show {batch.orderCount} orders
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {batch.orders.map((order) => (
            <OrderRow key={order.id} order={order} isToday={isToday} />
          ))}
        </div>
      </details>

      <ConfirmDialog
        open={completeDialogOpen}
        title="Complete all orders?"
        confirmLabel="Complete orders"
        cancelLabel="Cancel"
        loading={completing}
        onConfirm={() => void handleCompleteAll()}
        onCancel={() => setCompleteDialogOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <p>
            This will mark {openOrderIds.length} open {openOrderIds.length === 1 ? 'order' : 'orders'} as completed.
          </p>
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-neutral-800">
            <input
              type="checkbox"
              checked={markCollected}
              onChange={(e) => setMarkCollected(e.target.checked)}
              className="size-4 rounded border-neutral-300 text-brand focus:ring-brand"
            />
            Cash collected for all
          </label>
        </div>
      </ConfirmDialog>
    </section>
  );
}
