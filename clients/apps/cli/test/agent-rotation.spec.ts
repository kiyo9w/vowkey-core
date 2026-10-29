import { PureCrypto } from "@vowkey/sdk-internal";
import { rotateAgentRecords } from "@vowkey/common/vault/agent/account-records";

import { makeCoseKey } from "./crypto-keys";

it("rotates private ciphertext without rebuilding its payload or restoring an expired note", async () => {
  const oldKey = PureCrypto.make_user_key_aes256_cbc_hmac();
  const newKey = makeCoseKey();
  const raw = '  {"v":2,"custom":{"conference.role":"共同議長"},"future":[null,3]}\n';
  const encrypted = PureCrypto.symmetric_encrypt_string(raw, oldKey);
  try {
    const rotated = await rotateAgentRecords({ agentRecords: [{
      id: "request-1", kind: "request", revision: 7, routing: encrypted,
      note: null, answer: null, result: encrypted,
    }], formBindings: [{ id: "binding-1", revision: 8, encryptedBinding: encrypted }] }, {
      open: async (value) => PureCrypto.symmetric_decrypt_string(value, oldKey),
    }, {
      seal: async (value) => PureCrypto.symmetric_encrypt_string(value, newKey),
    });
    expect(rotated.agentRecords[0]).toMatchObject({ id: "request-1", kind: "request", revision: 7,
      note: null, answer: null });
    const request = rotated.agentRecords[0] as { routing: string; result: string };
    expect(request.routing.startsWith("7.")).toBe(true);
    expect(PureCrypto.symmetric_decrypt_string(request.routing, newKey)).toBe(raw);
    expect(PureCrypto.symmetric_decrypt_string(request.result, newKey)).toBe(raw);
    const binding = rotated.formBindings[0] as { encryptedBinding: string };
    expect(PureCrypto.symmetric_decrypt_string(binding.encryptedBinding, newKey)).toBe(raw);
  } finally { oldKey.fill(0); newKey.fill(0); }
});
