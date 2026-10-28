import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

import { DeviceCa } from "./device-ca";
import { EnvironmentFileManager, VaultPort } from "./env-files";
import { SecretsError, SecretsErrorCode } from "./errors";
import { KeyProxy, ProxyEvent, ProxyKey } from "./proxy";
import { DEFAULT_PROXY_PORT, DeveloperSecretsState, ProxyScopeState, StateStore } from "./state";
import type { KeyItem } from "./vault-resolver";

export const PROTOCOL_VERSION = 1;

/** What the owner needs from the vault beyond what the file manager reads. */
export interface OwnerVault extends VaultPort {
  keyItems(itemIds: string[]): Promise<KeyItem[]>;
}

export interface OwnerRequest {
  v: number;
  id: string;
  type:
    | "status"
    | "enable"
    | "disable"
    | "lock"
    | "logout"
    | "select-scope"
    | "proxy-start"
    | "proxy-stop"
    | "proxy-enable-key"
    | "proxy-disable-key"
    | "proxy-info"
    | "refresh"
    | "stop";
  [field: string]: unknown;
}

export interface OwnerReply {
  v: number;
  id: string;
  ok: boolean;
  code?: SecretsErrorCode | "bad-request";
  message?: string;
  [field: string]: unknown;
}

export function socketPathFor(directory: string): string {
  if (process.platform === "win32") {
    const user = crypto
      .createHash("sha256")
      .update(`${process.env.USERDOMAIN ?? ""}\\${os.userInfo().username}`)
      .digest("hex")
      .slice(0, 16);
    return `\\\\.\\pipe\\vowkey-secrets-${user}`;
  }
  return path.join(directory, "secrets.sock");
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * The one secrets process per OS user. It owns the environment files and the proxy, keeps keys in
 * memory only while the vault is unlocked, and takes control messages over an owner-only socket.
 * Its status reply carries no key, session or proxy credential.
 */
export class SecretsOwner {
  readonly state: DeveloperSecretsState;
  readonly files: EnvironmentFileManager;
  private vault: OwnerVault | null = null;
  private proxy: KeyProxy | null = null;
  private keys: ProxyKey[] = [];
  private credential = randomToken();
  private ca: DeviceCa | null = null;
  private server: net.Server | null = null;
  private readonly connections = new Set<net.Socket>();
  private readonly events: ProxyEvent[] = [];
  private onStop: (() => void) | null = null;

  constructor(
    readonly directory: string,
    private readonly store: StateStore = new StateStore(directory),
    private readonly options: {
      upstreamCa?: string;
      lookup?: (host: string) => Promise<string>;
    } = {},
  ) {
    this.state = store.load();
    this.files = new EnvironmentFileManager(store, this.state);
  }

  get socketPath(): string {
    return socketPathFor(this.directory);
  }

  recentEvents(): readonly ProxyEvent[] {
    return this.events;
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  /** An unlocked start rewrites enabled files; a locked start removes the ones it finds. */
  async start(vault: OwnerVault | null, onStop?: () => void): Promise<void> {
    this.onStop = onStop ?? null;
    await this.listen();
    await this.setVault(vault);
  }

  async setVault(vault: OwnerVault | null): Promise<void> {
    if (vault == null) {
      await this.lockEverything();
      return;
    }
    this.vault = vault;
    await this.files.unlock(vault);
    await this.refreshKeys();
    if (this.state.proxy.enabled) {
      // The proxy comes back with a fresh credential, so an old HTTPS_PROXY cannot revive.
      await this.startProxy(this.state.proxy.port);
    }
  }

  async shutdown(): Promise<void> {
    await this.lockEverything();
    for (const connection of this.connections) {
      connection.destroy();
    }
    const server = this.server;
    this.server = null;
    if (server != null) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== "win32") {
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          // Already gone.
        }
      }
    }
  }

  private async lockEverything(): Promise<void> {
    this.vault = null;
    this.keys = [];
    this.credential = randomToken();
    await this.stopProxy();
    await this.files.lock();
  }

  // ---- socket ------------------------------------------------------------------------------

  /**
   * Becomes the owner only when no live owner answers. A stale socket path is removed after a
   * failed connect, under a lock so two starters cannot both claim it.
   */
  private async listen(): Promise<void> {
    const socketPath = this.socketPath;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (await liveOwnerAnswers(socketPath)) {
      throw new SecretsError("unavailable", "A secrets owner is already running.");
    }
    const lockDir = path.join(this.directory, "secrets.lock");
    let held = false;
    for (let attempt = 0; attempt < 50 && !held; attempt++) {
      try {
        fs.mkdirSync(lockDir, { mode: 0o700 });
        held = true;
      } catch {
        // A lock older than a minute belongs to a starter that died.
        try {
          if (Date.now() - fs.statSync(lockDir).mtimeMs > 60_000) {
            fs.rmdirSync(lockDir);
          }
        } catch {
          // Someone else released it.
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!held) {
      throw new SecretsError("unavailable", "Another process is starting the secrets owner.");
    }
    try {
      if (await liveOwnerAnswers(socketPath)) {
        throw new SecretsError("unavailable", "A secrets owner is already running.");
      }
      if (process.platform !== "win32" && fs.existsSync(socketPath)) {
        if (!fs.lstatSync(socketPath).isSocket()) {
          throw new SecretsError("refused", `${socketPath} exists and is not a socket.`);
        }
        fs.unlinkSync(socketPath);
      }
      const server = net.createServer((socket) => this.accept(socket));
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => {
          server.off("error", reject);
          resolve();
        });
      });
      if (process.platform !== "win32") {
        fs.chmodSync(socketPath, 0o600);
      }
      this.server = server;
    } finally {
      try {
        fs.rmdirSync(lockDir);
      } catch {
        // Already released.
      }
    }
  }

  private accept(socket: net.Socket) {
    this.connections.add(socket);
    socket.once("close", () => this.connections.delete(socket));
    socket.on("error", () => socket.destroy());
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 64 * 1024) {
        socket.destroy();
        return;
      }
      let at: number;
      while ((at = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        void this.respond(line).then((reply) => socket.write(JSON.stringify(reply) + "\n"));
      }
    });
  }

  private async respond(line: string): Promise<OwnerReply> {
    let request: OwnerRequest;
    try {
      request = JSON.parse(line) as OwnerRequest;
    } catch {
      return { v: PROTOCOL_VERSION, id: "", ok: false, code: "bad-request", message: "Not JSON." };
    }
    const base = { v: PROTOCOL_VERSION, id: String(request.id ?? "") };
    if (request.v !== PROTOCOL_VERSION) {
      return { ...base, ok: false, code: "bad-request", message: "Unsupported protocol version." };
    }
    try {
      return { ...base, ok: true, ...(await this.handle(request)) };
    } catch (e) {
      if (e instanceof SecretsError) {
        return { ...base, ok: false, code: e.code, message: e.message };
      }
      return { ...base, ok: false, code: "unavailable", message: "The request failed." };
    }
  }

  // ---- control messages --------------------------------------------------------------------

  async handle(request: OwnerRequest): Promise<Record<string, unknown>> {
    switch (request.type) {
      case "status":
        return await this.status();
      case "enable": {
        const row = await this.files.enable(String(request.environment), String(request.path));
        return { environment: row };
      }
      case "disable": {
        const row = await this.files.disable(String(request.environment));
        return { environment: row };
      }
      case "lock":
      case "logout":
        await this.lockEverything();
        return {};
      case "select-scope":
        // The scope is the vault the owner holds; a switch comes with a new vault from the host.
        await this.files.refresh();
        return {};
      case "refresh":
        await this.refreshKeys();
        await this.files.refresh();
        return {};
      case "proxy-start":
        await this.startProxy(
          typeof request.port === "number" ? request.port : this.state.proxy.port,
        );
        this.state.proxy.enabled = true;
        this.store.save(this.state);
        return { proxy: this.proxyStatus() };
      case "proxy-stop":
        this.state.proxy.enabled = false;
        this.store.save(this.state);
        await this.stopProxy();
        return { proxy: this.proxyStatus() };
      case "proxy-enable-key":
        return await this.setKeyEnabled(String(request.itemId), true);
      case "proxy-disable-key":
        return await this.setKeyEnabled(String(request.itemId), false);
      case "proxy-info": {
        if (this.proxy == null || !this.proxy.listening) {
          throw new SecretsError("not-listening", "The proxy is not listening.");
        }
        const ca = await this.deviceCa();
        return {
          host: "127.0.0.1",
          port: this.state.proxy.port,
          credential: this.credential,
          caCertificate: ca.certificatePem,
        };
      }
      case "stop":
        setImmediate(() => {
          void this.shutdown().then(() => this.onStop?.());
        });
        return {};
      default:
        throw new SecretsError("unavailable", "Unknown request.");
    }
  }

  private async status() {
    return {
      owner: { pid: process.pid },
      locked: this.vault == null,
      environments: this.files.status(),
      proxy: this.proxyStatus(),
    };
  }

  private proxyStatus() {
    return {
      listening: this.proxy?.listening === true,
      host: "127.0.0.1",
      port: this.state.proxy.port,
    };
  }

  // ---- the proxy ---------------------------------------------------------------------------

  private async deviceCa(): Promise<DeviceCa> {
    this.ca ??= await DeviceCa.loadOrCreate(path.join(this.directory, "proxy-ca"));
    return this.ca;
  }

  private async scopeState(): Promise<ProxyScopeState> {
    const scope = await this.requireVault().scopeId();
    this.state.proxy.activeVaultScopeId = scope;
    this.state.proxy.scopes[scope] ??= { enabledItemIds: [], credential: "", placeholders: {} };
    return this.state.proxy.scopes[scope];
  }

  private requireVault(): OwnerVault {
    if (this.vault == null) {
      throw new SecretsError("locked", "The vault is locked.");
    }
    return this.vault;
  }

  private async setKeyEnabled(itemId: string, enabled: boolean) {
    const vault = this.requireVault();
    const scope = await this.scopeState();
    if (enabled) {
      const [item] = await vault.keyItems([itemId]);
      if (item == null) {
        throw new SecretsError("missing-ref", `${itemId} is not a key in this vault.`);
      }
      if (!scope.enabledItemIds.includes(itemId)) {
        scope.enabledItemIds.push(itemId);
      }
      // The stand-in is made the first time a key is enabled and kept across lock.
      scope.placeholders[itemId] ??= randomToken();
    } else {
      scope.enabledItemIds = scope.enabledItemIds.filter((id) => id !== itemId);
    }
    this.store.save(this.state);
    await this.refreshKeys();
    return { enabledItemIds: scope.enabledItemIds };
  }

  /** Reloads the enabled keys' current values; a key that is gone is dropped with its stand-in. */
  private async refreshKeys(): Promise<void> {
    if (this.vault == null) {
      this.keys = [];
      return;
    }
    const scope = await this.scopeState();
    const items = await this.vault.keyItems(scope.enabledItemIds);
    const present = new Set(items.map((i) => i.itemId));
    const dropped = scope.enabledItemIds.filter((id) => !present.has(id));
    for (const id of dropped) {
      delete scope.placeholders[id];
    }
    if (dropped.length > 0) {
      scope.enabledItemIds = scope.enabledItemIds.filter((id) => present.has(id));
      this.store.save(this.state);
    }
    this.keys = items.map((i) => ({
      itemId: i.itemId,
      name: i.name,
      value: i.value,
      sendStyle: i.sendStyle,
      allowedHosts: i.allowedHosts,
      headerName: i.headerName,
      basicUsername: i.basicUsername,
    }));
  }

  private async startProxy(port: number): Promise<void> {
    this.requireVault();
    await this.stopProxy();
    const scope = await this.scopeState();
    this.state.proxy.port = port || DEFAULT_PROXY_PORT;
    this.credential = randomToken();
    scope.credential = this.credential;
    const proxy = new KeyProxy({
      port: this.state.proxy.port,
      credential: this.credential,
      ca: await this.deviceCa(),
      keys: () => this.keys,
      placeholders: () => scope.placeholders,
      onEvent: (event) => {
        this.events.push(event);
        if (this.events.length > 200) {
          this.events.shift();
        }
      },
      upstreamCa: this.options.upstreamCa,
      lookup: this.options.lookup,
    });
    try {
      this.state.proxy.port = await proxy.start();
    } catch (e) {
      throw new SecretsError(
        "unavailable",
        `The proxy could not listen on port ${port}: ${(e as Error).message}`,
      );
    }
    this.proxy = proxy;
    this.store.save(this.state);
  }

  private async stopProxy(): Promise<void> {
    const proxy = this.proxy;
    this.proxy = null;
    await proxy?.stop();
  }
}

/** Whether something on `socketPath` answers a status request. */
export async function liveOwnerAnswers(socketPath: string): Promise<boolean> {
  try {
    const reply = await sendToOwner(socketPath, { type: "status" }, 1500);
    return reply.ok === true;
  } catch {
    return false;
  }
}

/** Sends one control message and reads its reply. */
export function sendToOwner(
  socketPath: string,
  message: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<OwnerReply> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const socket = net.connect(socketPath);
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new SecretsError("unavailable", "The secrets owner did not answer."));
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () =>
      socket.write(JSON.stringify({ v: PROTOCOL_VERSION, id, ...message }) + "\n"),
    );
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const at = buffer.indexOf("\n");
      if (at !== -1) {
        clearTimeout(timer);
        socket.end();
        try {
          resolve(JSON.parse(buffer.slice(0, at)) as OwnerReply);
        } catch {
          reject(new SecretsError("unavailable", "The secrets owner sent an unreadable reply."));
        }
      }
    });
    socket.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
