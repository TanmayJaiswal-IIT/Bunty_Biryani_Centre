import { describe, expect, it } from 'vitest';
import { Prisma } from '../../src/server/db';
import { isRetryableTxError, isUniqueViolation } from '../../src/server/lib/db-errors';

function known(message: string, code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test', meta });
}

describe('db-errors', () => {
  it('DE1 isUniqueViolation: a P2002 known error, never a plain Error', () => {
    expect(
      isUniqueViolation(
        known('Unique constraint failed on the fields: (`client_request_id`)', 'P2002', {
          modelName: 'Order',
        }),
      ),
    ).toBe(true);

    expect(isUniqueViolation(new Error('Unique constraint failed'))).toBe(false);
    expect(isUniqueViolation({ code: 'P2002' })).toBe(false);
    expect(isUniqueViolation(known('Raw query failed. Code: `23505`.', 'P2010'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('DE2 isRetryableTxError: P2034, or 40P01 / 40001 in the code, meta or message', () => {
    const writeConflict = known(
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction',
      'P2034',
    );
    const deadlockInMeta = known('Raw query failed.', 'P2010', { code: '40P01' });
    const serializationInMessage = known(
      'Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`',
      'P2010',
    );

    expect(isRetryableTxError(writeConflict)).toBe(true);
    expect(isRetryableTxError({ code: 'P2034' })).toBe(true);
    expect(isRetryableTxError(deadlockInMeta)).toBe(true);
    expect(isRetryableTxError(serializationInMessage)).toBe(true);
    expect(isRetryableTxError({ code: '40P01' })).toBe(true);

    expect(isRetryableTxError(known('Unique constraint failed', 'P2002'))).toBe(false);
    expect(
      isRetryableTxError(
        known('Raw query failed. Code: `23514`. Message: `violates check constraint`', 'P2010', {
          code: '23514',
        }),
      ),
    ).toBe(false);
    // Only a whole SQLSTATE counts, not digits inside a longer value.
    expect(isRetryableTxError(new Error('Key (order_number)=(BB140001) already exists'))).toBe(
      false,
    );
    expect(isRetryableTxError(new Error('boom'))).toBe(false);
    expect(isRetryableTxError(null)).toBe(false);
  });
});
