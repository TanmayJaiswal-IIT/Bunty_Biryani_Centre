import { describe, expect, it } from 'vitest';
import { isRetryableTxError, isUniqueViolation } from '../../src/server/lib/db-errors';

describe('db-errors unit tests', () => {
  it('isUniqueViolation detects P2002 and SQLSTATE 23505', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ message: 'Unique constraint failed on the fields' })).toBe(true);
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint' })).toBe(
      true,
    );
    expect(isUniqueViolation({ meta: { target: ['client_request_id'] } })).toBe(false);
    expect(isUniqueViolation(new Error('something else'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('isRetryableTxError detects P2034, 40P01 (deadlock) and 40001 (serialization failure)', () => {
    expect(isRetryableTxError({ code: 'P2034' })).toBe(true);
    expect(isRetryableTxError({ code: '40P01' })).toBe(true);
    expect(isRetryableTxError({ code: '40001' })).toBe(true);
    expect(isRetryableTxError({ message: 'Raw query failed. Code: 40P01' })).toBe(true);
    expect(isRetryableTxError({ message: 'could not serialize access due to concurrent update (40001)' })).toBe(
      true,
    );
    expect(isRetryableTxError({ code: 'P2002' })).toBe(false);
    expect(isRetryableTxError(new Error('general syntax error'))).toBe(false);
    expect(isRetryableTxError(undefined)).toBe(false);
  });
});
