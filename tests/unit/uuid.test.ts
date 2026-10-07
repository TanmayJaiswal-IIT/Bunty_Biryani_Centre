import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { newUuid, uuidFromRandomValues } from '../../src/client/lib/uuid';

describe('uuid', () => {
  it('#36 uuidFromRandomValues makes valid, unique v4 ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = uuidFromRandomValues(globalThis.crypto);
      expect(z.uuid().safeParse(id).success).toBe(true);
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19]);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('#36 sets the version and variant bits whatever the random bytes are', () => {
    const fill = (b: number) => ({
      getRandomValues: <T extends ArrayBufferView | null>(arr: T): T => {
        (arr as unknown as Uint8Array).fill(b);
        return arr;
      },
    });
    expect(uuidFromRandomValues(fill(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuidFromRandomValues(fill(0))).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('#36 newUuid falls back to getRandomValues without randomUUID', () => {
    const id = newUuid({
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    expect(z.uuid().safeParse(id).success).toBe(true);
  });

  it('#36 newUuid uses randomUUID when present', () => {
    const id = newUuid({
      randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
    });
    expect(id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });
});
