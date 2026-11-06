import { AgentTarget, FormAsksV1, validateFormAsks } from "../agent/targets";
import type { CapturedDocument, DetailSource, Locator as SdkLocator } from "@vowkey/sdk-internal";

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
  /** Where each detail was printed, when the reader placed it: a box on a page, from its top left. */
  locators?: Record<string, DocumentVisionLocator>;
}

export interface DocumentVisionLocator {
  /** The page, from 0. */
  page: number;
  /** Left, top, width and height, as fractions of the page. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ImageFillAction = "text" | "circle" | "check";

export interface PlannedImageFillField {
  sourceKey: string;
  label: string;
  value: string;
  /** Normalized `[left, top, width, height]` from the image top-left (`0..1`). */
  box: [number, number, number, number];
  comb: number | null;
  action: ImageFillAction;
}

export interface ImageFillPlanResult {
  fields: PlannedImageFillField[];
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

/** Keeps the boxes a reader placed, and drops the entries it did not place or placed badly. */
function readVisionLocators(value: unknown): Record<string, DocumentVisionLocator> | undefined {
  if (value == null || typeof value !== "object") {
    return undefined;
  }
  const placed: Record<string, DocumentVisionLocator> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null || typeof raw !== "object") {
      continue;
    }
    const box = raw as Record<string, unknown>;
    const numbers = [box.page, box.x, box.y, box.w, box.h];
    if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n)) || (box.page as number) < 0) {
      continue;
    }
    placed[key] = {
      page: Math.trunc(box.page as number),
      x: box.x as number,
      y: box.y as number,
      w: box.w as number,
      h: box.h as number,
    };
  }
  return Object.keys(placed).length > 0 ? placed : undefined;
}

/** The reader's answer in the shape a captured document keeps: values, how each was read, and where. */
export function capturedFromVision(read: VisionReadResult): CapturedDocument {
  const details = new Map<string, string>();
  const sources = new Map<string, DetailSource>();
  for (const [key, value] of Object.entries(read.details)) {
    const text = value.trim();
    if (details.has(key) || text === "") {
      continue;
    }
    const box = read.locators?.[key];
    details.set(key, text);
    sources.set(key, {
      kind: "ocr",
      verified: false,
      ...(box == null
        ? {}
        : {
            locator: {
              kind: "page",
              page: box.page,
              x: box.x,
              y: box.y,
              w: box.w,
              h: box.h,
              row: undefined,
              column: undefined,
              a1: undefined,
              table: undefined,
            } satisfies SdkLocator,
          }),
    });
  }
  return { details, sources };
}

/** The i18n keys a capture surface shows when a photographed document cannot be read. */
export const PHOTO_UNREADABLE_KEY = "vkDocumentPhotoUnsupported";
export const READ_FAILED_KEY = "vkDocumentReadFailed";

/** A reader that could not read a document says why, in the copy the surface shows. */
export class DocumentCaptureError extends Error {
  constructor(
    /** An i18n key for the toast the caller shows. */
    readonly i18nKey: string,
    message: string,
    /** The failure behind it, when a reader failed for a reason. */
    readonly reason?: unknown,
  ) {
    super(message);
    this.name = "DocumentCaptureError";
  }
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
    private readonly request: typeof fetch = (input, init) => globalThis.fetch(input, init),
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

  async decide(input: DecisionRequest, options?: { allowCloud?: boolean }): Promise<unknown> {
    await this.hydratePromise;
    if (this.mode === "local" && !options?.allowCloud) {
      throw new ReadingServiceUnavailableError(0);
    }
    return this.send("/v1/systemone", {
      state: input.state, questions: input.questions, ...(input.model == null ? {} : { model: input.model }),
    });
  }

  async describe(target: AgentTarget, options?: { allowCloud?: boolean }): Promise<FormAsksV1> {
    await this.hydratePromise;
    if (this.mode === "local" && !options?.allowCloud) {
      throw new ReadingServiceUnavailableError(0);
    }
    const cacheKey = `${target.formSignature}|${this.relayUrl}`;
    const cached = this.describeCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }
    const result = await this.describeUncached(target);
    this.describeCache.set(cacheKey, result);
    if (this.describeCache.size > 50) {
      this.describeCache.delete(this.describeCache.keys().next().value as string);
    }
    return result;
  }

  private readonly describeCache = new Map<string, FormAsksV1>();

  private async describeUncached(target: AgentTarget): Promise<FormAsksV1> {
    const CHUNK_SIZE = 40;
    if (target.fields.length <= CHUNK_SIZE) {
      const result = await this.send("/v1/forms/describe", {
        v: 1, targetId: target.targetId, formSignature: target.formSignature,
        sections: target.sections.map(({ id, label }) => ({ id, label })),
        fields: target.fields.map(({ id, sectionId, label, type, options: opts, format }) => ({
          id, sectionId, label, type, options: opts, ...(format == null ? {} : { format }),
        })),
      });
      if (!validateFormAsks(result, target)) {
        throw new ReadingServiceUnavailableError(502);
      }
      return result;
    }
    const sectionHints = new Map<string, string | null>();
    const allFields: FormAsksV1["fields"] = [];
    const chunks: (typeof target.fields)[] = [];
    for (let i = 0; i < target.fields.length; i += CHUNK_SIZE) {
      chunks.push(target.fields.slice(i, i + CHUNK_SIZE));
    }
    const CONCURRENCY = 8;
    for (let b = 0; b < chunks.length; b += CONCURRENCY) {
      const batch = chunks.slice(b, b + CONCURRENCY);
      const responses = await Promise.all(
        batch.map(async (chunkFields) => {
          const usedSectionIds = new Set(chunkFields.map((f) => f.sectionId));
          const chunkSections = target.sections.filter((s) => usedSectionIds.has(s.id));
          const subTarget: AgentTarget = {
            ...target,
            sections: chunkSections,
            fields: chunkFields,
          };
          const res = await this.send("/v1/forms/describe", {
            v: 1,
            targetId: subTarget.targetId,
            formSignature: subTarget.formSignature,
            sections: subTarget.sections.map(({ id, label }) => ({ id, label })),
            fields: subTarget.fields.map(({ id, sectionId, label, type, options: opts, format }) => ({
              id, sectionId, label, type, options: opts, ...(format == null ? {} : { format }),
            })),
          });
          if (!validateFormAsks(res, subTarget)) {
            throw new ReadingServiceUnavailableError(502);
          }
          return res;
        }),
      );
      for (const res of responses) {
        for (const sec of res.sections) {
          if (!sectionHints.has(sec.id) || sec.profileHint != null) {
            sectionHints.set(sec.id, sec.profileHint);
          }
        }
        allFields.push(...res.fields);
      }
    }
    return {
      v: 1,
      targetId: target.targetId,
      formSignature: target.formSignature,
      sections: target.sections.map((s) => ({
        id: s.id,
        label: s.label,
        profileHint: sectionHints.get(s.id) ?? null,
      })),
      fields: allFields,
    };
  }

  async readDocumentVision(imageDataUrl: string, fileName?: string): Promise<VisionReadResult> {
    await this.hydratePromise;
    if (this.mode === "local") {
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
    const locators = readVisionLocators("locators" in result ? result.locators : undefined);
    return {
      details,
      ...("kind" in result && typeof result.kind === "string" ? { kind: result.kind } : {}),
      ...(locators == null ? {} : { locators }),
    };
  }

  /**
   * Plans writing boxes, comb grids, and circled/checked choices directly on a photographed or
   * screen-captured form image using `/v1/forms/fill-image`.
   */
  async planImageFill(
    imageDataUrl: string,
    details: Record<string, string>,
    fileName?: string,
    options?: { allowCloud?: boolean },
  ): Promise<ImageFillPlanResult> {
    if (this.mode === "local" && !options?.allowCloud) {
      throw new ReadingServiceUnavailableError(0);
    }
    const cleanDetails: Record<string, string> = {};
    for (const [key, value] of Object.entries(details)) {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (key && trimmed) {
        cleanDetails[key] = trimmed;
      }
    }
    if (Object.keys(cleanDetails).length === 0) {
      return { fields: [] };
    }
    const payload: Record<string, unknown> = { v: 1, imageDataUrl, details: cleanDetails };
    if (fileName) {
      payload.fileName = fileName;
    }
    const result = await this.send("/v1/forms/fill-image", payload, true);
    if (result == null || typeof result !== "object" || !("fields" in result) || !Array.isArray(result.fields)) {
      throw new ReadingServiceUnavailableError(502);
    }
    const fields: PlannedImageFillField[] = [];
    for (const raw of result.fields) {
      if (raw == null || typeof raw !== "object") {
        continue;
      }
      const item = raw as Record<string, unknown>;
      const sourceKey = typeof item.sourceKey === "string" ? item.sourceKey : "";
      const label = typeof item.label === "string" ? item.label : "";
      const value = typeof item.value === "string" ? item.value.trim() : "";
      const rawBox = item.box;
      if (
        !sourceKey ||
        !value ||
        !Array.isArray(rawBox) ||
        rawBox.length !== 4 ||
        !rawBox.every((n) => typeof n === "number" && Number.isFinite(n))
      ) {
        continue;
      }
      const [x, y, w, h] = rawBox as [number, number, number, number];
      if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) {
        continue;
      }
      const comb =
        typeof item.comb === "number" && Number.isInteger(item.comb) && item.comb >= 2 && item.comb <= 64
          ? item.comb
          : null;
      const action: ImageFillAction =
        item.action === "circle" || item.action === "check" ? item.action : "text";
      fields.push({ sourceKey, label, value, box: [x, y, w, h], comb, action });
    }
    return { fields };
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
      if (this.grantInflight != null && this.grantInflight.key === `${session.installationId}|${grantIdentityUrl}`) {
        return this.grantInflight.token;
      }
      const pending = this.requestGuestGrant(session, grantIdentityUrl);
      this.grantInflight = { key: `${session.installationId}|${grantIdentityUrl}`, token: pending };
      try {
        return await pending;
      } finally {
        this.grantInflight = null;
      }
    }
    return this.guest.token;
  }

  private grantInflight: { key: string; token: Promise<string> } | null = null;

  private async requestGuestGrant(session: ProductInferenceSession, grantIdentityUrl: string): Promise<string> {
    {
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
      return grant.token;
    }
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
          ...("details" in (body as Record<string, unknown>)
            ? { details: `[${Object.keys(((body as Record<string, unknown>).details ?? {}) as Record<string, unknown>).length} profile facts]` }
            : {}),
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
