import { AbstractStorageService } from "@vowkey/common/platform/abstractions/storage.service";
import { deferred } from "@vowkey/common/platform/misc/deferred";
import { invokeAccountCoordinator } from "@vowkey/common/vault/agent/account-bridge";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { AgentTarget, AgentWrite } from "@vowkey/common/vault/agent/targets";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CardView } from "@vowkey/common/vault/models/view/card.view";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FieldView } from "@vowkey/common/vault/models/view/field.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { LoginUriView } from "@vowkey/common/vault/models/view/login-uri.view";
import { LoginView } from "@vowkey/common/vault/models/view/login.view";
import { SecureNoteView } from "@vowkey/common/vault/models/view/secure-note.view";
import { SshKeyView } from "@vowkey/common/vault/models/view/ssh-key.view";

import { BrowserApi } from "../platform/browser/browser-api";

const ENABLED = "agent_nativeEnabled";

function toDateOrNull(raw: unknown): Date | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function hydrateCipherView(raw: unknown): CipherView | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const src = raw as Record<string, any>;
  if (typeof src.name !== "string" && typeof src.id !== "string") {
    return null;
  }
  const view = Object.assign(new CipherView(), src);
  if (src.login && typeof src.login === "object") {
    const login = Object.assign(new LoginView(), src.login);
    if (Array.isArray(src.login.uris)) {
      login.uris = src.login.uris.map((u: unknown) => Object.assign(new LoginUriView(), u));
    }
    login.passwordRevisionDate = toDateOrNull(src.login.passwordRevisionDate);
    view.login = login;
  }
  if (src.card && typeof src.card === "object") {
    view.card = Object.assign(new CardView(), src.card);
  }
  if (src.identity && typeof src.identity === "object") {
    view.identity = Object.assign(new IdentityView(), src.identity);
  }
  if (src.secureNote && typeof src.secureNote === "object") {
    view.secureNote = Object.assign(new SecureNoteView(), src.secureNote);
  }
  if (src.sshKey && typeof src.sshKey === "object") {
    view.sshKey = Object.assign(new SshKeyView(), src.sshKey);
  }
  if (Array.isArray(src.fields)) {
    view.fields = src.fields.map((f: unknown) => Object.assign(new FieldView(), f));
  }
  view.creationDate = toDateOrNull(src.creationDate) ?? new Date();
  view.revisionDate = toDateOrNull(src.revisionDate) ?? new Date();
  view.deletedDate = toDateOrNull(src.deletedDate);
  view.archivedDate = toDateOrNull(src.archivedDate);
  return view;
}

export class AgentBackground {
  private port: chrome.runtime.Port | browser.runtime.Port | null = null;
  private authority: AgentVaultAuthority | null = null;
  private ready = false;
  private error: string | null = null;
  private syncingLocalItems = false;
  private lastKnownLocalRevisions = new Map<string, number>();
  private readonly controls = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();

  constructor(
    private readonly storage: AbstractStorageService,
    private readonly getAuthority: (explicit: boolean) => Promise<AgentVaultAuthority>,
    private readonly localVault?: LocalVaultService,
  ) {}

  async init(): Promise<void> {
    BrowserApi.messageListener("agent", (message, sender, respond) => {
      if (message?.command !== "agentControl") {
        return;
      }
      if (!BrowserApi.senderIsInternal(sender) || sender.tab != null) {
        respond({ error: "credential_rejected" });
        return;
      }
      void this.handleControl(message).then(respond, () =>
        respond({ error: "executor_unavailable" }),
      );
      return true;
    });

    this.localVault?.state$.subscribe((state) => {
      if (
        this.syncingLocalItems ||
        !this.ready ||
        this.port == null ||
        state === "empty" ||
        state === "persisted-locked"
      ) {
        return;
      }
      void this.localVault
        ?.list({ includeDeleted: true })
        .then((ciphers) => {
          if (this.syncingLocalItems || !this.ready || this.port == null) {
            return;
          }
          for (const cipher of ciphers) {
            if (!cipher.id) {
              continue;
            }
            const rev = cipher.revisionDate?.getTime?.() ?? 0;
            const prev = this.lastKnownLocalRevisions.get(cipher.id) ?? -1;
            if (rev > prev) {
              this.lastKnownLocalRevisions.set(cipher.id, rev);
              void this.sendHostControl("upsert_local_item", { item: cipher }).catch(
                (): void => undefined,
              );
            }
          }
        })
        .catch((): void => undefined);
    });

    const explicitlyDisabled = (await this.storage.get<boolean>(ENABLED)) === false;
    if (!explicitlyDisabled && (await BrowserApi.permissionsGranted(["nativeMessaging"]))) {
      await this.connect(false, true).catch((): void => undefined);
    }
  }

  disconnect(): void {
    const port = this.port;
    this.port = null;
    this.authority = null;
    this.ready = false;
    for (const pending of this.controls.values()) {
      pending.reject(new Error("executor_unavailable"));
    }
    this.controls.clear();
    port?.disconnect();
  }

  async syncLocalItems(): Promise<void> {
    if (!this.localVault || !this.ready || this.port == null || this.syncingLocalItems) {
      return;
    }
    if (this.authority?.coordination != null) {
      return;
    }
    this.syncingLocalItems = true;
    try {
      await this.localVault.initialize();
      const rawDesktop = await this.sendHostControl("list_local_items", {});
      const desktopList: unknown[] = Array.isArray(rawDesktop)
        ? rawDesktop
        : Array.isArray((rawDesktop as { items?: unknown[] } | null)?.items)
          ? ((rawDesktop as { items: unknown[] }).items ?? [])
          : [];
      const browserItems = await this.localVault.list({ includeDeleted: true });
      const browserById = new Map<string, CipherView>();
      for (const item of browserItems) {
        if (item.id) {
          browserById.set(item.id, item);
          this.lastKnownLocalRevisions.set(item.id, item.revisionDate?.getTime?.() ?? 0);
        }
      }

      const desktopIds = new Set<string>();
      for (const rawItem of desktopList) {
        const desktopView = hydrateCipherView(rawItem);
        if (!desktopView?.id) {
          continue;
        }
        desktopIds.add(desktopView.id);
        const existing = browserById.get(desktopView.id);
        const desktopRev = desktopView.revisionDate?.getTime?.() ?? 0;
        const browserRev = existing?.revisionDate?.getTime?.() ?? -1;
        if (!existing || desktopRev > browserRev) {
          const saved = await this.localVault.saveCipher(desktopView);
          this.lastKnownLocalRevisions.set(saved.id, saved.revisionDate?.getTime?.() ?? desktopRev);
        } else if (browserRev > desktopRev) {
          await this.sendHostControl("upsert_local_item", { item: existing }).catch(
            (): void => undefined,
          );
        }
      }

      for (const browserItem of browserItems) {
        if (browserItem.id && !desktopIds.has(browserItem.id)) {
          await this.sendHostControl("upsert_local_item", { item: browserItem }).catch(
            (): void => undefined,
          );
        }
      }
    } catch {
      // Desktop host may not be running or may not expose local item sync; keep Browser working cleanly.
    } finally {
      this.syncingLocalItems = false;
    }
  }

  private sendHostControl(action: string, extra: Record<string, unknown>): Promise<unknown> {
    if (!this.ready || this.port == null) {
      return Promise.reject(new Error("executor_unavailable"));
    }
    const requestId = crypto.randomUUID();
    const pending = deferred<unknown>();
    const timer = setTimeout(() => {
      this.controls.delete(requestId);
      pending.reject(new Error("executor_unavailable"));
    }, 10_000);
    this.controls.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer);
        pending.resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        pending.reject(error);
      },
    });
    this.port.postMessage({ ...extra, action, type: "control_request", requestId });
    return pending.promise;
  }

  private async handleControl(message: Record<string, unknown>): Promise<unknown> {
    if (message.action === "status") {
      return {
        connected: this.ready,
        enabled: (await this.storage.get<boolean>(ENABLED)) !== false,
        error: this.error,
      };
    }
    if (message.action === "connect") {
      if (!(await BrowserApi.permissionsGranted(["nativeMessaging"]))) {
        return { error: "permission_required" };
      }
      await this.connect(true, false);
      await this.storage.save(ENABLED, true);
      return { connected: this.ready };
    }
    if (message.action === "disconnect") {
      await this.storage.save(ENABLED, false);
      this.disconnect();
      return { connected: false };
    }
    if (message.action === "sync_local_items") {
      await this.syncLocalItems();
      return { connected: this.ready };
    }
    if (
      !this.ready ||
      this.port == null ||
      !["pending", "approve", "answer", "revoke", "list_local_items", "upsert_local_item"].includes(
        String(message.action),
      )
    ) {
      return { error: "executor_unavailable" };
    }
    return this.sendHostControl(String(message.action), message);
  }

  private async connect(explicit: boolean, silentStartup = false): Promise<void> {
    if (this.ready) {
      return;
    }
    this.disconnect();
    let authority: AgentVaultAuthority;
    try {
      authority = await this.getAuthority(explicit || silentStartup);
    } catch (err) {
      if (!silentStartup) {
        this.error = "executor_unavailable";
      }
      throw err;
    }
    const port = BrowserApi.connectNative("com.vowkey.agent");
    this.port = port;
    this.authority = authority;
    this.error = null;
    const handshake = deferred<void>();
    const timer = setTimeout(() => handshake.reject(new Error("executor_unavailable")), 15_000);
    port.onDisconnect.addListener(() => {
      if (this.port === port) {
        this.port = null;
        this.authority = null;
        this.ready = false;
        if (!silentStartup) {
          this.error = "executor_unavailable";
        }
        for (const pending of this.controls.values()) {
          pending.reject(new Error("executor_unavailable"));
        }
        this.controls.clear();
      }
      handshake.reject(new Error("executor_unavailable"));
    });
    port.onMessage.addListener((raw: unknown) => {
      if (this.port !== port || raw == null || typeof raw !== "object") {
        return;
      }
      const message = raw as Record<string, unknown>;
      if (message.type === "host_ready" && message.protocol === "vowkey.agent.v1") {
        this.ready = true;
        handshake.resolve();
        void this.syncLocalItems();
      } else if (message.type === "control_result" && typeof message.requestId === "string") {
        const pending = this.controls.get(message.requestId);
        this.controls.delete(message.requestId);
        if (message.error != null) {
          pending?.reject(new Error("executor_unavailable"));
        } else {
          pending?.resolve(message.result);
        }
      } else if (message.type === "authority_operation" && typeof message.requestId === "string") {
        void this.operation(authority, message).then(
          (result) => {
            if (this.port === port) {
              port.postMessage({ type: "authority_result", requestId: message.requestId, result });
            }
          },
          () => {
            if (this.port === port) {
              port.postMessage({
                type: "authority_result",
                requestId: message.requestId,
                error: "executor_unavailable",
              });
            }
          },
        );
      } else if (message.type === "upsert_local_item" && message.item != null) {
        void this.applyIncomingLocalItem(message.item);
      } else if (message.type === "local_items_changed") {
        void this.syncLocalItems();
      } else if (message.type === "error") {
        handshake.reject(new Error("executor_unavailable"));
      }
    });
    port.postMessage({
      type: "authority_ready",
      scopeIds: authority.scopeIds,
      accountBacked: authority.coordination != null,
    });
    try {
      await handshake.promise;
    } catch (error) {
      if (!silentStartup) {
        this.error = "executor_unavailable";
      }
      this.disconnect();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async applyIncomingLocalItem(rawItem: unknown): Promise<CipherView | null> {
    if (!this.localVault || this.authority?.coordination != null) {
      return null;
    }
    const incoming = hydrateCipherView(rawItem);
    if (!incoming) {
      return null;
    }
    this.syncingLocalItems = true;
    try {
      await this.localVault.initialize();
      const current = incoming.id ? await this.localVault.getCipher(incoming.id) : null;
      const incomingRev = incoming.revisionDate?.getTime?.() ?? Date.now();
      const currentRev = current?.revisionDate?.getTime?.() ?? -1;
      if (!current || incomingRev >= currentRev) {
        const saved = await this.localVault.saveCipher(incoming);
        this.lastKnownLocalRevisions.set(saved.id, saved.revisionDate?.getTime?.() ?? incomingRev);
        return saved;
      }
      return current;
    } finally {
      this.syncingLocalItems = false;
    }
  }

  private async operation(
    authority: AgentVaultAuthority,
    message: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.authority !== authority) {
      throw new Error("account_changed");
    }
    if (message.action === "list_local_items" && this.localVault) {
      await this.localVault.initialize();
      return this.localVault.list({ includeDeleted: true });
    }
    if (message.action === "upsert_local_item" && message.item != null) {
      return this.applyIncomingLocalItem(message.item);
    }
    if (message.action === "coordinate" && authority.coordination != null) {
      return invokeAccountCoordinator(authority.coordination, message.method, message.args);
    }
    if (message.action === "seal" && typeof message.plain === "string") {
      return authority.seal(message.plain);
    }
    if (message.action === "open" && typeof message.ciphertext === "string") {
      return authority.open(message.ciphertext);
    }
    if (
      ["resolve", "value"].includes(String(message.action)) &&
      typeof message.itemId === "string" &&
      typeof message.fieldPath === "string"
    ) {
      return message.action === "resolve"
        ? authority.resolve(message.itemId, message.fieldPath)
        : authority.value(message.itemId, message.fieldPath);
    }
    if (
      message.action === "collect" &&
      (message.targetId == null || typeof message.targetId === "string")
    ) {
      return authority.targets.collect(message.targetId as string | undefined);
    }
    if (
      message.action === "write" &&
      message.target != null &&
      typeof message.target === "object" &&
      Array.isArray(message.operations) &&
      message.operations.length <= 1000 &&
      message.operations.every(
        (operation) =>
          operation != null &&
          typeof operation.entryId === "string" &&
          typeof operation.fieldId === "string" &&
          typeof operation.value === "string",
      )
    ) {
      return authority.targets.write(
        message.target as AgentTarget,
        message.operations as AgentWrite[],
      );
    }
    throw new Error("malformed");
  }
}
