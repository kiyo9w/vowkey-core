import { SecretMasker } from "./masker";

function run(masker: SecretMasker, chunks: string[]): string {
  const out: Buffer[] = chunks.map((c) => masker.push(Buffer.from(c)));
  out.push(masker.flush());
  return Buffer.concat(out).toString();
}

describe("SecretMasker", () => {
  const secret = "sk-live-1234567890";

  it("replaces an exact secret", () => {
    expect(run(new SecretMasker([secret]), [`key=${secret}\n`])).toBe(
      "key=<concealed by Vowkey>\n",
    );
  });

  it("replaces a secret split across chunks at every position", () => {
    const text = `before ${secret} after`;
    for (let cut = 1; cut < text.length; cut++) {
      const out = run(new SecretMasker([secret]), [text.slice(0, cut), text.slice(cut)]);
      expect(out).toBe("before <concealed by Vowkey> after");
    }
  });

  it("replaces a secret delivered one byte at a time", () => {
    const text = `x${secret}y${secret}z`;
    const out = run(new SecretMasker([secret]), text.split(""));
    expect(out).toBe("x<concealed by Vowkey>y<concealed by Vowkey>z");
  });

  it("injects but does not mask a secret shorter than 8 bytes", () => {
    expect(run(new SecretMasker(["short12"]), ["a short12 b"])).toBe("a short12 b");
    expect(run(new SecretMasker(["exactly8"]), ["a exactly8 b"])).toBe("a <concealed by Vowkey> b");
  });

  it("prefers the longer of two overlapping secrets", () => {
    const out = run(new SecretMasker(["abcdefgh", "abcdefghijkl"]), ["x abcdefghijkl y"]);
    expect(out).toBe("x <concealed by Vowkey> y");
  });

  it("passes non-UTF-8 bytes through untouched", () => {
    const masker = new SecretMasker([secret]);
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80]);
    const out = Buffer.concat([masker.push(bytes), masker.flush()]);
    expect(out.equals(bytes)).toBe(true);
  });

  it("does not mask base64 or hex forms of the secret", () => {
    const b64 = Buffer.from(secret).toString("base64");
    const hex = Buffer.from(secret).toString("hex");
    expect(run(new SecretMasker([secret]), [`${b64} ${hex}`])).toBe(`${b64} ${hex}`);
  });

  it("is a pass-through when there is nothing to mask", () => {
    const masker = new SecretMasker([]);
    expect(masker.active).toBe(false);
    expect(masker.push(Buffer.from("anything")).toString()).toBe("anything");
  });
});
