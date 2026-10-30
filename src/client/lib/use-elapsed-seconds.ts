import { useCallback, useSyncExternalStore } from 'react';

const TICK_MS = 5_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, TICK_MS);
  return () => clearInterval(timer);
}

/**
 * Whole seconds since `since` (a `performance.now()` reading), re-read every 5 s.
 * The impure clock read lives in the snapshot callback, not the render body; the server snapshot is 0.
 */
export function useElapsedSeconds(since: number): number {
  const getSnapshot = useCallback(
    () => Math.floor((performance.now() - since) / 1000),
    [since],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
