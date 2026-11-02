import * as fs from "fs";
import * as path from "path";
import { deferred } from "@vowkey/common/platform/misc/deferred";
import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import { resolveCliDataDirectory } from "@vowkey/common/platform/misc/node/cli-data-directory";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { accountCoordinatorBridge } from "@vowkey/common/vault/agent/account-bridge";
import { ReferenceFacts } from "@vowkey/common/vault/agent/executor";
import type { OwnerSecretsResult } from "@vowkey/common/vault/agent/owner-secrets";
import { AgentBroker, AgentConnection, agentSocketPath, brokerIsLive } from "@vowkey/common/vault/agent/node/broker";
import { RemoteTargets } from "@vowkey/common/vault/agent/node/remote-targets";
import { AgentTarget, AgentWrite, AgentWriteResult } from "@vowkey/common/vault/agent/targets";

import { WindowMain } from "../main/window.main";

interface RendererAnswer {
  error?: string;
  scopeIds?: string[];
  result?: unknown;
}

/**
 * Desktop main is the elected broker. The renderer vault answers every secret and target
 * operation; this process never holds the vault key.
 */
export class DesktopAgentMain {
  private broker: AgentBroker | null = null;
  private authority: AgentVaultAuthority | null = null;
  private readonly pending = new Map<number, (answer: RendererAnswer) => void>();
  private nextId = 1;
  private epoch = 0;
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly window: WindowMain) {}

  init(): void {

    ipcMain.on("agent.ready", (event) => {
      if (!this.fromWindow(event)) {
        return;
      }
      void this.ensure().catch((): undefined => undefined);
    });
    ipcMain.on("agent.response", (event, id: number, answer: RendererAnswer) => {
      if (!this.fromWindow(event)) {
        return;
      }
      this.pending.get(id)?.(answer);
      this.pending.delete(id);
    });
    ipcMain.on("agent.changed", (event) => {
      if (!this.fromWindow(event)) {
        return;
      }
      void this.retire();
    });
    ipcMain.handle("agent.manage", (event, action: string, body: Record<string, unknown>) => {
      if (!this.fromWindow(event)) {
        throw new Error("Unauthorized agent request.");
      }
      return this.manage(action, body);
    });
    app.on("will-quit", () => {
      void this.broker?.stop();
    });
  }

  private fromWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return event.sender === this.window.win?.webContents && event.senderFrame === event.sender.mainFrame;
  }

  private ensure(): Promise<void> {
    const epoch = this.epoch;
    this.transition = this.transition.then(() => this.open(epoch), () => this.open(epoch));
    return this.transition;
  }

  private async open(epoch: number): Promise<void> {
    if (epoch !== this.epoch || this.broker != null) {
      return;
    }
    const directory = resolveCliDataDirectory();
    if (await brokerIsLive(agentSocketPath(directory))) {
      return;
    }
    const providers = new RemoteTargets();
    const description = await this.ask("scope", {});
    if (description == null || typeof description !== "object" || !("scopeIds" in description) ||
      !("session" in description) || typeof description.session !== "number" || !("accountBacked" in description)) {
      throw new Error("locked");
    }
    const session = description.session;
    const scopeIds = stringList(description.scopeIds);
    const call = async (action: string, body: Record<string, unknown>) => {
      if (epoch !== this.epoch) {
        throw new Error("account_changed");
      }
      const result = await this.ask(action, { ...body, session });
      if (epoch !== this.epoch) {
        throw new Error("account_changed");
      }
      return result;
    };
    const authority: AgentVaultAuthority = {
      scopeIds: [],
      seal: async (plain) => String(await call("seal", { plain })),
      open: async (ciphertext) => String(await call("open", { ciphertext })),
      resolve: async (itemId, fieldPath) => await call("resolve", { itemId, fieldPath }) as ReferenceFacts | null,
      value: async (itemId, fieldPath) => String(await call("value", { itemId, fieldPath })),
      secrets: async (query) => await call("secrets", { query }) as OwnerSecretsResult,
      coordination: description.accountBacked === true
        ? accountCoordinatorBridge((method, args) => call("coordinate", { method, args })) : undefined,
      targets: {
        collect: async (targetId) => [
          ...targetsOf(await call("collect", { targetId })),
          ...await providers.collect(targetId),
        ],
        write: async (target, operations) => this.write(target, operations, providers, call),
      },
    };
    if (epoch !== this.epoch || scopeIds.length === 0) {
      return;
    }
    authority.scopeIds = scopeIds;
    this.authority = authority;
    const broker = new AgentBroker(directory, authority, providers);
    try {
      await broker.start();
    } catch (error) {
      if (this.authority === authority) {
        this.authority = null;
      }
      await broker.stop().catch((): undefined => undefined);
      throw error;
    }
    if (epoch !== this.epoch) {
      if (this.authority === authority) {
        this.authority = null;
      }
      await broker.stop();
      return;
    }
    this.broker = broker;
  }

  private async write(
    target: AgentTarget,
    operations: AgentWrite[],
    providers: RemoteTargets,
    call: (action: string, body: Record<string, unknown>) => Promise<unknown>,
  ): Promise<AgentWriteResult> {
    const local = targetsOf(await call("collect", { targetId: target.targetId }));
    return local.some((candidate) => candidate.targetId === target.targetId)
      ? resultOf(await call("write", { target, operations }))
      : providers.write(target, operations);
  }

  retire(): Promise<void> {
    const epoch = ++this.epoch;
    this.transition = this.transition.then(async () => {
      if (epoch !== this.epoch) {
        return;
      }
      const broker = this.broker;
      this.broker = null;
      this.authority = null;
      for (const resolve of this.pending.values()) {
        resolve({ error: "account_changed" });
      }
      this.pending.clear();
      await broker?.stop();
    }, (): undefined => undefined);
    return this.transition;
  }

  private ask(action: string, body: Record<string, unknown>): Promise<unknown> {
    const win = this.window.win;
    if (win == null || win.isDestroyed()) {
      return Promise.reject(new Error("locked"));
    }
    const id = this.nextId++;
    const pending = deferred<RendererAnswer>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      pending.reject(new Error("locked"));
    }, 30_000);
    this.pending.set(id, (answer) => {
      clearTimeout(timer);
      pending.resolve(answer);
    });
    win.webContents.send("agent.request", id, { action, ...body });
    return pending.promise.then((answer) => {
      if (answer.error != null) {
        throw new Error(answer.error);
      }
      return answer.result;
    });
  }

  private async manage(action: string, body: Record<string, unknown>): Promise<unknown> {
    const directory = resolveCliDataDirectory();
    const socket = agentSocketPath(directory);
    if (!(await brokerIsLive(socket))) {
      throw new Error("executor_unavailable");
    }
    const token = fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8");
    const connection = await AgentConnection.connect(socket);
    try {
      connection.send({ type: "control", token, action, ...body });
      const reply = await connection.next(30_000) as { type?: string; code?: string };
      if (reply.type === "error") {
        throw new Error(reply.code ?? "executor_unavailable");
      }
      return reply;
    } finally {
      connection.close();
    }
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function targetsOf(value: unknown): AgentTarget[] {
  return Array.isArray(value) ? value.filter((item): item is AgentTarget => item != null && typeof item === "object" &&
    "targetId" in item && typeof item.targetId === "string" && "kind" in item &&
    (item.kind === "web" || item.kind === "file" || item.kind === "app")) : [];
}

function resultOf(value: unknown): AgentWriteResult {
  if (value != null && typeof value === "object" && "entries" in value && Array.isArray(value.entries)) {
    return { entries: value.entries.flatMap((entry) => entry != null && typeof entry === "object" &&
      "entryId" in entry && typeof entry.entryId === "string" && "outcome" in entry &&
      (entry.outcome === "confirmed" || entry.outcome === "not_written" || entry.outcome === "not_confirmed")
      ? [{ entryId: entry.entryId, outcome: entry.outcome }] : []) };
  }
  return { entries: [] };
}
