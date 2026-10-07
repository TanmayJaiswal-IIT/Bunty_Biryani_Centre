import { formatINR } from '@shared/money.js';
import type { Totals } from '@shared/pricing.js';
import { formatTime12h } from '@shared/time.js';
import type { Ref } from 'react';
import { Button } from '../../../components/Button';
import { copy } from '../../../copy';
import type { ResolvedSelection } from './selection';

const c = copy.customer.checkout;

/** "MSH · Today, 8:00 PM" or "Express to Kanhar · approx. 30–40 minutes", once that is chosen. */
function deliveryLine(resolved: ResolvedSelection | null, expressEta: string): string | null {
  if (resolved?.mode === 'BATCH' && resolved.slot) {
    return c.batchLine(resolved.slot.locationName, formatTime12h(resolved.slot.deliveryTime));
  }
  if (resolved?.mode === 'EXPRESS' && resolved.location) {
    return c.expressLine(resolved.location.name, expressEta);
  }
  return null;
}

function Row({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${total ? 'border-t border-line pt-1' : ''}`}>
      <dt className={total ? 'font-bold' : ''}>{label}</dt>
      <dd className={`price whitespace-nowrap ${total ? 'font-bold' : ''}`}>{value}</dd>
    </div>
  );
}

interface SummarySectionProps {
  /** From `computeTotals`: display only, the server recomputes (§5.7). */
  totals: Totals;
  resolved: ResolvedSelection | null;
  /** The express ETA text from the delivery options. */
  expressEta: string;
  submitDisabled: boolean;
  /** While the order is being sent: a spinner and `aria-busy`. */
  loading: boolean;
  submitLabel: string;
  /** Lets the page hide the sticky bar while this button is on screen. */
  submitRef?: Ref<HTMLButtonElement>;
}

/** Summary (§5.7): totals, where it goes, cash on delivery, and the in-flow Place order. */
export function SummarySection({
  totals,
  resolved,
  expressEta,
  submitDisabled,
  loading,
  submitLabel,
  submitRef,
}: SummarySectionProps) {
  const mode = resolved?.mode ?? null;
  const line = deliveryLine(resolved, expressEta);

  return (
    <section>
      <h2 className="display mb-3 text-lg">{c.summaryHeading}</h2>
      <dl className="flex flex-col gap-1">
        <Row label={c.food} value={formatINR(totals.foodSubtotal)} />
        {mode ? (
          <Row
            label={mode === 'BATCH' ? c.deliveryBatch : c.deliveryExpress}
            value={totals.deliveryFee === 0 ? c.free : formatINR(totals.deliveryFee)}
          />
        ) : null}
        <Row label={c.total} value={formatINR(totals.total)} total />
      </dl>
      {line ? <p className="mt-2">{line}</p> : null}
      <p className="mt-3 font-semibold">{c.payment}</p>
      <p className="text-sm text-ink-muted">{c.payInCash(formatINR(totals.total))}</p>
      <Button
        ref={submitRef}
        type="submit"
        fullWidth
        disabled={submitDisabled}
        loading={loading}
        className="mt-4 min-h-14"
      >
        {submitLabel}
      </Button>
    </section>
  );
}
