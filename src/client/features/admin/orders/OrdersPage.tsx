import type { DeliveryMode, OrderStatus } from '@shared/api-types.js';
import { useEffect, useRef, useState } from 'react';
import { ErrorState } from '../../../components/ErrorState.js';
import { useAdminOrders, useDashboard } from '../api/hooks.js';
import { OrderRow } from './OrderRow.js';

export function OrdersPage() {
  const { data: dashboard } = useDashboard(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedMode, setSelectedMode] = useState<DeliveryMode | undefined>(undefined);
  const [selectedStatus, setSelectedStatus] = useState<OrderStatus | undefined>(undefined);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(val.trim());
    }, 300);
  };

  const effectiveDate = selectedDate || dashboard?.date || '';

  const queryParams = {
    q: debouncedQuery || undefined,
    date: debouncedQuery ? undefined : effectiveDate || undefined,
    mode: selectedMode,
    status: selectedStatus,
  };

  const { data, error, isLoading, mutate } = useAdminOrders(queryParams);

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-bold font-display uppercase tracking-wide text-ink">
        Orders
      </h1>

      {/* Search Input */}
      <div className="flex flex-col gap-1">
        <label htmlFor="order-search" className="text-sm font-semibold text-ink">
          Order ID or phone number
        </label>
        <input
          id="order-search"
          type="search"
          inputMode="search"
          autoFocus
          value={searchInput}
          onChange={handleSearchChange}
          placeholder="Search by order ID or phone"
          className="min-h-12 w-full rounded-control border border-neutral-300 bg-white px-4 text-base text-ink placeholder:text-neutral-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {/* Filter Chips & Date Row */}
      <div className="flex flex-col gap-3">
        {/* Delivery Mode Chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted">Mode:</span>
          <button
            type="button"
            aria-pressed={selectedMode === undefined}
            onClick={() => setSelectedMode(undefined)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedMode === undefined
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            aria-pressed={selectedMode === 'BATCH'}
            onClick={() => setSelectedMode('BATCH')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedMode === 'BATCH'
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Batch
          </button>
          <button
            type="button"
            aria-pressed={selectedMode === 'EXPRESS'}
            onClick={() => setSelectedMode('EXPRESS')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedMode === 'EXPRESS'
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Express
          </button>
        </div>

        {/* Status Chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-muted">Status:</span>
          <button
            type="button"
            aria-pressed={selectedStatus === undefined}
            onClick={() => setSelectedStatus(undefined)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedStatus === undefined
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            All
          </button>
          <button
            type="button"
            aria-pressed={selectedStatus === 'ORDER_RECEIVED'}
            onClick={() => setSelectedStatus('ORDER_RECEIVED')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedStatus === 'ORDER_RECEIVED'
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Open
          </button>
          <button
            type="button"
            aria-pressed={selectedStatus === 'COMPLETED'}
            onClick={() => setSelectedStatus('COMPLETED')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedStatus === 'COMPLETED'
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Completed
          </button>
          <button
            type="button"
            aria-pressed={selectedStatus === 'CANCELLED'}
            onClick={() => setSelectedStatus('CANCELLED')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              selectedStatus === 'CANCELLED'
                ? 'bg-brand text-on-brand'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            Cancelled
          </button>
        </div>

        {/* Date Selector (disabled when searching text query) */}
        {!debouncedQuery && (
          <div className="flex flex-col gap-1">
            <label htmlFor="order-date" className="text-xs font-semibold text-ink-muted">
              Delivery date
            </label>
            <input
              id="order-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="min-h-10 w-48 rounded-control border border-neutral-300 bg-white px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
          </div>
        )}
      </div>

      {/* Results / Skeletons / Error / Empty */}
      {isLoading && !data && (
        <div className="flex flex-col gap-3 animate-pulse">
          <div className="h-28 rounded-card bg-neutral-200" />
          <div className="h-28 rounded-card bg-neutral-200" />
          <div className="h-28 rounded-card bg-neutral-200" />
        </div>
      )}

      {error && !data && (
        <ErrorState
          title="Couldn't load orders"
          message={error.message}
          onRetry={() => void mutate()}
        />
      )}

      {data && data.orders.length === 0 && (
        <div className="py-12 text-center text-sm font-medium text-ink-muted">
          No orders match.
        </div>
      )}

      {data && data.orders.length > 0 && (
        <div className="flex flex-col gap-3">
          {data.orders.map((order) => (
            <OrderRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}
