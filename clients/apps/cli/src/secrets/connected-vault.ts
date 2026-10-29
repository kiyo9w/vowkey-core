import * as fs from "fs";
import * as path from "path";

import { resolveCliDataDirectory } from "@vowkey/common/platform/misc/node/cli-data-directory";
import {
  AgentConnection,
  agentSocketPath,
  brokerIsLive,
} from "@vowkey/common/vault/agent/node/broker";
import type {
  OwnerEnvironment,
  OwnerKeyItem,
  OwnerSecretsQuery,
} from "@vowkey/common/vault/agent/owner-secrets";

import { SecretsError } from "./errors";

export interface ConnectedVault {
  scopeId(): Promise<string>;
  value(itemId: string, fieldPath: string): Promise<string>;
  revision(itemId: string): Promise<string | null>;
  environment(idOrName: string): Promise<OwnerEnvironment>;
  keyItems(itemIds: string[]): Promise<OwnerKeyItem[]>;
}

/** An owner-token query never falls back to a different vault after selecting its scope. */
export async function connectedVault(): Promise<ConnectedVault | null> {
  const directory = resolveCliDataDirectory();
  const socket = agentSocketPath(directory);
  if (!(await brokerIsLive(socket))) {
    return null;
  }
  let scopeId: string | undefined;
  const ask = async (query: OwnerSecretsQuery): Promise<Record<string, unknown>> => {
    let connection: AgentConnection | undefined;
    try {
      const token = fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8");
      connection = await AgentConnection.connect(socket);
      connection.send({ ...query, type: "control", token, action: "secrets", scopeId });
      const reply = await connection.next(15_000);
      if (reply == null || typeof reply !== "object" || !("type" in reply)) {
        throw new SecretsError("unavailable", "The connected vault did not answer.");
      }
      if (reply.type === "error") {
        const code = "code" in reply ? reply.code : "";
        throw new SecretsError(
          code === "locked" || code === "account_changed" ? "locked" : "missing-ref",
          code === "account_changed"
            ? "The vault account changed."
            : "The connected vault refused the item.",
        );
      }
      if (reply.type !== "secrets") {
        throw new SecretsError("unavailable", "The connected vault did not answer.");
      }
      return Object.assign({}, reply);
    } catch (error) {
      if (error instanceof SecretsError) {
        throw error;
      }
      throw new SecretsError("unavailable", "The connected vault is unavailable.");
    } finally {
      connection?.close();
    }
  };
  const status = await ask({ op: "status" });
  if (typeof status.scopeId !== "string" || status.scopeId === "") {
    throw new SecretsError("unavailable", "The connected vault has no active scope.");
  }
  scopeId = status.scopeId;
  return {
    scopeId: async () => {
      const current = await ask({ op: "status" });
      if (current.scopeId !== scopeId) {
        throw new SecretsError("locked", "The vault account changed.");
      }
      return scopeId;
    },
    value: async (itemId, fieldPath) => {
      const reply = await ask({ op: "value", itemId, fieldPath });
      if (typeof reply.value !== "string") {
        throw new SecretsError(
          "missing-ref",
          "The connected vault has no value for that reference.",
        );
      }
      return reply.value;
    },
    revision: async (itemId) => {
      const reply = await ask({ op: "revision", itemId });
      if (reply.revision === null) {
        return null;
      }
      if (typeof reply.revision !== "string") {
        throw new SecretsError("unavailable", "The connected vault returned no revision.");
      }
      return reply.revision;
    },
    environment: async (idOrName) => {
      const reply = await ask({ op: "environment", idOrName });
      if (!validEnvironment(reply.environment)) {
        throw new SecretsError("unavailable", "The connected vault returned no environment.");
      }
      return reply.environment;
    },
    keyItems: async (itemIds) => {
      const reply = await ask({ op: "keys", itemIds });
      if (!Array.isArray(reply.keys) || !reply.keys.every(validKey)) {
        throw new SecretsError("unavailable", "The connected vault returned invalid key metadata.");
      }
      return reply.keys;
    },
  };
}

function validEnvironment(value: unknown): value is OwnerEnvironment {
  return (
    value != null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "revision" in value &&
    typeof value.revision === "string" &&
    "deleted" in value &&
    typeof value.deleted === "boolean" &&
    "members" in value &&
    Array.isArray(value.members) &&
    value.members.every(
      (member) =>
        member != null &&
        typeof member === "object" &&
        "name" in member &&
        typeof member.name === "string" &&
        "itemId" in member &&
        typeof member.itemId === "string",
    )
  );
}

function validKey(value: unknown): value is OwnerKeyItem {
  if (
    value == null ||
    typeof value !== "object" ||
    !("itemId" in value) ||
    typeof value.itemId !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("value" in value) ||
    typeof value.value !== "string" ||
    !("revision" in value) ||
    typeof value.revision !== "string" ||
    !("allowedHosts" in value) ||
    !Array.isArray(value.allowedHosts) ||
    !value.allowedHosts.every((host) => typeof host === "string")
  ) {
    return false;
  }
  return (
    (!("sendStyle" in value) ||
      value.sendStyle === undefined ||
      typeof value.sendStyle === "string") &&
    (!("headerName" in value) ||
      value.headerName === undefined ||
      typeof value.headerName === "string") &&
    (!("basicUsername" in value) ||
      value.basicUsername === undefined ||
      typeof value.basicUsername === "string")
  );
}
