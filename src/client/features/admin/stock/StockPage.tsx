import type { AdminMenuItem } from '@shared/api-types.js';
import { formatINR } from '@shared/money.js';
import { formatBusinessDate } from '@shared/time.js';
import { useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { ErrorState } from '../../../components/ErrorState.js';
import { copy } from '../../../copy.js';
import { isTextEntry } from '../../customer/checkout/PlaceOrderBar.js';
import { useAdminMenu, useDashboard } from '../api/hooks.js';
import { ADMIN_MENU_KEY, dashboardKey } from '../api/keys.js';
import { saveStock } from '../api/mutations.js';
import { useNavigationGuard } from '../layout/NavigationGuard.js';
import {
  applyYesterday,
  changedEntries,
  initialInputs,
  isDirty,
  orderedForStock,
  rowError,
  serverRowErrors,
  type StockInputs,
} from './stock-form.js';

export function StockPage() {
  const { data: dashboard } = useDashboard(null);
  const { data: menuData, error: menuError, isLoading, mutate: mutateMenu } = useAdminMenu();
  const { mutate } = useSWRConfig();
  const { setDirty } = useNavigationGuard();

  const items = menuData?.items ?? [];
  const [inputs, setInputs] = useState<StockInputs>(() =>
    items.length > 0 ? initialInputs(items) : {},
  );
  const [prevItems, setPrevItems] = useState<AdminMenuItem[] | undefined>(
    menuData?.items,
  );
  if (menuData?.items !== prevItems) {
    setPrevItems(menuData?.items);
    if (menuData?.items && menuData.items.length > 0) {
      setInputs(initialInputs(menuData.items));
    }
  }

  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [typing, setTyping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Dirty state tracking with NavigationGuard
  const dirty = isDirty(items, inputs);

  useEffect(() => {
    if (dirty) {
      setDirty(copy.admin.stock.discard);
    } else {
      setDirty(null);
    }
    return () => setDirty(null);
  }, [dirty, setDirty]);

  const handleInputChange = (id: number, val: string) => {
    setInputs((prev) => ({ ...prev, [id]: val }));
    setSaveSuccess(false);
    if (serverErrors[id]) {
      setServerErrors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleUseYesterday = () => {
    setInputs((prev) => applyYesterday(items, prev));
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    const entries = changedEntries(items, inputs);
    if (entries.length === 0) return;

    setSaving(true);
    setServerErrors({});
    try {
      await saveStock({ items: entries });
      await Promise.all([
        mutateMenu(),
        mutate(ADMIN_MENU_KEY),
        mutate(dashboardKey(dashboard?.date ?? null)),
      ]);
      setSaveSuccess(true);
      setDirty(null);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && 'details' in err) {
        setServerErrors(serverRowErrors(err as Parameters<typeof serverRowErrors>[0], items));
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4 animate-pulse">
        <div className="h-10 rounded-card bg-neutral-200" />
        <div className="h-32 rounded-card bg-neutral-200" />
        <div className="h-32 rounded-card bg-neutral-200" />
      </div>
    );
  }

  if (menuError && items.length === 0) {
    return (
      <ErrorState
        title="Couldn't load stock"
        message={menuError.message}
        onRetry={() => void mutateMenu()}
      />
    );
  }

  const { onMenu, hidden } = orderedForStock(items);
  const titleDate = dashboard?.date ? formatBusinessDate(dashboard.date) : '';

  const hasRowErrors = items.some((item) => {
    const raw = inputs[item.id] ?? '';
    return rowError(item, raw) !== null;
  });
  const hasServerErrors = Object.keys(serverErrors).length > 0;
  const cannotSave = !dirty || hasRowErrors || hasServerErrors || saving;

  const renderItemRow = (item: AdminMenuItem) => {
    const raw = inputs[item.id] ?? '';
    const errorMsg = rowError(item, raw) || serverErrors[item.id];
    const isFocused = focusedId === item.id;

    return (
      <div
        key={item.id}
        className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <span className="font-semibold text-ink">{item.name}</span>
            <span className="text-xs text-ink-muted">
              {formatINR(item.price)}
            </span>
          </div>

          <div className="flex flex-col items-end text-xs text-ink-muted">
            {item.stockSetToday ? (
              <span>
                Sold {item.soldToday} · Left {item.stockRemaining}
              </span>
            ) : (
              <span>Not set today</span>
            )}
            {item.stockDate !== null && !item.stockSetToday && (
              <span>last: {item.dailyStock}</span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1 mt-1">
          <label
            htmlFor={`stock-input-${item.id}`}
            className="text-xs font-semibold text-ink-muted"
          >
            Total for today
          </label>
          <input
            id={`stock-input-${item.id}`}
            type="text"
            inputMode="numeric"
            value={raw}
            onChange={(e) => handleInputChange(item.id, e.target.value)}
            onFocus={() => setFocusedId(item.id)}
            onBlur={() => setFocusedId(null)}
            placeholder="0"
            className={`min-h-12 w-full rounded-control border px-3 text-base text-ink focus:outline-none focus:ring-1 ${
              errorMsg
                ? 'border-danger focus:border-danger focus:ring-danger'
                : 'border-neutral-300 focus:border-brand focus:ring-brand'
            }`}
          />

          {isFocused && (
            <div className="text-xs text-ink-muted">
              Sold {item.soldToday} so far. Total can't be less than {item.soldToday}.
            </div>
          )}

          {errorMsg && (
            <div className="text-xs font-semibold text-danger">{errorMsg}</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col gap-4 p-4 max-w-2xl mx-auto pb-24"
      onFocus={(e) => {
        if (isTextEntry(e.target)) setTyping(true);
      }}
      onBlur={(e) => {
        if (!isTextEntry(e.relatedTarget)) setTyping(false);
      }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold font-display uppercase tracking-wide text-ink">
          TODAY'S STOCK · {titleDate}
        </h1>

        {items.length > 0 && (
          <Button variant="secondary" onClick={handleUseYesterday}>
            {copy.admin.stock.useYesterday}
          </Button>
        )}
      </div>

      {saveSuccess && (
        <div className="rounded-control bg-success-soft p-3 text-sm font-semibold text-success">
          {copy.admin.stock.saveSuccess}
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-12 text-center text-sm font-medium text-ink-muted">
          {copy.admin.stock.empty}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* On menu items */}
          {onMenu.map(renderItemRow)}

          {/* Hidden items */}
          {hidden.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              <h2 className="text-base font-bold text-ink">
                {copy.admin.stock.hiddenHeading}
              </h2>
              {hidden.map(renderItemRow)}
            </div>
          )}
        </div>
      )}

      {/* Sticky Save bar */}
      <div
        className={`${
          typing ? 'hidden' : 'fixed'
        } inset-x-0 bottom-16 z-30 mx-auto max-w-2xl border-t border-line bg-surface/95 p-4 backdrop-blur-xs shadow-lg`}
      >
        <Button
          fullWidth
          onClick={() => void handleSave()}
          disabled={cannotSave}
          loading={saving}
        >
          Save stock
        </Button>
      </div>
    </div>
  );
}
