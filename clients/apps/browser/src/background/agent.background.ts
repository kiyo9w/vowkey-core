import { deferred } from "@vowkey/common/platform/misc/deferred";
import { AbstractStorageService } from "@vowkey/common/platform/abstractions/storage.service";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { invokeAccountCoordinator } from "@vowkey/common/vault/agent/account-bridge";
import { AgentTarget, AgentWrite } from "@vowkey/common/vault/agent/targets";

import { BrowserApi } from "../platform/browser/browser-api";

const ENABLED = "agent_nativeEnabled";

/** Native messaging is opt-in. Manual extension fills never start a CLI process. */
export class AgentBackground {
  private port: chrome.runtime.Port | browser.runtime.Port | null = null;
  private authority: AgentVaultAuthority | null = null;
  private ready = false;
  private error: string | null = null;
  private readonly controls = new Map<string, {
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  constructor(
    private readonly storage: AbstractStorageService,
    private readonly getAuthority: (explicit: boolean) => Promise<AgentVaultAuthority>,
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
      void this.handleControl(message).then(respond, () => respond({ error: "executor_unavailable" }));
      return true;
    });
    if (await this.storage.get<boolean>(ENABLED) &&
      await BrowserApi.permissionsGranted(["nativeMessaging"])) {
      await this.connect(false).catch((): void => undefined);
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

  private async handleControl(message: Record<string, unknown>): Promise<unknown> {
    if (message.action === "status") {
      return { connected: this.ready, enabled: await this.storage.get<boolean>(ENABLED) === true, error: this.error };
    }
    if (message.action === "connect") {
      // Permission is requested by the popup's click handler to retain its browser user gesture.
      if (!await BrowserApi.permissionsGranted(["nativeMessaging"])) {
        return { error: "permission_required" };
      }
      await this.connect(true);
      await this.storage.save(ENABLED, true);
      return { connected: this.ready };
    }
    if (message.action === "disconnect") {
      await this.storage.save(ENABLED, false);
      this.disconnect();
      return { connected: false };
    }
    if (!this.ready || this.port == null ||
      !["pending", "approve", "answer", "revoke"].includes(String(message.action))) {
      return { error: "executor_unavailable" };
    }
    const requestId = crypto.randomUUID();
    const pending = deferred<unknown>();
    const timer = setTimeout(() => {
      this.controls.delete(requestId);
      pending.reject(new Error("executor_unavailable"));
    }, 30_000);
    this.controls.set(requestId, {
      resolve: (value) => { clearTimeout(timer); pending.resolve(value); },
      reject: (error) => { clearTimeout(timer); pending.reject(error); },
    });
    this.port.postMessage({ ...message, type: "control_request", requestId });
    return pending.promise;
  }

  private async connect(explicit: boolean): Promise<void> {
    if (this.ready) {
      return;
    }
    this.disconnect();
    const authority = await this.getAuthority(explicit);
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
        this.error = "executor_unavailable";
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
              port.postMessage({ type: "authority_result", requestId: message.requestId, error: "executor_unavailable" });
            }
          },
        );
      } else if (message.type === "error") {
        handshake.reject(new Error("executor_unavailable"));
      }
    });
    port.postMessage({ type: "authority_ready", scopeIds: authority.scopeIds,
      accountBacked: authority.coordination != null });
    try {
      await handshake.promise;
    } catch (error) {
      this.error = "executor_unavailable";
      this.disconnect();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async operation(authority: AgentVaultAuthority, message: Record<string, unknown>): Promise<unknown> {
    if (this.authority !== authority) {
      throw new Error("account_changed");
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
    if (["resolve", "value"].includes(String(message.action)) &&
      typeof message.itemId === "string" && typeof message.fieldPath === "string") {
      return message.action === "resolve" ? authority.resolve(message.itemId, message.fieldPath)
        : authority.value(message.itemId, message.fieldPath);
    }
    if (message.action === "collect" &&
      (message.targetId == null || typeof message.targetId === "string")) {
      return authority.targets.collect(message.targetId as string | undefined);
    }
    if (message.action === "write" && message.target != null && typeof message.target === "object" &&
      Array.isArray(message.operations) && message.operations.length <= 1000 &&
      message.operations.every((operation) => operation != null && typeof operation.entryId === "string" &&
        typeof operation.fieldId === "string" && typeof operation.value === "string")) {
      return authority.targets.write(message.target as AgentTarget, message.operations as AgentWrite[]);
    }
    throw new Error("malformed");
  }
}
