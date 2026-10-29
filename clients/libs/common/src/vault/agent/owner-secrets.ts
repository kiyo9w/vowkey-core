import { CipherType } from "../enums";
import type { CipherView } from "../models/view/cipher.view";
import { readFieldPath } from "../reference";

export type OwnerSecretsQuery =
  | { op: "status" }
  | { op: "value"; itemId: string; fieldPath: string }
  | { op: "revision"; itemId: string }
  | { op: "environment"; idOrName: string }
  | { op: "keys"; itemIds: string[] };

export interface OwnerKeyItem {
  itemId: string;
  name: string;
  value: string;
  sendStyle: string | undefined;
  allowedHosts: string[];
  headerName?: string;
  basicUsername?: string;
  revision: string;
}

export interface OwnerEnvironment {
  id: string;
  name: string;
  members: { name: string; itemId: string }[];
  revision: string;
  deleted: boolean;
}

export type OwnerSecretsResult =
  | { scopeId: string }
  | { value: string; revision: string }
  | { revision: string | null }
  | { environment: OwnerEnvironment }
  | { keys: OwnerKeyItem[] };

/** Validates the owner-control boundary; pairing credentials never authorize this query. */
export function parseOwnerSecretsQuery(value: unknown): OwnerSecretsQuery {
  if (value == null || typeof value !== "object" || !("op" in value)) {
    throw new Error("malformed");
  }
  if (value.op === "status") {
    return { op: "status" };
  }
  if (value.op === "value" && "itemId" in value && typeof value.itemId === "string" &&
    "fieldPath" in value && typeof value.fieldPath === "string") {
    return { op: "value", itemId: value.itemId, fieldPath: value.fieldPath };
  }
  if (value.op === "revision" && "itemId" in value && typeof value.itemId === "string") {
    return { op: "revision", itemId: value.itemId };
  }
  if (value.op === "environment" && "idOrName" in value && typeof value.idOrName === "string") {
    return { op: "environment", idOrName: value.idOrName };
  }
  if (value.op === "keys" && "itemIds" in value && Array.isArray(value.itemIds) &&
    value.itemIds.every((id) => typeof id === "string")) {
    return { op: "keys", itemIds: value.itemIds };
  }
  throw new Error("malformed");
}

/** Projects explicit person-owned reads, independently of external-agent fill rules. */
export async function readOwnerSecrets(
  query: OwnerSecretsQuery,
  scopeId: string,
  view: (id: string) => Promise<CipherView | null>,
  list: () => Promise<CipherView[]>,
): Promise<OwnerSecretsResult> {
  const accessible = (cipher: CipherView | null): cipher is CipherView =>
    cipher != null && !cipher.isDeleted && !cipher.migrationPending;
  if (query.op === "status") {
    return { scopeId };
  }
  if (query.op === "environment") {
    let environment = await view(query.idOrName);
    if (!accessible(environment) || environment.type !== CipherType.Environment) {
      const matches = (await list()).filter((cipher) => accessible(cipher) &&
        cipher.type === CipherType.Environment && cipher.name === query.idOrName);
      if (matches.length !== 1) {
        throw new Error("no_access");
      }
      environment = matches[0];
    }
    return { environment: {
      id: environment.id, name: environment.name, revision: environment.revisionDate?.toISOString() ?? "",
      deleted: false, members: environment.environment.members.map(({ name, itemId }) => ({ name, itemId })),
    } };
  }
  if (query.op === "keys") {
    const keys: OwnerKeyItem[] = [];
    for (const id of query.itemIds) {
      const cipher = await view(id);
      if (!accessible(cipher) || cipher.type !== CipherType.ApiKey) {
        continue;
      }
      keys.push({
        itemId: cipher.id, name: cipher.name, value: readFieldPath(cipher, "key.value"),
        sendStyle: cipher.apiKey.sendStyle, allowedHosts: [...cipher.apiKey.allowedHosts],
        headerName: cipher.apiKey.headerName, basicUsername: cipher.apiKey.basicUsername,
        revision: cipher.revisionDate?.toISOString() ?? "",
      });
    }
    return { keys };
  }
  const cipher = await view(query.itemId);
  if (query.op === "revision") {
    return { revision: accessible(cipher) ? cipher.revisionDate?.toISOString() ?? "" : null };
  }
  if (!accessible(cipher)) {
    throw new Error("no_access");
  }
  return { value: readFieldPath(cipher, query.fieldPath), revision: cipher.revisionDate?.toISOString() ?? "" };
}
