import type { AdminSettings, SettingsUpdateInput } from '@shared/api-types.js';
import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Button } from '../../../components/Button.js';
import { ApiError } from '../../../lib/api.js';
import { dashboardKey, ADMIN_SETTINGS_KEY } from '../api/keys.js';
import { patchSettings } from '../api/mutations.js';
import { etaPreview, settingsFormToPatch } from './settings-logic.js';

export interface ExpressSettingsProps {
  settings: AdminSettings;
  onSave?: (patch: SettingsUpdateInput) => Promise<void>;
}

export function ExpressSettings({ settings, onSave }: ExpressSettingsProps) {
  const { mutate } = useSWRConfig();
  const [fee, setFee] = useState(String(settings.expressFee));
  const [minEta, setMinEta] = useState(String(settings.expressEtaMinMinutes));
  const [maxEta, setMaxEta] = useState(String(settings.expressEtaMaxMinutes));
  const [opensAt, setOpensAt] = useState(settings.expressOpensAt);
  const [closesAt, setClosesAt] = useState(settings.expressClosesAt);

  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const preview = etaPreview(minEta, maxEta);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setSuccess(false);

    const patch = settingsFormToPatch(
      {
        expressFee: fee,
        expressEtaMinMinutes: minEta,
        expressEtaMaxMinutes: maxEta,
        expressOpensAt: opensAt,
        expressClosesAt: closesAt,
      },
      settings,
    );

    if (Object.keys(patch).length === 0) {
      setSuccess(true);
      setSaving(false);
      return;
    }

    try {
      if (onSave) {
        await onSave(patch);
      } else {
        await patchSettings(patch);
        await Promise.all([
          mutate(ADMIN_SETTINGS_KEY),
          mutate(dashboardKey(null)),
        ]);
      }
      setSuccess(true);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (
          err.details &&
          typeof err.details === 'object' &&
          'fieldErrors' in err.details &&
          typeof err.details.fieldErrors === 'object' &&
          err.details.fieldErrors !== null
        ) {
          setFieldErrors(err.details.fieldErrors as Record<string, string>);
        }
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to save express settings',
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4">
      <h2 className="text-lg font-bold font-display uppercase tracking-wide text-ink">
        Express
      </h2>

      {success && (
        <div className="rounded-control bg-success-soft p-3 text-sm font-semibold text-success">
          Express settings saved.
        </div>
      )}

      {error && (
        <div className="rounded-control bg-danger-soft p-3 text-sm font-semibold text-danger">
          {error}
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-4">
        {/* Express fee */}
        <div className="flex flex-col gap-1">
          <label htmlFor="express-fee" className="text-sm font-semibold text-ink">
            Express delivery fee (₹)
          </label>
          <input
            id="express-fee"
            type="text"
            inputMode="numeric"
            value={fee}
            onChange={(e) => {
              setFee(e.target.value);
              setSuccess(false);
            }}
            placeholder="e.g. 30"
            className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          {fieldErrors.expressFee && (
            <span className="text-xs font-semibold text-danger">
              {fieldErrors.expressFee}
            </span>
          )}
        </div>

        {/* ETA min and max */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="express-eta-min" className="text-sm font-semibold text-ink">
              ETA minimum (min)
            </label>
            <input
              id="express-eta-min"
              type="text"
              inputMode="numeric"
              value={minEta}
              onChange={(e) => {
                setMinEta(e.target.value);
                setSuccess(false);
              }}
              placeholder="30"
              className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {fieldErrors.expressEtaMinMinutes && (
              <span className="text-xs font-semibold text-danger">
                {fieldErrors.expressEtaMinMinutes}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="express-eta-max" className="text-sm font-semibold text-ink">
              ETA maximum (min)
            </label>
            <input
              id="express-eta-max"
              type="text"
              inputMode="numeric"
              value={maxEta}
              onChange={(e) => {
                setMaxEta(e.target.value);
                setSuccess(false);
              }}
              placeholder="40"
              className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {fieldErrors.expressEtaMaxMinutes && (
              <span className="text-xs font-semibold text-danger">
                {fieldErrors.expressEtaMaxMinutes}
              </span>
            )}
          </div>
        </div>

        {/* Live ETA Preview */}
        {preview && (
          <div aria-live="polite" className="text-xs font-medium text-brand">
            {preview}
          </div>
        )}

        {/* Opens and Closes */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="express-opens" className="text-sm font-semibold text-ink">
              Opens
            </label>
            <input
              id="express-opens"
              type="time"
              step="60"
              value={opensAt}
              onChange={(e) => {
                setOpensAt(e.target.value);
                setSuccess(false);
              }}
              className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {fieldErrors.expressOpensAt && (
              <span className="text-xs font-semibold text-danger">
                {fieldErrors.expressOpensAt}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="express-closes" className="text-sm font-semibold text-ink">
              Closes
            </label>
            <input
              id="express-closes"
              type="time"
              step="60"
              value={closesAt}
              onChange={(e) => {
                setClosesAt(e.target.value);
                setSuccess(false);
              }}
              className="min-h-12 rounded-control border border-neutral-300 bg-white px-3 text-base text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
            />
            {fieldErrors.expressClosesAt && (
              <span className="text-xs font-semibold text-danger">
                {fieldErrors.expressClosesAt}
              </span>
            )}
          </div>
        </div>

        <div className="mt-2">
          <Button type="submit" loading={saving} fullWidth>
            Save express settings
          </Button>
        </div>
      </form>
    </section>
  );
}
