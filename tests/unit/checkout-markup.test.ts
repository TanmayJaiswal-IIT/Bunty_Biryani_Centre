// Static-markup checks for the checkout form building blocks (Batch 4 Task 4), the checkout
// page (Task 6) and its submission states (Batch 5 Task 7).
import { createElement as h } from 'react';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { PublicMenu } from '../../src/shared/api-types';
import type { CreateOrderOutput } from '../../src/shared/schemas/order';
import { Banner } from '../../src/client/components/Banner';
import { RadioCard } from '../../src/client/components/RadioCard';
import { TextField } from '../../src/client/components/TextField';
import { copy } from '../../src/client/copy';
import { CART_STORAGE_KEY } from '../../src/client/features/customer/cart/cart-storage';
import { CartProvider } from '../../src/client/features/customer/cart/CartProvider';
import type { DetailsForm } from '../../src/client/features/customer/checkout/build-order-request';
import { CheckoutPage } from '../../src/client/features/customer/checkout/CheckoutPage';
import {
  CHECKOUT_DRAFT_KEY,
  REMEMBERED_CUSTOMER_KEY,
  serializeDraft,
} from '../../src/client/features/customer/checkout/checkout-storage';
import { describeSubmitError } from '../../src/client/features/customer/checkout/error-handling';
import { PlaceOrderBar } from '../../src/client/features/customer/checkout/PlaceOrderBar';
import type { Selection } from '../../src/client/features/customer/checkout/selection';
import { SubmitErrorBanner } from '../../src/client/features/customer/checkout/SubmitErrorBanner';
import {
  DELIVERY_OPTIONS_KEY,
  deliveryOptionsSwrOptions,
} from '../../src/client/features/customer/checkout/use-delivery-options';
import { MENU_KEY } from '../../src/client/features/customer/menu/use-menu';
import { ApiError } from '../../src/client/lib/api';
import { closedSlot, opts, type DeliveryOptionsOverride } from '../helpers/delivery-fixtures';
import { escaped, item, render, withWindowStorage } from '../helpers/markup';

const noop = () => undefined;
const base = { name: 'method', value: 'express', onChoose: noop, title: 'Express Delivery' };
// The attribute, not Tailwind's `disabled:` variants in the class list.
const DISABLED_ATTR = /\sdisabled=""/;
const describedBy = (html: string) => /aria-describedby="([^"]*)"/.exec(html)?.[1]?.split(' ');

describe('RadioCard', () => {
  it('R1: an enabled checked card is a real, checked, enabled radio', () => {
    const html = render(h(RadioCard, { ...base, checked: true }));
    expect(html).toContain('<input type="radio"');
    expect(html).toContain('checked=""');
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toMatch(DISABLED_ATTR);
  });

  it('R2: a disabled card stays focusable and links its reason through aria-describedby', () => {
    const reason = 'Express delivery is currently unavailable.';
    const html = render(h(RadioCard, { ...base, checked: false, disabled: true, reason }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(DISABLED_ATTR);
    const reasonId = new RegExp(`<p id="([^"]*)"[^>]*>${reason}</p>`).exec(html)?.[1];
    expect(reasonId).toBeTruthy();
    expect(describedBy(html)).toEqual([reasonId]);
  });

  it('F8: the reason sits outside the label, so it is not part of the accessible name', () => {
    const reason = 'Express delivery is currently unavailable.';
    const html = render(h(RadioCard, { ...base, checked: false, disabled: true, reason }));
    const label = /<label[\s\S]*?<\/label>/.exec(html)?.[0] ?? '';
    expect(label).toContain('Express Delivery');
    expect(label).not.toContain(reason);
    // Still inside the card container, after the label.
    expect(html).toMatch(new RegExp(`</label><p id="[^"]*"[^>]*>${reason}</p></div>$`));
  });

  it('F8: an aside of 0 renders as 0, and no aside renders nothing', () => {
    expect(render(h(RadioCard, { ...base, checked: false, aside: 0 }))).toContain('>0<');
    expect(render(h(RadioCard, { ...base, checked: false }))).not.toContain('text-right');
  });

  it('R3: an errorId is part of aria-describedby', () => {
    const html = render(h(RadioCard, { ...base, checked: false, errorId: 'e1' }));
    expect(describedBy(html)).toEqual(['e1']);
  });

  it('describes a disabled card by its reason and the error', () => {
    const html = render(
      h(RadioCard, { ...base, checked: false, disabled: true, reason: 'Closed.', errorId: 'e1' }),
    );
    expect(describedBy(html)).toHaveLength(2);
    expect(describedBy(html)).toContain('e1');
  });
});

describe('TextField', () => {
  it('TF1: while an error shows, aria-describedby names only ids that exist', () => {
    const html = render(h(TextField, { label: 'Name', hint: 'As on your ID', error: 'Too short' }));
    const ids = describedBy(html);
    expect(ids).toHaveLength(1);
    for (const id of ids ?? []) expect(html).toContain(`id="${id}"`);
    expect(html).not.toContain('As on your ID');
  });

  it('points at the hint when it renders', () => {
    const html = render(h(TextField, { label: 'Name', hint: 'As on your ID' }));
    const ids = describedBy(html);
    expect(ids).toHaveLength(1);
    expect(html).toContain(`<p id="${ids?.[0]}" class="text-sm text-ink-muted">As on your ID</p>`);
  });

  it('TF2: renders the counter and references it from aria-describedby', () => {
    const html = render(h(TextField, { label: 'Room', counter: '101/120' }));
    const ids = describedBy(html);
    expect(ids).toHaveLength(1);
    expect(html).toMatch(new RegExp(`<p id="${ids?.[0]}"[^>]*>101/120</p>`));
  });
});

describe('Banner', () => {
  it('B1: an explicit role overrides the tone default', () => {
    const html = render(h(Banner, { tone: 'warning', role: 'alert', children: 'Paused' }));
    expect(html).toContain('role="alert"');
  });

  it('keeps the defaults: alert for danger, status otherwise', () => {
    expect(render(h(Banner, { tone: 'danger', children: 'x' }))).toContain('role="alert"');
    expect(render(h(Banner, { tone: 'warning', children: 'x' }))).toContain('role="status"');
  });
});

describe('deliveryOptionsSwrOptions', () => {
  it('D1: polls at the given interval and keeps stale data while revalidating', () => {
    expect(deliveryOptionsSwrOptions(30_000)).toEqual({
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
      keepPreviousData: true,
    });
  });
});

// ---- Checkout page ----------------------------------------------------------------------------

const MENU: PublicMenu = { businessDate: '2026-10-04', ordersPaused: false, items: [item()] };
// 2 × Chicken Biryani at ₹150: Food ₹300.
const CART = JSON.stringify({
  businessDate: '2026-10-04',
  lines: [{ menuItemId: 1, quantity: 2, name: 'Chicken Biryani' }],
});
const NO_DETAILS: DetailsForm = { customerName: '', customerPhone: '', addressDetail: '' };
const REMEMBERED = JSON.stringify({
  customerName: 'Rahul Verma',
  customerPhone: '9876543210',
  addressDetail: null,
  deliveryMode: 'EXPRESS',
  locationId: 2,
});

interface CheckoutSetup {
  /** Delivery options: overrides on the §8.4 example (default), a failed fetch, or none yet. */
  delivery?: DeliveryOptionsOverride | 'failed' | 'pending';
  /** A sessionStorage draft. */
  draft?: { selection: Selection; details?: DetailsForm };
  /** Extra localStorage entries. */
  local?: Record<string, string>;
  emptyCart?: boolean;
}

function renderCheckout(setup: CheckoutSetup = {}): string {
  const { delivery = {}, draft, local = {}, emptyCart = false } = setup;
  const cache = new Map<string, object>();
  if (delivery === 'failed') {
    cache.set(DELIVERY_OPTIONS_KEY, { error: new Error('offline'), isValidating: false });
  }
  const fallback = {
    [MENU_KEY]: MENU,
    ...(typeof delivery === 'object'
      ? { [DELIVERY_OPTIONS_KEY]: { ...opts(delivery), receivedAt: 0 } }
      : {}),
  };
  const session: Record<string, string> = draft
    ? {
        [CHECKOUT_DRAFT_KEY]: serializeDraft({
          selection: draft.selection,
          details: draft.details ?? NO_DETAILS,
        }),
      }
    : {};
  const value = { provider: () => cache, fallback };
  return withWindowStorage(
    { local: { ...(emptyCart ? {} : { [CART_STORAGE_KEY]: CART }), ...local }, session },
    () => render(h(SWRConfig, { value }, h(CartProvider, null, h(CheckoutPage)))),
  );
}

/** Every `<button type="submit"`, whole element. */
const submitButtons = (html: string) =>
  [...html.matchAll(/<button type="submit"[\s\S]*?<\/button>/g)].map((m) => m[0]);

/** The opening tag of the radio with this name and value, whatever the attribute order. */
function radio(html: string, name: string, value: string): string {
  const tag = new RegExp(`<input(?=[^>]*\\sname="${name}")(?=[^>]*\\svalue="${value}")[^>]*>`);
  const match = tag.exec(html)?.[0];
  if (!match) throw new Error(`no radio ${name}=${value}`);
  return match;
}

const batch = (slotId: number | null): Selection => ({
  deliveryMode: 'BATCH',
  slotId,
  locationId: slotId,
});
const express = (locationId: number | null): Selection => ({
  deliveryMode: 'EXPRESS',
  slotId: null,
  locationId,
});

describe('CheckoutPage', () => {
  it('C1: an empty cart redirects: no form and no Place order', () => {
    const html = renderCheckout({ emptyCart: true });
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Place order');
  });

  it('C2: shows the brief §4 method copy, nothing preselected, an enabled Place order', () => {
    const html = renderCheckout();
    for (const text of [
      'Batch Delivery',
      'Regular delivery',
      'Choose location and fixed delivery slot',
      'Express Delivery',
      'Delivered in approximately 30–40 minutes',
      '+₹30 delivery charge',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('checked=""');
    // Decision 10: no Delivery row until a method is chosen.
    expect(html).not.toContain('Delivery ·');
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain('Place order · ₹300');
      expect(button).not.toMatch(DISABLED_ATTR);
    }
    expect(html).toMatch(/<legend[^>]*>(?:(?!<\/legend>)[\s\S])*Delivery method/);
  });

  it('C3: paused shows an alert banner and disables both buttons', () => {
    const html = renderCheckout({ delivery: { ordersPaused: true } });
    expect(html).toMatch(
      /role="alert"[^>]*>(?:(?!role=)[\s\S])*Orders are temporarily paused\. Please check again shortly\./,
    );
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toMatch(DISABLED_ATTR);
      expect(button).toContain('Orders are paused');
    }
  });

  it('C4: unavailable express is a disabled card with the reason', () => {
    const off = renderCheckout({
      delivery: { express: { available: false, unavailableReason: 'DISABLED' } },
    });
    expect(radio(off, 'deliveryMode', 'EXPRESS')).toContain('aria-disabled="true"');
    expect(radio(off, 'deliveryMode', 'BATCH')).not.toContain('aria-disabled');
    expect(off).toContain('Express delivery is currently unavailable.');

    const hours = renderCheckout({
      delivery: { express: { available: false, unavailableReason: 'OUTSIDE_HOURS' } },
    });
    expect(radio(hours, 'deliveryMode', 'EXPRESS')).toContain('aria-disabled="true"');
    expect(hours).toContain('Express delivery runs 11:00 AM–11:00 PM.');
  });

  it('C5: a restored slot that has since closed shows unselected, explained, with Try Express', () => {
    const html = renderCheckout({
      delivery: { slots: { 1: closedSlot('CUTOFF_PASSED') } },
      draft: { selection: batch(1) },
    });
    expect(html).toContain('Orders for this delivery slot are closed.');
    expect(html).toContain('Batch orders for MSH are closed. Express delivery is available.');
    expect(html).toContain('Try Express Delivery');
    expect(html).toContain('Orders for MSH — 8:00 PM just closed.');
    expect(radio(html, 'slotId', '1')).not.toContain('checked=""');
    expect(radio(html, 'slotId', '2')).not.toContain('checked=""');
  });

  it('F2: no "closed, Express available" nudge when the location still has an open slot', () => {
    // Two MSH slots: the earlier closed, the later open.
    const msh2 = { locationId: 1, locationName: 'MSH', deliveryTime: '21:00', cutoffTime: '20:30' };
    const html = renderCheckout({
      delivery: { slots: { 1: closedSlot(), 2: msh2 } },
      draft: { selection: batch(null) },
    });
    expect(html).toContain('Orders for this delivery slot are closed.');
    expect(html).not.toContain('Batch orders for MSH are closed');
    expect(html).not.toContain('Try Express Delivery');

    // With no open slot at MSH, the nudge shows for it.
    const none = renderCheckout({
      delivery: { slots: { 1: closedSlot(), 2: { ...msh2, ...closedSlot() } } },
      draft: { selection: batch(null) },
    });
    expect(none).toContain('Batch orders for MSH are closed. Express delivery is available.');
  });

  it('F3: express "available" with no locations is not open: banner, disabled card and buttons', () => {
    const html = renderCheckout({
      delivery: { slots: { 1: closedSlot(), 2: closedSlot() }, express: { locations: [] } },
    });
    expect(html).toContain('No deliveries are open right now. Please check again later.');
    expect(radio(html, 'deliveryMode', 'EXPRESS')).toContain('aria-disabled="true"');
    expect(html).toContain('Express delivery is currently unavailable.');
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toMatch(DISABLED_ATTR);

    // With batch open, only the Express card is disabled.
    const batchOpen = renderCheckout({ delivery: { express: { locations: [] } } });
    expect(radio(batchOpen, 'deliveryMode', 'EXPRESS')).toContain('aria-disabled="true"');
    expect(radio(batchOpen, 'deliveryMode', 'BATCH')).not.toContain('aria-disabled');
    expect(batchOpen).not.toContain('No deliveries are open right now');
  });

  it('F3: a closed slot offers no Try Express while express has no locations', () => {
    const html = renderCheckout({
      delivery: { slots: { 1: closedSlot() }, express: { locations: [] } },
      draft: { selection: batch(null) },
    });
    expect(html).not.toContain('Try Express Delivery');
    expect(html).not.toContain('Batch orders for MSH are closed');
  });

  it('C6: express to Kanhar adds the fee and shows the COD summary, never "paid"', () => {
    const html = renderCheckout({ draft: { selection: express(2) } });
    for (const text of [
      'Delivery · Express',
      '₹30',
      '₹330',
      'Express to Kanhar · approx. 30–40 minutes',
      'Payment: CASH ON DELIVERY',
      'Pay ₹330 in cash when your food arrives.',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/\bpaid\b/i);
  });

  it('C7: an open batch slot with fee 0 is Free with the delivery line', () => {
    const html = renderCheckout({ draft: { selection: batch(1) } });
    expect(html).toContain('Free');
    expect(html).toContain('MSH · Today, 8:00 PM');
  });

  it('C8: slot hints count down from the server time inside 30 minutes', () => {
    // Batch is chosen (draft) so the slot list shows; 19:10 is 20 min before MSH's 19:30 cutoff.
    const html = renderCheckout({
      delivery: { serverTime: '19:10' },
      draft: { selection: batch(null) },
    });
    expect(html).toContain('Order in the next 20 min');
    expect(html).toContain('Order by 8:15 PM');
  });

  it('C9: with every slot closed, Express is preselected and Batch explains why not', () => {
    const html = renderCheckout({ delivery: { slots: { 1: closedSlot(), 2: closedSlot() } } });
    expect(radio(html, 'deliveryMode', 'EXPRESS')).toContain('checked=""');
    expect(html).toContain('No batch deliveries are open right now.');
  });

  it('C10: nothing open shows the banner and disables both buttons', () => {
    const html = renderCheckout({
      delivery: {
        slots: { 1: closedSlot(), 2: closedSlot('CLOSED_TODAY') },
        express: { available: false, unavailableReason: 'DISABLED' },
      },
    });
    expect(html).toContain('No deliveries are open right now. Please check again later.');
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toMatch(DISABLED_ATTR);
  });

  it('C11: a failed options fetch shows the inline error and disables both buttons', () => {
    const html = renderCheckout({ delivery: 'failed' });
    expect(html).toContain(escaped("Couldn't load delivery options."));
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toMatch(DISABLED_ATTR);
  });

  it('C12: while options load there are no method cards and both buttons are disabled', () => {
    const html = renderCheckout({ delivery: 'pending' });
    expect(html).not.toContain('Batch Delivery');
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toMatch(DISABLED_ATTR);
  });

  it('C13: prefills remembered details and choice; a session draft wins', () => {
    const html = renderCheckout({ local: { [REMEMBERED_CUSTOMER_KEY]: REMEMBERED } });
    expect(html).toContain('value="Rahul Verma"');
    expect(html).toContain('value="98765 43210"');
    expect(html).toContain('Not you? Clear details');
    expect(radio(html, 'expressLocationId', '2')).toContain('checked=""');

    const withDraft = renderCheckout({
      local: { [REMEMBERED_CUSTOMER_KEY]: REMEMBERED },
      draft: {
        selection: express(2),
        details: { customerName: 'Priya Shah', customerPhone: '', addressDetail: '' },
      },
    });
    expect(withDraft).toContain('value="Priya Shah"');
    expect(withDraft).not.toContain('value="Rahul Verma"');
  });

  it('C14: the details fields carry the §5.6 attributes', () => {
    // HTML attribute names are case-insensitive, and React 19's static markup keeps the camelCase
    // spelling of some (`autoComplete="name"`), so compare names in lower case; values stay exact.
    const html = renderCheckout().replace(
      /\s([A-Za-z-]+)=/g,
      (_, name: string) => ` ${name.toLowerCase()}=`,
    );
    for (const attr of [
      'autocomplete="name"',
      'autocapitalize="words"',
      'enterkeyhint="next"',
      'type="tel"',
      'inputmode="numeric"',
      'autocomplete="tel-national"',
      'maxlength="120"',
    ]) {
      expect(html).toContain(attr);
    }
  });

  it('CK3: the not-sent stub is gone; the in-form button is Place order in an enabled fieldset', () => {
    expect(Object.keys(copy.customer.checkout)).not.toContain('notSent');
    const html = renderCheckout();
    expect(html).not.toContain('Nothing has been sent');
    expect(html).not.toContain(escaped("online ordering isn't switched on yet"));
    // The sticky bar's button names the form; the in-form one doesn't need to.
    const inForm = submitButtons(html).filter((b) => !b.includes('form="checkout-form"'));
    expect(inForm).toHaveLength(1);
    expect(inForm[0]).toContain('Place order · ₹300');
    expect(inForm[0]).not.toContain('aria-busy');
    expect(inForm[0]).not.toMatch(DISABLED_ATTR);
    // The sections sit in one fieldset that a submission disables; idle, it is enabled.
    expect(html).toMatch(/<form[^>]*><fieldset(?![^>]*\sdisabled="")[^>]*>/);
  });

  it('a draft with no method (a saved default) still gets the preselection; its details stay', () => {
    // The first visit saved the blank default; on return every slot is closed, so Express is the
    // only possible method (§12) and must be preselected.
    const html = renderCheckout({
      delivery: { slots: { 1: closedSlot(), 2: closedSlot() } },
      draft: {
        selection: { deliveryMode: null, slotId: null, locationId: null },
        details: { customerName: 'Priya Shah', customerPhone: '', addressDetail: '' },
      },
    });
    expect(radio(html, 'deliveryMode', 'EXPRESS')).toContain('checked=""');
    expect(html).toContain('value="Priya Shah"');
  });
});

// ---- Submission (Batch 5 §7.2–§7.3) ------------------------------------------------------------

/** The `spinner` icon's path (`components/Icon.tsx`). */
const SPINNER_PATH = 'M21 12a9 9 0 1 1-6.22-8.56';

const SENT: CreateOrderOutput = {
  clientRequestId: '11111111-1111-4111-8111-111111111111',
  deliveryMode: 'BATCH',
  locationId: 1,
  slotId: 1,
  customerName: 'Rahul Verma',
  customerPhone: '9876543210',
  addressDetail: null,
  items: [{ menuItemId: 1, quantity: 2 }],
  expectedTotal: 300,
};

describe('PlaceOrderBar', () => {
  it('CK1: while loading it is busy, disabled and shows the spinner and the caller label', () => {
    const html = render(
      h(PlaceOrderBar, {
        hidden: false,
        disabled: false,
        loading: true,
        label: copy.customer.checkout.placing,
      }),
    );
    const buttons = submitButtons(html);
    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    expect(button).toContain('aria-busy="true"');
    expect(button).toContain(SPINNER_PATH);
    // Loading alone locks the button, whatever `disabled` says.
    expect(button).toMatch(DISABLED_ATTR);
    expect(button).toContain('Placing order…');

    const idle = render(
      h(PlaceOrderBar, { hidden: false, disabled: false, loading: false, label: 'x' }),
    );
    expect(idle).not.toContain('aria-busy');
    expect(idle).not.toContain(SPINNER_PATH);
  });
});

describe('SubmitErrorBanner', () => {
  const failureFor = (
    code: 'SLOT_CLOSED' | 'TOO_MANY_OPEN_ORDERS',
    details: Record<string, unknown>,
    contactPhone: string | null = null,
  ) =>
    describeSubmitError(new ApiError(409, code, 'server message', details), {
      request: SENT,
      options: opts({ contactPhone }),
    });

  it('CK2: SLOT_CLOSED is an alert with both lines and a Try Express Delivery button', () => {
    const failure = failureFor('SLOT_CLOSED', { reason: 'CUTOFF_PASSED', expressAvailable: true });
    const html = render(h(SubmitErrorBanner, { failure, contactPhone: null, onTryExpress: noop }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Orders for MSH — 8:00 PM just closed.');
    expect(html).toContain('Batch orders for MSH are closed. Express delivery is available.');
    expect(html).toMatch(/<button type="button"[^>]*>Try Express Delivery<\/button>/);
    expect(html).not.toContain('tel:');
  });

  it('CK2: TOO_MANY_OPEN_ORDERS links the help number only when one is set', () => {
    const contact = '9876543210';
    const html = render(
      h(SubmitErrorBanner, {
        failure: failureFor('TOO_MANY_OPEN_ORDERS', { limit: 3 }, contact),
        contactPhone: contact,
        onTryExpress: noop,
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('You already have 3 orders waiting for delivery today.');
    expect(html).toContain('Need help?');
    expect(html).toContain('href="tel:9876543210"');
    expect(html).toContain('Call 98765 43210');
    expect(html).not.toContain('Try Express Delivery');

    const without = render(
      h(SubmitErrorBanner, {
        failure: failureFor('TOO_MANY_OPEN_ORDERS', { limit: 3 }),
        contactPhone: null,
        onTryExpress: noop,
      }),
    );
    expect(without).toContain('You already have 3 orders waiting for delivery today.');
    expect(without).not.toContain('tel:');
    expect(without).not.toContain('Need help?');
  });
});
