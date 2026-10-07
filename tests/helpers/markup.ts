// Shared static-markup helpers. No DOM: components render with react-dom/server in the node unit
// project, and SWR serves its `fallback` without fetching.
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, type InitialEntry } from 'react-router';
import { vi } from 'vitest';
import type { PublicMenuItem } from '../../src/shared/api-types';

export function item(over: Partial<PublicMenuItem> = {}): PublicMenuItem {
  return {
    id: 1,
    name: 'Chicken Biryani',
    description: null,
    price: 150,
    imageUrl: null,
    soldOut: false,
    maxQty: 10,
    onlyLeft: null,
    ...over,
  };
}

export function render(el: ReactElement, initialEntries?: InitialEntry[]): string {
  return renderToStaticMarkup(h(MemoryRouter, initialEntries ? { initialEntries } : null, el));
}

/** React escapes apostrophes in static markup. */
export const escaped = (text: string) => text.replace(/'/g, '&#x27;');

/** The class tokens of the first opening tag `openTag` matches (its one capture group). */
export function classesOf(html: string, openTag: RegExp): string[] {
  const match = openTag.exec(html);
  if (!match?.[1]) throw new Error(`no tag matching ${String(openTag)}`);
  return match[1].split(' ');
}

/** A minimal in-memory `Storage` (only the methods the app calls). */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** Runs `fn` with a `window` whose every storage call throws (private mode / blocked site data). */
export function withThrowingStorage<T>(fn: () => T): T {
  const boom = (): never => {
    throw new Error('storage blocked');
  };
  const blocked = { getItem: boom, setItem: boom, removeItem: boom };
  vi.stubGlobal('window', { localStorage: blocked, sessionStorage: blocked });
  try {
    return fn();
  } finally {
    vi.unstubAllGlobals();
  }
}

/**
 * Runs `fn` with `window.localStorage` / `window.sessionStorage` stubbed by seeded in-memory
 * stores, and always restores the globals afterwards, even if `fn` throws.
 */
export function withWindowStorage<T>(
  seed: { local?: Record<string, string>; session?: Record<string, string> },
  fn: () => T,
): T {
  vi.stubGlobal('window', {
    localStorage: fakeStorage(seed.local),
    sessionStorage: fakeStorage(seed.session),
  });
  try {
    return fn();
  } finally {
    vi.unstubAllGlobals();
  }
}
