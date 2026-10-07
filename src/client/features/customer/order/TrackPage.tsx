import { formatPhone, normalizeIndianMobile } from '@shared/phone.js';
import { lookupSchema } from '@shared/schemas/order.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { TextField } from '../../../components/TextField';
import { copy } from '../../../copy';
import { ApiError } from '../../../lib/api';
import { RecentOrders } from './RecentOrders';
import { addRecentOrder } from './recent-orders-storage';
import { lookupOrder } from './use-order-lookup';

const t = copy.customer.track;

type Field = 'orderNumber' | 'phone';
type FieldErrors = Partial<Record<Field, string>>;

/** Each submit gets its own object, so the same message twice still moves focus to the banner. */
interface BannerMessage {
  text: string;
}

function lookupFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return t.notFound;
    if (error.status === 429) return t.rateLimited;
    if (error.code === 'NETWORK_ERROR') return copy.common.networkError;
  }
  return copy.common.genericError;
}

interface TrackFormProps {
  /** Prefills the order ID (the order page falls back to this form). */
  initialOrderNumber?: string;
  /** Start with the "couldn't find an order" banner (a stored phone didn't match). */
  notFound?: boolean;
}

/** Order ID + mobile number → the order page. Used by `/track` and by the order page's fallback. */
export function TrackForm({ initialOrderNumber = '', notFound = false }: TrackFormProps) {
  const navigate = useNavigate();
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<BannerMessage | null>(() =>
    notFound ? { text: t.notFound } : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  // A failed lookup moves focus to its message (screen readers and keyboards land on it).
  useEffect(() => {
    if (banner) bannerRef.current?.focus();
  }, [banner]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const parsed = lookupSchema.safeParse({ orderNumber, phone });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === 'orderNumber' || field === 'phone') && !next[field]) {
          next[field] = issue.message;
        }
      }
      setErrors(next);
      setBanner(null);
      const first: Field = next.orderNumber ? 'orderNumber' : 'phone';
      e.currentTarget.querySelector<HTMLInputElement>(`input[name="${first}"]`)?.focus();
      return;
    }
    setErrors({});
    setBanner(null);
    setSubmitting(true);
    try {
      const order = await lookupOrder(parsed.data);
      addRecentOrder({
        orderNumber: order.orderNumber,
        phone: parsed.data.phone,
        deliveryDate: order.deliveryDate,
      });
      // This form unmounts as the order page takes over, so there is nothing to reset.
      void navigate(`/order/${order.orderNumber}`, {
        state: { order, phone: parsed.data.phone, placed: false },
      });
    } catch (error) {
      setBanner({ text: lookupFailure(error) });
      setSubmitting(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-4"
    >
      {banner ? (
        <Banner ref={bannerRef} tone="danger">
          {banner.text}
        </Banner>
      ) : null}
      <TextField
        label={t.orderId}
        name="orderNumber"
        value={orderNumber}
        error={errors.orderNumber}
        onChange={(e) => {
          setOrderNumber(e.target.value);
        }}
        placeholder={t.orderIdPlaceholder}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="next"
      />
      <TextField
        label={t.phone}
        name="phone"
        value={phone}
        error={errors.phone}
        onChange={(e) => {
          setPhone(e.target.value);
        }}
        onBlur={() => {
          // A valid number shows the way it is printed on the order: 98765 43210.
          const tenDigits = normalizeIndianMobile(phone);
          if (tenDigits) setPhone(formatPhone(tenDigits));
        }}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder={copy.customer.checkout.phonePlaceholder}
        enterKeyHint="done"
      />
      <Button type="submit" loading={submitting} fullWidth>
        {submitting ? t.finding : t.submit}
      </Button>
    </form>
  );
}

/** `/track`: look an order up by ID and mobile number, or reopen one from this phone. */
export function TrackPage() {
  return (
    <>
      <h2 className="display mb-4 text-2xl">{t.title}</h2>
      <TrackForm />
      <RecentOrders />
    </>
  );
}
