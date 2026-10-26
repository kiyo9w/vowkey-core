import {
  getQsParam,
  b64Decode,
  buildMobileDeeplinkUriFromParam,
  isKnownCloudOrigin,
  resolvePostMessageOrigin,
} from "./common";

describe("common connector utilities", () => {
  describe("getQsParam", () => {
    function setHref(url: string) {
      Object.defineProperty(window, "location", {
        value: { href: url },
        writable: true,
        configurable: true,
      });
    }

    it("returns the value for an existing query parameter", () => {
      setHref("https://example.com?foo=bar");
      expect(getQsParam("foo")).toBe("bar");
    });

    it("returns null when the parameter does not exist", () => {
      setHref("https://example.com?foo=bar");
      expect(getQsParam("missing")).toBeNull();
    });

    it("decodes URI-encoded values", () => {
      setHref("https://example.com?msg=hello%20world");
      expect(getQsParam("msg")).toBe("hello world");
    });

    it("returns empty string for a parameter with no value", () => {
      setHref("https://example.com?flag&other=1");
      expect(getQsParam("flag")).toBe("");
    });
  });

  describe("b64Decode", () => {
    it("decodes a base64 string", () => {
      const encoded = btoa("hello world");
      expect(b64Decode(encoded)).toBe("hello world");
    });

    it("handles spaceAsPlus replacement", () => {
      const original = btoa("test");
      const withSpaces = original.replace(/\+/g, " ");
      expect(b64Decode(withSpaces, true)).toBe("test");
    });
  });

  describe("buildMobileDeeplinkUriFromParam", () => {
    function setLocation(href: string, hostname: string) {
      Object.defineProperty(window, "location", {
        value: { href, hostname },
        writable: true,
        configurable: true,
      });
    }

    describe("when deeplinkScheme=https", () => {
      it("returns https://vowkey.com for .com vaults", () => {
        setLocation(
          "https://vault.vowkey.com/connector?deeplinkScheme=https",
          "vault.vowkey.com",
        );
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe(
          "https://vowkey.com/webauthn-callback",
        );
      });

      it("returns https://vowkey.eu for .eu vaults", () => {
        setLocation(
          "https://vault.vowkey.eu/connector?deeplinkScheme=https",
          "vault.vowkey.eu",
        );
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe(
          "https://vowkey.eu/webauthn-callback",
        );
      });

      it("returns https://vowkey.pw for .pw vaults", () => {
        setLocation(
          "https://vault.vowkey.pw/connector?deeplinkScheme=https",
          "vault.vowkey.pw",
        );
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe(
          "https://vowkey.pw/webauthn-callback",
        );
      });

      it("returns https://bitwarden-gov.com for vowkey-gov vaults", () => {
        setLocation(
          "https://vault.bitwarden-gov.com/connector?deeplinkScheme=https",
          "vault.bitwarden-gov.com",
        );
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe(
          "https://bitwarden-gov.com/webauthn-callback",
        );
      });

      it("defaults to vowkey.com for unknown hostnames", () => {
        setLocation(
          "https://self-hosted.example.com/connector?deeplinkScheme=https",
          "self-hosted.example.com",
        );
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe(
          "https://vowkey.com/webauthn-callback",
        );
      });
    });

    describe("when deeplinkScheme is not https", () => {
      it("returns vowkey:// for vowkey scheme", () => {
        setLocation(
          "https://vault.vowkey.com/connector?deeplinkScheme=vowkey",
          "vault.vowkey.com",
        );
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe("vowkey://webauthn-callback");
      });

      it("returns vowkey:// when deeplinkScheme is absent", () => {
        setLocation("https://vault.vowkey.com/connector", "vault.vowkey.com");
        expect(buildMobileDeeplinkUriFromParam("webauthn")).toBe("vowkey://webauthn-callback");
      });
    });

    describe("duo kind", () => {
      it("builds correct path for duo callbacks", () => {
        setLocation(
          "https://vault.vowkey.com/connector?deeplinkScheme=https",
          "vault.vowkey.com",
        );
        expect(buildMobileDeeplinkUriFromParam("duo")).toBe("https://vowkey.com/duo-callback");
      });
    });
  });

  describe("isKnownCloudOrigin", () => {
    function setLocation(href: string, hostname: string) {
      Object.defineProperty(window, "location", {
        value: { href, hostname },
        writable: true,
        configurable: true,
      });
    }

    describe("recognizes Vowkey-managed domains", () => {
      it.each([
        ["vault.vowkey.com", "production .com subdomain"],
        ["vault.vowkey.eu", "production .eu subdomain"],
        ["vault.qa.vowkey.pw", "multi-level .pw subdomain"],
        ["vault.bitwarden-gov.com", "production -gov subdomain"],
      ])("returns true for %s (%s)", (hostname) => {
        setLocation(`https://${hostname}/connector`, hostname);
        expect(isKnownCloudOrigin()).toBe(true);
      });
    });

    describe("rejects unmanaged domains", () => {
      it("returns false for localhost", () => {
        setLocation("http://localhost/connector", "localhost");
        expect(isKnownCloudOrigin()).toBe(false);
      });

      it("returns false for a customer self-hosted domain", () => {
        setLocation("https://vault.customer.com/connector", "vault.customer.com");
        expect(isKnownCloudOrigin()).toBe(false);
      });

      it("returns false for a domain that contains but does not end with a managed TLD", () => {
        setLocation("https://not-vowkey.com/connector", "not-vowkey.com");
        expect(isKnownCloudOrigin()).toBe(false);
      });

      it("returns false for a domain that contains but does not end with the managed gov suffix", () => {
        setLocation("https://not-bitwarden-gov.com/connector", "not-bitwarden-gov.com");
        expect(isKnownCloudOrigin()).toBe(false);
      });

      it("returns false for the bare marketing domain", () => {
        setLocation("https://vowkey.com/connector", "vowkey.com");
        expect(isKnownCloudOrigin()).toBe(false);
      });

      it("returns false when a managed TLD appears as a non-terminal segment", () => {
        setLocation(
          "https://vault.vowkey.com.not-vowkey.com/connector",
          "vault.vowkey.com.not-vowkey.com",
        );
        expect(isKnownCloudOrigin()).toBe(false);
      });

      it("returns false for an empty hostname", () => {
        setLocation("", "");
        expect(isKnownCloudOrigin()).toBe(false);
      });
    });
  });

  describe("resolvePostMessageOrigin", () => {
    function setLocation(hostname: string, origin: string) {
      Object.defineProperty(window, "location", {
        value: { hostname, origin, href: origin + "/connector" },
        writable: true,
        configurable: true,
      });
    }

    describe("on Vowkey-managed domains", () => {
      it("returns window.location.origin when parent is a web URL", () => {
        setLocation("vault.vowkey.com", "https://vault.vowkey.com");
        expect(resolvePostMessageOrigin("https://vault.vowkey.com/some-page")).toBe(
          "https://vault.vowkey.com",
        );
      });

      it("returns window.location.origin regardless of the provided parent URL", () => {
        setLocation("vault.vowkey.com", "https://vault.vowkey.com");
        expect(resolvePostMessageOrigin("https://unrelated.example.com")).toBe(
          "https://vault.vowkey.com",
        );
      });

      it("preserves a file:// parent URL for desktop compatibility", () => {
        setLocation("vault.vowkey.com", "https://vault.vowkey.com");
        expect(resolvePostMessageOrigin("file:///path/to/electron/index.html")).toBe(
          "file:///path/to/electron/index.html",
        );
      });

      it("returns window.location.origin when parent URL is null", () => {
        setLocation("vault.vowkey.com", "https://vault.vowkey.com");
        expect(resolvePostMessageOrigin(null)).toBe("https://vault.vowkey.com");
      });

      it("returns window.location.origin when parent URL is invalid", () => {
        setLocation("vault.vowkey.com", "https://vault.vowkey.com");
        expect(resolvePostMessageOrigin("not-a-url")).toBe("https://vault.vowkey.com");
      });
    });

    describe("on unmanaged domains", () => {
      it("returns the provided parent URL unchanged", () => {
        setLocation("vault.customer.com", "https://vault.customer.com");
        expect(resolvePostMessageOrigin("https://vault.customer.com/page")).toBe(
          "https://vault.customer.com/page",
        );
      });

      it("returns null when parent URL is null", () => {
        setLocation("vault.customer.com", "https://vault.customer.com");
        expect(resolvePostMessageOrigin(null)).toBeNull();
      });
    });
  });
});
