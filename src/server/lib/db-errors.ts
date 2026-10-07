import { Prisma } from '../db.js';

// Prisma error classification for createOrder (Batch 5 §4 steps 4 and 6). Driver adapters shape
// `meta` differently from the old query engine, so neither check depends on its layout.

/**
 * A unique-constraint violation (Prisma `P2002`). Which constraint isn't parsed: the caller
 * re-looks up its own key and rethrows when nothing turns up.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** SQLSTATE deadlock_detected (40P01) or serialization_failure (40001), as a whole word. */
const RETRYABLE_SQLSTATE = /\b40(?:P01|001)\b/;

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * A deadlock or serialization failure, worth running the whole transaction once more: Prisma
 * `P2034`, or SQLSTATE 40P01 / 40001 anywhere in the error's code, meta or message. A raw query
 * reports it as `P2010` "Raw query failed. Code: `40P01`", so the text is checked too (the same
 * approach the constraint tests use for 23514).
 */
export function isRetryableTxError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const { code, meta, message } = err as { code?: unknown; meta?: unknown; message?: unknown };
  if (code === 'P2034') return true;
  const text = [
    typeof code === 'string' ? code : '',
    json(meta),
    typeof message === 'string' ? message : '',
  ].join(' ');
  return RETRYABLE_SQLSTATE.test(text);
}
