import { AgentTarget, FormAsksV1, validateFormAsks } from "../agent/targets";

export type PrivacyMode = "local" | "masked" | "cloud_vision";

export interface OutboundWireRecord {
  timestamp: string;
  endpoint: string;
  mode: PrivacyMode;
  requestJson: string;
}

export interface VisionReadResult {
  details: Record<string, string>;
  kind?: string;
}

export interface ProductInferenceSession {
  installationId: string;
  identityUrl: string;
  accountToken: string | null;
}
export interface DecisionRequest {
  state: Record<string, unknown>;
  questions: Record<string, unknown>;
  model?: string;
}
export class ReadingServiceUnavailableError extends Error {
  constructor(readonly status: number) {
    super("The reading service is unavailable. Try again when connected.");
  }
}

const PRIVACY_MODE_STORAGE_KEY = "vowkey.privacyMode";
const MAX_WIRE_LOG = 12;

interface ChromeStorageAreaLike {
  get(keys: string | string[], callback?: (items: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  set(items: Record<string, unknown>, callback?: () => void): Promise<void> | void;
}

interface ChromeLike {
  storage?: {
    local?: ChromeStorageAreaLike;
    onChanged?: {
      addListener(
        callback: (changes: Record<string, { newValue?: unknown }>, areaName: string) => void,
      ): void;
    };
  };
}

function isPrivacyMode(value: unknown): value is PrivacyMode {
  return value === "local" || value === "masked" || value === "cloud_vision";
}

function getChromeNamespace(): ChromeLike | undefined {
  try {
    const candidate = (globalThis as { chrome?: ChromeLike }).chrome;
    if (candidate?.storage?.local) {
      return candidate;
    }
  } catch {
    // Ignore restricted global access
  }
  return undefined;
}

function readChromeStorageKey(area: ChromeStorageAreaLike, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      let settled = false;
      const done = (items: Record<string, unknown> | undefined) => {
        if (!settled) {
          settled = true;
          resolve(items?.[key]);
        }
      };
      const maybePromise = area.get([key], (items) => done(items));
      if (maybePromise && typeof (maybePromise as Promise<Record<string, unknown>>).then === "function") {
        (maybePromise as Promise<Record<string, unknown>>)
          .then((items) => done(items))
          .catch(() => done(undefined));
      }
    } catch {
      resolve(undefined);
    }
  });
}

function writeChromeStorageKey(area: ChromeStorageAreaLike, key: string, value: unknown): void {
  try {
    const maybePromise = area.set({ [key]: value }, () => {});
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
      (maybePromise as Promise<void>).catch(() => {});
    }
  } catch {
    // Ignore extension storage failures
  }
}

function readInitialPrivacyMode(): PrivacyMode {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage != null) {
      const saved = globalThis.localStorage.getItem(PRIVACY_MODE_STORAGE_KEY);
      if (isPrivacyMode(saved)) {
        return saved;
      }
    }
  } catch {
    // Storage unavailable in service worker or restricted context
  }
  return "masked";
}

/** App-owned service authorization is separate from vault keys and agent credentials. */
export class ProductInference {
  private guest: { installationId: string; identityUrl: string; token: string; expiresAt: number } | null = null;
  private mode: PrivacyMode = readInitialPrivacyMode();
  private modeManuallySet = false;
  private readonly hydratePromise: Promise<void>;
  private readonly wireLog: OutboundWireRecord[] = [];
  private unreachableUntil = 0;

  constructor(
    private readonly session: () => Promise<ProductInferenceSession>,
    private readonly relayUrl = "https://decision.vowkey.app",
    private readonly request: typeof fetch = fetch,
  ) {
    const chromeNs = getChromeNamespace();
    if (chromeNs?.storage?.local) {
      this.hydratePromise = readChromeStorageKey(chromeNs.storage.local, PRIVACY_MODE_STORAGE_KEY).then((stored) => {
        if (!this.modeManuallySet && isPrivacyMode(stored)) {
          this.mode = stored;
        }
      });
      chromeNs.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName === "local" && PRIVACY_MODE_STORAGE_KEY in changes) {
          const next = changes[PRIVACY_MODE_STORAGE_KEY]?.newValue;
          if (isPrivacyMode(next)) {
            this.mode = next;
            this.unreachableUntil = 0;
          }
        }
      });
    } else {
      this.hydratePromise = Promise.resolve();
    }
  }

  getPrivacyMode(): PrivacyMode {
    return this.mode;
  }

  setPrivacyMode(mode: PrivacyMode): void {
    this.modeManuallySet = true;
    this.mode = mode;
    this.unreachableUntil = 0;
    try {
      if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage != null) {
        globalThis.localStorage.setItem(PRIVACY_MODE_STORAGE_KEY, mode);
      }
    } catch {
      // Ignore in non-DOM contexts
    }
    const chromeNs = getChromeNamespace();
    if (chromeNs?.storage?.local) {
      writeChromeStorageKey(chromeNs.storage.local, PRIVACY_MODE_STORAGE_KEY, mode);
    }
  }

  getWireLog(): readonly OutboundWireRecord[] {
    return this.wireLog;
  }

  clearWireLog(): void {
    this.wireLog.length = 0;
  }

  async decide(input: DecisionRequest): Promise<unknown> {
    await this.hydratePromise;
    if (this.mode === "local") {
      throw new ReadingServiceUnavailableError(0);
    }
    return this.send("/v1/systemone", {
      state: input.state, questions: input.questions, ...(input.model == null ? {} : { model: input.model }),
    });
  }

  async describe(target: AgentTarget): Promise<FormAsksV1> {
    await this.hydratePromise;
    if (this.mode === "local") {
      throw new ReadingServiceUnavailableError(0);
    }
    const result = await this.send("/v1/forms/describe", {
      v: 1, targetId: target.targetId, formSignature: target.formSignature,
      sections: target.sections.map(({ id, label }) => ({ id, label })),
      fields: target.fields.map(({ id, sectionId, label, type, options, format }) => ({
        id, sectionId, label, type, options, ...(format == null ? {} : { format }),
      })),
    });
    if (!validateFormAsks(result, target)) {
      throw new ReadingServiceUnavailableError(502);
    }
    return result;
  }

  async readDocumentVision(imageDataUrl: string, fileName?: string): Promise<VisionReadResult> {
    await this.hydratePromise;
    if (this.mode !== "cloud_vision") {
      throw new ReadingServiceUnavailableError(0);
    }
    const result = await this.send(
      "/v1/documents/read-vision",
      { v: 1, imageDataUrl, ...(fileName ? { fileName } : {}) },
      true,
    );
    if (
      result == null ||
      typeof result !== "object" ||
      !("details" in result) ||
      result.details == null ||
      typeof result.details !== "object"
    ) {
      throw new ReadingServiceUnavailableError(502);
    }
    const details: Record<string, string> = {};
    for (const [k, v] of Object.entries(result.details as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim() !== "") {
        details[k] = v.trim();
      }
    }
    return {
      details,
      kind: "kind" in result && typeof result.kind === "string" ? result.kind : undefined,
    };
  }

  private isSameServiceFamily(identityUrl: string, relayUrl: string): boolean {
    try {
      const idHost = new URL(identityUrl).hostname.toLowerCase();
      const relayHost = new URL(relayUrl).hostname.toLowerCase();
      if (idHost === relayHost) {
        return true;
      }
      const isLoopback = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";
      if (isLoopback(idHost) && isLoopback(relayHost)) {
        return true;
      }
      const rootDomain = (h: string) => h.split(".").slice(-2).join(".");
      return idHost.includes(".") && relayHost.includes(".") && rootDomain(idHost) === rootDomain(relayHost);
    } catch {
      return false;
    }
  }

  private async authorization(session: ProductInferenceSession): Promise<string> {
    const sameFamily = this.isSameServiceFamily(session.identityUrl, this.relayUrl);
    if (session.accountToken != null && sameFamily) {
      return session.accountToken;
    }
    const grantIdentityUrl = sameFamily
      ? session.identityUrl
      : this.relayUrl.includes("vowkey.app")
        ? "https://identity.vowkey.app"
        : session.identityUrl;
    if (this.guest == null || this.guest.installationId !== session.installationId ||
      this.guest.identityUrl !== grantIdentityUrl || this.guest.expiresAt <= Date.now() + 30_000) {
      const response = await this.request(`${grantIdentityUrl.replace(/\/$/, "")}/guest-decision/grant`, {
        method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: session.installationId }),
      });
      if (!response.ok) {
        throw new ReadingServiceUnavailableError(response.status);
      }
      const grant: unknown = await response.json();
      if (grant == null || typeof grant !== "object" || !("token" in grant) || typeof grant.token !== "string" ||
        !("expiresIn" in grant) || typeof grant.expiresIn !== "number" || grant.expiresIn <= 0) {
        throw new ReadingServiceUnavailableError(502);
      }
      this.guest = {
        installationId: session.installationId, identityUrl: grantIdentityUrl,
        token: grant.token, expiresAt: Date.now() + grant.expiresIn * 1000,
      };
    }
    return this.guest.token;
  }

  private async send(path: string, body: unknown, redactBinaryInLog = false): Promise<unknown> {
    if (globalThis.navigator?.onLine === false) {
      throw new ReadingServiceUnavailableError(0);
    }
    if (Date.now() < this.unreachableUntil) {
      throw new ReadingServiceUnavailableError(0);
    }
    const serialized = JSON.stringify(body);
    const loggedJson = redactBinaryInLog && body != null && typeof body === "object" && "imageDataUrl" in body
      ? JSON.stringify({
          ...(body as Record<string, unknown>),
          imageDataUrl: `[opt-in document image, ${String((body as Record<string, unknown>).imageDataUrl).length} chars]`,
        })
      : serialized;
    this.wireLog.unshift({
      timestamp: new Date().toISOString(),
      endpoint: `${this.relayUrl.replace(/\/$/, "")}${path}`,
      mode: this.mode,
      requestJson: loggedJson,
    });
    if (this.wireLog.length > MAX_WIRE_LOG) {
      this.wireLog.length = MAX_WIRE_LOG;
    }
    try {
      const session = await this.session();
      const token = await this.authorization(session);
      const response = await this.request(`${this.relayUrl.replace(/\/$/, "")}${path}`, {
        method: "POST", credentials: "omit", headers: {
          "Content-Type": "application/json", Authorization: `Bearer ${token}`,
        }, body: serialized,
      });
      if (!response.ok) {
        if (response.status === 401 && (!this.isSameServiceFamily(session.identityUrl, this.relayUrl) || session.accountToken == null)) {
          this.guest = null;
        }
        throw new ReadingServiceUnavailableError(response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof ReadingServiceUnavailableError) {
        throw error;
      }
      this.unreachableUntil = Date.now() + 15_000;
      throw new ReadingServiceUnavailableError(0);
    }
  }
}
