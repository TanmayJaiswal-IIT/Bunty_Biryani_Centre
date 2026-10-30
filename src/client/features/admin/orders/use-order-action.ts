import type { AdminOrderView, OrderAction } from '@shared/api-types.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { refreshOrders, setOrderStatus } from '../api/mutations.js';

function getInverseAction(action: OrderAction): OrderAction | null {
  if ('status' in action) {
    if (action.status === 'COMPLETED') return { status: 'ORDER_RECEIVED' };
    if (action.status === 'ORDER_RECEIVED') return { status: 'COMPLETED' };
    return null; // CANCELLED has no inverse
  }
  if ('paymentStatus' in action) {
    if (action.paymentStatus === 'COLLECTED') return { paymentStatus: 'PENDING' };
    if (action.paymentStatus === 'PENDING') return { paymentStatus: 'COLLECTED' };
  }
  return null;
}

export function useOrderAction(order: AdminOrderView): {
  run: (action: OrderAction, opts?: { undoable?: boolean }) => Promise<void>;
  pending: OrderAction | null;
  error: string | null;
  undo: OrderAction | null;
} {
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState<OrderAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<OrderAction | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const run = useCallback(
    async (action: OrderAction, opts?: { undoable?: boolean }): Promise<void> => {
      setPending(action);
      setError(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      try {
        await setOrderStatus(order.id, action);
        await refreshOrders(mutate);
        if (opts?.undoable !== false) {
          const inverse = getInverseAction(action);
          if (inverse) {
            setUndo(inverse);
            undoTimerRef.current = setTimeout(() => {
              setUndo(null);
              undoTimerRef.current = null;
            }, 5000);
          } else {
            setUndo(null);
          }
        } else {
          setUndo(null);
        }
      } catch (err) {
        setUndo(null);
        setError(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setPending(null);
      }
    },
    [order.id, mutate],
  );

  return { run, pending, error, undo };
}
