import { formatPhone } from '@shared/phone.js';
import type { Ref } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { copy } from '../../../copy';
import type { SubmitFailure } from './error-handling';

const c = copy.customer.checkout;
const o = copy.customer.order;

interface SubmitErrorBannerProps {
  /** The page focuses the banner when a submission fails (Batch 5 §7.3). */
  ref?: Ref<HTMLDivElement>;
  failure: SubmitFailure;
  /** The help number from the delivery options, or null when none is set. */
  contactPhone: string | null;
  onTryExpress: (locationId: number) => void;
}

/** Why the order wasn't placed, at the top of the checkout: the message, then what can be done. */
export function SubmitErrorBanner({
  ref,
  failure,
  contactPhone,
  onTryExpress,
}: SubmitErrorBannerProps) {
  const { banner, bannerExtra, tryExpressLocationId, showContact } = failure;
  return (
    <Banner ref={ref} tone="danger" className="mb-4">
      <p>{banner}</p>
      {bannerExtra ? <p className="mt-1">{bannerExtra}</p> : null}
      {tryExpressLocationId !== null ? (
        <Button
          variant="secondary"
          className="mt-2"
          onClick={() => {
            onTryExpress(tryExpressLocationId);
          }}
        >
          {c.tryExpress}
        </Button>
      ) : null}
      {showContact && contactPhone ? (
        <p className="mt-1">
          {o.needHelp}{' '}
          <a
            href={`tel:${contactPhone}`}
            className="inline-flex min-h-12 items-center font-semibold underline"
          >
            {o.call(formatPhone(contactPhone))}
          </a>
        </p>
      ) : null}
    </Banner>
  );
}
