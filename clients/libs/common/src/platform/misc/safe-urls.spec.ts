import { SafeUrls, UrlType } from "./safe-urls";

describe("SafeUrls service", () => {
  it("should allow valid URLs", () => {
    expect(SafeUrls.canLaunch("https://vowkey.com", UrlType.CipherUri)).toBe(true);
    expect(SafeUrls.canLaunch("http://vowkey.com", UrlType.CipherUri)).toBe(true);
    expect(SafeUrls.canLaunch("ssh://my-server", UrlType.CipherUri)).toBe(true);
  });

  it.each([
    "HTTPS://vowkey.com",
    "HtTp://vowkey.com",
    "SSH://my-server",
    "MS-RD:full address=s:server.example.com",
  ])("should allow URI schemes regardless of case: %s", (url) => {
    expect(SafeUrls.canLaunch(url, UrlType.CipherUri)).toBe(true);
  });

  it("should fail invalid URLs", () => {
    expect(SafeUrls.canLaunch("vowkey.com", UrlType.CipherUri)).toBe(false);
    expect(SafeUrls.canLaunch("", UrlType.CipherUri)).toBe(false);
    expect(SafeUrls.canLaunch(null, UrlType.CipherUri)).toBe(false);
  });

  it("should fail URLs with disallowed protocols", () => {
    expect(SafeUrls.canLaunch("file:///etc/passwd", UrlType.CipherUri)).toBe(false);
    expect(SafeUrls.canLaunch("FILE:///etc/passwd", UrlType.CipherUri)).toBe(false);
    expect(SafeUrls.canLaunch("\\\\network.share\\abc", UrlType.CipherUri)).toBe(false);
    expect(SafeUrls.canLaunch("smb://smb.server", UrlType.CipherUri)).toBe(false);
  });

  it("should only allow https for WebUrl", () => {
    expect(SafeUrls.canLaunch("https://vowkey.com", UrlType.WebUrl)).toBe(true);
    expect(SafeUrls.canLaunch("HTTPS://vowkey.com", UrlType.WebUrl)).toBe(true);
    expect(SafeUrls.canLaunch("http://vowkey.com", UrlType.WebUrl)).toBe(false);
    expect(SafeUrls.canLaunch("HTTP://vowkey.com", UrlType.WebUrl)).toBe(false);
  });
});
