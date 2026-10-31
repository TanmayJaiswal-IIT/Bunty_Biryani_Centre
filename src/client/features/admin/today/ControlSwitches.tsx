import type { Dashboard } from '@shared/api-types.js';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { ConfirmDialog } from '../../../components/ConfirmDialog.js';
import { Switch } from '../../../components/Switch.js';
import { dashboardKey } from '../api/keys.js';
import { ADMIN_SETTINGS_KEY } from '../api/keys.js';
import { patchSettings } from '../api/mutations.js';
import { expressSubtext } from './today-logic.js';

export interface ControlSwitchesProps {
  controls: Dashboard['controls'];
  serverTime: string;
  date?: string | null;
}

export function ControlSwitches({
  controls,
  serverTime,
  date = null,
}: ControlSwitchesProps) {
  const { mutate } = useSWRConfig();
  const [confirmPauseOpen, setConfirmPauseOpen] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [expressLoading, setExpressLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOrdersToggle = async (nextActive: boolean) => {
    if (!nextActive) {
      // Turning off requires confirmation
      setConfirmPauseOpen(true);
      return;
    }
    // Turning on does not ask
    setOrdersLoading(true);
    setError(null);
    try {
      await patchSettings({ ordersPaused: false });
      await Promise.all([
        mutate(dashboardKey(date)),
        mutate(ADMIN_SETTINGS_KEY),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update orders status');
    } finally {
      setOrdersLoading(false);
    }
  };

  const confirmPause = async () => {
    setOrdersLoading(true);
    setError(null);
    try {
      await patchSettings({ ordersPaused: true });
      await Promise.all([
        mutate(dashboardKey(date)),
        mutate(ADMIN_SETTINGS_KEY),
      ]);
      setConfirmPauseOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleExpressToggle = async (nextEnabled: boolean) => {
    setExpressLoading(true);
    setError(null);
    try {
      await patchSettings({ expressEnabled: nextEnabled });
      await Promise.all([
        mutate(dashboardKey(date)),
        mutate(ADMIN_SETTINGS_KEY),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update express status');
    } finally {
      setExpressLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Switch
          checked={!controls.ordersPaused}
          onChange={(next) => void handleOrdersToggle(next)}
          label="Orders"
          description={controls.ordersPaused ? 'Paused' : 'Taking orders'}
          loading={ordersLoading}
        />

        <Switch
          checked={controls.expressEnabled}
          onChange={(next) => void handleExpressToggle(next)}
          label="Express delivery"
          description={expressSubtext(controls, serverTime)}
          loading={expressLoading}
        />
      </div>

      {error && (
        <div className="mt-2 rounded-control bg-danger-soft p-2 text-xs font-semibold text-danger">
          {error}
        </div>
      )}

      <ConfirmDialog
        open={confirmPauseOpen}
        title="Pause all orders?"
        confirmLabel="Pause orders"
        cancelLabel="Keep taking orders"
        tone="danger"
        loading={ordersLoading}
        onConfirm={() => void confirmPause()}
        onCancel={() => setConfirmPauseOpen(false)}
      >
        <p>
          Customers won't be able to place any orders until you turn them back on.
        </p>
      </ConfirmDialog>
    </div>
  );
}
