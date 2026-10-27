import { formatINR } from '@shared/money.js';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { ErrorState } from '../../../components/ErrorState.js';
import { Switch } from '../../../components/Switch.js';
import { useAdminMenu } from '../api/hooks.js';
import { ADMIN_MENU_KEY } from '../api/keys.js';
import { updateMenuItem } from '../api/mutations.js';
import { moveItem, sortOrderPatches } from './menu-logic.js';

export function MenuPage() {
  const { data, error, isLoading, mutate: mutateMenu } = useAdminMenu();
  const { mutate } = useSWRConfig();
  const [reordering, setReordering] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = data?.items ?? [];

  const handleToggleAvailable = async (id: number, isAvailable: boolean) => {
    setActionError(null);
    try {
      await updateMenuItem(id, { isAvailable });
      await mutate(ADMIN_MENU_KEY);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update item availability');
      await mutate(ADMIN_MENU_KEY);
    }
  };

  const handleMove = async (id: number, dir: -1 | 1) => {
    if (reordering) return;
    const nextItems = moveItem(items, id, dir);
    if (nextItems === items) return;

    const patches = sortOrderPatches(items, nextItems);
    if (patches.length === 0) return;

    setReordering(true);
    setActionError(null);
    try {
      for (const patch of patches) {
        await updateMenuItem(patch.id, { sortOrder: patch.sortOrder });
      }
      await mutate(ADMIN_MENU_KEY);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to reorder items');
      await mutate(ADMIN_MENU_KEY);
    } finally {
      setReordering(false);
    }
  };

  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4 animate-pulse">
        <div className="h-10 rounded-card bg-neutral-200" />
        <div className="h-24 rounded-card bg-neutral-200" />
        <div className="h-24 rounded-card bg-neutral-200" />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <ErrorState
        title="Couldn't load menu"
        message={error.message}
        onRetry={() => void mutateMenu()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold font-display uppercase tracking-wide text-ink">
          Menu
        </h1>
        <Link to="/admin/menu/new">
          <Button variant="primary">Add item</Button>
        </Link>
      </div>

      {actionError && (
        <div className="rounded-control bg-danger-soft p-3 text-xs font-semibold text-danger">
          {actionError}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="No menu items yet."
          message="Add your first item to start taking orders."
          icon="info"
          action={
            <Link to="/admin/menu/new">
              <Button variant="primary">Add your first item</Button>
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4"
            >
              {/* Item Info */}
              <div className="flex flex-col min-w-0">
                <Link
                  to={`/admin/menu/${item.id}`}
                  className="font-semibold text-ink hover:underline truncate"
                >
                  {item.name}
                </Link>
                <span className="text-sm text-ink-muted">
                  {formatINR(item.price)}
                </span>
              </div>

              {/* Controls: Switch & Reorder Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-36">
                  <Switch
                    checked={item.isAvailable}
                    onChange={(next) => void handleToggleAvailable(item.id, next)}
                    label="On menu"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${item.name} up`}
                    disabled={index === 0 || reordering}
                    onClick={() => void handleMove(item.id, -1)}
                    className="flex size-7 items-center justify-center rounded-control border border-line bg-surface text-xs font-bold text-ink hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.name} down`}
                    disabled={index === items.length - 1 || reordering}
                    onClick={() => void handleMove(item.id, 1)}
                    className="flex size-7 items-center justify-center rounded-control border border-line bg-surface text-xs font-bold text-ink hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ▼
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
