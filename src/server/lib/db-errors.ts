// Helpers for classifying database errors from Prisma / Postgres (Batch 5 §4).

function errorText(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const rec = err as { code?: string; message?: string; meta?: unknown };
  const metaStr = rec.meta !== undefined ? JSON.stringify(rec.meta) : '';
  return `${rec.code ?? ''} ${rec.message ?? ''} ${metaStr}`;
}

/**
 * Unique violation: Prisma P2002 or Postgres SQLSTATE 23505.
 * Driver adapters shape meta.target differently, so any P2002 on an insert
 * qualifies for unique violation fallback (Batch 5 §4 step 4).
 */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string };
  if (rec.code === 'P2002' || rec.code === '23505') return true;
  return /\b(23505|P2002)\b|unique constraint/i.test(errorText(err));
}

/**
 * Retryable transaction error (Batch 5 §4 step 6):
 * - Prisma P2034 (transaction failed due to a write conflict or deadlock)
 * - Postgres SQLSTATE 40P01 (deadlock_detected)
 * - Postgres SQLSTATE 40001 (serialization_failure)
 *
 * Appears as a whole word in code, meta, or message (e.g. raw queries report P2010 with Code: 40P01).
 */
export function isRetryableTxError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const rec = err as { code?: string };
  if (rec.code === 'P2034') return true;
  return /\b(40P01|40001)\b/.test(errorText(err));
}
