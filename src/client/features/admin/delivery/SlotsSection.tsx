import type { AdminLocation, AdminSlot } from '@shared/api-types.js';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { ConfirmDialog } from '../../../components/ConfirmDialog.js';
import { Switch } from '../../../components/Switch.js';
import { ApiError } from '../../../lib/api.js';
import { ADMIN_LOCATIONS_KEY, ADMIN_SLOTS_KEY, dashboardKey } from '../api/keys.js';
import { createSlot, updateSlot } from '../api/mutations.js';
import { slotEditWarning, slotLine, slotsByLocation } from './settings-logic.js';

export interface SlotsSectionProps {
  slots: AdminSlot[];
  locations: AdminLocation[];
}

export function SlotsSection({ slots, locations }: SlotsSectionProps) {
  const { mutate } = useSWRConfig();

  // Add slot form state
  const [newLocationId, setNewLocationId] = useState<number>(
    locations[0]?.id ?? 0,
  );
  const [newDeliveryTime, setNewDeliveryTime] = useState('20:00');
  const [newCutoffTime, setNewCutoffTime] = useState('19:30');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit slot state
  const [editingSlotId, setEditingSlotId] = useState<number | null>(null);
  const [editDeliveryTime, setEditDeliveryTime] = useState('');
  const [editCutoffTime, setEditCutoffTime] = useState('');
  const [savingSlotId, setSavingSlotId] = useState<number | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // Warning dialog for editing slot with open orders
  const [pendingSaveSlot, setPendingSaveSlot] = useState<{
    slot: AdminSlot;
    deliveryTime: string;
    cutoffTime: string;
  } | null>(null);

  const revalidate = async () => {
    await Promise.all([
      mutate(ADMIN_SLOTS_KEY),
      mutate(ADMIN_LOCATIONS_KEY),
      mutate(dashboardKey(null)),
    ]);
  };

  const grouped = slotsByLocation(slots, locations);

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    if (newCutoffTime >= newDeliveryTime) {
      setAddError('Cutoff must be before the delivery time.');
      return;
    }

    const locId = newLocationId || locations[0]?.id;
    if (!locId) {
      setAddError('Please create a location first.');
      return;
    }

    setAdding(true);
    try {
      await createSlot({
        locationId: locId,
        deliveryTime: newDeliveryTime,
        cutoffTime: newCutoffTime,
      });
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        setAddError(err.message);
      } else {
        setAddError('Failed to add slot');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleToggleActive = async (slot: AdminSlot, next: boolean) => {
    try {
      await updateSlot(slot.id, { isActive: next });
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      }
    }
  };

  const handleToggleClosedToday = async (slot: AdminSlot, next: boolean) => {
    try {
      await updateSlot(slot.id, { closedToday: next });
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        alert(err.message);
      }
    }
  };

  const handleStartEdit = (slot: AdminSlot) => {
    setEditingSlotId(slot.id);
    setEditDeliveryTime(slot.deliveryTime);
    setEditCutoffTime(slot.cutoffTime);
    setEditError(null);
  };

  const handleSaveSlot = async (slot: AdminSlot) => {
    if (editCutoffTime >= editDeliveryTime) {
      setEditError('Cutoff must be before the delivery time.');
      return;
    }

    // Check if slot has open orders today
    if (
      slot.openOrdersToday > 0 &&
      (editDeliveryTime !== slot.deliveryTime ||
        editCutoffTime !== slot.cutoffTime)
    ) {
      setPendingSaveSlot({
        slot,
        deliveryTime: editDeliveryTime,
        cutoffTime: editCutoffTime,
      });
      return;
    }

    await performSlotUpdate(slot.id, editDeliveryTime, editCutoffTime);
  };

  const performSlotUpdate = async (
    id: number,
    deliveryTime: string,
    cutoffTime: string,
  ) => {
    setSavingSlotId(id);
    setEditError(null);
    try {
      await updateSlot(id, { deliveryTime, cutoffTime });
      setEditingSlotId(null);
      setPendingSaveSlot(null);
      await revalidate();
    } catch (err) {
      if (err instanceof ApiError) {
        setEditError(err.message);
      } else {
        setEditError('Failed to update slot');
      }
    } finally {
      setSavingSlotId(null);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
      <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
        Batch slots
      </h2>

      {grouped.map(({ location, slots: locSlots }) => (
        <div key={location.id} className="flex flex-col gap-2">
          <h3 className="text-base font-bold text-ink">{location.name}</h3>
          {locSlots.length === 0 ? (
            <p className="text-xs text-neutral-500">No slots for this location.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {locSlots.map((slot) => (
                <li
                  key={slot.id}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-semibold text-ink">{slotLine(slot)}</span>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(slot)}
                        className="text-xs text-neutral-500 hover:text-brand hover:underline"
                      >
                        Edit
                      </button>
                      <div className="w-28">
                        <Switch
                          checked={slot.isActive}
                          onChange={(next) => void handleToggleActive(slot, next)}
                          label="Active"
                        />
                      </div>
                      <div className="w-36">
                        <Switch
                          checked={slot.closedToday}
                          onChange={(next) =>
                            void handleToggleClosedToday(slot, next)
                          }
                          label="Closed today"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Inline edit mode */}
                  {editingSlotId === slot.id && (
                    <div className="flex flex-col gap-2 rounded-control bg-neutral-50 p-3 border border-neutral-200">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-ink">
                            Delivery time
                          </label>
                          <input
                            type="time"
                            step="60"
                            value={editDeliveryTime}
                            onChange={(e) => setEditDeliveryTime(e.target.value)}
                            className="min-h-10 rounded-control border border-neutral-300 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-semibold text-ink">
                            Cutoff time
                          </label>
                          <input
                            type="time"
                            step="60"
                            value={editCutoffTime}
                            onChange={(e) => setEditCutoffTime(e.target.value)}
                            className="min-h-10 rounded-control border border-neutral-300 bg-white px-2 text-sm text-ink focus:border-brand focus:outline-none"
                          />
                        </div>
                      </div>

                      {editError && (
                        <span className="text-xs font-semibold text-danger">
                          {editError}
                        </span>
                      )}

                      <div className="flex justify-end gap-2 mt-1">
                        <Button
                          className="min-h-10 px-3 text-sm"
                          variant="ghost"
                          onClick={() => setEditingSlotId(null)}
                          disabled={savingSlotId === slot.id}
                        >
                          Cancel
                        </Button>
                        <Button
                          className="min-h-10 px-3 text-sm"
                          loading={savingSlotId === slot.id}
                          onClick={() => void handleSaveSlot(slot)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {/* Add Slot Form */}
      <form
        onSubmit={(e) => void handleAddSlot(e)}
        className="flex flex-col gap-3 pt-3 border-t border-line"
      >
        <span className="text-sm font-semibold text-ink">Add batch slot</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <select
            value={newLocationId || locations[0]?.id}
            onChange={(e) => setNewLocationId(Number(e.target.value))}
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>

          <input
            type="time"
            step="60"
            value={newDeliveryTime}
            onChange={(e) => setNewDeliveryTime(e.target.value)}
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />

          <input
            type="time"
            step="60"
            value={newCutoffTime}
            onChange={(e) => setNewCutoffTime(e.target.value)}
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </div>

        {addError && (
          <span className="text-xs font-semibold text-danger">{addError}</span>
        )}

        <Button type="submit" loading={adding} disabled={locations.length === 0}>
          Add slot
        </Button>
      </form>

      {/* Slot edit warning dialog */}
      {pendingSaveSlot && (
        <ConfirmDialog
          open={Boolean(pendingSaveSlot)}
          title="Change slot time?"
          confirmLabel="Change time"
          cancelLabel="Keep current time"
          tone="primary"
          loading={savingSlotId === pendingSaveSlot.slot.id}
          onConfirm={() =>
            void performSlotUpdate(
              pendingSaveSlot.slot.id,
              pendingSaveSlot.deliveryTime,
              pendingSaveSlot.cutoffTime,
            )
          }
          onCancel={() => setPendingSaveSlot(null)}
        >
          <p>{slotEditWarning(pendingSaveSlot.slot)}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
