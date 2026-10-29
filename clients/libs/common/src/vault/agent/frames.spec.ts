import { encodeFrame, FrameDecoder, FrameError, MAX_FRAME_BYTES } from "./frames";

describe("agent frames", () => {
  it("reads a frame that arrives in pieces, and two frames that arrive together", () => {
    const first = encodeFrame({ type: "hello", protocol: "vowkey.agent.v1" });
    const second = encodeFrame({ type: "access_result", requestId: "r1" });
    const decoder = new FrameDecoder();
    expect(decoder.push(first.slice(0, 3))).toEqual([]);
    expect(decoder.push(first.slice(3, 7))).toEqual([]);
    expect(decoder.push(first.slice(7))).toEqual([{ type: "hello", protocol: "vowkey.agent.v1" }]);
    const both = new Uint8Array(first.length + second.length);
    both.set(first, 0);
    both.set(second, first.length);
    expect(decoder.push(both)).toEqual([
      { type: "hello", protocol: "vowkey.agent.v1" },
      { type: "access_result", requestId: "r1" },
    ]);
  });

  it("refuses a length past the limit from the header alone", () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false);
    const decoder = new FrameDecoder();
    expect(() => decoder.push(header)).toThrow(FrameError);
    try {
      decoder.push(header);
    } catch (e) {
      expect((e as FrameError).code).toBe("oversized");
    }
    // The refused length is not kept waiting for a body.
    expect(decoder.push(encodeFrame({ type: "hello" }))).toEqual([{ type: "hello" }]);
  });

  it("refuses a frame that is not JSON", () => {
    const body = new TextEncoder().encode("not-json");
    const frame = new Uint8Array(4 + body.length);
    new DataView(frame.buffer).setUint32(0, body.length, false);
    frame.set(body, 4);
    expect(() => new FrameDecoder().push(frame)).toThrow(FrameError);
  });
});
