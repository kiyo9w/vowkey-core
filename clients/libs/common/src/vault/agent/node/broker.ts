import { deferred } from "@vowkey/common/platform/misc/deferred";
import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { encodeFrame, FrameDecoder, FrameError } from "@vowkey/common/vault/agent/frames";
import {
  AGENT_PROTOCOL,
  AgentExecutor,
  AgentReply,
  AgentSnapshot,
  AnswerKind,
} from "@vowkey/common/vault/agent/executor";
import { parseOwnerSecretsQuery } from "../owner-secrets";
import { RemoteTargets } from "./remote-targets";

export function agentDirectory(dataDirectory: string): string {
  return path.join(dataDirectory, "agent");
}

/** The broker socket. A second process connects to it; it does not replace a live listener. */
export function agentSocketPath(dataDirectory: string): string {
  if (process.platform === "win32") {
    const user = crypto
      .createHash("sha256")
      .update(`${process.env.USERDOMAIN ?? ""}\\${os.userInfo().username}`)
      .digest("hex")
      .slice(0, 16);
    return `\\\\.\\pipe\\vowkey-agent-${user}`;
  }
  return path.join(agentDirectory(dataDirectory), "agent.sock");
}

export async function brokerIsLive(socketPath: string): Promise<boolean> {
  let connection: AgentConnection | undefined;
  try {
    connection = await AgentConnection.connect(socketPath);
    connection.send({ type: "hello", protocol: AGENT_PROTOCOL });
    const reply = await connection.next(1500) as AgentReply;
    return reply.type === "hello" && reply.protocol === AGENT_PROTOCOL;
  } catch {
    return false;
  } finally {
    connection?.close();
  }
}

/** Speaks one agent connection: send a frame, then read the next frame the broker sends. */
export class AgentConnection {
  private readonly decoder = new FrameDecoder();
  private readonly waiting: Array<{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = [];
  private readonly queued: unknown[] = [];
  private failed: Error | null = null;

  private constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = this.decoder.push(chunk);
      } catch (e) {
        this.fail(e instanceof Error ? e : new FrameError("malformed"));
        return;
      }
      for (const message of messages) {
        const next = this.waiting.shift();
        if (next != null) {
          next.resolve(message);
        } else {
          this.queued.push(message);
        }
      }
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => this.fail(new Error("closed")));
  }

  static connect(socketPath: string): Promise<AgentConnection> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(socketPath);
      socket.once("connect", () => resolve(new AgentConnection(socket)));
      socket.once("error", reject);
    });
  }

  send(message: unknown): void {
    this.socket.write(encodeFrame(message));
  }

  next(timeoutMs = 5000): Promise<unknown> {
    if (this.failed != null) {
      return Promise.reject(this.failed);
    }
    const queued = this.queued.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value: unknown) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(waiter), 1);
        reject(new Error("timed out"));
      }, timeoutMs);
      this.waiting.push(waiter);
    });
  }

  close(): void {
    this.socket.end();
  }

  private fail(error: Error): void {
    if (this.failed != null) {
      return;
    }
    this.failed = error;
    this.socket.destroy();
    while (this.waiting.length > 0) {
      this.waiting.shift()?.reject(error);
    }
  }
}

/**
 * The Node broker. Desktop takes this socket when it is running; otherwise this process does.
 * Pairing credentials are delivered on the requesting socket and stored only as a sealed verifier.
 */
export function agentStatePath(dataDirectory: string, scopeIds: string[]): string {
  const scope = crypto.createHash("sha256").update(JSON.stringify(scopeIds)).digest("hex");
  return path.join(agentDirectory(dataDirectory), `state.${scope}.enc`);
}

export class AgentBroker {
  private server: net.Server | null = null;
  private executor: AgentExecutor | null = null;
  private readonly sockets = new Map<string, net.Socket>();
  private controlToken = "";
  private readonly directory: string;
  private readonly statePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private ownsLock = false;
  private readonly observedTargets = new Set<string>();
  private quiesced = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private stopping: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly dataDirectory: string,
    private readonly vault: AgentVaultAuthority,
    private readonly providers?: RemoteTargets,
  ) {
    this.directory = agentDirectory(dataDirectory);
    this.statePath = agentStatePath(dataDirectory, vault.scopeIds);
  }

  get socketPath(): string {
    return agentSocketPath(this.dataDirectory);
  }

  async start(): Promise<void> {
    if (this.stopping != null) {
      await this.stopping;
      this.stopping = null;
    }
    this.quiesced = false;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.directory, 0o700);
    if (await brokerIsLive(this.socketPath)) {
      throw new Error("An agent broker is already running.");
    }
    this.acquireLock();
    try {
      if (await brokerIsLive(this.socketPath)) {
        throw new Error("An agent broker is already running.");
      }
      if (process.platform !== "win32" && fs.existsSync(this.socketPath)) {
        if (!fs.lstatSync(this.socketPath).isSocket()) {
          throw new Error("The agent socket path belongs to another file.");
        }
        fs.unlinkSync(this.socketPath);
      }
      const snapshot = fs.existsSync(this.statePath)
        ? JSON.parse(await this.vault.open(fs.readFileSync(this.statePath, "utf8"))) as AgentSnapshot
        : null;
      if (snapshot != null && snapshot.v !== 1) {
        throw new Error("The agent state version is not supported.");
      }
      const identityPath = path.join(this.directory, "executor.id");
      const localExecutorId = fs.existsSync(identityPath)
        ? fs.readFileSync(identityPath, "utf8")
        : crypto.randomUUID();
      const options = {
        vaultScopeIds: this.vault.scopeIds,
        protector: this.vault,
        clock: { wall: () => Date.now(), mono: () => performance.now() },
        resolve: this.vault.resolve,
        coordination: this.vault.coordination,
        persist: () => this.flush(),
      };
      this.executor = snapshot == null
        ? new AgentExecutor({ ...options, localExecutorId })
        : AgentExecutor.resume(snapshot, options);
      if (!fs.existsSync(identityPath)) {
        writeOwnerFile(identityPath, localExecutorId);
      }
      this.controlToken = crypto.randomBytes(32).toString("base64url");
      writeOwnerFile(path.join(this.directory, "control.token"), this.controlToken);
      await this.flush();
      const server = net.createServer((socket) => this.accept(socket));
      const listening = deferred<void>();
      server.once("error", listening.reject);
      server.listen(this.socketPath, () => {
        server.off("error", listening.reject);
        listening.resolve();
      });
      await listening.promise;
      if (process.platform !== "win32") {
        fs.chmodSync(this.socketPath, 0o600);
      }
      this.server = server;
      if (this.vault.coordination != null) {
        this.poll = setInterval(() => this.refreshAccount(), 2000);
        this.poll.unref();
      }
    } catch (error) {
      this.releaseLock();
      throw error;
    }
  }

  stop(): Promise<void> {
    return this.stopping ??= this.close();
  }

  private async close(): Promise<void> {
    this.quiesced = true;
    if (this.poll != null) {
      clearInterval(this.poll);
      this.poll = null;
    }
    this.executor?.suspend();
    await this.queue;
    try {
      await this.flush();
    } finally {
      for (const socket of this.sockets.values()) {
        socket.destroy();
      }
      this.sockets.clear();
      const server = this.server;
      this.server = null;
      this.executor = null;
      try {
        if (server != null) {
          const closed = deferred<void>();
          server.close(() => closed.resolve());
          await closed.promise;
        }
        if (this.ownsLock && process.platform !== "win32" && fs.existsSync(this.socketPath)) {
          fs.unlinkSync(this.socketPath);
        }
      } finally {
        this.releaseLock();
      }
    }
  }

  private accept(socket: net.Socket): void {
    const connectionId = crypto.randomUUID();
    this.sockets.set(connectionId, socket);
    const decoder = new FrameDecoder();
    socket.on("data", (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const message of messages) {
        if (message != null && typeof message === "object" &&
          this.providers?.receive(connectionId, message as Record<string, unknown>)) {
          continue;
        }
        const operation = this.queue.then(() => this.onMessage(connectionId, message));
        this.queue = operation.catch((): void => undefined);
        void operation.then((reply) => {
          if (reply != null && !socket.destroyed) {
            socket.write(encodeFrame(reply), () => {
              if (reply.type === "quiesced") {
                void this.stop();
              }
            });
          }
        }).catch(() => {
          if (!socket.destroyed) {
            socket.end(encodeFrame({ type: "error", code: "executor_unavailable" }));
          }
        });
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      this.sockets.delete(connectionId);
      this.executor?.disconnect(connectionId);
      this.providers?.detach(connectionId);
    });
  }

  private async onMessage(connectionId: string, message: unknown): Promise<AgentReply | null> {
    const executor = this.executor;
    if (executor == null) {
      return { type: "error", code: "executor_unavailable" };
    }
    const body = message != null && typeof message === "object"
      ? message as Record<string, unknown> : null;
    if (body?.type === "control") {
      if (typeof body.token !== "string" || !tokenMatches(body.token, this.controlToken)) {
        return { type: "error", code: "credential_rejected" };
      }
      if (body.action === "quiesce") {
        this.quiesced = true;
        executor.quiesce();
        await this.flush();
        return { type: "quiesced", encryptedState: fs.readFileSync(this.statePath, "utf8") };
      }
      if (this.quiesced) {
        return { type: "error", code: "account_changed" };
      }
      if (body.action === "provider") {
        if (this.providers == null || typeof body.scopeId !== "string" ||
          !this.vault.scopeIds.includes(body.scopeId)) {
          return { type: "error", code: "pairing_mismatch" };
        }
        const socket = this.sockets.get(connectionId)!;
        this.providers.attach(connectionId, body.scopeId, (frame) => {
          if (socket.destroyed) {
            throw new Error("executor_unavailable");
          }
          socket.write(encodeFrame(frame));
        });
        return { type: "provider_ready" };
      }
      if (body.action === "pending") {
        executor.expire();
        await this.flush();
        return {
          type: "pending", pairs: executor.waitingPairs(), requests: executor.pendingForPerson(),
          pairings: executor.publicPairings(), activity: executor.snapshot().activity,
        };
      }
      if (body.action === "answer") {
        if (
          (body.answer !== "allow_once" && body.answer !== "always_allow" && body.answer !== "deny") ||
          typeof body.requestId !== "string" || !Array.isArray(body.selectedEntryIds) ||
          body.selectedEntryIds.some((entry) => typeof entry !== "string")
        ) {
          return { type: "error", code: "malformed" };
        }
        const reply = await executor.answerFromPerson(
          body.requestId, body.answer as AnswerKind, body.selectedEntryIds as string[],
        );
        await this.flush();
        if (reply.type === "dispatch") {
          return this.dispatch(body.requestId);
        }
        return reply;
      }
      if (body.action === "revoke" && typeof body.pairingId === "string") {
        await this.vault.coordination?.revokePairing(body.pairingId);
        executor.revoke(body.pairingId);
        await this.flush();
        return { type: "revoked", pairingId: body.pairingId };
      }
      if (body.action === "secrets") {
        return this.secrets(body);
      }
      if (body.action !== "approve" || typeof body.connectionId !== "string" ||
        !this.sockets.has(body.connectionId)) {
        return { type: "error", code: "malformed" };
      }
      const paired = await executor.approve(body.connectionId);
      const socket = this.sockets.get(body.connectionId);
      if (paired == null || socket == null || socket.destroyed) {
        if (typeof paired?.pairingId === "string") {
          executor.revoke(paired.pairingId);
        }
        await this.flush();
        return { type: "error", code: "malformed" };
      }
      await this.flush();
      socket.write(encodeFrame(paired));
      return { type: "approved", pairingId: paired.pairingId };
    }
    if (this.quiesced && body?.type !== "hello") {
      return { type: "error", code: "account_changed" };
    }

    if (body?.type === "read_form" || body?.type === "fill_request") {
      const targets = await this.vault.targets.collect();
      for (const id of this.observedTargets) {
        executor.invalidateTarget(id);
      }
      this.observedTargets.clear();
      for (const target of targets) {
        executor.observeTarget(target);
        this.observedTargets.add(target.targetId);
      }
    }
    const reply = await executor.receive(connectionId, message);
    if (reply.type === "pair_pending") {
      return { ...reply, connectionId };
    }
    await this.flush();
    if (body?.type === "fill_request") {
      this.refreshAccount();
    }
    if (reply.status === "dispatching" && typeof reply.requestId === "string") {
      const result = await this.dispatch(reply.requestId);
      return { ...reply, status: result.status ?? "not_written" };
    }
    return reply;
  }

  /** This path is reached only after the owner-control token has been authenticated. */
  private async secrets(body: Record<string, unknown>): Promise<AgentReply> {
    try {
      if (body.scopeId != null && (typeof body.scopeId !== "string" || !this.vault.scopeIds.includes(body.scopeId))) {
        return { type: "error", code: "account_changed" };
      }
      if (this.vault.secrets == null) {
        return { type: "error", code: "executor_unavailable" };
      }
      return { type: "secrets", ...await this.vault.secrets(parseOwnerSecretsQuery(body)) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return { type: "error", code: ["account_changed", "locked", "malformed"].includes(code) ? code : "no_access" };
    }
  }

  private async dispatch(requestId: string): Promise<AgentReply> {
    return this.executor!.dispatch(
      requestId, this.vault.targets, this.vault.value.bind(this.vault), () => this.flush(),
    );
  }

  private refreshAccount(): void {
    const executor = this.executor;
    if (executor == null || this.quiesced || this.vault.coordination == null || this.refreshing != null) {
      return;
    }
    const operation = executor.refreshAccount().then(async () => {
      if (this.executor !== executor || this.quiesced) {
        return;
      }
      const apply = this.queue.then(async () => {
        if (this.executor !== executor || this.quiesced) {
          return;
        }
        await this.flush();
        for (const requestId of executor.readyRequests()) {
          await this.dispatch(requestId);
        }
      });
      this.queue = apply.catch((): void => undefined);
      await apply;
      if (this.executor === executor && !this.quiesced) {
        await executor.publishAccount();
      }
    }).catch((): void => undefined);
    this.refreshing = operation;
    void operation.finally(() => {
      if (this.refreshing === operation) {
        this.refreshing = null;
      }
    });
  }

  private async flush(): Promise<void> {
    if (this.executor != null) {
      const sealed = await this.vault.seal(JSON.stringify(this.executor.snapshot()));
      writeOwnerFile(this.statePath, sealed);
    }
  }

  private acquireLock(): void {
    const file = path.join(this.directory, "owner.lock");
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      try {
        fs.writeFileSync(fd, String(process.pid));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      this.ownsLock = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const pid = Number(fs.readFileSync(file, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("The agent ownership lock is unreadable.");
      }
      try {
        process.kill(pid, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === "ESRCH") {
          fs.unlinkSync(file);
          this.acquireLock();
          return;
        }
      }
      throw new Error("An agent broker is already running.");
    }
  }

  private releaseLock(): void {
    if (this.ownsLock) {
      fs.unlinkSync(path.join(this.directory, "owner.lock"));
      this.ownsLock = false;
    }
  }
}


function tokenMatches(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function writeOwnerFile(file: string, contents: string): void {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

