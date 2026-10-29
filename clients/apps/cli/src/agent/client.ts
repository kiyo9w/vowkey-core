import * as fs from "fs";
import * as path from "path";

import { parseVkReference } from "@vowkey/common/vault/reference";

import { AgentConnection, agentSocketPath, brokerIsLive } from "@vowkey/common/vault/agent/node/broker";

export interface StoredPairing {
  pairingId: string;
  credential: string;
  vaultScopeId: string;
}

export interface RequestAssignment {
  fieldId: string;
  reference?: string;
}

/** Reads the credential file a paired client keeps. Mode is the caller's responsibility. */
export function readPairing(file: string): StoredPairing {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<StoredPairing>;
  if (
    typeof parsed.pairingId !== "string" ||
    typeof parsed.credential !== "string" ||
    typeof parsed.vaultScopeId !== "string"
  ) {
    throw new Error("credential_rejected: This client is not paired.");
  }
  return parsed as StoredPairing;
}

export function writePairing(file: string, pairing: StoredPairing): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(pairing), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * Pairs this socket and waits until the person approves it. The credential is written to
 * `file` and is not returned to the caller that only asked to start the pair.
 */
export async function pairAndWait(
  dataDirectory: string,
  credentialFile: string,
  displayName: string,
): Promise<{ pairingId: string }> {
  const socketPath = agentSocketPath(dataDirectory);
  if (!(await brokerIsLive(socketPath))) {
    throw new Error("executor_unavailable: The agent broker is not running.");
  }
  const connection = await AgentConnection.connect(socketPath);
  try {
    connection.send({ type: "hello", protocol: "vowkey.agent.v1" });
    const hello = (await connection.next()) as { vaultScopeIds?: string[] };
    const vaultScopeId = hello.vaultScopeIds?.[0];
    if (vaultScopeId == null) {
      throw new Error("executor_unavailable: The agent broker is not running.");
    }
    connection.send({ type: "pair", displayName, vaultScopeId });
    const pending = (await connection.next()) as { type?: string };
    if (pending.type !== "pair_pending") {
      throw new Error("credential_rejected: The broker did not accept the pair.");
    }
    const paired = (await connection.next(120_000)) as {
      type?: string;
      pairingId?: string;
      credential?: string;
      vaultScopeId?: string;
    };
    if (paired.type !== "paired" || paired.pairingId == null || paired.credential == null) {
      throw new Error("credential_rejected: The pair was not approved.");
    }
    writePairing(credentialFile, {
      pairingId: paired.pairingId,
      credential: paired.credential,
      vaultScopeId: paired.vaultScopeId ?? vaultScopeId,
    });
    return { pairingId: paired.pairingId };
  } finally {
    connection.close();
  }
}

async function control(dataDirectory: string, body: Record<string, unknown>): Promise<unknown> {
  const token = fs.readFileSync(path.join(dataDirectory, "agent", "control.token"), "utf8");
  if (!(await brokerIsLive(agentSocketPath(dataDirectory)))) {
    throw new Error("executor_unavailable: The agent broker is not running.");
  }
  const connection = await AgentConnection.connect(agentSocketPath(dataDirectory));
  try {
    connection.send({ type: "control", token, ...body });
    return await connection.next();
  } finally {
    connection.close();
  }
}

/** Pairs the person has not approved yet. */
export async function listPending(
  dataDirectory: string,
): Promise<{ connectionId: string; displayName: string; vaultScopeId: string }[]> {
  const reply = (await control(dataDirectory, { action: "pending" })) as {
    type?: string;
    pairs?: { connectionId: string; displayName: string; vaultScopeId: string }[];
    code?: string;
  };
  if (reply.type !== "pending" || reply.pairs == null) {
    throw new Error(`${reply.code ?? "credential_rejected"}: The broker refused the request.`);
  }
  return reply.pairs;
}

/** Approves a pair from the same machine. The reply does not include the credential. */
export async function approvePair(
  dataDirectory: string,
  connectionId: string,
): Promise<{ pairingId: string }> {
  const reply = (await control(dataDirectory, { action: "approve", connectionId })) as {
    type?: string;
    pairingId?: string;
    code?: string;
  };
  if (reply.type !== "approved" || reply.pairingId == null) {
    throw new Error(`${reply.code ?? "credential_rejected"}: The pair was not approved.`);
  }
  return { pairingId: reply.pairingId };
}

/** The person's answer. The paired agent cannot send this. */
export async function answerRequest(
  dataDirectory: string,
  requestId: string,
  answer: "allow_once" | "always_allow" | "deny",
  selectedEntryIds: string[],
): Promise<unknown> {
  return await control(dataDirectory, {
    action: "answer",
    requestId,
    answer,
    selectedEntryIds,
  });
}

/**
 * Sends a fill request for this paired client. Entries without a canonical reference are not
 * given one; the broker is asked only when every entry already names one.
 */
export async function submitRequest(
  dataDirectory: string,
  credentialFile: string,
  input: { goal: string; reason: string; targetId?: string; assignments: RequestAssignment[] },
): Promise<unknown> {
  const missing = input.assignments.some(
    (entry) => entry.reference == null || parseVkReference(entry.reference) == null,
  );
  if (missing || input.assignments.length === 0) {
    return { type: "error", code: "invalid_reference" };
  }
  const socketPath = agentSocketPath(dataDirectory);
  if (!(await brokerIsLive(socketPath))) {
    throw new Error("executor_unavailable: The agent broker is not running.");
  }
  const pairing = readPairing(credentialFile);
  const connection = await AgentConnection.connect(socketPath);
  try {
    connection.send({
      type: "fill_request",
      pairingId: pairing.pairingId,
      credential: pairing.credential,
      vaultScopeId: pairing.vaultScopeId,
      body: {
        targetId: input.targetId,
        goal: input.goal,
        reason: input.reason,
        assignments: input.assignments.map((entry) => ({
          fieldId: entry.fieldId,
          reference: entry.reference,
        })),
      },
    });
    return await connection.next();
  } finally {
    connection.close();
  }
}

/** The outcome of one request, for the pairing that sent it. */
export async function accessResult(
  dataDirectory: string,
  credentialFile: string,
  requestId: string,
): Promise<unknown> {
  const socketPath = agentSocketPath(dataDirectory);
  if (!(await brokerIsLive(socketPath))) {
    throw new Error("executor_unavailable: The agent broker is not running.");
  }
  const pairing = readPairing(credentialFile);
  const connection = await AgentConnection.connect(socketPath);
  try {
    connection.send({
      type: "access_result",
      pairingId: pairing.pairingId,
      credential: pairing.credential,
      vaultScopeId: pairing.vaultScopeId,
      requestId,
    });
    return await connection.next();
  } finally {
    connection.close();
  }
}

export async function readForm(
  dataDirectory: string,
  credentialFile: string,
  targetId?: string,
): Promise<unknown> {
  const pairing = readPairing(credentialFile);
  const connection = await AgentConnection.connect(agentSocketPath(dataDirectory));
  try {
    connection.send({ type: "read_form", ...pairing, targetId });
    return await connection.next(30_000);
  } finally {
    connection.close();
  }
}
