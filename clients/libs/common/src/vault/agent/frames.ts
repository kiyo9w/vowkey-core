/** The largest agent frame. A larger length is refused before a body of that size is kept. */
export const MAX_FRAME_BYTES = 256 * 1024;

export class FrameError extends Error {
  constructor(readonly code: "oversized" | "malformed") {
    super(code);
    this.name = "FrameError";
  }
}

const text = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Agent frames are big-endian; browser native messaging uses little-endian framing. */
export function encodeFrame(value: unknown, littleEndian = false): Uint8Array {
  const body = text.encode(JSON.stringify(value));
  if (body.length > MAX_FRAME_BYTES) {
    throw new FrameError("oversized");
  }
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, littleEndian);
  frame.set(body, 4);
  return frame;
}

/**
 * Reads frames from a stream of bytes. An advertised length past the limit drops the buffer and
 * throws, instead of waiting for a body that size.
 */
export class FrameDecoder {
  private readonly header = new Uint8Array(4);
  private headerBytes = 0;
  private body: Uint8Array | null = null;
  private bodyBytes = 0;

  constructor(private readonly littleEndian = false) {}

  push(chunk: Uint8Array): unknown[] {
    const messages: unknown[] = [];
    let offset = 0;
    try {
      while (offset < chunk.length) {
        if (this.body == null) {
          const count = Math.min(4 - this.headerBytes, chunk.length - offset);
          this.header.set(chunk.subarray(offset, offset + count), this.headerBytes);
          this.headerBytes += count;
          offset += count;
          if (this.headerBytes !== 4) {
            break;
          }
          const length = new DataView(this.header.buffer).getUint32(0, this.littleEndian);
          if (length > MAX_FRAME_BYTES) {
            throw new FrameError("oversized");
          }
          this.body = new Uint8Array(length);
          this.bodyBytes = 0;
        }
        const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
        this.body.set(chunk.subarray(offset, offset + count), this.bodyBytes);
        this.bodyBytes += count;
        offset += count;
        if (this.bodyBytes !== this.body.length) {
          break;
        }
        const parsed: unknown = JSON.parse(utf8.decode(this.body));
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new FrameError("malformed");
        }
        messages.push(parsed);
        this.body = null;
        this.headerBytes = 0;
      }
    } catch (error) {
      this.body = null;
      this.bodyBytes = 0;
      this.headerBytes = 0;
      throw error instanceof FrameError ? error : new FrameError("malformed");
    }
    return messages;
  }
}

