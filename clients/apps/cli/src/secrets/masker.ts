export const MIN_MASKED_BYTES = 8;
export const CONCEALED = Buffer.from("<concealed by Vowkey>");

/**
 * Replaces exact UTF-8 occurrences of resolved secrets in a byte stream, including a secret that
 * is split across two chunks. A secret shorter than 8 bytes is injected but not masked. Base64,
 * hex and URL-encoded forms are outside the mask.
 */
export class SecretMasker {
  private readonly needles: Buffer[];
  private readonly longest: number;
  private pending: Buffer = Buffer.alloc(0);

  constructor(secrets: Iterable<string>) {
    const unique = [...new Set(secrets)]
      .map((s) => Buffer.from(s, "utf8"))
      .filter((b) => b.length >= MIN_MASKED_BYTES)
      .sort((a, b) => b.length - a.length);
    this.needles = unique;
    this.longest = unique.length > 0 ? unique[0].length : 0;
  }

  get active(): boolean {
    return this.needles.length > 0;
  }

  /** Feeds a chunk and returns the bytes that are safe to write now. */
  push(chunk: Buffer): Buffer {
    if (!this.active) {
      return chunk;
    }
    const buf = Buffer.concat([this.pending, chunk]);
    const matches = this.findMatches(buf);
    // Hold back the tail that could begin a secret finishing in the next chunk.
    let cut = Math.max(0, buf.length - (this.longest - 1));
    for (const m of matches) {
      if (m.start < cut && m.end > cut) {
        cut = m.start;
      }
    }
    this.pending = buf.subarray(cut);
    return this.replace(
      buf.subarray(0, cut),
      matches.filter((m) => m.end <= cut),
    );
  }

  /** Returns what was held back once the stream ends. */
  flush(): Buffer {
    const buf = this.pending;
    this.pending = Buffer.alloc(0);
    if (!this.active || buf.length === 0) {
      return buf;
    }
    return this.replace(buf, this.findMatches(buf));
  }

  private findMatches(buf: Buffer): { start: number; end: number }[] {
    const raw: { start: number; end: number }[] = [];
    for (const needle of this.needles) {
      let from = 0;
      for (;;) {
        const at = buf.indexOf(needle, from);
        if (at === -1) {
          break;
        }
        raw.push({ start: at, end: at + needle.length });
        from = at + 1;
      }
    }
    // Longest match first, then drop any match that overlaps one already taken.
    raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const taken: { start: number; end: number }[] = [];
    let last = -1;
    for (const m of raw) {
      if (m.start >= last) {
        taken.push(m);
        last = m.end;
      }
    }
    return taken;
  }

  private replace(buf: Buffer, matches: { start: number; end: number }[]): Buffer {
    if (matches.length === 0) {
      return buf;
    }
    const parts: Buffer[] = [];
    let at = 0;
    for (const m of matches) {
      parts.push(buf.subarray(at, m.start), CONCEALED);
      at = m.end;
    }
    parts.push(buf.subarray(at));
    return Buffer.concat(parts);
  }
}
