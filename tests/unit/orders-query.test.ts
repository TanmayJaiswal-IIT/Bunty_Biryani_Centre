import { describe, expect, it } from 'vitest';
import { parseOrderQuery } from '../../src/server/services/admin-orders.service.js';

describe('parseOrderQuery unit tests (#3)', () => {
  it('parses BB-prefixed order numbers', () => {
    expect(parseOrderQuery('BB1023')).toEqual({ orderNumber: 'BB1023', phone: null });
    expect(parseOrderQuery('bb1023')).toEqual({ orderNumber: 'BB1023', phone: null });
  });

  it('parses bare 4–9 digits as order number and phone suffix', () => {
    expect(parseOrderQuery('1023')).toEqual({
      orderNumber: 'BB1023',
      phone: { suffix: '1023' },
    });
    expect(parseOrderQuery('98765')).toEqual({
      orderNumber: 'BB98765',
      phone: { suffix: '98765' },
    });
  });

  it('parses bare 10 digits as phone suffix only', () => {
    expect(parseOrderQuery('9876543210')).toEqual({
      orderNumber: null,
      phone: { suffix: '9876543210' },
    });
  });

  it('parses full phone with +91, spaces or dashes as exact phone', () => {
    expect(parseOrderQuery('+91 98765-43210')).toEqual({
      orderNumber: null,
      phone: { exact: '9876543210' },
    });
  });

  it('rejects short digits, names, or short BB strings with null', () => {
    expect(parseOrderQuery('123')).toBeNull();
    expect(parseOrderQuery('Rahul')).toBeNull();
    expect(parseOrderQuery('BB12')).toBeNull();
  });
});
