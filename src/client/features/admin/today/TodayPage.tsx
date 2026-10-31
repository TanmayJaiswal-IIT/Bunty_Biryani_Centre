import { formatINR } from '@shared/money.js';
import { formatBusinessDate, formatTime12h } from '@shared/time.js';
import { Link, useSearchParams } from 'react-router';
import { ErrorState } from '../../../components/ErrorState.js';
import { Icon } from '../../../components/Icon.js';
import { useElapsedSeconds } from '../../../lib/use-elapsed-seconds.js';
import { useDashboard } from '../api/hooks.js';
import { OrderRow } from '../orders/OrderRow.js';
import { BatchCard } from './BatchCard.js';
import { ControlSwitches } from './ControlSwitches.js';
import { ExpressSection } from './ExpressSection.js';
import { dateHref, shiftDate } from './today-logic.js';

export function TodayPage() {
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.get('date');
  const { data, error, isLoading, mutate } = useDashboard(dateParam);
  const elapsed = useElapsedSeconds(data?.receivedAt ?? 0);

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-4 p-4 animate-pulse">
        <div className="h-10 rounded-card bg-neutral-200" />
        <div className="h-28 rounded-card bg-neutral-200" />
        <div className="h-36 rounded-card bg-neutral-200" />
        <div className="h-36 rounded-card bg-neutral-200" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <ErrorState
        title="Couldn't load dashboard"
        message={error.message}
        onRetry={() => void mutate()}
      />
    );
  }

  if (!data) return null;

  const isToday = data.isToday;
  const prevDate = shiftDate(data.date, -1);
  const nextDate = shiftDate(data.date, 1);
  const titleText = isToday
    ? `TODAY · ${formatBusinessDate(data.date)}`
    : formatBusinessDate(data.date);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Stale data strip */}
      {error && (
        <div className="rounded-card border border-warning-soft bg-warning-soft p-3 text-sm font-medium text-warning">
          Can't reach the server. Showing orders from {formatTime12h(data.serverTime)}.
        </div>
      )}

      {/* Header row: Date, Nav, Updated N s ago, Refresh */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link
            to={dateHref(prevDate, data)}
            aria-label="Previous day"
            className="flex size-10 items-center justify-center rounded-control text-lg font-bold text-ink hover:bg-neutral-100 active:bg-neutral-200"
          >
            ‹
          </Link>

          <h1 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
            {titleText}
          </h1>

          {isToday ? (
            <span
              aria-disabled="true"
              className="flex size-10 items-center justify-center rounded-control text-lg font-bold text-ink-muted opacity-30 cursor-not-allowed"
            >
              ›
            </span>
          ) : (
            <Link
              to={dateHref(nextDate, data)}
              aria-label="Next day"
              className="flex size-10 items-center justify-center rounded-control text-lg font-bold text-ink hover:bg-neutral-100 active:bg-neutral-200"
            >
              ›
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span>Updated {elapsed} s ago</span>
          <button
            type="button"
            onClick={() => void mutate()}
            aria-label="Refresh"
            className="flex size-8 items-center justify-center rounded-control text-ink hover:bg-neutral-100 active:bg-neutral-200"
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </header>

      {/* Control switches (Orders & Express) */}
      <ControlSwitches
        controls={data.controls}
        serverTime={data.serverTime}
        date={dateParam}
      />

      {/* Today-only Banners: Missing stock warning & Earlier open orders */}
      {isToday && data.stock.itemsWithoutStockToday > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-card border border-warning-soft bg-warning-soft p-3 text-sm text-warning">
          <span>
            {data.stock.itemsWithoutStockToday}{' '}
            {data.stock.itemsWithoutStockToday === 1 ? 'item has' : 'items have'}{' '}
            no stock set for today.
          </span>
          <Link
            to="/admin/stock"
            className="font-semibold underline hover:no-underline"
          >
            Set stock
          </Link>
        </div>
      )}

      {isToday &&
        data.earlierOpenOrders &&
        data.earlierOpenOrders.length > 0 && (
          <details className="group rounded-card border border-info-soft bg-info-soft p-4">
            <summary className="cursor-pointer font-semibold text-info hover:underline focus-visible:outline-2 focus-visible:outline-brand">
              Open orders from earlier days ({data.earlierOpenOrders.length})
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {data.earlierOpenOrders.map((o) => (
                <OrderRow key={o.id} order={o} isToday={false} />
              ))}
            </div>
          </details>
        )}

      {/* Summary strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface p-4">
        <div className="text-sm font-bold font-display uppercase tracking-wider text-brand">
          NEW ORDERS: {data.summary.newOrders}
        </div>
        <div className="text-sm font-semibold text-ink">
          {formatINR(data.summary.codPending)} COD pending
        </div>
      </div>

      {/* Batch Cards */}
      <div className="flex flex-col gap-4">
        {data.batches.map((batch) => (
          <BatchCard
            key={`${batch.slotId}-${batch.deliveryTime}`}
            batch={batch}
            isToday={isToday}
            date={dateParam}
          />
        ))}
      </div>

      {/* Express Section */}
      <ExpressSection express={data.express} isToday={isToday} />
    </div>
  );
}
