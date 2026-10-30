import { describe, expect, it } from 'vitest';
import type { PublicMenu, PublicMenuItem } from '../../src/shared/api-types';
import {
  EMPTY_CART,
  cartReducer,
  cartView,
  type CartAction,
  type CartModel,
  type CartState,
} from '../../src/client/features/customer/cart/cart-reducer';
import {
  CART_STORAGE_KEY,
  parseStoredCart,
  serializeCart,
} from '../../src/client/features/customer/cart/cart-storage';
import { readStorage, writeStorage } from '../../src/client/lib/storage';

const DATE = '2026-10-04';
const empty: CartModel = { cart: EMPTY_CART, notices: [] };

function run(model: CartModel, ...actions: CartAction[]): CartModel {
  return actions.reduce(cartReducer, model);
}
function add(id: number, maxQty = 10, name = `Item ${id}`): CartAction {
  return { type: 'add', item: { id, name, maxQty }, businessDate: DATE };
}
function menuItem(over: Partial<PublicMenuItem> & { id: number }): PublicMenuItem {
  return {
    name: `Item ${over.id}`,
    description: null,
    price: 100,
    imageUrl: null,
    soldOut: false,
    maxQty: 10,
    onlyLeft: null,
    ...over,
  };
}
function menu(items: PublicMenuItem[], businessDate = DATE): PublicMenu {
  return { businessDate, ordersPaused: false, items };
}
function cartOf(lines: [number, number, string?][], businessDate: string | null = DATE): CartState {
  return {
    businessDate,
    lines: lines.map(([menuItemId, quantity, name]) => ({
      menuItemId,
      quantity,
      name: name ?? `Item ${menuItemId}`,
    })),
  };
}
function tenLines(): CartModel {
  return run(empty, ...Array.from({ length: 10 }, (_, i) => add(i + 1)));
}

describe('cartReducer add / increment / decrement', () => {
  it('starts a fresh cart when add meets lines from another day', () => {
    const stale: CartModel = { cart: cartOf([[1, 2]], '2026-10-03'), notices: [] };
    const next = run(stale, add(7, 5, 'Roll'));
    expect(next.cart).toEqual({
      businessDate: DATE,
      lines: [{ menuItemId: 7, quantity: 1, name: 'Roll' }],
    });
    expect(next.notices).toEqual([{ kind: 'clearedOldDay' }]);
    // The next reconcile for today keeps the freshly added item.
    const reconciled = cartReducer(next, { type: 'reconcile', menu: menu([menuItem({ id: 7 })]) });
    expect(reconciled.cart.lines).toEqual([{ menuItemId: 7, quantity: 1, name: 'Item 7' }]);
  });

  it('leaves a same-day add unchanged', () => {
    const today: CartModel = { cart: cartOf([[1, 2]]), notices: [] };
    const next = run(today, add(7));
    expect(next.cart.lines.map((l) => l.menuItemId)).toEqual([1, 7]);
    expect(next.cart.businessDate).toBe(DATE);
    expect(next.notices).toEqual([]);
  });

  it('adds a line, stamps the business date, caps increments and removes at zero', () => {
    const added = run(empty, add(3, 3, 'Biryani'));
    expect(added.cart).toEqual({
      businessDate: DATE,
      lines: [{ menuItemId: 3, quantity: 1, name: 'Biryani' }],
    });

    const inc = (maxQty: number): CartAction => ({ type: 'increment', menuItemId: 3, maxQty });
    const capped3 = run(added, inc(3), inc(3), inc(3), inc(3), inc(3));
    expect(capped3.cart.lines[0]?.quantity).toBe(3);

    const capped10 = run(added, ...Array.from({ length: 15 }, () => inc(12)));
    expect(capped10.cart.lines[0]?.quantity).toBe(10);

    const removed = run(added, { type: 'decrement', menuItemId: 3 });
    expect(removed.cart.lines).toEqual([]);
  });

  it('decrement above 1 lowers the quantity', () => {
    const m = run(empty, add(3), { type: 'increment', menuItemId: 3, maxQty: 5 });
    expect(m.cart.lines[0]?.quantity).toBe(2);
    expect(run(m, { type: 'decrement', menuItemId: 3 }).cart.lines[0]?.quantity).toBe(1);
  });

  it('ignores add when maxQty is 0', () => {
    const before = run(empty, add(1));
    expect(cartReducer(before, add(2, 0))).toEqual(before);
    expect(cartReducer(empty, add(2, 0))).toEqual(empty);
  });

  it('refuses an 11th distinct line with a single lineCap notice', () => {
    const full = tenLines();
    const once = cartReducer(full, add(11));
    expect(once.cart.lines).toEqual(full.cart.lines);
    expect(once.notices).toEqual([{ kind: 'lineCap' }]);
    const twice = cartReducer(once, add(12));
    expect(twice.notices).toEqual([{ kind: 'lineCap' }]);
  });

  it('adding an existing id at the line cap increments with no notice', () => {
    const m = cartReducer(tenLines(), add(4));
    expect(m.cart.lines.find((l) => l.menuItemId === 4)?.quantity).toBe(2);
    expect(m.notices).toEqual([]);
  });

  it('add twice on an item with maxQty 1 stays at 1', () => {
    const m = run(empty, add(5, 1), add(5, 1));
    expect(m.cart.lines).toHaveLength(1);
    expect(m.cart.lines[0]?.quantity).toBe(1);
  });

  it('drops the lineCap notice after a line is removed or decremented away', () => {
    const capped = cartReducer(tenLines(), add(11));
    expect(cartReducer(capped, { type: 'remove', menuItemId: 1 }).notices).toEqual([]);
    expect(cartReducer(capped, { type: 'decrement', menuItemId: 1 }).notices).toEqual([]);
  });

  it('keeps other notices when a line is removed', () => {
    const m: CartModel = {
      cart: cartOf([[1, 1]]),
      notices: [{ kind: 'removedSoldOut', name: 'X' }, { kind: 'lineCap' }],
    };
    expect(cartReducer(m, { type: 'remove', menuItemId: 1 }).notices).toEqual([
      { kind: 'removedSoldOut', name: 'X' },
    ]);
  });

  it('a successful add drops the lineCap notice', () => {
    const m: CartModel = { cart: cartOf([[1, 1]]), notices: [{ kind: 'lineCap' }] };
    expect(cartReducer(m, add(2)).notices).toEqual([]);
  });
});

describe('cartReducer reconcile', () => {
  it('drops missing and sold-out lines, caps quantities, notices in line order', () => {
    const model: CartModel = {
      cart: cartOf([
        [1, 1, 'Gone'],
        [2, 1, 'Old Soldout'],
        [3, 5, 'Roll'],
        [4, 2, 'Kept'],
      ]),
      notices: [],
    };
    const m = cartReducer(model, {
      type: 'reconcile',
      menu: menu([
        menuItem({ id: 2, name: 'Soldout', soldOut: true, maxQty: 0 }),
        menuItem({ id: 3, name: 'Roll', maxQty: 2 }),
        menuItem({ id: 4, name: 'Kept', maxQty: 10 }),
      ]),
    });
    expect(m.cart.lines).toEqual([
      { menuItemId: 3, quantity: 2, name: 'Roll' },
      { menuItemId: 4, quantity: 2, name: 'Kept' },
    ]);
    expect(m.notices).toEqual([
      { kind: 'removedUnavailable', name: 'Gone' },
      { kind: 'removedSoldOut', name: 'Soldout' },
      { kind: 'capped', name: 'Roll', available: 2 },
    ]);
  });

  it('refreshes names silently, then reports a later removal under the new name', () => {
    const model: CartModel = { cart: cartOf([[3, 1, 'Old name']]), notices: [] };
    const renamed = cartReducer(model, {
      type: 'reconcile',
      menu: menu([menuItem({ id: 3, name: 'New name' })]),
    });
    expect(renamed.cart.lines[0]?.name).toBe('New name');
    expect(renamed.notices).toEqual([]);

    const dropped = cartReducer(renamed, { type: 'reconcile', menu: menu([]) });
    expect(dropped.notices).toEqual([{ kind: 'removedUnavailable', name: 'New name' }]);
  });

  it('a reconcile that changes nothing clears earlier notices', () => {
    const model: CartModel = { cart: cartOf([[1, 1]]), notices: [{ kind: 'lineCap' }] };
    const m = cartReducer(model, { type: 'reconcile', menu: menu([menuItem({ id: 1 })]) });
    expect(m.cart.lines).toEqual(model.cart.lines);
    expect(m.notices).toEqual([]);
  });

  it('clears a cart from another business day', () => {
    const model: CartModel = { cart: cartOf([[1, 1]], '2026-10-03'), notices: [] };
    const m = cartReducer(model, { type: 'reconcile', menu: menu([menuItem({ id: 1 })]) });
    expect(m.cart).toEqual(EMPTY_CART);
    expect(m.notices).toEqual([{ kind: 'clearedOldDay' }]);
  });

  it('an empty cart with an old date gets no notice', () => {
    const model: CartModel = { cart: { businessDate: '2026-10-03', lines: [] }, notices: [] };
    const m = cartReducer(model, { type: 'reconcile', menu: menu([]) });
    expect(m.cart).toEqual(model.cart);
    expect(m.notices).toEqual([]);
  });
});

describe('cartReducer misc actions', () => {
  it('dismissNotices clears, replace swaps the cart and keeps notices, clear resets', () => {
    const model: CartModel = { cart: cartOf([[1, 1]]), notices: [{ kind: 'lineCap' }] };
    expect(cartReducer(model, { type: 'dismissNotices' })).toEqual({
      cart: model.cart,
      notices: [],
    });
    const next = cartOf([[9, 2]]);
    expect(cartReducer(model, { type: 'replace', cart: next })).toEqual({
      cart: next,
      notices: [{ kind: 'lineCap' }],
    });
    expect(cartReducer(model, { type: 'clear' })).toEqual(empty);
  });
});

describe('cartView', () => {
  it('prices lines from the menu and skips unknown ids', () => {
    const view = cartView(
      menu([
        menuItem({ id: 1, name: 'Biryani', price: 150 }),
        menuItem({ id: 2, name: 'Roll', price: 130 }),
      ]),
      cartOf([
        [1, 2],
        [2, 1],
        [99, 4],
      ]),
    );
    expect(view.count).toBe(3);
    expect(view.subtotal).toBe(430);
    expect(view.lines).toEqual([
      { menuItemId: 1, name: 'Biryani', price: 150, quantity: 2, lineTotal: 300 },
      { menuItemId: 2, name: 'Roll', price: 130, quantity: 1, lineTotal: 130 },
    ]);
  });
});

describe('cart storage', () => {
  it('returns EMPTY_CART for null, malformed and wrong-shaped input', () => {
    expect(parseStoredCart(null)).toEqual(EMPTY_CART);
    expect(parseStoredCart('{bad')).toEqual(EMPTY_CART);
    expect(parseStoredCart('[]')).toEqual(EMPTY_CART);
    expect(parseStoredCart(JSON.stringify({ lines: 'x' }))).toEqual(EMPTY_CART);
  });

  it('round-trips a valid cart', () => {
    const c = cartOf([
      [1, 2],
      [5, 10],
    ]);
    expect(parseStoredCart(serializeCart(c))).toEqual(c);
    expect(parseStoredCart(serializeCart(EMPTY_CART))).toEqual(EMPTY_CART);
  });

  it('rejects invalid carts', () => {
    const s = (c: CartState): string => JSON.stringify(c);
    const dup = cartOf([
      [1, 1],
      [1, 2],
    ]);
    expect(parseStoredCart(s(dup))).toEqual(EMPTY_CART);
    const eleven = cartOf(Array.from({ length: 11 }, (_, i): [number, number] => [i + 1, 1]));
    expect(parseStoredCart(s(eleven))).toEqual(EMPTY_CART);
    expect(parseStoredCart(s(cartOf([[1, 0]])))).toEqual(EMPTY_CART);
    expect(parseStoredCart(s(cartOf([[1, 11]])))).toEqual(EMPTY_CART);
    expect(parseStoredCart(s(cartOf([[1, 1]], null)))).toEqual(EMPTY_CART);
    expect(parseStoredCart(s(cartOf([[1, 1]], 'not-a-date')))).toEqual(EMPTY_CART);
  });

  it('keeps a long name and rejects an empty one', () => {
    const long = cartOf([[1, 1, 'x'.repeat(120)]]);
    expect(parseStoredCart(serializeCart(long))).toEqual(long);
    expect(parseStoredCart(serializeCart(cartOf([[1, 1, '']])))).toEqual(EMPTY_CART);
  });

  it('serializes only businessDate and lines, never notices', () => {
    const raw = serializeCart(cartOf([[1, 1]]));
    const json = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(['businessDate', 'lines']);
    expect(raw).not.toContain('notices');
  });

  it('uses a versioned key', () => {
    expect(CART_STORAGE_KEY).toBe('bbc.cart.v1');
  });
});

describe('cartReducer applyStock (Batch 5 §7.3, §12.4)', () => {
  it('caps items when quantity exceeds available, removes when available <= 0, without cart notices', () => {
    const initial: CartModel = {
      cart: cartOf([
        [1, 5, 'Chicken Biryani'],
        [2, 3, 'Paneer Biryani'],
        [3, 2, 'Raita'],
      ]),
      notices: [],
    };

    const next = run(initial, {
      type: 'applyStock',
      shortItems: [
        { menuItemId: 1, available: 2 }, // capped to 2
        { menuItemId: 2, available: 0 }, // removed
      ],
    });

    expect(next.cart.lines).toEqual([
      { menuItemId: 1, quantity: 2, name: 'Chicken Biryani' },
      { menuItemId: 3, quantity: 2, name: 'Raita' },
    ]);
    expect(next.notices).toEqual([]);
  });
});

describe('lib/storage without a window', () => {
  it('never throws when localStorage is unavailable', () => {
    expect(readStorage('k')).toBeNull();
    expect(() => {
      writeStorage('k', 'v');
    }).not.toThrow();
  });
});
