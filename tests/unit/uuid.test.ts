import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { generateUUID } from '../../src/client/lib/uuid';

const uuidSchema = z.string().uuid();

describe('UUID generator (Batch 5 §12.4 #36)', () => {
  it('generates valid v4 UUID matching z.uuid()', () => {
    const id = generateUUID();
    expect(uuidSchema.safeParse(id).success).toBe(true);
  });

  it('generates 1,000 unique UUIDs', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateUUID();
      expect(uuidSchema.safeParse(id).success).toBe(true);
      set.add(id);
    }
    expect(set.size).toBe(1000);
  });

  it('fallback branch works when crypto.randomUUID is deleted', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (buf: Uint8Array) => {
        for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() * 256) | 0;
        return buf;
      },
    });
    try {
      const id = generateUUID();
      expect(uuidSchema.safeParse(id).success).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
