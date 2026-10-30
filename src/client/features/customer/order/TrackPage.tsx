import type { PublicOrderView } from '@shared/api-types.js';
import { lookupSchema } from '@shared/schemas/order.js';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { AppHeader } from '../../../components/AppHeader';
import { BackToMenuLink } from '../../../components/BackToMenuLink';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { CustomerPage } from '../../../components/CustomerPage';
import { TextField } from '../../../components/TextField';
import { copy } from '../../../copy';
import { api, ApiError } from '../../../lib/api';
import { RecentOrders } from './RecentOrders';
import { saveRecentOrder } from './recent-orders-storage';

export interface TrackFormProps {
  initialOrderNumber?: string;
  initialPhone?: string;
  onSuccess?: (order: PublicOrderView, phone: string) => void;
}

export function TrackForm({ initialOrderNumber = '', initialPhone = '', onSuccess }: TrackFormProps) {
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState(initialPhone);
  const [submitting, setSubmitting] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ orderNumber?: string; phone?: string }>({});
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setFieldErrors({});

    const parseResult = lookupSchema.safeParse({ orderNumber, phone });
    if (!parseResult.success) {
      const errs: { orderNumber?: string; phone?: string } = {};
      for (const issue of parseResult.error.issues) {
        const field = issue.path[0];
        if (field === 'orderNumber' || field === 'phone') {
          errs[field] = issue.message;
        }
      }
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      const order = await api<PublicOrderView>('/api/orders/lookup', {
        method: 'POST',
        body: parseResult.data,
      });

      saveRecentOrder({
        orderNumber: order.orderNumber,
        phone: parseResult.data.phone,
        deliveryDate: order.deliveryDate,
      });

      if (onSuccess) {
        onSuccess(order, parseResult.data.phone);
      } else {
        void navigate(`/order/${order.orderNumber}`, {
          state: { order, phone: parseResult.data.phone },
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404 || err.code === 'ORDER_NOT_FOUND') {
          setBannerError(copy.customer.track.notFound);
        } else if (err.status === 429 || err.code === 'RATE_LIMITED') {
          setBannerError(copy.customer.track.rateLimited);
        } else {
          setBannerError(err.message || copy.common.genericError);
        }
      } else {
        setBannerError(copy.common.networkError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      {bannerError && (
        <Banner tone="danger" role="alert">
          <p>{bannerError}</p>
        </Banner>
      )}

      <TextField
        label={copy.customer.track.orderNumberLabel}
        placeholder={copy.customer.track.orderNumberPlaceholder}
        value={orderNumber}
        onChange={(e) => setOrderNumber(e.target.value)}
        error={fieldErrors.orderNumber}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck="false"
        disabled={submitting}
        required
      />

      <TextField
        label={copy.customer.track.phoneLabel}
        type="tel"
        inputMode="numeric"
        placeholder={copy.customer.track.phonePlaceholder}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        error={fieldErrors.phone}
        disabled={submitting}
        required
      />

      <Button
        type="submit"
        variant="primary"
        loading={submitting}
        aria-busy={submitting}
        className="mt-2 w-full"
      >
        {submitting ? copy.customer.track.submitting : copy.customer.track.submit}
      </Button>
    </form>
  );
}

export function TrackPage() {
  return (
    <CustomerPage>
      <AppHeader subline={copy.customer.track.title} />
      <div className="mx-auto flex max-w-120 flex-col gap-6 p-4">
        <div>
          <BackToMenuLink />
          <h1 className="mt-2 text-xl font-bold tracking-tight text-neutral-900">
            {copy.customer.track.heading}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{copy.customer.track.subline}</p>
        </div>

        <section className="rounded-card border border-neutral-200 bg-white p-4 shadow-xs">
          <TrackForm />
        </section>

        <RecentOrders />
      </div>
    </CustomerPage>
  );
}
export default TrackPage;
