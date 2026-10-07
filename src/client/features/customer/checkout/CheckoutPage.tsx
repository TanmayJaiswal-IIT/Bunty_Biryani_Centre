import type {
  CreateOrderResponse,
  DeliverySlotOption,
  PublicMenu,
  PublicMenuItem,
} from '@shared/api-types.js';
import type { DeliveryMode } from '@shared/enums.js';
import { computeTotals } from '@shared/pricing.js';
import type { CreateOrderOutput } from '@shared/schemas/order.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Banner } from '../../../components/Banner';
import { ErrorState } from '../../../components/ErrorState';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { copy } from '../../../copy';
import { loadOrderPage, prefetch } from '../../../lazy-routes';
import { ApiError } from '../../../lib/api';
import { readStorage, removeStorage, writeStorage } from '../../../lib/storage';
import { useElapsedMinutes } from '../../../lib/use-elapsed-minutes';
import { useInView } from '../../../lib/use-in-view';
import { CART_EMPTY_STATE } from '../cart/cart-empty';
import { cartView } from '../cart/cart-reducer';
import { useCart } from '../cart/CartProvider';
import { useMenu } from '../menu/use-menu';
import { addRecentOrder } from '../order/recent-orders-storage';
import {
  FIELD_ORDER,
  buildOrderRequest,
  type DetailsForm,
  type FieldErrors,
  type OrderField,
} from './build-order-request';
import {
  CHECKOUT_DRAFT_KEY,
  REMEMBERED_CUSTOMER_KEY,
  parseDraft,
  parseRemembered,
  serializeDraft,
  type RememberedCustomer,
} from './checkout-storage';
import {
  DetailsSection,
  EMPTY_DETAILS,
  detailError,
  rememberedDetails,
  tidyDetail,
  type DetailField,
} from './DetailsSection';
import { describeSubmitError, type SubmitFailure } from './error-handling';
import { MethodSection } from './MethodSection';
import { OrderSection } from './OrderSection';
import { FINGERPRINT_ID, clearPendingOrder, orderFingerprint, requestIdFor } from './pending-order';
import { PlaceOrderBar, isTextEntry } from './PlaceOrderBar';
import {
  NO_SELECTION,
  chooseMethod,
  defaultSelection,
  isBatchOpen,
  isExpressOpen,
  resolveSelection,
  type Selection,
} from './selection';
import { SubmitErrorBanner } from './SubmitErrorBanner';
import { submitButtonState, submitOrder } from './submit-order';
import { SummarySection } from './SummarySection';
import { useDeliveryOptions, type LoadedDeliveryOptions } from './use-delivery-options';
import { WhereWhenSection } from './WhereWhenSection';

const c = copy.customer.checkout;
const m = copy.customer.menu;

const DRAFT_DEBOUNCE_MS = 300;
const DELIVERY_FIELDS: readonly OrderField[] = ['deliveryMode', 'slotId', 'locationId'];
const DETAIL_FIELDS: readonly OrderField[] = ['customerName', 'customerPhone', 'addressDetail'];
/** The radio group (input `name`) that shows each choice field's error. */
const RADIO_GROUPS: Partial<Record<OrderField, string>> = {
  deliveryMode: 'deliveryMode',
  slotId: 'slotId',
  locationId: 'expressLocationId',
};

type PendingFocus =
  { field: OrderField } | { expressLocationId: number } | { orderHeading: true } | { banner: true };

/** Router state for `/order/:orderNumber` after a successful submit (Batch 5 §8.1). */
interface PlacedOrderState {
  order: CreateOrderResponse;
  phone: string;
  placed: true;
}

function withoutErrors(errors: FieldErrors, fields: readonly OrderField[]): FieldErrors {
  const next = { ...errors };
  for (const field of fields) delete next[field];
  return next;
}

function withError(errors: FieldErrors, field: OrderField, message: string | undefined) {
  return message ? { ...errors, [field]: message } : withoutErrors(errors, [field]);
}

/** A field's text input, or the first radio in its group that can be chosen (else the first). */
function focusTarget(form: HTMLFormElement, field: OrderField): HTMLElement | null {
  const group = RADIO_GROUPS[field];
  if (group) {
    return (
      form.querySelector<HTMLElement>(`input[name="${group}"]:not([aria-disabled="true"])`) ??
      form.querySelector<HTMLElement>(`input[name="${group}"]`)
    );
  }
  // Items: the first control in Your order, the form's first section.
  if (field === 'items') return form.querySelector<HTMLElement>('button');
  return form.querySelector<HTMLElement>(`input[name="${field}"]`);
}

/** What a rejected order clears from the delivery choice (Batch 5 §7.3); the rest stays. */
function afterRejection(selection: Selection, change: SubmitFailure['selection']): Selection {
  switch (change) {
    case 'keep':
      return selection;
    case 'clearSlot':
      return { ...selection, slotId: null };
    case 'clearLocation':
      return { ...selection, slotId: null, locationId: null };
    case 'clearMethod':
      return { deliveryMode: null, slotId: null, locationId: selection.locationId };
  }
}

function readStored() {
  return {
    draft: parseDraft(readStorage(CHECKOUT_DRAFT_KEY, 'session')),
    remembered: parseRemembered(readStorage(REMEMBERED_CUSTOMER_KEY)),
  };
}

interface CheckoutFormProps {
  menu: PublicMenu;
  /** Undefined until the first successful fetch. */
  options: LoadedDeliveryOptions | undefined;
  optionsFailed: boolean;
  optionsRetrying: boolean;
  /** Refetch the delivery options: the inline retry, and after a rejection that changed them. */
  onRefreshOptions: () => void;
  /** Refetch the menu after a rejection about items or prices; the refetch reconciles the cart. */
  onRefreshMenu: () => void;
  /** Called just before the cart is cleared, so the page doesn't redirect the empty cart to the menu. */
  onPlaced: () => void;
  /**
   * The request kept for "Try again" (Decision 6), or null. The page owns it: its menu doesn't
   * reconcile the cart while one exists.
   */
  frozen: CreateOrderOutput | null;
  setFrozen: (request: CreateOrderOutput | null) => void;
}

function CheckoutForm({
  menu,
  options,
  optionsFailed,
  optionsRetrying,
  onRefreshOptions,
  onRefreshMenu,
  onPlaced,
  frozen,
  setFrozen,
}: CheckoutFormProps) {
  const navigate = useNavigate();
  const { cart, notices, increment, decrement, clear, applyStock, dismissNotices } = useCart();
  const [stored] = useState(readStored);
  const [remembered, setRemembered] = useState(stored.remembered);
  // A customer can't choose "no method", so a draft without one only saved a default: restore its
  // details (below) but not its selection, so today's default applies again.
  const [selection, setSelection] = useState<Selection | null>(
    stored.draft?.selection.deliveryMode ? stored.draft.selection : null,
  );
  const [details, setDetails] = useState<DetailsForm>(
    () => stored.draft?.details ?? rememberedDetails(stored.remembered),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState<ReadonlySet<DetailField>>(() => new Set());
  const [typing, setTyping] = useState(false);
  // In flight: the button spins and the fieldset is disabled. The ref is checked synchronously,
  // because a second tap can arrive before React re-renders with `submitting` set.
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  /** The last rejection's banner, shown at the top until the next attempt. */
  const [failure, setFailure] = useState<SubmitFailure | null>(null);
  // Set once the order is placed: the draft timer must not write the draft back after it's removed.
  const placedRef = useRef(false);
  // The in-form Place order button. While it is fully on screen the sticky bar steps aside, so
  // the end of the page shows one button, not two.
  const [inFormSubmit, setInFormSubmit] = useState<HTMLButtonElement | null>(null);
  const inFormSubmitVisible = useInView(inFormSubmit);
  // Set only by a tap (submit with errors, Try Express) or a rejected submit; the effect below
  // consumes it.
  const pendingFocus = useRef<PendingFocus | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);
  const whereWhenRef = useRef<HTMLFieldSetElement>(null);
  const orderHeadingRef = useRef<HTMLHeadingElement>(null);

  // Decision 5: the initial choice (draft, else the default) is set once, during render, when the
  // options first arrive. Whether it is still valid is derived below, never cleared in an effect.
  if (selection === null && options) setSelection(defaultSelection(remembered, options));

  const view = cartView(menu, cart);
  const resolved = options && selection ? resolveSelection(selection, options) : null;
  const fee =
    options && resolved?.mode
      ? resolved.mode === 'BATCH'
        ? options.batch.fee
        : options.express.fee
      : 0;
  const totals = computeTotals(
    view.lines.map((line) => ({ unitPrice: line.price, quantity: line.quantity })),
    fee,
  );
  const elapsed = useElapsedMinutes(options?.receivedAt ?? 0);
  const nothingOpen = options ? !isBatchOpen(options) && !isExpressOpen(options) : false;
  const button = submitButtonState({
    submitting,
    retrying: frozen !== null,
    options,
    total: totals.total,
  });
  // After an ORDERS_PAUSED rejection the focused banner above already says this.
  const pausedSaidAbove = failure?.banner === c.paused;
  // While options load, a restored method shows its list as skeletons; once they arrive, only a
  // method that is still valid shows one.
  const whereWhenMode: DeliveryMode | null = options
    ? (resolved?.mode ?? null)
    : optionsFailed
      ? null
      : (selection?.deliveryMode ?? null);

  useEffect(() => {
    if (selection === null) return;
    const timer = setTimeout(() => {
      if (placedRef.current) return;
      writeStorage(CHECKOUT_DRAFT_KEY, serializeDraft({ selection, details }), 'session');
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [selection, details]);

  useEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const form = formRef.current;
    if (!target || !form) return;
    if ('orderHeading' in target) {
      orderHeadingRef.current?.focus();
    } else if ('banner' in target) {
      bannerRef.current?.focus({ preventScroll: true });
      bannerRef.current?.scrollIntoView({ block: 'center' });
    } else if ('field' in target) {
      const el = focusTarget(form, target.field);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'center' });
    } else {
      const radio =
        form.querySelector<HTMLElement>(
          `input[name="expressLocationId"][value="${target.expressLocationId}"]`,
        ) ?? focusTarget(form, 'locationId');
      radio?.focus({ preventScroll: true });
      whereWhenRef.current?.scrollIntoView({ block: 'center' });
    }
  });

  function clearErrors(fields: readonly OrderField[]) {
    setErrors((prev) => withoutErrors(prev, fields));
  }

  /**
   * Every customer edit below starts here. The frozen request goes: from now on the fingerprint
   * decides the id (spec §7.1), so a changed order gets a new one. A network banner goes with it:
   * its "tap Try again, no duplicate" promise holds only for the frozen request. Other banners stay
   * until the next attempt.
   */
  function dropFrozen() {
    setFrozen(null);
    setFailure((f) => (f?.retryable ? null : f));
  }

  function onChooseMethod(mode: DeliveryMode) {
    dropFrozen();
    setSelection((prev) => chooseMethod(prev ?? NO_SELECTION, mode));
    clearErrors(DELIVERY_FIELDS);
  }

  function onChooseSlot(slot: DeliverySlotOption) {
    dropFrozen();
    setSelection({ deliveryMode: 'BATCH', slotId: slot.id, locationId: slot.locationId });
    clearErrors(['slotId']);
  }

  function onChooseExpressLocation(locationId: number) {
    dropFrozen();
    setSelection({ deliveryMode: 'EXPRESS', slotId: null, locationId });
    clearErrors(['locationId']);
  }

  /** Try Express, from a closed slot in Where & when or from a SLOT_CLOSED banner. */
  function onTryExpress(locationId: number) {
    dropFrozen();
    setSelection({ deliveryMode: 'EXPRESS', slotId: null, locationId });
    clearErrors(DELIVERY_FIELDS);
    pendingFocus.current = { expressLocationId: locationId };
  }

  function onBannerTryExpress(locationId: number) {
    // The banner has done its job; focus moves to the express location.
    setFailure(null);
    onTryExpress(locationId);
  }

  function onDetailChange(field: DetailField, value: string) {
    dropFrozen();
    setDetails((prev) => ({ ...prev, [field]: value }));
    setDirty((prev) => (prev.has(field) ? prev : new Set(prev).add(field)));
    if (errors[field]) setErrors((prev) => withError(prev, field, detailError(field, value)));
  }

  function onDetailBlur(field: DetailField) {
    const value = tidyDetail(field, details[field]);
    if (value !== details[field]) setDetails((prev) => ({ ...prev, [field]: value }));
    if (dirty.has(field)) setErrors((prev) => withError(prev, field, detailError(field, value)));
  }

  function onIncrement(item: PublicMenuItem) {
    dropFrozen();
    increment(item);
  }

  function onDecrement(menuItemId: number) {
    dropFrozen();
    // Removing a line removes the focused button; with other lines left, focus moves to the
    // heading (an emptied cart redirects away instead).
    const line = view.lines.find((l) => l.menuItemId === menuItemId);
    if (line?.quantity === 1 && view.lines.length > 1)
      pendingFocus.current = { orderHeading: true };
    decrement(menuItemId);
  }

  function onForget() {
    dropFrozen();
    removeStorage(REMEMBERED_CUSTOMER_KEY);
    setRemembered(null);
    setDetails(EMPTY_DETAILS);
    setDirty(new Set());
    clearErrors(DETAIL_FIELDS);
    // "Not you? Clear details" removes itself.
    pendingFocus.current = { field: 'customerName' };
  }

  /** Spec §7.2, in order. The form never renders again after this: the page leaves. */
  function onPlacedOrder(order: CreateOrderResponse, request: CreateOrderOutput) {
    addRecentOrder({
      orderNumber: order.orderNumber,
      phone: request.customerPhone,
      deliveryDate: order.deliveryDate,
    });
    const rememberedNow: RememberedCustomer = {
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      addressDetail: request.addressDetail,
      deliveryMode: request.deliveryMode,
      locationId: request.locationId,
    };
    writeStorage(REMEMBERED_CUSTOMER_KEY, JSON.stringify(rememberedNow));
    // Before the cart empties, or the page could redirect to the menu first (Decision 10).
    placedRef.current = true;
    onPlaced();
    clear();
    removeStorage(CHECKOUT_DRAFT_KEY, 'session');
    clearPendingOrder();
    const state: PlacedOrderState = { order, phone: request.customerPhone, placed: true };
    // Replace, so Back goes to the menu, not to an emptied checkout.
    void navigate(`/order/${order.orderNumber}`, { replace: true, state });
  }

  /** Spec §7.3: every rejection re-enables the form and moves focus to what needs attention. */
  function onRejected(error: ApiError, request: CreateOrderOutput) {
    const outcome = describeSubmitError(error, { request, options });
    setErrors(outcome.fieldErrors);
    setFailure(outcome.banner ? outcome : null);
    if (outcome.stockFixes.length > 0) applyStock(outcome.stockFixes);
    if (outcome.revalidateMenu) onRefreshMenu();
    if (outcome.revalidateOptions) onRefreshOptions();
    if (outcome.selection !== 'keep') {
      setSelection((prev) => (prev ? afterRejection(prev, outcome.selection) : prev));
    }
    if (outcome.newRequestId) clearPendingOrder();
    setFrozen(outcome.retryable ? request : null);
    submittingRef.current = false;
    setSubmitting(false);
    const first = FIELD_ORDER.find((field) => outcome.fieldErrors[field]);
    pendingFocus.current = first ? { field: first } : { banner: true };
  }

  async function send(request: CreateOrderOutput) {
    submittingRef.current = true;
    setSubmitting(true);
    setErrors({});
    setFailure(null);
    let order: CreateOrderResponse;
    try {
      order = await submitOrder(request);
    } catch (err) {
      // Anything that isn't an API answer (a body cut off mid-read, say) may still have placed
      // the order, so it is a network error: "Try again" with the same id.
      onRejected(
        err instanceof ApiError ? err : new ApiError(0, 'NETWORK_ERROR', 'Network error'),
        request,
      );
      return;
    }
    onPlacedOrder(order, request);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current || button.disabled) return;
    if (frozen) {
      // "Try again" resends the exact request, even if prices or the cutoff changed since: the
      // server replays an order that was placed, whatever the body says (Decision 6).
      void send(frozen);
      return;
    }
    if (!options || !selection) return;
    const result = buildOrderRequest({
      cartView: view,
      selection,
      details,
      options,
      clientRequestId: FINGERPRINT_ID,
    });
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((field) => result.errors[field]);
      if (first) pendingFocus.current = { field: first };
      return;
    }
    const built = result.request;
    // The same order content keeps the same id, so a double tap or a retry is one order (§7.1).
    void send({ ...built, clientRequestId: requestIdFor(orderFingerprint(built)) });
  }

  return (
    <>
      {failure ? (
        <SubmitErrorBanner
          ref={bannerRef}
          failure={failure}
          contactPhone={options?.contactPhone ?? null}
          onTryExpress={onBannerTryExpress}
        />
      ) : null}
      {options?.ordersPaused ? (
        pausedSaidAbove ? null : (
          <Banner tone="warning" role="alert" className="mb-4">
            {c.paused}
          </Banner>
        )
      ) : nothingOpen ? (
        <Banner tone="info" className="mb-4">
          {c.nothingOpen}
        </Banner>
      ) : null}
      <form
        id="checkout-form"
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        onFocus={(e) => {
          if (isTextEntry(e.target)) setTyping(true);
        }}
        onBlur={(e) => {
          if (!isTextEntry(e.relatedTarget)) setTyping(false);
        }}
      >
        {/* Disabled while the order is in flight, so nothing changes under it (§7.2). */}
        <fieldset disabled={submitting} className="flex min-w-0 flex-col gap-8">
          <OrderSection
            view={view}
            items={menu.items}
            notices={notices}
            error={errors.items}
            onIncrement={onIncrement}
            onDecrement={onDecrement}
            headingRef={orderHeadingRef}
            onDismissNotices={dismissNotices}
          />
          <MethodSection
            options={options}
            loadFailed={optionsFailed}
            retrying={optionsRetrying}
            onRetry={onRefreshOptions}
            mode={resolved?.mode ?? null}
            expressUnavailableNotice={
              resolved?.notices.some((n) => n.kind === 'expressUnavailable') ?? false
            }
            error={errors.deliveryMode}
            onChoose={onChooseMethod}
          />
          {whereWhenMode ? (
            <WhereWhenSection
              ref={whereWhenRef}
              mode={whereWhenMode}
              options={options}
              resolved={resolved}
              elapsedMinutes={elapsed}
              error={whereWhenMode === 'BATCH' ? errors.slotId : errors.locationId}
              onChooseSlot={onChooseSlot}
              onChooseExpressLocation={onChooseExpressLocation}
              onTryExpress={(slot) => {
                onTryExpress(slot.locationId);
              }}
            />
          ) : null}
          <DetailsSection
            details={details}
            errors={errors}
            mode={resolved?.mode ?? null}
            canForget={remembered !== null}
            onChange={onDetailChange}
            onBlur={onDetailBlur}
            onForget={onForget}
          />
          <SummarySection
            totals={totals}
            resolved={resolved}
            expressEta={options?.express.etaText ?? ''}
            submitDisabled={button.disabled}
            loading={button.loading}
            submitLabel={button.label}
            submitRef={setInFormSubmit}
          />
        </fieldset>
      </form>
      <PlaceOrderBar
        hidden={typing || inFormSubmitVisible}
        disabled={button.disabled}
        loading={button.loading}
        label={button.label}
      />
    </>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {/* The skeleton blocks are aria-hidden; screen readers hear this instead. */}
      <p role="status" className="sr-only">
        {copy.common.loading}
      </p>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/** `/checkout` (Batch 4 §5): one page from the cart to Place order. */
export function CheckoutPage() {
  const { cart } = useCart();
  // The confirmation page is its own chunk: have it ready before the order is placed.
  useEffect(() => {
    prefetch(loadOrderPage);
  }, []);
  // Decision 6: after a network error, timeout or 5xx, the exact request (same id, same body) is
  // kept for "Try again". Any customer edit drops it; background revalidation doesn't. It lives
  // here, not in the form, so the menu doesn't reconcile the cart while it exists: the customer's
  // own unconfirmed order may have sold out the cart, and reconciling would empty it and redirect
  // away, losing Try again (Batch 5 §7.2). Try again then replays the order, or its OUT_OF_STOCK
  // fixes the cart (applyStock). Once it is dropped, the next fetch reconciles as usual.
  const [frozen, setFrozen] = useState<CreateOrderOutput | null>(null);
  // Reconciles the cart on every successful fetch (see useMenu), except while a request is frozen.
  const {
    data: menu,
    error: menuError,
    isValidating: menuValidating,
    mutate: refreshMenu,
  } = useMenu({ reconcile: frozen === null });
  const {
    data: options,
    error: optionsError,
    isValidating: optionsValidating,
    mutate: refreshOptions,
  } = useDeliveryOptions(30_000);
  // Set by a successful submit just before it clears the cart (Decision 10).
  const [placed, setPlaced] = useState(false);

  // Arriving empty, removing the last line, reconcile emptying it (never while a request is
  // frozen), another tab emptying it (§5.2).
  // Once an order is placed the empty cart is expected: the navigation to the confirmation is on
  // its way (the router commits it in a transition, after the cart clears), and a redirect to the
  // menu from here could win the race. Until it lands the page shows its loading state.
  const leaving = placed && cart.lines.length === 0;
  if (cart.lines.length === 0 && !placed) {
    return <Navigate to="/" replace state={CART_EMPTY_STATE} />;
  }

  return (
    <>
      <header className="bg-sun">
        <div className="mx-auto flex max-w-120 items-center justify-between gap-3 px-2">
          <Link to="/" className="inline-flex min-h-12 items-center gap-1 px-2 font-semibold">
            <Icon name="chevron-left" />
            {c.back}
          </Link>
          <h1 className="display px-2 text-lg">{c.title}</h1>
        </div>
      </header>
      <main className="mx-auto max-w-120 px-4 pt-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {leaving ? (
          <CheckoutSkeleton />
        ) : menu ? (
          <CheckoutForm
            menu={menu}
            options={options}
            optionsFailed={!options && Boolean(optionsError)}
            optionsRetrying={optionsValidating}
            onRefreshOptions={() => void refreshOptions()}
            onRefreshMenu={() => void refreshMenu()}
            onPlaced={() => {
              setPlaced(true);
            }}
            frozen={frozen}
            setFrozen={setFrozen}
          />
        ) : menuError ? (
          <ErrorState
            title={m.loadErrorTitle}
            message={m.loadErrorMessage}
            onRetry={() => void refreshMenu()}
            retrying={menuValidating}
          />
        ) : (
          <CheckoutSkeleton />
        )}
      </main>
    </>
  );
}
