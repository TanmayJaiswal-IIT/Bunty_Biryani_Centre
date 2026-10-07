import { Button } from '../../../components/Button';

/** Inputs that open the on-screen keyboard. */
const TEXT_INPUT_TYPES = new Set(['text', 'tel', 'email', 'number', 'search', 'url', 'password']);

/** True for a text input or textarea: while one has focus the bar is hidden. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

interface PlaceOrderBarProps {
  /**
   * Hidden while a text field has focus, so the bar never sits over it (§5.8), and while the
   * in-form Place order button is fully on screen, so the two never show together.
   */
  hidden: boolean;
  disabled: boolean;
  /** While the order is being sent: a spinner, `aria-busy`, and the button can't be tapped. */
  loading: boolean;
  label: string;
}

/** Sticky bottom Place order. It submits `#checkout-form` from outside the form element. */
export function PlaceOrderBar({ hidden, disabled, loading, label }: PlaceOrderBarProps) {
  return (
    <div
      hidden={hidden}
      className="fixed inset-x-0 bottom-0 z-10 bg-cream pb-[env(safe-area-inset-bottom)] shadow-bar"
    >
      <div className="mx-auto max-w-120 px-4 py-2">
        <Button
          type="submit"
          form="checkout-form"
          fullWidth
          disabled={disabled}
          loading={loading}
          className="min-h-14"
        >
          {label}
        </Button>
      </div>
    </div>
  );
}
