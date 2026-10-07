import type { PublicOrderView } from '@shared/api-types.js';
import { formatINR } from '@shared/money.js';
import { formatPhone } from '@shared/phone.js';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { copy } from '../../../copy';
import { deliveryWhen } from './order-display';

const o = copy.customer.order;

const LINK_BASE =
  'inline-flex min-h-12 flex-1 items-center justify-center rounded-control px-5 text-base font-semibold';

/** How long "Copied" stays on the button. */
const COPIED_MS = 2_000;

function selectText(element: HTMLElement | null) {
  if (!element) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** Copies the order ID; if the browser won't allow it, selects the ID so the customer can. */
function CopyButton({
  orderNumber,
  idRef,
}: {
  orderNumber: string;
  idRef: RefObject<HTMLElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(orderNumber);
    } catch {
      selectText(idRef.current);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
  }

  return (
    <>
      <Button
        variant="secondary"
        aria-label={o.copyLabel}
        onClick={() => {
          void onCopy();
        }}
      >
        {copied ? o.copied : o.copyButton}
      </Button>
      <span role="status" className="sr-only">
        {copied ? o.copied : ''}
      </span>
    </>
  );
}

function HelpLine({ contactPhone }: { contactPhone: string }) {
  return (
    <p>
      {o.needHelp}{' '}
      <a
        href={`tel:${contactPhone}`}
        className="inline-flex min-h-12 items-center font-semibold text-brand underline underline-offset-2"
      >
        {o.call(formatPhone(contactPhone))}
      </a>
    </p>
  );
}

/** "ORDER PLACED" with the big, selectable order ID and Copy button (Batch 5 §8.2). */
function PlacedHeading({ orderNumber }: { orderNumber: string }) {
  const idRef = useRef<HTMLParagraphElement>(null);
  return (
    <header className="flex flex-col items-center gap-1 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
        <Icon name="check" size={28} />
      </span>
      <h2 className="display text-2xl">{o.placed}</h2>
      <p className="mt-2 text-sm text-ink-muted">{o.yourId}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <p
          ref={idRef}
          className="display text-[40px] leading-tight font-extrabold tracking-wider select-all"
        >
          {orderNumber}
        </p>
        <CopyButton orderNumber={orderNumber} idRef={idRef} />
      </div>
      <p className="text-sm text-ink-muted">{o.keepId}</p>
    </header>
  );
}

function StatusHeading({ order }: { order: PublicOrderView }) {
  return (
    <header className="flex flex-col items-center gap-2 text-center">
      <h2 className="display text-2xl">{o.heading(order.orderNumber)}</h2>
      {order.status === 'ORDER_RECEIVED' ? (
        <span className="rounded-full bg-gold-soft px-3 py-1 text-sm font-semibold">
          {o.received}
        </span>
      ) : null}
      {order.status === 'COMPLETED' ? (
        <span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success">
          {o.completed}
        </span>
      ) : null}
    </header>
  );
}

interface OrderDetailsProps {
  order: PublicOrderView;
  /** Arrived straight from placing the order. */
  placed: boolean;
  /** The IST business date from the menu, or `null` until it is known. */
  businessDate: string | null;
}

/** The confirmation and status view of one order (Batch 5 §8.2). Cash on delivery, never "paid". */
export function OrderDetails({ order, placed, businessDate }: OrderDetailsProps) {
  const cancelled = order.status === 'CANCELLED';
  // "Just placed" only while nothing has happened to the order since.
  const justPlaced = placed && order.status === 'ORDER_RECEIVED';
  const method =
    order.deliveryMode === 'EXPRESS'
      ? o.expressMethod(order.locationName)
      : o.batchMethod(order.locationName);

  return (
    <div className="flex flex-col gap-6 pb-2">
      {justPlaced ? (
        <PlacedHeading orderNumber={order.orderNumber} />
      ) : (
        <StatusHeading order={order} />
      )}

      {cancelled ? (
        <Banner tone="danger">
          <p>{o.cancelled}</p>
          {order.contactPhone ? <HelpLine contactPhone={order.contactPhone} /> : null}
        </Banner>
      ) : null}

      <section aria-labelledby="order-delivery">
        <h3 id="order-delivery" className="display text-lg">
          {o.deliveryHeading}
        </h3>
        <p className="mt-1 font-semibold">{method}</p>
        <p>{deliveryWhen(order, businessDate)}</p>
        {order.addressDetail ? <p className="text-ink-muted">{order.addressDetail}</p> : null}
      </section>

      <section aria-labelledby="order-items">
        <h3 id="order-items" className="display text-lg">
          {o.orderHeading}
        </h3>
        <ul className="mt-1 flex flex-col gap-1">
          {order.items.map((line, index) => (
            <li key={index} className="flex justify-between gap-3">
              <span>{o.itemLine(line.name, line.quantity)}</span>
              <span className="tabular-nums">{formatINR(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
          <p className="flex justify-between gap-3">
            <span>{o.delivery}</span>
            <span className="tabular-nums">
              {order.deliveryFee === 0 ? o.free : formatINR(order.deliveryFee)}
            </span>
          </p>
          <p className="flex justify-between gap-3 font-bold">
            <span>{o.total}</span>
            <span className="tabular-nums">{formatINR(order.total)}</span>
          </p>
        </div>
        {/* Nothing is owed on a cancelled order. */}
        {cancelled ? null : order.paymentStatus === 'COLLECTED' ? (
          <p className="mt-3 font-semibold">{o.collected}</p>
        ) : (
          <>
            <p className="mt-3 font-semibold">{o.payment}</p>
            <p className="text-ink-muted">{o.payInCash(formatINR(order.total))}</p>
          </>
        )}
      </section>

      {!cancelled && order.contactPhone ? <HelpLine contactPhone={order.contactPhone} /> : null}

      <nav className="flex gap-3">
        <Link to="/" className={`${LINK_BASE} bg-brand text-on-brand`}>
          {o.orderMore}
        </Link>
        <Link to="/track" className={`${LINK_BASE} border border-line bg-surface text-ink`}>
          {o.track}
        </Link>
      </nav>
    </div>
  );
}
