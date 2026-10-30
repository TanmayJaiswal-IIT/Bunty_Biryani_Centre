import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useDashboard, type LoadedDashboard } from '../api/hooks';
import {
  adminTitle,
  dismissFresh,
  freshCount,
  INITIAL_ALERTS,
  isFresh,
  receiveDashboard,
  type AlertState,
} from './new-orders';
import { playNewOrderSound, writeSoundEnabled } from './sound';

let currentNow = typeof performance !== 'undefined' ? performance.now() : 0;
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(onChange: () => void): () => void {
  nowListeners.add(onChange);
  if (nowListeners.size === 1 && typeof setInterval !== 'undefined') {
    currentNow = performance.now();
    nowTimer = setInterval(() => {
      currentNow = performance.now();
      for (const listener of nowListeners) {
        listener();
      }
    }, 15_000);
  }
  return () => {
    nowListeners.delete(onChange);
    if (nowListeners.size === 0 && nowTimer !== null) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

function getNowSnapshot(): number {
  return currentNow;
}

function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNowSnapshot, () => 0);
}

interface NewOrdersContextValue {
  isFresh: (id: number) => boolean;
  dismiss: (id: number) => void;
  count: number;
  soundBlocked: boolean;
  enableSound: () => void;
}

const NewOrdersContext = createContext<NewOrdersContextValue | null>(null);

export function NewOrdersProvider({ children }: { children: ReactNode }) {
  const [alerts, setAlerts] = useState<AlertState>(INITIAL_ALERTS);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const now = useNow();

  const handleDashboard = useCallback((d: LoadedDashboard) => {
    setAlerts((prev) => {
      const { state: next, added } = receiveDashboard(prev, d, performance.now());
      if (added.length > 0) {
        void playNewOrderSound().then((res) => {
          if (res === 'blocked') {
            setSoundBlocked(true);
          }
        });
      }
      return next;
    });
  }, []);

  useDashboard(null, handleDashboard);

  const count = freshCount(alerts, now);

  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);

  useEffect(() => {
    document.title = adminTitle(count);
  }, [count]);

  const dismiss = useCallback((id: number) => {
    setAlerts((prev) => dismissFresh(prev, id));
  }, []);

  const isFreshCallback = useCallback(
    (id: number) => isFresh(alerts, id, now),
    [alerts, now],
  );

  const enableSound = useCallback(() => {
    writeSoundEnabled(true);
    setSoundBlocked(false);
    void playNewOrderSound();
  }, []);

  const value = useMemo(
    () => ({
      isFresh: isFreshCallback,
      dismiss,
      count,
      soundBlocked,
      enableSound,
    }),
    [isFreshCallback, dismiss, count, soundBlocked, enableSound],
  );

  return (
    <NewOrdersContext.Provider value={value}>
      {children}
    </NewOrdersContext.Provider>
  );
}

const DEFAULT_NEW_ORDERS: NewOrdersContextValue = {
  isFresh: () => false,
  dismiss: () => {},
  count: 0,
  soundBlocked: false,
  enableSound: () => {},
};

export function useNewOrders(): NewOrdersContextValue {
  const ctx = useContext(NewOrdersContext);
  return ctx ?? DEFAULT_NEW_ORDERS;
}
