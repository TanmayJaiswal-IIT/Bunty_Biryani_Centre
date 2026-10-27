import { useId } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon';

export interface OverflowMenuItem {
  label: string;
  onSelect?: () => void;
  to?: string;
  tone?: 'danger';
  disabled?: boolean;
  hint?: string;
}

export interface OverflowMenuProps {
  label: string;
  items: OverflowMenuItem[];
}

export function OverflowMenu({ label, items }: OverflowMenuProps) {
  const popoverId = useId().replace(/:/g, '-');
  const id = `overflow-menu-${popoverId}`;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        popoverTarget={id}
        aria-label={label}
        className="flex size-10 items-center justify-center rounded-control text-ink hover:bg-neutral-100 active:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Icon name="more" size={20} />
      </button>

      <div
        id={id}
        popover="auto"
        className="fixed inset-x-0 bottom-0 m-0 max-h-[80vh] w-full max-w-120 mx-auto rounded-t-card border-t border-line bg-surface p-4 shadow-xl backdrop:bg-black/40 open:flex open:flex-col open:gap-1"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300" />
        <ul className="flex flex-col gap-1">
          {items.map((item, index) => {
            const isDanger = item.tone === 'danger';
            const baseClass = `flex min-h-12 w-full items-center justify-between rounded-control px-4 py-2 text-left text-sm font-semibold transition-colors ${
              item.disabled
                ? 'cursor-not-allowed opacity-50'
                : isDanger
                  ? 'text-danger hover:bg-danger-soft active:bg-danger-soft'
                  : 'text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200'
            }`;

            if (item.to && !item.disabled) {
              return (
                <li key={index}>
                  <Link to={item.to} className={baseClass}>
                    <span>{item.label}</span>
                    {item.hint && <span className="text-xs font-normal text-neutral-500">{item.hint}</span>}
                  </Link>
                </li>
              );
            }

            return (
              <li key={index}>
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={item.onSelect}
                  className={baseClass}
                >
                  <span>{item.label}</span>
                  {item.hint && <span className="text-xs font-normal text-neutral-500">{item.hint}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
