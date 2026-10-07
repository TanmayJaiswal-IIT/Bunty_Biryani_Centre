import type { Clock } from '../../src/shared/time';

/** 2026-10-04 19:10 IST, the "now" most tests use (Batch 5 §12). */
export const TEST_NOW = '2026-10-04T13:40:00.000Z';
export const TEST_TODAY = '2026-10-04';

/** ISO instant for `hhmm` IST on `date` (default TEST_TODAY), e.g. istInstant('19:10'). */
export function istInstant(hhmm: string, date: string = TEST_TODAY): string {
  return new Date(`${date}T${hhmm}:00+05:30`).toISOString();
}

export interface TestClock extends Clock {
  set(iso: string): void;
  advance(ms: number): void;
}

export function createTestClock(iso: string = TEST_NOW): TestClock {
  let t = new Date(iso).getTime();
  return {
    now: () => new Date(t),
    set(next) {
      t = new Date(next).getTime();
    },
    advance(ms) {
      t += ms;
    },
  };
}
