import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { readEnvelope, resolveEnvelopePath } from "@vowkey/common/vault/profile/vk-meta";

/** The reference parser `mcp/src/utils/references.ts` also uses. */
const VK_REF_REGEX = /^@vk:([^/\s]+)\/(.+)$/;

export interface VkReference {
  itemId: string;
  fieldPath: string;
}

export function parseVkReference(value: string): VkReference | null {
  const match = VK_REF_REGEX.exec(value.trim());
  if (match == null || !match[1] || !match[2]) {
    return null;
  }
  return { itemId: match[1], fieldPath: match[2] };
}

export function formatVkReference(itemId: string, fieldPath: string): string {
  return `@vk:${itemId}/${fieldPath}`;
}

export type ResolveFailure = "not-found" | "trashed" | "unknown-path" | "empty";

export class ReferenceError extends Error {
  constructor(
    readonly reason: ResolveFailure,
    message: string,
  ) {
    super(message);
    this.name = "ReferenceError";
  }
}

const TYPE_OF_GROUP = {
  sshKey: CipherType.SshKey,
  bankAccount: CipherType.BankAccount,
  driversLicense: CipherType.DriversLicense,
  passport: CipherType.Passport,
} as const;

const KEY_PATHS = ["value", "sendStyle", "allowedHosts", "headerName", "basicUsername"] as const;
const LOGIN_PATHS = ["username", "password", "totp"] as const;
const CARD_PATHS = ["number", "code", "cardholderName", "expMonth", "expYear"] as const;

/**
 * Reads one field of a decrypted item. `viewPassword: false` does not stop this: the value is
 * resolved for `vowkey run`, an enabled environment file and the proxy, and hidden only in the
 * output of `get` and the MCP tools.
 */
export function readFieldPath(cipher: CipherView, fieldPath: string): string {
  const fail = (reason: ResolveFailure): never => {
    throw new ReferenceError(reason, `${reason}: ${fieldPath}`);
  };

  if (cipher.isDeleted) {
    return fail("trashed");
  }

  let value: string | null | undefined;
  const [group, ...rest] = fieldPath.split(".");
  const name = rest.join(".");

  if (fieldPath === "notes") {
    value = cipher.notes;
  } else if (group === "key" && cipher.type === CipherType.ApiKey) {
    if (!(KEY_PATHS as readonly string[]).includes(name)) {
      return fail("unknown-path");
    }
    if (name === "allowedHosts") {
      value = JSON.stringify(cipher.apiKey.allowedHosts);
    } else {
      value = cipher.apiKey[name as Exclude<(typeof KEY_PATHS)[number], "allowedHosts">];
    }
  } else if (group === "login" && cipher.type === CipherType.Login) {
    if (!(LOGIN_PATHS as readonly string[]).includes(name)) {
      return fail("unknown-path");
    }
    value = cipher.login[name as (typeof LOGIN_PATHS)[number]];
  } else if (group === "card" && cipher.type === CipherType.Card) {
    if (!(CARD_PATHS as readonly string[]).includes(name)) {
      return fail("unknown-path");
    }
    value = cipher.card[name as (typeof CARD_PATHS)[number]];
  } else if (
    cipher.type === CipherType.Identity &&
    readEnvelope(cipher) != null &&
    (group === "detail" || group === "identity")
  ) {
    // A profile with details of its own: a detail id, or an Identity path as fill writes it.
    value = resolveEnvelopePath(cipher, fieldPath);
  } else if (group === "identity" && cipher.type === CipherType.Identity) {
    const identity = cipher.identity as unknown as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(identity, name) ||
      typeof identity[name] === "function"
    ) {
      return fail("unknown-path");
    }
    value = identity[name] as string | null | undefined;
  } else if (
    (group === "sshKey" ||
      group === "bankAccount" ||
      group === "driversLicense" ||
      group === "passport") &&
    TYPE_OF_GROUP[group] === cipher.type
  ) {
    const object = (cipher as unknown as Record<string, Record<string, unknown>>)[group];
    if (!Object.prototype.hasOwnProperty.call(object, name) || typeof object[name] === "function") {
      return fail("unknown-path");
    }
    value = object[name] as string | null | undefined;
  } else if (group === "field") {
    const matches = (cipher.fields ?? []).filter((f) => f.name === name);
    if (matches.length !== 1) {
      return fail("unknown-path");
    }
    value = matches[0].value;
  } else {
    return fail("unknown-path");
  }

  if (value == null || value === "") {
    return fail("empty");
  }
  return value;
}
