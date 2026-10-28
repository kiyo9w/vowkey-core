import { matchRank, parseHostPattern, selectKey } from "./host-match";

const https = (hostname: string, port = 443) => ({ hostname, port, scheme: "https" as const });

describe("matchRank", () => {
  it("matches an exact host on 443 when the pattern has no port", () => {
    expect(matchRank(parseHostPattern("api.openai.com"), https("API.OpenAI.com"))).toBe(2);
    expect(matchRank(parseHostPattern("api.openai.com"), https("api.openai.com", 8443))).toBe(0);
  });

  it("needs another port in the pattern", () => {
    expect(
      matchRank(parseHostPattern("api.example.com:8443"), https("api.example.com", 8443)),
    ).toBe(2);
    expect(matchRank(parseHostPattern("api.example.com:8443"), https("api.example.com"))).toBe(0);
  });

  it("matches port 80 only for http to a loopback host", () => {
    const http = (hostname: string) => ({ hostname, port: 80, scheme: "http" as const });
    expect(matchRank(parseHostPattern("localhost"), http("localhost"))).toBe(2);
    expect(matchRank(parseHostPattern("127.0.0.1"), http("127.0.0.1"))).toBe(2);
    expect(matchRank(parseHostPattern("example.com"), http("example.com"))).toBe(0);
  });

  it("lets *.example.com match one label and not several", () => {
    const pattern = parseHostPattern("*.example.com");
    expect(matchRank(pattern, https("a.example.com"))).toBe(1);
    expect(matchRank(pattern, https("a.b.example.com"))).toBe(0);
    expect(matchRank(pattern, https("example.com"))).toBe(0);
    expect(matchRank(pattern, https("evilexample.com"))).toBe(0);
    expect(matchRank(pattern, https("a.example.com.evil.com"))).toBe(0);
  });

  it("reads IPv6 literals", () => {
    const http = { hostname: "[::1]", port: 80, scheme: "http" as const };
    expect(matchRank(parseHostPattern("[::1]"), http)).toBe(2);
  });

  it("rejects patterns that are not hosts", () => {
    expect(() => parseHostPattern("")).toThrow();
    expect(() => parseHostPattern("a*.example.com")).toThrow();
    expect(() => parseHostPattern("example.com/path")).toThrow();
    expect(() => parseHostPattern("example.com:99999")).toThrow();
  });
});

describe("selectKey", () => {
  const keys = [
    { itemId: "wild", allowedHosts: ["*.example.com"] },
    { itemId: "exact", allowedHosts: ["api.example.com"] },
    { itemId: "other", allowedHosts: ["other.test"] },
  ];

  it("prefers an exact host over a wildcard", () => {
    expect(selectKey(keys, https("api.example.com"))).toEqual({ kind: "key", itemId: "exact" });
    expect(selectKey(keys, https("www.example.com"))).toEqual({ kind: "key", itemId: "wild" });
  });

  it("returns none for a host no key lists", () => {
    expect(selectKey(keys, https("unlisted.test"))).toEqual({ kind: "none" });
  });

  it("is ambiguous when two keys match at the same rank, and names both", () => {
    const two = [
      { itemId: "a", allowedHosts: ["api.example.com"] },
      { itemId: "b", allowedHosts: ["api.example.com", "x.test"] },
    ];
    expect(selectKey(two, https("api.example.com"))).toEqual({
      kind: "ambiguous",
      itemIds: ["a", "b"],
    });
  });

  it("ignores a pattern that does not parse", () => {
    expect(selectKey([{ itemId: "a", allowedHosts: ["a*b"] }], https("ab.test"))).toEqual({
      kind: "none",
    });
  });
});
