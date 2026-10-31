import type { Dashboard } from '@shared/api-types.js';

export const NEW_ORDER_TTL_MS = 120_000;

export interface AlertState {
  known: ReadonlySet<number> | null;
  fresh: ReadonlyMap<number, number>; // id → seenAt (performance.now)
}

export const INITIAL_ALERTS: AlertState = {
  known: null,
  fresh: new Map(),
};

/** Open order ids on the dashboard: every batch group's ORDER_RECEIVED + express ORDER_RECEIVED + earlierOpenOrders. */
export function openOrderIds(d: Dashboard): number[] {
  const ids: number[] = [];
  for (const b of d.batches) {
    for (const o of b.orders) {
      if (o.status === 'ORDER_RECEIVED') {
        ids.push(o.id);
      }
    }
  }
  for (const o of d.express.orders) {
    if (o.status === 'ORDER_RECEIVED') {
      ids.push(o.id);
    }
  }
  for (const o of d.earlierOpenOrders) {
    if (o.status === 'ORDER_RECEIVED') {
      ids.push(o.id);
    }
  }
  return ids;
}

/** First call (known null) → baseline, added []. Later → ids not in `known` are added to `fresh` at `now`. */
export function receiveDashboard(
  s: AlertState,
  d: Dashboard,
  now: number,
): { state: AlertState; added: number[] } {
  const currentOpen = openOrderIds(d);
  if (s.known === null) {
    return {
      state: {
        known: new Set(currentOpen),
        fresh: new Map(),
      },
      added: [],
    };
  }

  const added: number[] = [];
  const nextKnown = new Set(s.known);
  const nextFresh = new Map(s.fresh);

  // Expire entries older than NEW_ORDER_TTL_MS
  for (const [id, seenAt] of nextFresh.entries()) {
    if (now - seenAt >= NEW_ORDER_TTL_MS) {
      nextFresh.delete(id);
    }
  }

  for (const id of currentOpen) {
    if (!s.known.has(id)) {
      added.push(id);
      nextKnown.add(id);
      nextFresh.set(id, now);
    }
  }

  return {
    state: {
      known: nextKnown,
      fresh: nextFresh,
    },
    added,
  };
}

export function dismissFresh(s: AlertState, id: number): AlertState {
  if (!s.fresh.has(id)) return s;
  const nextFresh = new Map(s.fresh);
  nextFresh.delete(id);
  return {
    known: s.known,
    fresh: nextFresh,
  };
}

export function freshCount(s: AlertState, now: number): number {
  let count = 0;
  for (const seenAt of s.fresh.values()) {
    if (now - seenAt < NEW_ORDER_TTL_MS) {
      count++;
    }
  }
  return count;
}

export function isFresh(s: AlertState, id: number, now: number): boolean {
  const seenAt = s.fresh.get(id);
  if (seenAt === undefined) return false;
  return now - seenAt < NEW_ORDER_TTL_MS;
}

export function adminTitle(count: number): string {
  if (count > 0) {
    return `(${count}) BBC Admin`;
  }
  return 'BBC Admin';
}
