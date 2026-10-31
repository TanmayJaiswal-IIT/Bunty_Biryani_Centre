export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  loading?: boolean;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  loading = false,
  disabled = false,
}: SwitchProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading ? 'true' : undefined}
      disabled={isDisabled}
      onClick={() => {
        if (!isDisabled) {
          onChange(!checked);
        }
      }}
      className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-control px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand ${
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-neutral-50 active:bg-neutral-100'
      }`}
    >
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-neutral-900">{label}</span>
        {description && <span className="text-xs text-neutral-500">{description}</span>}
      </div>
      <div
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-brand' : 'bg-neutral-300'
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block size-4 transform rounded-full bg-white shadow-xs transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </div>
    </button>
  );
}
