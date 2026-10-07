import type { PublicMenu } from '@shared/api-types.js';
import { MAX_LINES_PER_ORDER, MAX_QTY_PER_ITEM } from '@shared/limits.js';
import { computeTotals } from '@shared/pricing.js';

// Pure cart model (Batch 3 §5). The cart holds ids and quantities only; prices always come from
// the latest menu (Rule 3), and `name` is kept for notices after an item vanishes from the menu.

export type CartLine = { menuItemId: number; quantity: number; name: string };
export type CartState = { businessDate: string | null; lines: CartLine[] };

export type CartNotice =
  | { kind: 'clearedOldDay' }
  | { kind: 'removedUnavailable'; name: string }
  | { kind: 'removedSoldOut'; name: string }
  | { kind: 'capped'; name: string; available: number }
  | { kind: 'lineCap' };

export type CartModel = { cart: CartState; notices: CartNotice[] };

export type CartAction =
  | { type: 'add'; item: { id: number; name: string; maxQty: number }; businessDate: string }
  | { type: 'increment'; menuItemId: number; maxQty: number }
  | { type: 'decrement'; menuItemId: number }
  | { type: 'remove'; menuItemId: number }
  | { type: 'clear' }
  | { type: 'reconcile'; menu: PublicMenu }
  /** The server said how much is left (`OUT_OF_STOCK` / `ITEM_UNAVAILABLE`); the checkout banner carries the message, so no cart notices. */
  | { type: 'applyStock'; items: ReadonlyArray<{ menuItemId: number; available: number }> }
  | { type: 'dismissNotices' }
  | { type: 'replace'; cart: CartState };

export const EMPTY_CART: CartState = { businessDate: null, lines: [] };

const withoutLineCap = (notices: CartNotice[]): CartNotice[] =>
  notices.filter((n) => n.kind !== 'lineCap');

function increment(model: CartModel, menuItemId: number, maxQty: number): CartModel {
  const limit = Math.min(maxQty, MAX_QTY_PER_ITEM);
  const line = model.cart.lines.find((l) => l.menuItemId === menuItemId);
  if (!line || line.quantity >= limit) return model;
  return {
    ...model,
    cart: {
      ...model.cart,
      lines: model.cart.lines.map((l) =>
        l.menuItemId === menuItemId ? { ...l, quantity: l.quantity + 1 } : l,
      ),
    },
  };
}

function removeLine(model: CartModel, menuItemId: number): CartModel {
  if (!model.cart.lines.some((l) => l.menuItemId === menuItemId)) return model;
  return {
    cart: { ...model.cart, lines: model.cart.lines.filter((l) => l.menuItemId !== menuItemId) },
    notices: withoutLineCap(model.notices),
  };
}

function reconcile(model: CartModel, menu: PublicMenu): CartModel {
  const { cart } = model;
  if (cart.lines.length === 0) return { cart, notices: [] };
  if (cart.businessDate !== menu.businessDate) {
    return { cart: EMPTY_CART, notices: [{ kind: 'clearedOldDay' }] };
  }

  const byId = new Map(menu.items.map((item) => [item.id, item]));
  const lines: CartLine[] = [];
  const notices: CartNotice[] = [];
  for (const line of cart.lines) {
    const item = byId.get(line.menuItemId);
    if (!item) {
      notices.push({ kind: 'removedUnavailable', name: line.name });
    } else if (item.soldOut || item.maxQty <= 0) {
      notices.push({ kind: 'removedSoldOut', name: item.name });
    } else if (line.quantity > item.maxQty) {
      notices.push({ kind: 'capped', name: item.name, available: item.maxQty });
      lines.push({ menuItemId: line.menuItemId, quantity: item.maxQty, name: item.name });
    } else {
      lines.push({ menuItemId: line.menuItemId, quantity: line.quantity, name: item.name });
    }
  }
  return { cart: { businessDate: cart.businessDate, lines }, notices };
}

function applyStock(
  model: CartModel,
  items: ReadonlyArray<{ menuItemId: number; available: number }>,
): CartModel {
  const available = new Map(items.map((i) => [i.menuItemId, i.available]));
  let changed = false;
  const lines: CartLine[] = [];
  for (const line of model.cart.lines) {
    const left = available.get(line.menuItemId);
    if (left === undefined || line.quantity <= left) {
      lines.push(line);
    } else if (left > 0) {
      changed = true;
      lines.push({ ...line, quantity: left });
    } else {
      changed = true;
    }
  }
  if (!changed) return model;
  return { ...model, cart: { ...model.cart, lines } };
}

export function cartReducer(model: CartModel, action: CartAction): CartModel {
  switch (action.type) {
    case 'add': {
      const { item, businessDate } = action;
      if (item.maxQty <= 0) return model;
      if (model.cart.lines.length > 0 && model.cart.businessDate !== businessDate) {
        // Stale lines from another day (a tab woken after midnight, or a stale tab's cart).
        // Start fresh now, or the next reconcile would wipe the item just added.
        return {
          cart: {
            businessDate,
            lines: [{ menuItemId: item.id, quantity: 1, name: item.name }],
          },
          notices: [...withoutLineCap(model.notices), { kind: 'clearedOldDay' }],
        };
      }
      if (model.cart.lines.some((l) => l.menuItemId === item.id)) {
        return increment(model, item.id, item.maxQty);
      }
      if (model.cart.lines.length >= MAX_LINES_PER_ORDER) {
        if (model.notices.some((n) => n.kind === 'lineCap')) return model;
        return { ...model, notices: [...model.notices, { kind: 'lineCap' }] };
      }
      return {
        cart: {
          businessDate: model.cart.lines.length === 0 ? businessDate : model.cart.businessDate,
          lines: [...model.cart.lines, { menuItemId: item.id, quantity: 1, name: item.name }],
        },
        notices: withoutLineCap(model.notices),
      };
    }
    case 'increment':
      return increment(model, action.menuItemId, action.maxQty);
    case 'decrement': {
      const line = model.cart.lines.find((l) => l.menuItemId === action.menuItemId);
      if (!line) return model;
      if (line.quantity <= 1) return removeLine(model, action.menuItemId);
      return {
        ...model,
        cart: {
          ...model.cart,
          lines: model.cart.lines.map((l) =>
            l.menuItemId === action.menuItemId ? { ...l, quantity: l.quantity - 1 } : l,
          ),
        },
      };
    }
    case 'remove':
      return removeLine(model, action.menuItemId);
    case 'clear':
      return { cart: EMPTY_CART, notices: [] };
    case 'reconcile':
      return reconcile(model, action.menu);
    case 'applyStock':
      return applyStock(model, action.items);
    case 'dismissNotices':
      return { ...model, notices: [] };
    case 'replace':
      return { ...model, cart: action.cart };
  }
}

export interface CartViewLine {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
}

export interface CartView {
  lines: CartViewLine[];
  count: number;
  subtotal: number;
}

/** Cart lines priced from the latest menu. A line whose item isn't on the menu is left out. */
export function cartView(menu: PublicMenu, cart: CartState): CartView {
  const byId = new Map(menu.items.map((item) => [item.id, item]));
  const lines: CartViewLine[] = [];
  for (const line of cart.lines) {
    const item = byId.get(line.menuItemId);
    if (!item) continue;
    lines.push({
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      quantity: line.quantity,
      lineTotal: item.price * line.quantity,
    });
  }
  const { foodSubtotal } = computeTotals(
    lines.map((l) => ({ unitPrice: l.price, quantity: l.quantity })),
  );
  return {
    lines,
    count: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: foodSubtotal,
  };
}
