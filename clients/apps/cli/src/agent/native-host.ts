import { deferred } from "@vowkey/common/platform/misc/deferred";
import * as fs from "fs";
import * as path from "path";

import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { accountCoordinatorBridge } from "@vowkey/common/vault/agent/account-bridge";
import { AgentReply, ReferenceFacts } from "@vowkey/common/vault/agent/executor";
import { encodeFrame, FrameDecoder } from "@vowkey/common/vault/agent/frames";
import { AgentBroker, AgentConnection, agentSocketPath, brokerIsLive } from "@vowkey/common/vault/agent/node/broker";
import { RemoteTargets } from "@vowkey/common/vault/agent/node/remote-targets";
import { AgentTarget, AgentWriteResult } from "@vowkey/common/vault/agent/targets";

import { resolveCliDataDirectory } from "@vowkey/common/platform/misc/node/cli-data-directory";

/** Stdio belongs to the browser. Only length-prefixed native messages are written there. */
export async function runNativeHost(): Promise<void> {
  const decoder = new FrameDecoder(true);
  const ready = deferred<string[]>();
  const ended = deferred<void>();
  const requests = new Map<string, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();
  const send = (message: unknown) => process.stdout.write(encodeFrame(message, true));
  const directory = resolveCliDataDirectory();
  let broker: AgentBroker | undefined;
  let connection: AgentConnection | undefined;
  let stopped = false;
  let initialized = false;
  let accountBacked = false;
  const readyTimer = setTimeout(() => ready.reject(new Error("executor_unavailable")), 15_000);

  process.stdin.on("data", (chunk: Buffer) => {
    try {
      for (const raw of decoder.push(chunk)) {
        const message = raw as Record<string, unknown>;
        if (message.type === "authority_ready" && !initialized) {
          if (!Array.isArray(message.scopeIds) || message.scopeIds.length !== 1 ||
            message.scopeIds.some((scope) => typeof scope !== "string" || scope === "")) {
            throw new Error("malformed");
          }
          initialized = true;
          accountBacked = message.accountBacked === true;
          clearTimeout(readyTimer);
          ready.resolve(message.scopeIds as string[]);
        } else if (message.type === "authority_result" && typeof message.requestId === "string") {
          const request = requests.get(message.requestId);
          if (request != null) {
            requests.delete(message.requestId);
            if (message.error != null) {
              request.reject(new Error("executor_unavailable"));
            } else {
              request.resolve(message.result);
            }
          }
        }
        else if (message.type === "control_request" && initialized &&
          typeof message.requestId === "string") {
          void control(message).then(
            (result) => send({ type: "control_result", requestId: message.requestId, result }),
            () => send({ type: "control_result", requestId: message.requestId, error: "executor_unavailable" }),
          );
        }
      }
    } catch {
      stopped = true;
      ready.reject(new Error("malformed"));
      ended.resolve();
    }
  });
  process.stdin.on("end", () => { stopped = true; ended.resolve(); });
  process.stdin.on("error", () => { stopped = true; ended.resolve(); });

  const call = (action: string, body: object): Promise<unknown> => {
    if (stopped) {
      return Promise.reject(new Error("executor_unavailable"));
    }
    const requestId = crypto.randomUUID();
    const pending = deferred<unknown>();
    const timer = setTimeout(() => {
      requests.delete(requestId);
      pending.reject(new Error("executor_unavailable"));
    }, 15_000);
    requests.set(requestId, {
      resolve: (value) => { clearTimeout(timer); pending.resolve(value); },
      reject: (error) => { clearTimeout(timer); pending.reject(error); },
    });
    send({ type: "authority_operation", requestId, action, ...body });
    return pending.promise;
  };

  const control = async (message: Record<string, unknown>): Promise<unknown> => {
    if (!["pending", "approve", "answer", "revoke"].includes(String(message.action))) {
      throw new Error("malformed");
    }
    const client = await AgentConnection.connect(agentSocketPath(directory));
    try {
      client.send({
        ...message,
        type: "control",
        token: fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8"),
        requestId: message.targetRequestId,
      });
      return await client.next(30_000);
    } finally {
      client.close();
    }
  };

  try {
    const scopeIds = await ready.promise;
    const socket = agentSocketPath(directory);
    if (await brokerIsLive(socket)) {
      connection = await AgentConnection.connect(socket);
      connection.send({
        type: "control",
        token: fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8"),
        action: "provider",
        scopeId: scopeIds[0],
      });
      const accepted = await connection.next() as AgentReply;
      if (accepted.type !== "provider_ready") {
        throw new Error("pairing_mismatch");
      }
      const forward = async () => {
        while (!stopped) {
          const message = await connection!.next(24 * 60 * 60 * 1000) as AgentReply;
          if (message.type !== "target_operation" || typeof message.requestId !== "string" ||
            (message.action !== "collect" && message.action !== "write")) {
            throw new Error("malformed");
          }
          try {
            const result = await call(message.action, {
              targetId: message.targetId, target: message.target, operations: message.operations,
            });
            connection!.send({ type: "provider_result", requestId: message.requestId, result });
          } catch {
            connection!.send({ type: "provider_result", requestId: message.requestId, error: "executor_unavailable" });
          }
        }
      };
      void forward().catch(() => ended.resolve());
    } else {
      const providers = new RemoteTargets();
      const authority: AgentVaultAuthority = {
        scopeIds,
        coordination: accountBacked ? accountCoordinatorBridge((method, args) =>
          call("coordinate", { method, args })) : undefined,
        seal: async (plain) => await call("seal", { plain }) as string,
        open: async (ciphertext) => await call("open", { ciphertext }) as string,
        resolve: async (itemId, fieldPath) => await call("resolve", { itemId, fieldPath }) as ReferenceFacts | null,
        value: async (itemId, fieldPath) => await call("value", { itemId, fieldPath }) as string,
        targets: {
          collect: async (targetId) => [
            ...await call("collect", { targetId }) as AgentTarget[],
            ...await providers.collect(targetId),
          ],
          write: async (target, operations) => {
            const local = await call("collect", { targetId: target.targetId }) as AgentTarget[];
            return local.some((candidate) => candidate.targetId === target.targetId)
              ? await call("write", { target, operations }) as AgentWriteResult
              : providers.write(target, operations);
          },
        },
      };
      broker = new AgentBroker(directory, authority, providers);
      await broker.start();
    }
    send({ type: "host_ready", protocol: "vowkey.agent.v1" });
    await ended.promise;
  } catch {
    if (!stopped) {
      send({ type: "error", code: "executor_unavailable" });
    }
  } finally {
    clearTimeout(readyTimer);
    stopped = true;
    for (const request of requests.values()) {
      request.reject(new Error("executor_unavailable"));
    }
    requests.clear();
    connection?.close();
    try {
      await broker?.stop();
    } catch {
    }
    process.stdin.pause();
  }
}
