import { SecretsError } from "./errors";

export interface SendableKey {
  sendStyle: string | undefined;
  value: string | undefined;
  headerName?: string | undefined;
  basicUsername?: string | undefined;
}

/** Header names a send style may not set: they belong to the proxy's own framing and auth. */
const FORBIDDEN_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "proxy-authorization",
]);

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** The header a key puts on a request to one of its hosts. */
export function buildSendHeader(key: SendableKey): { name: string; value: string } {
  const fail = (message: string): never => {
    throw new SecretsError("refused", message);
  };
  if (key.value == null || key.value === "") {
    return fail("The key has no value to send.");
  }

  let name: string;
  let value: string;
  switch (key.sendStyle) {
    case "bearer":
      name = "Authorization";
      value = `Bearer ${key.value}`;
      break;
    case "header":
      if (key.headerName == null || key.headerName === "") {
        return fail("This send style needs a header name.");
      }
      name = key.headerName;
      value = key.value;
      break;
    case "basic":
      if (key.basicUsername == null) {
        return fail("This send style needs a user name.");
      }
      name = "Authorization";
      value =
        "Basic " + Buffer.from(`${key.basicUsername}:${key.value}`, "utf8").toString("base64");
      break;
    default:
      return fail("The key's send style is not bearer, header or basic.");
  }

  if (!TOKEN.test(name) || FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) {
    return fail("The header name is not one a key may set.");
  }
  if (hasControlCharacter(value)) {
    return fail("The key value contains a control character and cannot go in a header.");
  }
  return { name, value };
}
