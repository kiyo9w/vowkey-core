import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";

export function agentAuthority(): AgentVaultAuthority {
  const key = randomBytes(32);
  return {
    scopeIds: ["local"],
    resolve: async (): Promise<null> => null,
    value: async () => { throw new Error("no_access"); },
    targets: { collect: async () => [], write: async () => ({ entries: [] }) },
    seal: async (plain) => {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const bytes = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64");
    },
    open: async (sealed) => {
      const bytes = Buffer.from(sealed, "base64");
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
    },
  };
}
