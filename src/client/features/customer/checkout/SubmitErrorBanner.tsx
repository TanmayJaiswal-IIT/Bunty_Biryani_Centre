import { useEffect, useRef } from 'react';
import { Banner } from '../../../components/Banner';
import { copy } from '../../../copy';
import type { CheckoutErrorBanner } from './error-handling';

export interface SubmitErrorBannerProps {
  banner: CheckoutErrorBanner;
  onTryExpress?: () => void;
}

export function SubmitErrorBanner({ banner, onTryExpress }: SubmitErrorBannerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [banner.message]);

  const tone = banner.variant === 'warning' ? 'warning' : 'danger';

  return (
    <Banner
      ref={ref}
      tone={tone}
      role="alert"
      className="outline-none"
      action={
        banner.tryExpress && onTryExpress ? (
          <button
            type="button"
            onClick={onTryExpress}
            className="shrink-0 rounded px-2 py-1 text-xs font-semibold underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-current"
          >
            {copy.customer.checkout.tryExpress}
          </button>
        ) : undefined
      }
    >
      <p>{banner.message}</p>
    </Banner>
  );
}
