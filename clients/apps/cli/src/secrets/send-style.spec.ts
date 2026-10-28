import { buildSendHeader } from "./send-style";

describe("buildSendHeader", () => {
  it("writes Authorization: Bearer for bearer", () => {
    expect(buildSendHeader({ sendStyle: "bearer", value: "sk-1" })).toEqual({
      name: "Authorization",
      value: "Bearer sk-1",
    });
  });

  it("writes the named header with the raw value for header", () => {
    expect(buildSendHeader({ sendStyle: "header", value: "k", headerName: "X-Api-Key" })).toEqual({
      name: "X-Api-Key",
      value: "k",
    });
  });

  it("writes Basic of username:value for basic, including an empty user name", () => {
    expect(buildSendHeader({ sendStyle: "basic", value: "pw", basicUsername: "me" }).value).toBe(
      "Basic " + Buffer.from("me:pw").toString("base64"),
    );
    expect(buildSendHeader({ sendStyle: "basic", value: "pw", basicUsername: "" }).value).toBe(
      "Basic " + Buffer.from(":pw").toString("base64"),
    );
  });

  it.each(["Host", "content-length", "Transfer-Encoding", "Connection", "Proxy-Authorization"])(
    "refuses %s as a send-style header name",
    (headerName) => {
      expect(() => buildSendHeader({ sendStyle: "header", value: "k", headerName })).toThrow(
        "not one a key may set",
      );
    },
  );

  it("refuses control characters in the value and a malformed name", () => {
    expect(() => buildSendHeader({ sendStyle: "bearer", value: "a\r\nX: y" })).toThrow("control");
    expect(() => buildSendHeader({ sendStyle: "bearer", value: "a\0b" })).toThrow("control");
    expect(() =>
      buildSendHeader({ sendStyle: "header", value: "k", headerName: "Bad Name" }),
    ).toThrow();
  });

  it("refuses a style that is missing what it needs", () => {
    expect(() => buildSendHeader({ sendStyle: "header", value: "k" })).toThrow("header name");
    expect(() => buildSendHeader({ sendStyle: "basic", value: "k" })).toThrow("user name");
    expect(() => buildSendHeader({ sendStyle: "weird", value: "k" })).toThrow("send style");
    expect(() => buildSendHeader({ sendStyle: "bearer", value: "" })).toThrow("no value");
  });
});
