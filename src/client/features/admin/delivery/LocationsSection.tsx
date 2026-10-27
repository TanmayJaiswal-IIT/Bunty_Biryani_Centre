import type { AdminLocation, AdminSlot } from '@shared/api-types.js';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { ConfirmDialog } from '../../../components/ConfirmDialog.js';
import { Switch } from '../../../components/Switch.js';
import { copy } from '../../../copy.js';
import { ApiError } from '../../../lib/api.js';
import { ADMIN_LOCATIONS_KEY, ADMIN_SLOTS_KEY, dashboardKey } from '../api/keys.js';
import { createLocation, updateLocation } from '../api/mutations.js';
import { deactivateWarning } from './settings-logic.js';

export interface LocationsSectionProps {
  locations: AdminLocation[];
  slots?: AdminSlot[];
}

export function LocationsSection({ locations, slots }: LocationsSectionProps) {
  const { mutate } = useSWRConfig();

  // Add location state
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit / rename state per location
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<{ id: number; message: string } | null>(null);

  // Deactivate confirm dialog state
  const [pendingDeactivate, setPendingDeactivate] = useState<AdminLocation | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  const revalidate = async () => {
    await Promise.all([
      mutate(ADMIN_LOCATIONS_KEY),
      mutate(ADMIN_SLOTS_KEY),
      mutate(dashboardKey(null)),
    ]);
  };

  const handleAddLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;

    setAdding(true);
    setAddError(null);
    try {
      await createLocation({ name: trimmed });
      setNewName('');
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.message);
      } else {
        setAddError('Failed to add location');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggleActive = async (loc: AdminLocation, next: boolean) => {
    if (!next) {
      // Check if location has active slots
      const warning = deactivateWarning(loc, slots ? slots.filter((s) => s.locationId === loc.id && s.isActive).length : undefined);
      if (warning) {
        setPendingDeactivate(loc);
        return;
      }
    }

    try {
      await updateLocation(loc.id, { isActive: next });
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      }
    }
  };

  const handleConfirmDeactivate = async () => {
    if (!pendingDeactivate) return;
    setDeactivating(true);
    try {
      await updateLocation(pendingDeactivate.id, { isActive: false });
      setPendingDeactivate(null);
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      }
    } finally {
      setDeactivating(false);
    }
  };

  const handleStartRename = (loc: AdminLocation) => {
    setEditingId(loc.id);
    setEditName(loc.name);
    setRenameError(null);
  };

  const handleSaveRename = async (id: number) => {
    const trimmed = editName.trim();
    if (!trimmed) return;

    setRenaming(true);
    setRenameError(null);
    try {
      await updateLocation(id, { name: trimmed });
      setEditingId(null);
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        setRenameError({ id, message: err.message });
      } else {
        setRenameError({ id, message: 'Failed to rename location' });
      }
    } finally {
      setRenaming(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
      <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
        Locations
      </h2>

      {locations.length === 0 ? (
        <p className="text-sm text-neutral-500">{copy.admin.settings.noLocations}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {locations.map((loc) => (
            <li key={loc.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                {editingId === loc.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-h-10 flex-1 rounded-control border border-neutral-300 bg-white px-3 text-sm text-ink focus:border-brand focus:outline-none"
                    />
                    <Button
                      className="min-h-10 px-3 text-sm"
                      loading={renaming}
                      onClick={() => void handleSaveRename(loc.id)}
                    >
                      Save
                    </Button>
                    <Button
                      className="min-h-10 px-3 text-sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      disabled={renaming}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{loc.name}</span>
                    <button
                      type="button"
                      onClick={() => handleStartRename(loc)}
                      className="text-xs text-neutral-500 hover:text-brand hover:underline"
                    >
                      Rename
                    </button>
                  </div>
                )}

                <div className="w-32">
                  <Switch
                    checked={loc.isActive}
                    onChange={(next) => void handleToggleActive(loc, next)}
                    label="Active"
                  />
                </div>
              </div>

              {renameError && renameError.id === loc.id && (
                <span className="text-xs font-semibold text-danger">
                  {renameError.message}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add Location Form */}
      <form onSubmit={(e) => void handleAddLocation(e)} className="flex flex-col gap-2 pt-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setAddError(null);
            }}
            placeholder="Add new location"
            className="min-h-12 flex-1 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <Button type="submit" loading={adding} disabled={!newName.trim()}>
            Add location
          </Button>
        </div>
        {addError && (
          <span className="text-xs font-semibold text-danger">{addError}</span>
        )}
      </form>

      {/* Deactivate confirmation dialog */}
      {pendingDeactivate && (
        <ConfirmDialog
          open={Boolean(pendingDeactivate)}
          title="Deactivate location?"
          confirmLabel="Deactivate"
          cancelLabel="Keep active"
          tone="danger"
          loading={deactivating}
          onConfirm={() => void handleConfirmDeactivate()}
          onCancel={() => setPendingDeactivate(null)}
        >
          <p>
            {deactivateWarning(
              pendingDeactivate,
              slots
                ? slots.filter(
                    (s) => s.locationId === pendingDeactivate.id && s.isActive,
                  ).length
                : undefined,
            )}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
