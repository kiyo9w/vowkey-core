import { PureCrypto } from "@vowkey/sdk-internal";

import { AgentSnapshot } from "../agent/executor";

import { LocalVaultAccountKeyCustody } from "./protection";
import { LocalVaultStore } from "./store";

export const ACCOUNT_ROTATION_PREFIX = "account-key-rotation:";
export interface AccountRotationCustodyJournal {
  v: 1;
  rotationId: string;
  accountUserId: string;
  phase: "staged" | "committed";
  destinationKey: string;
  previousKey: string;
  source: string | null;
  destination: string | null;
}

export function rotationCustodyId(accountUserId: string): string {
  return `${ACCOUNT_ROTATION_PREFIX}${accountUserId}`;
}

export async function readRotationCustody(
  store: LocalVaultStore, accountUserId: string,
): Promise<AccountRotationCustodyJournal | undefined> {
  const journal = await store.get<AccountRotationCustodyJournal>("migrations", rotationCustodyId(accountUserId));
  if (journal != null && (journal.v !== 1 || journal.accountUserId !== accountUserId)) {
    throw new Error("The account key rotation belongs to another account.");
  }
  return journal;
}

function rewrapAgentSnapshot(encrypted: string | null, currentKey: Uint8Array, nextKey: Uint8Array): string | null {
  if (encrypted == null) { return null; }
  const snapshot = JSON.parse(PureCrypto.symmetric_decrypt_string(encrypted, currentKey)) as AgentSnapshot;
  if (snapshot.v !== 1 || !Array.isArray(snapshot.pairings) || !Array.isArray(snapshot.requests)) {
    throw new Error("The local agent state is unreadable.");
  }
  for (const pairing of snapshot.pairings) {
    pairing.encryptedVerifier = PureCrypto.symmetric_encrypt_string(
      PureCrypto.symmetric_decrypt_string(pairing.encryptedVerifier, currentKey), nextKey,
    );
  }
  return PureCrypto.symmetric_encrypt_string(JSON.stringify(snapshot), nextKey);
}

export async function prepareRotationCustody(
  store: LocalVaultStore, custody: LocalVaultAccountKeyCustody | null,
  accountUserId: string, currentKey: Uint8Array, nextKey: Uint8Array, rotationId: string,
): Promise<boolean> {
  if (custody == null) { return false; }
  const source = await custody.quiesce(rotationId, accountUserId);
  const journal: AccountRotationCustodyJournal = {
    v: 1, rotationId, accountUserId, phase: "staged", source,
    destination: rewrapAgentSnapshot(source, currentKey, nextKey),
    destinationKey: PureCrypto.wrap_symmetric_key(nextKey, currentKey),
    previousKey: PureCrypto.wrap_symmetric_key(currentKey, nextKey),
  };
  await store.commit([{ store: "migrations", id: rotationCustodyId(accountUserId), value: journal }]);
  return true;
}

export function verifyRotationKeys(journal: AccountRotationCustodyJournal, currentKey: Uint8Array, nextKey: Uint8Array): void {
  let current: Uint8Array | undefined;
  let next: Uint8Array | undefined;
  try {
    current = PureCrypto.unwrap_symmetric_key(journal.previousKey, nextKey);
    next = PureCrypto.unwrap_symmetric_key(journal.destinationKey, currentKey);
    if (current.length !== currentKey.length || next.length !== nextKey.length ||
      current.some((byte, index) => byte !== currentKey[index]) || next.some((byte, index) => byte !== nextKey[index])) {
      throw new Error("The staged account key rotation does not match these keys.");
    }
  } finally { current?.fill(0); next?.fill(0); }
}

export async function commitRotationCustody(
  store: LocalVaultStore, custody: LocalVaultAccountKeyCustody | null,
  journal: AccountRotationCustodyJournal, currentKey: Uint8Array, nextKey: Uint8Array,
): Promise<void> {
  if (custody == null) {
    throw new Error("The local agent key handoff is unavailable.");
  }
  verifyRotationKeys(journal, currentKey, nextKey);
  const current = await custody.quiesce(journal.rotationId, journal.accountUserId);
  if (current !== journal.source && current !== journal.destination) {
    let destination: string | null;
    try { destination = rewrapAgentSnapshot(current, currentKey, nextKey); }
    catch { destination = rewrapAgentSnapshot(current, nextKey, nextKey); }
    journal = { ...journal, source: current, destination };
  }
  journal.phase = "committed";
  await store.commit([{ store: "migrations", id: rotationCustodyId(journal.accountUserId), value: journal }]);
  await custody.stage(journal.rotationId, journal.accountUserId, journal.destination, journal.source);
  await custody.finalize(journal.rotationId, journal.accountUserId);
}
