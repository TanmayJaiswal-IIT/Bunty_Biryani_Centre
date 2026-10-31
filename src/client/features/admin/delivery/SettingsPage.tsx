import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { ErrorState } from '../../../components/ErrorState.js';
import { Switch } from '../../../components/Switch.js';
import { copy } from '../../../copy.js';
import { api, ApiError } from '../../../lib/api.js';
import {
  playNewOrderSound,
  readSoundEnabled,
  writeSoundEnabled,
} from '../alerts/sound.js';
import {
  useAdminSettings,
  useDashboard,
  useLocations,
  useSlots,
} from '../api/hooks.js';
import { ADMIN_SETTINGS_KEY, dashboardKey } from '../api/keys.js';
import { patchSettings } from '../api/mutations.js';
import { useClearSwrCache } from '../auth/useAdminSession.js';
import { ControlSwitches } from '../today/ControlSwitches.js';
import { ExpressSettings } from './ExpressSettings.js';
import { LocationsSection } from './LocationsSection.js';
import { SlotsSection } from './SlotsSection.js';

export function SettingsPage() {
  const navigate = useNavigate();
  const clearCache = useClearSwrCache();
  const { mutate } = useSWRConfig();

  const {
    data: settings,
    error: settingsError,
    isLoading: settingsLoading,
    mutate: mutateSettings,
  } = useAdminSettings();

  const {
    data: dashboard,
    error: dashboardError,
    isLoading: dashboardLoading,
  } = useDashboard(null);

  const {
    data: locationsData,
    error: locationsError,
    isLoading: locationsLoading,
    mutate: mutateLocations,
  } = useLocations();

  const {
    data: slotsData,
    error: slotsError,
    isLoading: slotsLoading,
    mutate: mutateSlots,
  } = useSlots();

  // Batch fee form state
  const [batchFee, setBatchFee] = useState<string | null>(null);
  const [savingBatch, setSavingBatch] = useState(false);
  const [batchSuccess, setBatchSuccess] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  // Phone form state
  const [phone, setPhone] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSuccess, setPhoneSuccess] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Sound alert state
  const [soundEnabled, setSoundEnabled] = useState(() => readSoundEnabled());

  // Logout state
  const [loggingOut, setLoggingOut] = useState(false);

  const isLoading =
    (settingsLoading && !settings) ||
    (dashboardLoading && !dashboard) ||
    (locationsLoading && !locationsData) ||
    (slotsLoading && !slotsData);

  const error =
    settingsError || dashboardError || locationsError || slotsError;

  const retryAll = async () => {
    await Promise.all([
      mutateSettings(),
      mutateLocations(),
      mutateSlots(),
    ]);
  };

  if (error && !settings) {
    return (
      <div className="p-4">
        <ErrorState
          title="Couldn't load settings."
          message={error.message || 'Please check your connection and try again.'}
          onRetry={() => void retryAll()}
        />
      </div>
    );
  }

  if (isLoading || !settings) {
    return (
      <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto animate-pulse">
        <div className="h-8 w-40 rounded bg-neutral-200"></div>
        <div className="h-32 rounded-card bg-neutral-200"></div>
        <div className="h-48 rounded-card bg-neutral-200"></div>
        <div className="h-48 rounded-card bg-neutral-200"></div>
      </div>
    );
  }

  const effectiveBatchFee = batchFee !== null ? batchFee : String(settings.batchFee);
  const effectivePhone = phone !== null ? phone : (settings.contactPhone ?? '');

  const controls = dashboard?.controls ?? {
    ordersPaused: settings.ordersPaused,
    expressEnabled: settings.expressEnabled,
    expressAvailableNow: settings.expressEnabled,
    expressOpensAt: settings.expressOpensAt,
    expressClosesAt: settings.expressClosesAt,
  };

  const serverTime = dashboard?.serverTime ?? '19:00';
  const locations = locationsData?.locations ?? [];
  const slots = slotsData?.slots ?? [];

  const handleSaveBatchFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBatch(true);
    setBatchError(null);
    setBatchSuccess(false);

    const val = Number(effectiveBatchFee);
    if (isNaN(val) || val < 0) {
      setBatchError('Enter a valid non-negative fee');
      setSavingBatch(false);
      return;
    }

    try {
      await patchSettings({ batchFee: val });
      await Promise.all([
        mutate(ADMIN_SETTINGS_KEY),
        mutate(dashboardKey(null)),
      ]);
      setBatchSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setBatchError(err.message);
      } else {
        setBatchError('Failed to save batch fee');
      }
    } finally {
      setSavingBatch(false);
    }
  };

  const handleSavePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPhone(true);
    setPhoneError(null);
    setPhoneSuccess(false);

    const normalized = effectivePhone.trim() || null;
    try {
      await patchSettings({ contactPhone: normalized });
      await mutate(ADMIN_SETTINGS_KEY);
      setPhoneSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setPhoneError(err.message);
      } else {
        setPhoneError('Failed to save contact phone');
      }
    } finally {
      setSavingPhone(false);
    }
  };

  const handleToggleSound = (next: boolean) => {
    writeSoundEnabled(next);
    setSoundEnabled(next);
    if (next) {
      void playNewOrderSound();
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api<void>('/api/admin/logout', { method: 'POST' });
      await clearCache();
      void navigate('/admin/login', { replace: true });
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold font-display uppercase tracking-wide text-ink">
        Settings
      </h1>

      {/* 1. Ordering */}
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
          Ordering
        </h2>
        <ControlSwitches
          controls={controls}
          serverTime={serverTime}
          date={null}
        />
      </section>

      {/* 2. Express */}
      <ExpressSettings settings={settings} />

      {/* 3. Batch */}
      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
          Batch
        </h2>

        {batchSuccess && (
          <div className="rounded-control bg-success-soft p-3 text-sm font-semibold text-success">
            Batch fee saved.
          </div>
        )}

        {batchError && (
          <div className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">
            {batchError}
          </div>
        )}

        <form onSubmit={(e) => void handleSaveBatchFee(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="batch-fee" className="text-sm font-semibold text-ink">
              Batch delivery fee (₹)
            </label>
            <input
              id="batch-fee"
              type="text"
              inputMode="numeric"
              value={effectiveBatchFee}
              onChange={(e) => {
                setBatchFee(e.target.value);
                setBatchSuccess(false);
              }}
              placeholder="0"
              className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <span className="text-xs text-neutral-500">0 shows Free to customers.</span>
          </div>

          <Button type="submit" loading={savingBatch}>
            Save batch settings
          </Button>
        </form>
      </section>

      {/* 4. Locations */}
      <LocationsSection locations={locations} slots={slots} />

      {/* 5. Batch slots */}
      <SlotsSection slots={slots} locations={locations} />

      {/* 6. Customer help number */}
      <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
        <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
          Customer help number
        </h2>

        {phoneSuccess && (
          <div className="rounded-control bg-success-soft p-3 text-sm font-semibold text-success">
            Phone number saved.
          </div>
        )}

        {phoneError && (
          <div className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">
            {phoneError}
          </div>
        )}

        <form onSubmit={(e) => void handleSavePhone(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="contact-phone" className="text-sm font-semibold text-ink">
              Mobile number
            </label>
            <input
              id="contact-phone"
              type="tel"
              inputMode="tel"
              value={effectivePhone}
              onChange={(e) => {
                setPhone(e.target.value);
                setPhoneSuccess(false);
              }}
              placeholder="e.g. 9876543210"
              className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <span className="text-xs text-neutral-500">
              Shown on customer order confirmation pages. Leave empty to clear.
            </span>
          </div>

          <Button type="submit" loading={savingPhone}>
            Save phone number
          </Button>
        </form>
      </section>

      {/* 7. This device */}
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
          This device
        </h2>
        <Switch
          checked={soundEnabled}
          onChange={handleToggleSound}
          label="Sound alerts"
          description="Play a sound when a new order arrives"
        />
      </section>

      {/* 8. Account */}
      <section className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
          Account
        </h2>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleLogout()}
            loading={loggingOut}
          >
            {copy.admin.logout}
          </Button>
        </div>
        <p className="text-xs text-neutral-500">
          {copy.admin.settings.accountNote}
        </p>
      </section>
    </div>
  );
}
