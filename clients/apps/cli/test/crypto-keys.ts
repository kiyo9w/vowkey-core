import { randomBytes } from "node:crypto";

/** COSE symmetric key encoding for XChaCha20, including the SDK's legacy-byte padding. A plain Uint8Array, so `slice()` copies. */
export function makeCoseKey(): Uint8Array {
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0xa5, 1, 4, 2, 0x50]),
      randomBytes(16),
      Buffer.from([3, 0x3a, 0, 1, 0x11, 0x6f, 4, 0x84, 3, 4, 5, 6, 0x20, 0x58, 0x20]),
      randomBytes(32),
      Buffer.from([1]),
    ]),
  );
}
