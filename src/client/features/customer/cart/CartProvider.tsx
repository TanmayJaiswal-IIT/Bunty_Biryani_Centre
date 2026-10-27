import type { PublicMenu, PublicMenuItem } from '@shared/api-types.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { readStorage, writeStorage } from '../../../lib/storage';
import {
  EMPTY_CART,
  cartReducer,
  type CartModel,
  type CartNotice,
  type CartState,
} from './cart-reducer';
import { CART_STORAGE_KEY, parseStoredCart, serializeCart } from './cart-storage';

export interface CartApi {
  cart: CartState;
  notices: CartNotice[];
  add: (item: PublicMenuItem, businessDate: string) => void;
  increment: (item: PublicMenuItem) => void;
  decrement: (menuItemId: number) => void;
  remove: (menuItemId: number) => void;
  clear: () => void;
  reconcile: (menu: PublicMenu) => void;
  applyStock: (shortItems: { menuItemId: number; available: number }[]) => void;
  dismissNotices: () => void;
}

const CartContext = createContext<CartApi | null>(null);

function initCart(): CartModel {
  return { cart: parseStoredCart(readStorage(CART_STORAGE_KEY)), notices: [] };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [model, dispatch] = useReducer(cartReducer, undefined, initCart);
  // The last string written to (or read from) localStorage: skips redundant writes, and stops a
  // cart that arrived from another tab being written straight back.
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    const serialized = serializeCart(model.cart);
    if (serialized === lastWritten.current) return;
    lastWritten.current = serialized;
    writeStorage(CART_STORAGE_KEY, serialized);
  }, [model.cart]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.storageArea !== window.localStorage) return;
      if (e.key === null) {
        lastWritten.current = serializeCart(EMPTY_CART);
        dispatch({ type: 'replace', cart: EMPTY_CART });
      } else if (e.key === CART_STORAGE_KEY) {
        const cart = parseStoredCart(e.newValue);
        lastWritten.current = serializeCart(cart);
        dispatch({ type: 'replace', cart });
      }
    }
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const add = useCallback((item: PublicMenuItem, businessDate: string) => {
    dispatch({
      type: 'add',
      item: { id: item.id, name: item.name, maxQty: item.maxQty },
      businessDate,
    });
  }, []);
  const increment = useCallback((item: PublicMenuItem) => {
    dispatch({ type: 'increment', menuItemId: item.id, maxQty: item.maxQty });
  }, []);
  const decrement = useCallback((menuItemId: number) => {
    dispatch({ type: 'decrement', menuItemId });
  }, []);
  const remove = useCallback((menuItemId: number) => {
    dispatch({ type: 'remove', menuItemId });
  }, []);
  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);
  const reconcile = useCallback((menu: PublicMenu) => {
    dispatch({ type: 'reconcile', menu });
  }, []);
  const applyStock = useCallback(
    (shortItems: { menuItemId: number; available: number }[]) => {
      dispatch({ type: 'applyStock', shortItems });
    },
    [],
  );
  const dismissNotices = useCallback(() => {
    dispatch({ type: 'dismissNotices' });
  }, []);

  const value = useMemo<CartApi>(
    () => ({
      cart: model.cart,
      notices: model.notices,
      add,
      increment,
      decrement,
      remove,
      clear,
      reconcile,
      applyStock,
      dismissNotices,
    }),
    [model, add, increment, decrement, remove, clear, reconcile, applyStock, dismissNotices],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
