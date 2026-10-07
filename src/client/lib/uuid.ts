// `crypto.randomUUID` only exists in secure contexts (https or localhost). Testing from a phone over
// `http://<lan-ip>` has no secure context, so the fallback builds a v4 UUID from `getRandomValues`,
// which is available everywhere.

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** RFC 4122 version 4: the version nibble is 4, the variant bits are `10`. */
export function uuidFromRandomValues(c: Pick<Crypto, 'getRandomValues'>): string {
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (byte) => HEX[byte] ?? '00');
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h
    .slice(8, 10)
    .join('')}-${h.slice(10, 16).join('')}`;
}

export function newUuid(
  c: Partial<Pick<Crypto, 'randomUUID'>> & Pick<Crypto, 'getRandomValues'> = globalThis.crypto,
): string {
  return typeof c.randomUUID === 'function' ? c.randomUUID() : uuidFromRandomValues(c);
}
