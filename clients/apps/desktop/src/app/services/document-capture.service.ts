import { inject, Injectable } from "@angular/core";
import * as JSZip from "jszip";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
// eslint-disable-next-line no-restricted-imports
import { EncString, EncryptService } from "@vowkey/legacy-crypto";
import { KeyService } from "@vowkey/key-management";
import { OrganizationId, UserId } from "@vowkey/common/types/guid";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { AgentTarget } from "@vowkey/common/vault/agent/targets";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import {
  DecisionRequest,
  PrivacyMode,
  ProductInference,
  ReadingServiceUnavailableError,
} from "@vowkey/common/vault/local/product-inference";
import { checksum, requestHash } from "@vowkey/common/vault/local/canonical-json";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherSdkService } from "@vowkey/common/vault/abstractions/cipher-sdk.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { CipherData } from "@vowkey/common/vault/models/data/cipher.data";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherRequest } from "@vowkey/common/vault/models/request/cipher.request";
import { CipherResponse } from "@vowkey/common/vault/models/response/cipher.response";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { chooseDetails } from "@vowkey/common/vault/profile/decision-choices";
import { profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import { ProfileDetailEdit, ProfileService } from "@vowkey/common/vault/profile/profile.service";
import { ProfileDocumentActions } from "@vowkey/vault";
import {
  applyProjection,
  attachSourceBytes,
  CapturedValue,
  CapturedSourceInput,
  Locator,
  migrateLegacyProfile,
  projectEnvelope,
  recordCapture,
  VariantOrigin,
  newEnvelope,
  readEnvelope,
  envelopeState,
  prepareProfileSave,
  copySourceToProfile,
  markSourceDeleted,
  profileRefOf,
  profileUsableForFill,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";

import { PdfFormField } from "../../capture/types/capture";
import * as sdk from "@vowkey/sdk-internal";
import {
  capture_document_text,
  CapturedDocument,
  ChosenField,
  decision_begin,
  decision_finish,
  decision_requests,
  decision_take_first_answers,
  decode_document_barcode,
  detail_label,
  fill_docx_with_profile,
  fill_fields_from_profile,
  fill_hwpx_with_profile,
  fill_xlsx_with_profile,
  FieldMatch,
  Locator as SdkLocator,
  match_form_field,
  profile_details,
  profile_stored_details,
  PureCrypto,
} from "@vowkey/sdk-internal";

export interface FilledFieldSummary {
  label: string;
  value: string;
  closeCall?: string;
}

export interface UnfilledFieldSummary {
  label: string;
}

export interface FillFormBreakdown {
  filledFields: FilledFieldSummary[];
  unfilledFields: UnfilledFieldSummary[];
  savedToDownloads: boolean;
}

/** A detail read from a document, as it sits in a profile now. */
export interface AddedDetail {
  key: string;
  label: string;
  value: string;
  /** True for a machine-readable zone whose check digits all pass. */
  verified: boolean;
}

/** What adding a document did. */
export interface DocumentAdded {
  profile: CipherView;
  created: boolean;
  /** The details the profile did not have, or had differently. */
  added: AddedDetail[];
  /** Whether the original file was attached to the profile. */
  attached: boolean;
  sourceId?: string;
  operationId?: string;
}

interface DocumentOperation {
  v: 1;
  intentId: string;
  kind: "capture" | "move" | "delete";
  cipherId: string;
  sourceId: string;
  allocation?: { attachmentId: string; uploadUrl: string };
  bytes?: string;
  uploaded?: boolean;
  originCipherId?: string;
  originSourceId?: string;
  replaceSourceId?: string;
  created?: boolean;
  source?: CapturedSourceInput;
  values?: CapturedValue[];
  capturedAt?: string;
  create?: { localId: string; body: Record<string, unknown>; hash: string };
  upload?: { localId: string; body: Record<string, unknown>; hash: string; contents: string };
}

export interface PendingDocumentOperation {
  id: string;
  kind: DocumentOperation["kind"];
  profileId: string;
  sourceId: string;
  fileName: string;
}

export class CaptureProfileChoiceRequiredError extends Error {
  constructor(readonly profiles: CipherView[]) {
    super("Choose the profile this document belongs to.");
  }
}

export interface CaptureDestination {
  profileId?: string;
  operationId?: string;
  replaceSourceId?: string;
}

/** Numbers printed on a document that belong to one person. */
const PERSONAL_NUMBERS = [
  "id.passport.number",
  "id.residence_card.number",
  "id.driver_license.number",
  "id.ssn",
  "id.mynumber",
];

/** Where a document writes the holder's whole name, in one script or another. */
const FULL_NAMES = [
  "name.full",
  "name.full.latin",
  "name.full.kana",
  "bank.account.holder.kanji",
  "bank.account.holder.kana",
];

const normalized = (value: string | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const same = (a: string | undefined, b: string | undefined) =>
  normalized(a) !== "" && normalized(a) === normalized(b);

/** Whether two sets of details are one person's: a shared number or name, or the same family name
 * with a given name in common. */
export function isSamePerson(known: Map<string, string>, read: Map<string, string>): boolean {
  if (PERSONAL_NUMBERS.some((key) => same(known.get(key), read.get(key)))) {
    return true;
  }
  const names = new Set(FULL_NAMES.map((key) => normalized(known.get(key))).filter(Boolean));
  if (FULL_NAMES.some((key) => names.has(normalized(read.get(key))) && read.get(key))) {
    return true;
  }
  const pairs = [
    ["name.family.latin", "name.given.latin"],
    ["name.family", "name.given"],
  ];
  return pairs.some(([family, given]) =>
    pairs.some(([readFamily, readGiven]) => {
      const readNames = normalized(read.get(readGiven)).split(" ");
      return (
        same(known.get(family), read.get(readFamily)) &&
        normalized(known.get(given))
          .split(" ")
          .some((name) => name !== "" && readNames.includes(name))
      );
    }),
  );
}

const TEXT_FILE = /\.(txt|md|csv|json)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic)$/i;
export const FILLABLE_FORM = /\.(docx|xlsx|hwpx)$/i;
/** Field names that say nothing about the field, such as "Text12" or "Check Box3". */
const OPAQUE_NAME =
  /^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$/i;

/** Why a photo could not be read in full: its print is too small, or the photo is too unclear. */
export type Unclear = "small" | "unclear";

/** What a document says, and whether its photo was too hard to read in full. */
export interface DocumentRead {
  captured: CapturedDocument;
  unclear: Unclear | null;
}

/** The print of a photographed page is too small to read when its lines are under this many pixels tall. */
const SMALL_PRINT_PIXELS = 10;
const TOO_SMALL_PIXELS = 7;

const UNREADABLE_PHOTO_MESSAGE =
  "Couldn't read this photo. Hold the document flat in good light and try again.";

/**
 * Whether a reading says its photo was too hard to read: text recognition reported a boundary
 * diagnostic (`too_small` / `unreadable`) or was unsure of most of the print on a page.
 */
export function unclearReading(reading: string): Unclear | null {
  let pages: { unsure?: number; lineHeight?: number; diagnostic?: string }[];
  try {
    pages = JSON.parse(reading).pages ?? [];
  } catch {
    return null;
  }
  const tooSmall = pages.find(
    (p) =>
      p.diagnostic === "too_small" ||
      (p.lineHeight != null && p.lineHeight > 0 && p.lineHeight < TOO_SMALL_PIXELS),
  );
  if (tooSmall != null) {
    return "small";
  }
  const page = pages.find(
    (p) => p.diagnostic === "unreadable" || (p.unsure ?? 0) >= 0.5,
  );
  if (page == null) {
    return null;
  }
  return page.lineHeight != null && page.lineHeight < SMALL_PRINT_PIXELS ? "small" : "unclear";
}

const ORIGINS: Record<string, VariantOrigin> = {
  mrz: "mrz",
  aamva: "barcode",
  cccd: "barcode",
  text: "text",
  decision: "ocr",
};

const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
};

function mediaTypeOf(fileName: string): string {
  return MEDIA_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Where the reader found a detail, in the shape the profile keeps it. */
function locatorOf(place: SdkLocator | undefined | null): Locator | null {
  if (place == null) {
    return null;
  }
  return place.kind === "cell"
    ? {
        kind: "cell",
        page: place.page,
        row: place.row ?? 0,
        column: place.column ?? 0,
        a1: place.a1 ?? null,
        table: place.table ?? null,
      }
    : { kind: "page", page: place.page, x: place.x, y: place.y, w: place.w, h: place.h };
}

/** The first date a document states for a key ending in `suffix`, such as `.issued` or `.expiry`. */
function statedDate(read: Map<string, string>, suffix: string): string | null {
  for (const [key, value] of read) {
    if (key.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

/** Reads documents into profiles, and fills forms from them. */
@Injectable({ providedIn: "root" })
export class DocumentCaptureService {
  private accountService = inject(AccountService);
  private cipherService = inject(CipherService);
  private api = inject(ApiService);
  private paths = new WeakMap<File, string>();
  private localVault = inject(LocalVaultService, { optional: true });
  private inference = inject(ProductInference);
  private encryptService = inject(EncryptService, { optional: true });
  private keyService = inject(KeyService, { optional: true });
  private mutations: Promise<unknown> = Promise.resolve();
  private _lastFillBreakdown: FillFormBreakdown | null = null;
  private profileService = new ProfileService(
    this.accountService,
    this.cipherService,
    this.localVault,
    inject(CipherSdkService),
  );

  private async userId(): Promise<UserId | null> {
    return (await firstValueFrom(this.accountService.activeAccount$))?.id ?? null;
  }

  private local(): LocalVaultService {
    if (this.localVault == null) {
      throw new Error("The local vault is unavailable.");
    }
    return this.localVault;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(operation);
    this.mutations = next.catch((): void => undefined);
    return next;
  }

  private async assertAccount(userId: UserId | null): Promise<void> {
    if (await this.userId() !== userId) {
      throw new Error("The active vault changed. Try again from that vault.");
    }
  }

  private async accountResponse(value: unknown, userId: UserId): Promise<CipherView> {
    if (value == null || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" ||
      !("revisionDate" in value) || typeof value.revisionDate !== "string" ||
      !("type" in value) || value.type !== CipherType.Identity) {
      throw new Error("The server returned an invalid profile.");
    }
    await this.assertAccount(userId);
    const data = new CipherData(new CipherResponse(value));
    await this.cipherService.upsert(data, userId);
    const profile = await this.cipherService.decrypt(new Cipher(data), userId);
    await this.assertAccount(userId);
    return profile;
  }

  private async storedProfile(id: string, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    const profile = userId != null
      ? await this.accountResponse(await this.api.send("GET", `/ciphers/${encodeURIComponent(id)}`, null, userId, true), userId)
      : (await this.local().list()).find((cipher) => cipher.id === id);
    await this.assertAccount(userId);
    if (profile == null || profile.type !== CipherType.Identity || profile.isDeleted || profile.migrationPending) {
      throw new Error("The profile is unavailable.");
    }
    return CipherView.fromSdkCipherView(profile.toSdkCipherView())!;
  }

  private async saveProfile(profile: CipherView, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    prepareProfileSave(profile);
    const saved = userId != null
      ? await this.cipherService.updateWithServer(profile, userId)
      : await this.local().save(profile);
    await this.assertAccount(userId);
    return saved;
  }

  private async saveOperation(id: string, operation: DocumentOperation, userId: UserId | null): Promise<void> {
    await this.assertAccount(userId);
    const plain = JSON.stringify(operation);
    const encrypted = userId != null
      ? (await this.encryptService!.encryptString(plain, await firstValueFrom(this.keyService!.userKey$(userId)))).encryptedString
      : await this.local().seal(plain);
    await this.local().saveOperation(userId ?? `local:${await this.local().installationId()}`, id, encrypted);
  }

  private async operation(id: string, userId: UserId | null): Promise<DocumentOperation | null> {
    const encrypted = await this.local().operation(userId ?? `local:${await this.local().installationId()}`, id);
    if (encrypted == null) {
      return null;
    }
    const plain = userId != null
      ? await this.encryptService!.decryptString(new EncString(encrypted), await firstValueFrom(this.keyService!.userKey$(userId)))
      : await this.local().open(encrypted);
    await this.assertAccount(userId);
    return parseDocumentOperation(JSON.parse(plain));
  }

  private async clearOperation(id: string, userId: UserId | null): Promise<void> {
    await this.assertAccount(userId);
    await this.local().deleteOperation(userId ?? `local:${await this.local().installationId()}`, id);
  }

  async pendingOperations(): Promise<PendingDocumentOperation[]> {
    const userId = await this.userId();
    const rows = await this.local().listOperations(userId ?? `local:${await this.local().installationId()}`);
    const pending: PendingDocumentOperation[] = [];
    for (const row of rows) {
      if (!row.id.startsWith("document:")) {
        continue;
      }
      const operation = await this.operation(row.id, userId);
      if (operation != null) {
        pending.push({
          id: row.id, kind: operation.kind, profileId: operation.cipherId, sourceId: operation.sourceId,
          fileName: operation.source?.fileName ?? "Document",
        });
      }
    }
    return pending;
  }

  async retryOperation(id: string): Promise<CipherView> {
    return this.exclusive(async () => {
      const userId = await this.userId();
      const operation = await this.operation(id, userId);
      if (operation == null) {
        throw new Error("The document operation is unavailable.");
      }
      const profile = operation.kind === "capture"
        ? await this.completeCapture(id, operation, userId)
        : operation.kind === "move"
          ? await this.completeMove(id, operation, userId)
          : await this.removeDocument(operation.cipherId, operation.sourceId, userId);
      await this.clearOperation(id, userId);
      return profile;
    });
  }

  /** The people whose details the vault holds: its Identity items. */
  async profiles(): Promise<CipherView[]> {
    const userId = await this.userId();
    const ciphers = userId != null ? await this.cipherService.getAllDecrypted(userId) : await this.local().list();
    await this.assertAccount(userId);
    return ciphers.filter((cipher) => cipher.type === CipherType.Identity && !cipher.isDeleted && !cipher.migrationPending);
  }

  /** The details a profile holds, as they were saved. */
  detailsOf(profile: CipherView): Map<string, string> {
    return profile_stored_details(profileFieldsOf(profile)).details;
  }

  /** Field-by-field breakdown of the most recent fillForm / fillPdfForm call. */
  lastFillBreakdown(): FillFormBreakdown | null {
    return this._lastFillBreakdown;
  }

  /** The text of a document: what this computer reads from a PDF, Office file, photo, or plain file. */
  async readText(file: File, bytes: Uint8Array): Promise<string> {
    if (TEXT_FILE.test(file.name)) {
      return new TextDecoder().decode(bytes);
    }
    if (/\.(docx|xlsx)$/i.test(file.name)) {
      try {
        const officeReading = await extractOfficePieces(file.name, bytes);
        const officeText = officePiecesToPlainText(officeReading);
        if (officeText.trim() !== "") {
          return officeText;
        }
      } catch {
        // Fall through to helper when bytes are not a valid Office zip archive.
      }
    }
    let text = await ipc.capture.readDocument(bytes, file.name);
    if (IMAGE_FILE.test(file.name)) {
      try {
        text += "\n" + decode_document_barcode(bytes).text;
      } catch {
        // The photo has no barcode, which is usual.
      }
    }
    return text;
  }

  private privacyMode(): PrivacyMode {
    return this.inference?.getPrivacyMode?.() ?? "masked";
  }

  /**
   * Decision is asked through the key set up on this computer when there is one (an environment
   * setting or the Mac keychain), and through the hosted relay otherwise.
   */
  private async decide(request: DecisionRequest): Promise<unknown> {
    if (this.privacyMode() === "local") {
      throw new ReadingServiceUnavailableError(0);
    }
    if ((await ipc.capture.decisionSettings()) != null) {
      return ipc.capture.askDecision(request);
    }
    return this.inference.decide(request);
  }

  /** Printed pieces retain their location; standard MRZ/barcode data also works offline. */
  async read(file: File, bytes: Uint8Array): Promise<DocumentRead> {
    const year = new Date().getFullYear();
    const mode = this.privacyMode();
    if (mode === "local") {
      return this.readLocal(file, bytes, year);
    }
    if (mode === "cloud_vision" && (IMAGE_FILE.test(file.name) || /\.pdf$/i.test(file.name))) {
      const visionRead = await this.readCloudVision(file, bytes, year);
      if (visionRead != null) {
        return visionRead;
      }
    }
    let lastReading = '{"pages":[]}';
    let lastUnclear: Unclear | null = null;
    try {
      const settings = await ipc.capture.decisionSettings();
      return await this.readWithDecision(file, bytes, year, settings?.perRequest ?? 0, (r) => {
        lastReading = r;
        lastUnclear = unclearReading(r);
      });
    } catch (error) {
      let captured = await this.readLocalStandard(file, bytes, year);
      const beforeCount = captured.details.size;
      this.mergeSpatialLabeledPieces(lastReading, captured);
      if (captured.details.size > beforeCount) {
        captured = this.withCompanionDetails(captured);
      }
      if (captured.details.size > 0 || lastUnclear != null) {
        return { captured, unclear: lastUnclear };
      }
      throw error;
    }
  }

  private async readPiecesString(file: File, bytes: Uint8Array): Promise<string> {
    if (TEXT_FILE.test(file.name)) {
      return JSON.stringify({
        pages: [
          {
            index: 0,
            pieces: new TextDecoder()
              .decode(bytes)
              .split("\n")
              .map((text) => ({ text }))
              .filter((piece) => piece.text.trim() !== ""),
          },
        ],
      });
    }
    if (/\.(docx|xlsx)$/i.test(file.name)) {
      try {
        const officeReading = await extractOfficePieces(file.name, bytes);
        if (JSON.parse(officeReading).pages?.some((p: { pieces?: unknown[] }) => (p.pieces?.length ?? 0) > 0)) {
          return officeReading;
        }
      } catch {
        // Fall through to helper if archive cannot be opened.
      }
    }
    return ipc.capture.readPieces(bytes, file.name);
  }

  private withCompanionDetails(captured: CapturedDocument): CapturedDocument {
    let expanded: Map<string, string> | undefined;
    try {
      expanded = profile_details?.({
        identity: {
          title: "",
          first_name: "",
          middle_name: "",
          last_name: "",
          address1: "",
          address2: "",
          address3: "",
          city: "",
          state: "",
          postal_code: "",
          country: "",
          company: "",
          email: "",
          phone: "",
          ssn: "",
          passport_number: "",
          license_number: "",
        },
        custom: new Map(captured.details),
      })?.details;
    } catch {
      return captured;
    }
    if (!(expanded instanceof Map)) {
      return captured;
    }
    const details = new Map(captured.details);
    const sources = new Map(captured.sources);
    let changed = false;
    for (const [key, value] of expanded.entries()) {
      if (!value) {
        continue;
      }
      if (!details.has(key)) {
        details.set(key, value);
        sources.set(key, { kind: "derived", verified: false });
        changed = true;
      } else if (key === "name.full" && !sources.get(key)?.verified && details.get(key) !== value) {
        details.set(key, value);
        changed = true;
      }
    }
    return changed ? { details, sources } : captured;
  }

  private async readLocalStandard(
    file: File,
    bytes: Uint8Array,
    year: number,
  ): Promise<CapturedDocument> {
    const raw = capture_document_text(await this.readText(file, bytes), year);
    return this.withCompanionDetails(raw);
  }

  private async readLocal(file: File, bytes: Uint8Array, year: number): Promise<DocumentRead> {
    let reading = '{"pages":[]}';
    try {
      reading = await this.readPiecesString(file, bytes);
    } catch {
      // Corrupt image or helper failure surfaces as unclear when text extraction is also empty.
      reading = JSON.stringify({ pages: [{ pieces: [], unsure: 1, diagnostic: "unreadable" }] });
    }
    const unclear = unclearReading(reading);
    let captured: CapturedDocument = { details: new Map(), sources: new Map() };
    try {
      captured = await this.readLocalStandard(file, bytes, year);
    } catch {
      return { captured, unclear: unclear ?? "unclear" };
    }
    this.mergeSpatialLabeledPieces(reading, captured);
    return { captured: this.withCompanionDetails(captured), unclear };
  }

  private mergeSpatialLabeledPieces(reading: string, captured: CapturedDocument): void {
    if (typeof match_form_field !== "function") {
      return;
    }
    let pages: {
      pieces?: {
        text: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        confidence?: number;
        locator?: SdkLocator;
      }[];
    }[];
    try {
      pages = JSON.parse(reading).pages ?? [];
    } catch {
      return;
    }
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pieces = (pages[pageIndex].pieces ?? []).filter(
        (p) => (p.confidence ?? 1) >= 0.45 && p.text.trim() !== "",
      );
      for (let i = 0; i < pieces.length - 1; i++) {
        const cur = pieces[i];
        const next = pieces[i + 1];
        const hasPunctuationCue = /[:：]\s*$/.test(cur.text) || cur.text.includes("/");
        const sameRow =
          cur.y != null &&
          next.y != null &&
          Math.abs(cur.y - next.y) <= Math.max(cur.h ?? 0.03, 0.025) &&
          (next.x ?? 0) > (cur.x ?? 0);
        const stackedBelow =
          cur.x != null &&
          next.x != null &&
          cur.y != null &&
          next.y != null &&
          Math.abs(cur.x - next.x) <= 0.06 &&
          next.y > cur.y &&
          next.y - cur.y <= Math.max((cur.h ?? 0.03) * 2.4, 0.08);
        if (!sameRow && !stackedBelow) {
          continue;
        }
        const matched = match_form_field({
          id: `p_${pageIndex}_${i}`,
          name: "",
          label: cur.text.replace(/[:：]\s*$/, "").trim(),
          placeholder: "",
          autocomplete: "",
          input_type: "text",
          section: "",
          form: "",
          pattern: "",
          max_length: 0,
          format: "",
          op_ignore: false,
        });
        const attr = matched?.attribute;
        const score = matched?.score ?? 0;
        if (!attr || (hasPunctuationCue ? score <= 0 : score < 0.75)) {
          continue;
        }
        const val = next.text.trim();
        if (!val || /[:：]\s*$/.test(val) || captured.details.has(attr)) {
          continue;
        }
        if (!hasPunctuationCue) {
          const nextMatched = match_form_field({
            id: `p_${pageIndex}_${i}_n`,
            name: "",
            label: val,
            placeholder: "",
            autocomplete: "",
            input_type: "text",
            section: "",
            form: "",
            pattern: "",
            max_length: 0,
            format: "",
            op_ignore: false,
          });
          if (nextMatched?.attribute && (nextMatched.score ?? 0) >= 0.75) {
            continue;
          }
        }
        captured.details.set(attr, val);
        const hasBox =
          next.x != null && next.y != null && next.w != null && next.h != null &&
          next.w >= 0 && next.h >= 0;
        const x = hasBox ? Math.max(0, Math.min(1, next.x!)) : 0;
        const y = hasBox ? Math.max(0, Math.min(1, next.y!)) : 0;
        captured.sources.set(attr, {
          kind: "text",
          verified: false,
          locator:
            next.locator?.kind === "cell"
              ? next.locator
              : hasBox
                ? {
                    kind: "page",
                    page: pageIndex,
                    x,
                    y,
                    w: Math.max(0, Math.min(1 - x, next.w!)),
                    h: Math.max(0, Math.min(1 - y, next.h!)),
                    row: undefined,
                    column: undefined,
                    a1: undefined,
                    table: undefined,
                  }
                : undefined,
        });
      }
    }
  }

  private async imageDataUrlFor(file: File, bytes: Uint8Array): Promise<string | null> {
    if (IMAGE_FILE.test(file.name)) {
      const mime = mediaTypeOf(file.name);
      return `data:${mime};base64,${Utils.fromBufferToB64(bytes)}`;
    }
    if (/\.pdf$/i.test(file.name) && typeof document !== "undefined") {
      try {
        const pdfjs = await import("pdfjs-dist");
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const pageCount = Math.min(doc.numPages, 5);
        if (pageCount <= 0) {
          return null;
        }
        const rendered: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
        for (let p = 1; p <= pageCount; p++) {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: 2.0 });
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = Math.ceil(viewport.width);
          pageCanvas.height = Math.ceil(viewport.height);
          const ctx = pageCanvas.getContext("2d");
          if (ctx == null) {
            continue;
          }
          await page.render({ canvasContext: ctx, viewport, canvas: pageCanvas } as any).promise;
          rendered.push({ canvas: pageCanvas, width: pageCanvas.width, height: pageCanvas.height });
        }
        if (rendered.length === 0) {
          return null;
        }
        if (rendered.length === 1) {
          return rendered[0].canvas.toDataURL("image/png");
        }
        const totalWidth = Math.max(...rendered.map((r) => r.width));
        const gap = 16;
        const totalHeight =
          rendered.reduce((sum, r) => sum + r.height, 0) + gap * (rendered.length - 1);
        const stitched = document.createElement("canvas");
        stitched.width = totalWidth;
        stitched.height = totalHeight;
        const sCtx = stitched.getContext("2d");
        if (sCtx == null) {
          return rendered[0].canvas.toDataURL("image/png");
        }
        sCtx.fillStyle = "#ffffff";
        sCtx.fillRect(0, 0, totalWidth, totalHeight);
        let offsetY = 0;
        for (const r of rendered) {
          sCtx.drawImage(r.canvas, 0, offsetY);
          offsetY += r.height + gap;
        }
        return stitched.toDataURL("image/png");
      } catch {
        return null;
      }
    }
    return null;
  }

  private async readCloudVision(
    file: File,
    bytes: Uint8Array,
    year: number,
  ): Promise<DocumentRead | null> {
    if (typeof this.inference?.readDocumentVision !== "function") {
      return null;
    }
    const dataUrl = await this.imageDataUrlFor(file, bytes);
    if (dataUrl == null) {
      return null;
    }
    let unclear: Unclear | null = null;
    let local: CapturedDocument = { details: new Map(), sources: new Map() };
    try {
      const reading = await this.readPiecesString(file, bytes);
      unclear = unclearReading(reading);
    } catch {
      unclear = "unclear";
    }
    try {
      local = await this.readLocalStandard(file, bytes, year);
    } catch {
      // Local OCR helper failure does not block Cloud Vision.
    }
    try {
      const vision = await this.inference.readDocumentVision(dataUrl, file.name);
      const details = new Map<string, string>();
      const sources = new Map(local.sources);
      for (const [key, value] of local.details.entries()) {
        if (local.sources.get(key)?.verified) {
          details.set(key, value);
        }
      }
      let visionCount = 0;
      for (const [rawKey, rawVal] of Object.entries(vision?.details ?? {})) {
        const value = typeof rawVal === "string" ? rawVal.trim() : "";
        if (!rawKey || !value) {
          continue;
        }
        visionCount++;
        if (sources.get(rawKey)?.verified && details.has(rawKey)) {
          continue;
        }
        details.set(rawKey, value);
        sources.set(rawKey, { kind: "decision", verified: false } as any);
      }
      for (const [key, value] of local.details.entries()) {
        if (!details.has(key) && local.sources.get(key)?.kind !== "derived") {
          details.set(key, value);
        }
      }
      const merged = this.withCompanionDetails({ details, sources });
      return {
        captured: merged,
        unclear: visionCount > 0 || merged.details.size > 0 ? null : unclear,
      };
    } catch {
      return null;
    }
  }

  private async readWithDecision(
    file: File,
    bytes: Uint8Array,
    year: number,
    perRequest: number,
    onReading?: (reading: string) => void,
  ): Promise<DocumentRead> {
    const reading = await this.readPiecesString(file, bytes);
    onReading?.(reading);
    const ask = (requests: string) =>
      Promise.all((JSON.parse(requests) as DecisionRequest[]).map((r) => this.decide(r)));

    let plan = decision_begin(reading, perRequest);
    plan = decision_take_first_answers(
      plan,
      JSON.stringify(await ask(decision_requests(plan, false))),
    );
    const second = await ask(decision_requests(plan, true));

    let barcode = "";
    if (IMAGE_FILE.test(file.name)) {
      try {
        barcode = decode_document_barcode(bytes).text;
      } catch {
        // The photo has no barcode, which is usual.
      }
    }
    return {
      captured: decision_finish(plan, JSON.stringify(second), barcode, year),
      unclear: unclearReading(reading),
    };
  }

  /** Adds what a document says to the profile it belongs to, or to a new one. */
  async add(text: string, file: File, bytes: Uint8Array): Promise<DocumentAdded | null> {
    return this.addCaptured(capture_document_text(text, new Date().getFullYear()), file, bytes);
  }

  /** Adds the details read from a document to the profile it belongs to, or to a new one. */
  async addCaptured(
    captured: CapturedDocument,
    file: File,
    bytes: Uint8Array,
    destination: CaptureDestination = {},
  ): Promise<DocumentAdded | null> {
    return this.exclusive(() => this.capture(captured, file, bytes, destination));
  }

  private async capture(
    captured: CapturedDocument,
    file: File,
    bytes: Uint8Array,
    destination: CaptureDestination,
  ): Promise<DocumentAdded | null> {
    const read = new Map([...captured.details].filter(([key]) => captured.sources.get(key)?.kind !== "derived"));
    if (read.size === 0) {
      return null;
    }
    const userId = await this.userId();
    const profiles = userId != null ? await this.cipherService.getAllDecrypted(userId) : await this.local().list();
    await this.assertAccount(userId);
    const matches = profiles.filter((profile) => profile.type === CipherType.Identity &&
      !profile.isDeleted && !profile.migrationPending &&
      (envelopeState(profile) === "none" || profileUsableForFill(profile)) &&
      isSamePerson(this.detailsOf(profile), read));
    if (matches.length > 1 && destination.profileId == null) {
      throw new CaptureProfileChoiceRequiredError(matches);
    }
    const existing = destination.profileId != null
      ? await this.storedProfile(destination.profileId, userId)
      : matches.length === 1 ? await this.storedProfile(matches[0].id, userId) : null;
    if (existing != null && !existing.edit) {
      throw new Error("This profile is read-only.");
    }
    const profile = existing ?? this.newProfile(read, file);
    profile.id ||= crypto.randomUUID();
    const known = existing != null ? this.detailsOf(existing) : new Map<string, string>();
    const added = [...read].filter(([key, value]) => known.get(key) !== value).map(([key, value]) => ({
      key, value, label: detail_label(key), verified: captured.sources.get(key)?.verified ?? false,
    }));
    const operation: DocumentOperation = {
      v: 1, kind: "capture", cipherId: profile.id, sourceId: crypto.randomUUID(),
      intentId: crypto.randomUUID(), bytes: Utils.fromBufferToB64(bytes), capturedAt: new Date().toISOString(),
      created: existing == null, replaceSourceId: destination.replaceSourceId,
      source: {
        fileName: file.name, mediaType: mediaTypeOf(file.name), kind: "document",
        documentDate: statedDate(read, ".issued"), expiresOn: statedDate(read, ".expiry"),
      },
      values: [...read].map(([key, value]) => {
        const source = captured.sources.get(key);
        return { key, value, origin: ORIGINS[source?.kind ?? "text"] ?? "ocr",
          verified: source?.verified ?? false, locator: locatorOf(source?.locator) };
      }),
    };
    const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
    if (destination.replaceSourceId != null && !meta.sources.some((source) =>
      source.id === destination.replaceSourceId && source.status !== "deleted" && source.attachmentId != null)) {
      throw new Error("The document being replaced is unavailable.");
    }
    if (userId == null) {
      const attachmentId = crypto.randomUUID();
      this.commitCaptureMetadata(profile, operation, attachmentId);
      const saved = await this.local().save(profile, [{ id: attachmentId, fileName: file.name, bytes }]);
      return { profile: saved, created: existing == null, added, attached: true, sourceId: operation.sourceId };
    }
    const operationId = `document:${operation.intentId}`;
    if (existing == null) {
      writeEnvelope(profile, newEnvelope(profile.id));
      const context = await this.cipherService.encrypt(profile, userId);
      const body: Record<string, unknown> = JSON.parse(JSON.stringify(new CipherRequest(context)));
      if (typeof body.key !== "string" || !body.key) {
        throw new Error("The profile's encryption key is unavailable.");
      }
      body.migrationPending = false;
      operation.create = { localId: profile.id, body, hash: await requestHash(body) };
    }
    await this.saveOperation(operationId, operation, userId);
    try {
      const saved = await this.completeCapture(operationId, operation, userId);
      await this.clearOperation(operationId, userId);
      return { profile: saved, created: existing == null, added, attached: true, sourceId: operation.sourceId, operationId };
    } catch {
      profile.id = operation.cipherId;
      return { profile, created: existing == null, added, attached: false, sourceId: operation.sourceId, operationId };
    }
  }

  private commitCaptureMetadata(profile: CipherView, operation: DocumentOperation, attachmentId: string): void {
    const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
    if (!meta.sources.some((source) => source.id === operation.sourceId)) {
      const previous = [...projectEnvelope(meta).text.keys()];
      let firstId = true;
      recordCapture(meta, operation.source!, operation.values!, {
        labelOf: detail_label, now: () => new Date(operation.capturedAt!),
        newId: () => { if (firstId) { firstId = false; return operation.sourceId; } return crypto.randomUUID(); },
      });
      attachSourceBytes(meta, operation.sourceId, attachmentId);
      if (operation.replaceSourceId != null) {
        const old = meta.sources.find((source) => source.id === operation.replaceSourceId);
        if (old == null || old.status === "deleted" || old.attachmentId == null) {
          throw new Error("The document being replaced is unavailable.");
        }
        old.status = "retained";
      }
      writeEnvelope(profile, meta);
      applyProjection(profile, projectEnvelope(meta), previous);
    }
  }

  private async completeCapture(id: string, operation: DocumentOperation, userId: UserId | null): Promise<CipherView> {
    if (userId == null) {
      throw new Error("Local document saves are atomic and do not need an upload retry.");
    }
    if (operation.create != null) {
      const create = operation.create;
      const response: unknown = await this.api.send("POST", "/ciphers", {
        ...create.body, migrationId: operation.intentId, localResourceId: create.localId, requestHash: create.hash,
      }, userId, true);
      const created = await this.accountResponse(response, userId);
      operation.cipherId = created.id;
      await this.saveOperation(id, operation, userId);
    }
    let profile = await this.storedProfile(operation.cipherId, userId);
    const committed = readEnvelope(profile)?.sources.find((source) => source.id === operation.sourceId);
    if (committed?.attachmentId != null) {
      return profile;
    }
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    const bytes = new Uint8Array(Utils.fromB64ToArray(operation.bytes!));
    await this.uploadDocument(profile, id, operation, bytes, userId);
    profile = await this.storedProfile(operation.cipherId, userId);
    this.commitCaptureMetadata(profile, operation, operation.allocation!.attachmentId);
    const saved = await this.saveProfile(profile, userId);
    if (!readEnvelope(saved)?.sources.some((source) =>
      source.id === operation.sourceId && source.attachmentId === operation.allocation!.attachmentId)) {
      throw new Error("The document was uploaded but its profile update was not acknowledged.");
    }
    return saved;
  }

  private async uploadDocument(profile: CipherView, id: string, operation: DocumentOperation, bytes: Uint8Array, userId: UserId): Promise<void> {
    await this.assertAccount(userId);
    if (operation.uploaded) {
      return;
    }
    if (operation.upload == null) {
      const { cipher } = await this.cipherService.encrypt(profile, userId);
      const key = profile.organizationId == null
        ? await firstValueFrom(this.keyService!.userKey$(userId))
        : (await firstValueFrom(this.keyService!.orgKeys$(userId)))[profile.organizationId as OrganizationId];
      if (key == null) {
        throw new Error("Unlock the vault to upload this document.");
      }
      const encoded = key.toEncoded();
      try {
        const localId = crypto.randomUUID();
        const prepared = PureCrypto.encrypt_legacy_attachment(cipher.toSdkCipher(), {
          id: localId, fileName: operation.source!.fileName,
        }, bytes, encoded);
        const contents = Uint8Array.from(prepared.contents);
        const body = {
          key: prepared.attachment.key, fileName: prepared.attachment.fileName,
          fileSize: contents.byteLength, bytesChecksum: await checksum(contents),
          lastKnownRevisionDate: profile.revisionDate.toISOString(),
        };
        operation.upload = { localId, body, hash: await requestHash(body), contents: Utils.fromBufferToB64(contents) };
      } finally {
        encoded.fill(0);
      }
      await this.saveOperation(id, operation, userId);
    }
    const upload = operation.upload;
    const allocation: unknown = await this.api.send("POST", `/ciphers/${encodeURIComponent(profile.id)}/attachment/v2`, {
      ...upload.body, migrationId: operation.intentId, localResourceId: upload.localId, requestHash: upload.hash,
    }, userId, true);
    if (allocation == null || typeof allocation !== "object" ||
      !("attachmentId" in allocation) || typeof allocation.attachmentId !== "string" ||
      !("url" in allocation) || typeof allocation.url !== "string") {
      throw new Error("The attachment allocation was not acknowledged.");
    }
    operation.allocation = { attachmentId: allocation.attachmentId, uploadUrl: allocation.url };
    await this.saveOperation(id, operation, userId);
    await this.assertAccount(userId);
    const form = new FormData();
    form.append("data", new Blob([new Uint8Array(Utils.fromB64ToArray(upload.contents)).buffer]), "attachment");
    await this.api.send("POST", `/ciphers/${encodeURIComponent(profile.id)}/attachment/${encodeURIComponent(operation.allocation.attachmentId)}`,
      form, userId, false);
    const metadata: unknown = await this.api.send("GET",
      `/ciphers/${encodeURIComponent(profile.id)}/attachment/${encodeURIComponent(operation.allocation.attachmentId)}`, null, userId, true);
    if (metadata == null || typeof metadata !== "object" || !("url" in metadata) || typeof metadata.url !== "string") {
      throw new Error("The uploaded document could not be verified.");
    }
    const response = await fetch(metadata.url, { credentials: "omit" });
    if (!response.ok || await checksum(new Uint8Array(await response.arrayBuffer())) !== upload.body.bytesChecksum) {
      throw new Error("The uploaded document could not be verified.");
    }
    operation.uploaded = true;
    await this.saveOperation(id, operation, userId);
  }

  async retryCapture(operationId: string): Promise<CipherView> {
    return this.retryOperation(operationId);
  }

  /** Saves an explicit correction, alternative selection, dismissal or detail deletion. */
  async editDetail(profileId: string, edit: ProfileDetailEdit): Promise<CipherView> {
    return this.exclusive(() => this.profileService.edit(profileId, edit));
  }

  /** A replacement is a new capture source; retained history keeps the old bytes and locator. */
  async replaceDocument(
    profileId: string, sourceId: string, captured: CapturedDocument, file: File, bytes: Uint8Array,
  ): Promise<DocumentAdded | null> {
    return this.addCaptured(captured, file, bytes, { profileId, replaceSourceId: sourceId });
  }

  /** Deletes only bytes. Saved details and history retain the original logical source id. */
  async deleteDocument(profileId: string, sourceId: string): Promise<CipherView> {
    return this.exclusive(async () => {
      const userId = await this.userId();
      const operationId = `document:delete:${profileId}:${sourceId}`;
      const operation = await this.operation(operationId, userId) ?? {
        v: 1, intentId: crypto.randomUUID(), kind: "delete", cipherId: profileId, sourceId,
      };
      await this.saveOperation(operationId, operation, userId);
      const saved = await this.removeDocument(profileId, sourceId, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  private async removeDocument(profileId: string, sourceId: string, userId: UserId | null): Promise<CipherView> {
    let profile = await this.storedProfile(profileId, userId);
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    let meta = migrateLegacyProfile(profile);
    const source = meta.sources.find((candidate) => candidate.id === sourceId);
    if (source == null) {
      throw new Error("The document is unavailable.");
    }
    const attachmentId = source.attachmentId;
    if (userId == null) {
      markSourceDeleted(meta, sourceId);
      writeEnvelope(profile, meta);
      const present = attachmentId != null && profile.attachments.some((attachment) => attachment.id === attachmentId);
      return this.local().save(profile, [], present ? [attachmentId] : []);
    }
    if (attachmentId != null && profile.attachments.some((attachment) => attachment.id === attachmentId)) {
      await this.cipherService.deleteAttachmentWithServer(profileId, attachmentId, userId, false);
      profile = await this.storedProfile(profileId, userId);
      meta = migrateLegacyProfile(profile);
    }
    markSourceDeleted(meta, sourceId);
    writeEnvelope(profile, meta);
    return this.saveProfile(profile, userId);
  }

  /** Downloads only the original source's bytes; a deleted source never substitutes a replacement. */
  async documentBytes(profileId: string, sourceId: string): Promise<Uint8Array> {
    return this.profileService.bytes(profileId, sourceId);
  }

  /** The origin is retired only after a verified destination source update is acknowledged. */
  async moveDocument(originId: string, sourceId: string, destinationId: string): Promise<CipherView> {
    return this.exclusive(async () => {
      if (originId === destinationId) {
        throw new Error("Choose a different destination profile.");
      }
      const userId = await this.userId();
      const operationId = `document:move:${originId}:${sourceId}:${destinationId}`;
      const origin = await this.storedProfile(originId, userId);
      const destination = await this.storedProfile(destinationId, userId);
      const source = readEnvelope(origin)?.sources.find((item) => item.id === sourceId);
      if (!origin.edit || !destination.edit || source == null || source.status === "deleted" || source.attachmentId == null) {
        throw new Error("Both profiles must be editable and the document must be available.");
      }
      const operation: DocumentOperation = await this.operation(operationId, userId) ?? {
        v: 1, intentId: crypto.randomUUID(), kind: "move", cipherId: destinationId, sourceId: crypto.randomUUID(),
        originCipherId: originId, originSourceId: sourceId,
        source: { fileName: source.fileName, mediaType: source.mediaType, kind: source.kind },
      };
      await this.saveOperation(operationId, operation, userId);
      const saved = await this.completeMove(operationId, operation, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  private async completeMove(operationId: string, operation: DocumentOperation, userId: UserId | null): Promise<CipherView> {
    let destination = await this.storedProfile(operation.cipherId, userId);
    const origin = await this.storedProfile(operation.originCipherId!, userId);
    if (!origin.edit || !destination.edit) {
      throw new Error("Both profiles must be editable to move a document.");
    }
    const originMeta = migrateLegacyProfile(origin);
    let meta = migrateLegacyProfile(destination);
    const committed = meta.sources.find((source) => source.id === operation.sourceId);
    if (committed?.attachmentId == null) {
      const bytes = await this.documentBytes(origin.id, operation.originSourceId!);
      await this.assertAccount(userId);
      const previous = [...projectEnvelope(meta).text.keys()];
      if (userId == null) {
        const attachmentId = crypto.randomUUID();
        copySourceToProfile(meta, originMeta, operation.originSourceId!, operation.sourceId, attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), previous);
        destination = await this.local().save(destination, [{ id: attachmentId, fileName: operation.source!.fileName, bytes }]);
      } else {
        await this.uploadDocument(destination, operationId, operation, bytes, userId);
        destination = await this.storedProfile(destination.id, userId);
        meta = migrateLegacyProfile(destination);
        const currentNames = [...projectEnvelope(meta).text.keys()];
        copySourceToProfile(meta, originMeta, operation.originSourceId!, operation.sourceId, operation.allocation!.attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), currentNames);
        destination = await this.saveProfile(destination, userId);
      }
    }
    const savedSource = readEnvelope(destination)?.sources.find((source) => source.id === operation.sourceId);
    if (savedSource?.attachmentId == null || savedSource.status === "deleted") {
      throw new Error("The destination document was not committed.");
    }
    await this.removeDocument(origin.id, operation.originSourceId!, userId);
    return destination;
  }

  /** Associations resolve only their explicit accessible, confirmed profile. */
  async associatedProfile(item: CipherView): Promise<CipherView | null> {
    const id = profileRefOf(item);
    if (id == null) {
      return null;
    }
    const profile = (await this.profiles()).find((candidate) => candidate.id === id);
    return profileUsableForFill(profile) ? profile! : null;
  }

  private newProfile(read: Map<string, string>, file: File): CipherView {
    const latinGiven = read.get("name.given.latin")?.trim();
    const latinFamily = read.get("name.family.latin")?.trim();
    const given = read.get("name.given")?.trim();
    const family = read.get("name.family")?.trim();
    const profile = new CipherView();
    profile.type = CipherType.Identity;
    profile.identity = new IdentityView();
    profile.name =
      (latinGiven && latinFamily ? `${latinGiven} ${latinFamily}` : undefined) ??
      read.get("name.full.latin")?.trim() ??
      (given && family ? `${given} ${family}` : undefined) ??
      read.get("name.full")?.trim() ??
      latinGiven ??
      latinFamily ??
      given ??
      family ??
      file.name.replace(/\.[^.]+$/, "");
    return profile;
  }

  /** Fills a Word, Excel or Hangul form from a profile and saves the copy beside the original. */
  async fillForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const profileFields = profileFieldsOf(profile);
    const details = { details: profile_details(profileFields).details };
    const lower = file.name.toLowerCase();
    const result = lower.endsWith(".docx")
      ? fill_docx_with_profile(bytes, details)
      : lower.endsWith(".xlsx")
        ? fill_xlsx_with_profile(bytes, details)
        : fill_hwpx_with_profile(bytes, details);
    let outBytes: Uint8Array = Uint8Array.from(result.bytes);
    let filledCount = result.report.filled_count;
    const filledFields: FilledFieldSummary[] = (result.report.entries ?? []).map((entry) => ({
      label: entry.label || entry.target,
      value: entry.value,
      ...(entry.owner && entry.owner !== "applicant" ? { closeCall: entry.owner } : {}),
    }));
    let unfilledFields: UnfilledFieldSummary[] = [];

    if (
      this.privacyMode() !== "local" &&
      typeof this.inference?.describe === "function" &&
      (lower.endsWith(".docx") || lower.endsWith(".xlsx"))
    ) {
      try {
        const extra = lower.endsWith(".docx")
          ? await this.describeAndFillRemainingDocx(file.name, outBytes, profileFields, bytes)
          : await this.describeAndFillRemainingXlsx(file.name, outBytes, profileFields, bytes);
        if (extra.filled > 0) {
          outBytes = extra.bytes;
          filledCount += extra.filled;
          filledFields.push(...extra.filledFields);
        }
        unfilledFields = extra.unfilledFields;
      } catch {
        // Offline or ReadingServiceUnavailableError falls back cleanly to local office fill.
      }
    }

    const sourcePath = this.sourcePathOf(file);
    this._lastFillBreakdown = {
      filledFields,
      unfilledFields,
      savedToDownloads: !sourcePath,
    };

    if (filledCount === 0) {
      return { path: null, filled: 0 };
    }
    const path = await ipc.capture.saveCopy({
      sourcePath,
      name: file.name,
      bytes: outBytes,
    });
    return { path, filled: filledCount };
  }

  /** Fills a PDF or photographed paper form from a profile and saves the copy beside the original. */
  async fillPdfForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const fields = (await ipc.capture.readPdfForm(bytes)).filter(
      (field) =>
        field.type === "text" || field.type === "select-one" || field.type === "checkbox",
    );
    const inputs = fields.map(pdfFieldInput);
    const profileFields = profileFieldsOf(profile);
    let { matches } = fill_fields_from_profile({
      fields: inputs,
      profile: profileFields,
      explicit_fill: true,
      choices: [],
    });

    if (this.privacyMode() !== "local" && inputs.length > 0) {
      const choices = await this.semanticChoicesFor(file.name, fields, inputs, matches, profile);
      if (choices.length > 0 || inputs.some((input) => input.format !== "")) {
        matches = fill_fields_from_profile({
          fields: inputs,
          profile: profileFields,
          explicit_fill: true,
          choices,
        }).matches;
      }
    }

    const values: Record<string, string> = {};
    const filledFields: FilledFieldSummary[] = [];
    const unfilledFields: UnfilledFieldSummary[] = [];
    const seenUnfilled = new Set<string>();

    matches.forEach((match, index) => {
      const field = fields[index];
      const displayLabel = (field.label || field.tooltip || field.name || field.key).trim();
      let value = match.value?.trim();
      if (value) {
        if (field.type === "select-one") {
          value = resolveSelectOption(value, field.options);
        } else if (field.type === "checkbox") {
          value = matchesCheckboxChoice(value, field) ? "true" : undefined;
        } else if (field.maxLength > 0) {
          value = value.slice(0, field.maxLength);
        }
      }
      if (value) {
        values[field.key] = value;
        const closeCall =
          match.owner && match.owner !== "applicant"
            ? match.owner
            : match.score > 0 && match.score < 0.85
              ? detail_label(match.attribute)
              : undefined;
        filledFields.push({
          label: displayLabel,
          value: field.type === "checkbox" && value === "true" ? "✓" : value,
          ...(closeCall ? { closeCall } : {}),
        });
      } else if (
        field.type !== "checkbox" &&
        match.owner !== "official_only" &&
        displayLabel &&
        !OPAQUE_NAME.test(displayLabel) &&
        !seenUnfilled.has(displayLabel)
      ) {
        seenUnfilled.add(displayLabel);
        unfilledFields.push({ label: displayLabel });
      }
    });

    const sourcePath = this.sourcePathOf(file);
    this._lastFillBreakdown = {
      filledFields,
      unfilledFields,
      savedToDownloads: !sourcePath,
    };

    if (Object.keys(values).length === 0) {
      return { path: null, filled: 0 };
    }
    return ipc.capture.fillPdfForm({
      sourcePath,
      name: file.name,
      bytes,
      values,
    });
  }

  private async semanticChoicesFor(
    fileName: string,
    rawFields: PdfFormField[],
    inputs: ReturnType<typeof pdfFieldInput>[],
    _localMatches: FieldMatch[],
    profile: CipherView,
  ): Promise<ChosenField[]> {
    const indexById = new Map<string, number>();
    inputs.forEach((input, idx) => {
      indexById.set(input.id, idx);
      indexById.set(`f_${idx}`, idx);
      indexById.set(`field_${idx}`, idx);
    });
    const byIndex = new Map<number, ChosenField>();
    const explicitNoneIndices = new Set<number>();

    if (inputs.length > 0 && typeof this.inference?.describe === "function") {
      try {
        const described = await this.describeFormInputs(fileName, rawFields, inputs);
        for (const item of described) {
          if (item.format) {
            inputs[item.index].format ||= item.format;
          }
          if (!inputs[item.index].section && item.whose !== "applicant") {
            inputs[item.index].section = item.whose;
          }
          const id = inputs[item.index].id;
          if (item.whose === "official_only") {
            byIndex.set(item.index, { id, attribute: "", owner: "official_only" });
          } else if (item.explicitNone) {
            explicitNoneIndices.add(item.index);
            byIndex.set(item.index, { id, attribute: "", owner: item.whose });
          } else if (item.whose !== "applicant" && item.whose !== "employer") {
            byIndex.set(item.index, {
              id,
              attribute: isPersonScopedAttribute(item.detail) ? item.detail : "",
              owner: item.whose,
            });
          } else if (item.detail) {
            byIndex.set(item.index, {
              id,
              attribute: item.detail,
              owner: item.whose,
            });
          }
        }
      } catch {
        // Offline or ReadingServiceUnavailableError falls back to Decision or local matching.
      }
    }

    try {
      const decisionChoices = await this.choicesFor(inputs, profile);
      for (const choice of decisionChoices) {
        const idx = indexById.get(choice.id);
        if (idx == null || explicitNoneIndices.has(idx)) {
          continue;
        }
        const existing = byIndex.get(idx);
        if (
          existing != null &&
          existing.owner !== "applicant" &&
          existing.owner !== "employer"
        ) {
          continue;
        }
        if (choice.attribute || (choice.owner && choice.owner !== "applicant")) {
          byIndex.set(idx, {
            id: inputs[idx].id,
            attribute: choice.attribute,
            owner: choice.owner || "applicant",
          });
        }
      }
    } catch {
      // Offline or ReadingServiceUnavailableError keeps local / described matches.
    }

    return [...byIndex.values()];
  }

  private async describeFormInputs(
    fileName: string,
    rawFields: PdfFormField[],
    inputs: ReturnType<typeof pdfFieldInput>[],
  ): Promise<
    { index: number; detail: string; whose: string; format: string; explicitNone: boolean }[]
  > {
    const CHUNK_SIZE = 75;
    const out: {
      index: number;
      detail: string;
      whose: string;
      format: string;
      explicitNone: boolean;
    }[] = [];
    for (let offset = 0; offset < inputs.length; offset += CHUNK_SIZE) {
      const sliceInputs = inputs.slice(offset, offset + CHUNK_SIZE);
      const sliceRaw = rawFields.slice(offset, offset + CHUNK_SIZE);
      const sectionIds = new Map<string, string>([["", "main"]]);
      const sections: { id: string; label: string }[] = [{ id: "main", label: fileName }];
      for (const input of sliceInputs) {
        const sec = input.section.trim();
        if (sec && !sectionIds.has(sec)) {
          const secId = `sec_${sections.length}`;
          sectionIds.set(sec, secId);
          sections.push({ id: secId, label: sec });
        }
      }
      const agentFields = sliceInputs.map((input, localIdx) => ({
        id: `f_${offset + localIdx}`,
        sectionId: sectionIds.get(input.section.trim()) ?? "main",
        label: input.label,
        type: input.input_type,
        options: (sliceRaw[localIdx]?.options ?? []).slice(0, 350),
        ...(input.format ? { format: input.format } : {}),
      }));
      const signatureSource = JSON.stringify(
        agentFields.map((f) => [f.id, f.sectionId, f.label, f.type, f.options]),
      );
      const formSignature = fnv1aHex(signatureSource);
      const target: AgentTarget = {
        targetId: `file:${fileName}:${offset}`,
        kind: "file",
        destinationKey: `file:${fileName}`,
        generation: "1",
        display: fileName,
        formSignature,
        sections,
        fields: agentFields,
      };
      const asks = await this.inference.describe(target);
      for (const ask of asks.fields) {
        const idx = Number(ask.id.replace(/^f_/, ""));
        if (!Number.isInteger(idx) || idx < 0 || idx >= inputs.length) {
          continue;
        }
        const rawDetail = (ask.attribute ?? ask.what ?? "").trim();
        const explicitNone = rawDetail === "none";
        const detail =
          explicitNone || rawDetail === "unknown" || !rawDetail.includes(".")
            ? ""
            : rawDetail;
        const whose = normalizeWhose(ask.owner ?? ask.whose);
        const format = ask.format?.label?.trim() ?? "";
        if (!detail && !explicitNone && whose === "applicant" && !format) {
          continue;
        }
        out.push({
          index: idx,
          detail,
          whose,
          format,
          explicitNone,
        });
      }
    }
    return out;
  }

  private async describeAndFillRemainingDocx(
    fileName: string,
    docxBytes: Uint8Array,
    profileFields: ReturnType<typeof profileFieldsOf>,
    origDocxBytes?: Uint8Array,
  ): Promise<{
    bytes: Uint8Array;
    filled: number;
    filledFields: FilledFieldSummary[];
    unfilledFields: UnfilledFieldSummary[];
  }> {
    const zip = await new JSZip().loadAsync(docxBytes);
    const docEntry = zip.file("word/document.xml");
    if (docEntry == null) {
      return { bytes: docxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }
    const xml = await docEntry.async("string");
    let origXmlDoc = xml;
    if (origDocxBytes != null) {
      const origZip = await new JSZip().loadAsync(origDocxBytes);
      const origDoc = origZip.file("word/document.xml");
      if (origDoc != null) {
        origXmlDoc = await origDoc.async("string");
      }
    }
    const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const extractText = (fragment: string) => {
      let out = "";
      let m: RegExpExecArray | null;
      textRe.lastIndex = 0;
      while ((m = textRe.exec(fragment)) != null) {
        out += xmlUnescape(m[1]);
      }
      return out.trim();
    };
    const parseRows = (sourceXml: string) => {
      const parsed: {
        start: number;
        end: number;
        xml: string;
        cells: { start: number; end: number; xml: string; text: string }[];
      }[] = [];
      let rm: RegExpExecArray | null;
      rowRe.lastIndex = 0;
      while ((rm = rowRe.exec(sourceXml)) != null) {
        const rXml = rm[0];
        const cells: { start: number; end: number; xml: string; text: string }[] = [];
        let cm: RegExpExecArray | null;
        cellRe.lastIndex = 0;
        while ((cm = cellRe.exec(rXml)) != null) {
          cells.push({
            start: cm.index,
            end: cm.index + cm[0].length,
            xml: cm[0],
            text: extractText(cm[0]),
          });
        }
        parsed.push({ start: rm.index, end: rm.index + rXml.length, xml: rXml, cells });
      }
      return parsed;
    };

    const rows = parseRows(xml);
    const origRows = origXmlDoc === xml ? rows : parseRows(origXmlDoc);

    const candidates: { rowIdx: number; cellIdx: number; label: string }[] = [];
    const seenCells = new Set<string>();
    rows.forEach((row, rIdx) => {
      row.cells.forEach((cell, cIdx) => {
        const origLabel = origRows[rIdx]?.cells[cIdx]?.text ?? cell.text;
        if (!origLabel || origLabel.length > 120) {
          return;
        }
        if (cIdx + 1 < row.cells.length && row.cells[cIdx + 1].text === "") {
          const key = `${rIdx}:${cIdx + 1}`;
          if (!seenCells.has(key)) {
            seenCells.add(key);
            candidates.push({ rowIdx: rIdx, cellIdx: cIdx + 1, label: origLabel });
          }
        } else if (
          rIdx + 1 < rows.length &&
          cIdx < rows[rIdx + 1].cells.length &&
          rows[rIdx + 1].cells[cIdx].text === ""
        ) {
          const key = `${rIdx + 1}:${cIdx}`;
          if (!seenCells.has(key)) {
            seenCells.add(key);
            candidates.push({ rowIdx: rIdx + 1, cellIdx: cIdx, label: origLabel });
          }
        }
      });
    });

    if (candidates.length === 0) {
      return { bytes: docxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }
    const rawFields: PdfFormField[] = candidates.map((c, idx): PdfFormField => ({
      key: `docx_${idx}`,
      name: "",
      tooltip: "",
      label: c.label,
      type: "text",
      maxLength: 0,
      options: [],
    }));
    const inputs = rawFields.map(pdfFieldInput);
    const described = await this.describeFormInputs(fileName, rawFields, inputs);
    if (described.length === 0) {
      return {
        bytes: docxBytes,
        filled: 0,
        filledFields: [],
        unfilledFields: candidates.map((c) => ({ label: c.label })),
      };
    }
    const choices: ChosenField[] = [];
    for (const item of described) {
      if (item.format) {
        inputs[item.index].format ||= item.format;
      }
      const attr =
        item.whose === "official_only"
          ? ""
          : item.whose !== "applicant" && item.whose !== "employer" && !isPersonScopedAttribute(item.detail)
            ? ""
            : item.detail;
      choices.push({ id: inputs[item.index].id, attribute: attr, owner: item.whose });
    }
    const { matches } = fill_fields_from_profile({
      fields: inputs,
      profile: profileFields,
      explicit_fill: true,
      choices,
    });

    const replacements = new Map<string, string>();
    const filledFields: FilledFieldSummary[] = [];
    const unfilledFields: UnfilledFieldSummary[] = [];
    const eaFont = eastAsianFontName();
    matches.forEach((match, idx) => {
      const target = candidates[idx];
      const val = match.value?.trim();
      if (!val) {
        if (match.owner !== "official_only") {
          unfilledFields.push({ label: target.label });
        }
        return;
      }
      const origXml = rows[target.rowIdx].cells[target.cellIdx].xml;
      const hasEastAsian = Array.from(val).some((ch) => (ch.codePointAt(0) ?? 0) >= 0x3000);
      const rPr = hasEastAsian
        ? `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="${eaFont}"/></w:rPr>`
        : "";
      const run = `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(val)}</w:t></w:r>`;
      const injected = origXml.includes("</w:p>")
        ? origXml.replace(/<\/w:p>/, `${run}</w:p>`)
        : origXml.replace(/<\/w:tc>$/, `<w:p>${run}</w:p></w:tc>`);
      replacements.set(`${target.rowIdx}:${target.cellIdx}`, injected);
      filledFields.push({ label: target.label, value: val });
    });
    if (replacements.size === 0) {
      return { bytes: docxBytes, filled: 0, filledFields: [], unfilledFields };
    }

    let rebuilt = "";
    let lastPos = 0;
    rows.forEach((row, rIdx) => {
      rebuilt += xml.slice(lastPos, row.start);
      let rowOut = "";
      let cellLast = 0;
      row.cells.forEach((cell, cIdx) => {
        rowOut += row.xml.slice(cellLast, cell.start);
        rowOut += replacements.get(`${rIdx}:${cIdx}`) ?? cell.xml;
        cellLast = cell.end;
      });
      rowOut += row.xml.slice(cellLast);
      rebuilt += rowOut;
      lastPos = row.end;
    });
    rebuilt += xml.slice(lastPos);
    zip.file("word/document.xml", rebuilt);
    return {
      bytes: await zip.generateAsync({ type: "uint8array" }),
      filled: replacements.size,
      filledFields,
      unfilledFields,
    };
  }

  private async describeAndFillRemainingXlsx(
    fileName: string,
    xlsxBytes: Uint8Array,
    profileFields: ReturnType<typeof profileFieldsOf>,
    origXlsxBytes?: Uint8Array,
  ): Promise<{
    bytes: Uint8Array;
    filled: number;
    filledFields: FilledFieldSummary[];
    unfilledFields: UnfilledFieldSummary[];
  }> {
    const zip = await new JSZip().loadAsync(xlsxBytes);
    const sharedEntry = zip.file("xl/sharedStrings.xml");
    const sharedStrings: string[] = [];
    if (sharedEntry != null) {
      const sXml = (await sharedEntry.async("string")).replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let sm: RegExpExecArray | null;
      while ((sm = siRe.exec(sXml)) != null) {
        let txt = "";
        let tm: RegExpExecArray | null;
        tRe.lastIndex = 0;
        while ((tm = tRe.exec(sm[1])) != null) {
          txt += xmlUnescape(tm[1]);
        }
        sharedStrings.push(txt.trim());
      }
    }

    const shadedStyles = new Set<string>();
    const stylesEntry = zip.file("xl/styles.xml");
    if (stylesEntry != null) {
      const stylesXml = await stylesEntry.async("string");
      const shadedFills = new Set<number>();
      const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>/g;
      let fm: RegExpExecArray | null;
      let fIdx = 0;
      while ((fm = fillRe.exec(stylesXml)) != null) {
        const body = fm[1] ?? "";
        if (body.includes('patternType="solid"')) {
          const rgbMatch = /<fgColor\b[^>]*\brgb="([0-9A-Fa-f]{6,8})"/.exec(body);
          const hex = rgbMatch?.[1]?.toUpperCase() ?? "";
          const rgb6 = hex.length === 8 ? hex.slice(2) : hex;
          if (body.includes('tint="-') || (rgb6 !== "" && rgb6 !== "FFFFFF")) {
            shadedFills.add(fIdx);
          }
        }
        fIdx++;
      }
      const xfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
      if (xfsMatch != null) {
        const xfRe = /<xf\b([^>]*)(?:\/>|>[\s\S]*?<\/xf>)/g;
        let xm: RegExpExecArray | null;
        let sIdx = 0;
        while ((xm = xfRe.exec(xfsMatch[1])) != null) {
          const fidMatch = /\bfillId="(\d+)"/.exec(xm[1] ?? "");
          if (fidMatch != null && shadedFills.has(Number(fidMatch[1]))) {
            shadedStyles.add(String(sIdx));
          }
          sIdx++;
        }
      }
    }

    const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
    if (sheetEntry == null) {
      return { bytes: xlsxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }
    const sheetXml = await sheetEntry.async("string");
    let origSheetXml = sheetXml;
    if (origXlsxBytes != null) {
      const origZip = await new JSZip().loadAsync(origXlsxBytes);
      const origSheet = origZip.file("xl/worksheets/sheet1.xml");
      if (origSheet != null) {
        origSheetXml = await origSheet.async("string");
      }
    }

    const colToIdx = (col: string) => {
      let n = 0;
      for (let i = 0; i < col.length; i++) {
        n = n * 26 + (col.charCodeAt(i) - 64);
      }
      return n;
    };
    const cellRe = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
    const parseSheetCells = (xmlStr: string) => {
      const list: {
        start: number;
        end: number;
        attrs: string;
        col: string;
        colNum: number;
        row: string;
        rowNum: number;
        style: string;
        text: string;
        raw: string;
      }[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(xmlStr)) != null) {
        const attrs = cm[1] ?? "";
        const body = cm[2] ?? "";
        const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs);
        if (refMatch == null) {
          continue;
        }
        const styleMatch = /\bs="(\d+)"/.exec(attrs);
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const valMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        let text = "";
        if (typeMatch?.[1] === "s" && valMatch != null) {
          text = sharedStrings[Number(valMatch[1])] ?? "";
        } else if (inlineMatch != null) {
          text = xmlUnescape(inlineMatch[1]).trim();
        } else if (valMatch != null) {
          text = xmlUnescape(valMatch[1]).trim();
        }
        list.push({
          start: cm.index,
          end: cm.index + cm[0].length,
          attrs,
          col: refMatch[1],
          colNum: colToIdx(refMatch[1]),
          row: refMatch[2],
          rowNum: Number(refMatch[2]),
          style: styleMatch?.[1] ?? "",
          text,
          raw: cm[0],
        });
      }
      return list;
    };

    const cells = parseSheetCells(sheetXml);
    const origCells = origSheetXml === sheetXml ? cells : parseSheetCells(origSheetXml);
    const origLabelMap = new Map<string, string>();
    for (const c of origCells) {
      if (c.text !== "") {
        origLabelMap.set(`${c.colNum}:${c.rowNum}`, c.text);
      }
    }

    type XlsxCandidate =
      | { kind: "cell"; cellIdx: number; label: string }
      | { kind: "drawing"; boxIdx: number; label: string };
    const candidates: XlsxCandidate[] = [];

    for (let i = 0; i < cells.length - 1; i++) {
      const cur = cells[i];
      const next = cells[i + 1];
      const origLabel = origLabelMap.get(`${cur.colNum}:${cur.rowNum}`) ?? "";
      const bothShaded = shadedStyles.has(cur.style) && shadedStyles.has(next.style);
      if (
        !bothShaded &&
        cur.row === next.row &&
        origLabel !== "" &&
        origLabel.length <= 120 &&
        next.text === ""
      ) {
        candidates.push({ kind: "cell", cellIdx: i + 1, label: origLabel });
      }
    }

    const drawingEntry = zip.file("xl/drawings/drawing1.xml");
    let drawingXml = "";
    const drawingBlocks: { start: number; end: number; raw: string }[] = [];
    if (drawingEntry != null) {
      drawingXml = await drawingEntry.async("string");
      const ancRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
      let am: RegExpExecArray | null;
      while ((am = ancRe.exec(drawingXml)) != null) {
        const block = am[0];
        const bIdx = drawingBlocks.length;
        drawingBlocks.push({ start: am.index, end: am.index + block.length, raw: block });
        if (!block.includes("<xdr:sp") || !block.includes("<xdr:txBody>")) {
          continue;
        }
        const isWhite =
          block.includes('txBox="1"') ||
          block.includes('lastClr="FFFFFF"') ||
          block.includes('val="FFFFFF"');
        if (!isWhite) {
          continue;
        }
        let existing = "";
        const atRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = atRe.exec(block)) != null) {
          existing += xmlUnescape(tm[1]);
        }
        if (existing.trim() !== "") {
          continue;
        }
        const fromMatch = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/.exec(
          block,
        );
        if (fromMatch == null) {
          continue;
        }
        const col1 = Number(fromMatch[1]) + 1;
        const row1 = Number(fromMatch[2]) + 1;
        let lbl = origLabelMap.get(`${col1}:${row1}`) ?? "";
        if (!lbl) {
          for (let c = col1; c >= 1; c--) {
            const hit = origLabelMap.get(`${c}:${row1}`);
            if (hit) {
              lbl = hit;
              break;
            }
          }
        }
        if (!lbl && row1 > 1) {
          for (let c = Math.max(1, col1 - 2); c <= col1 + 1; c++) {
            const hit = origLabelMap.get(`${c}:${row1 - 1}`);
            if (hit) {
              lbl = hit;
              break;
            }
          }
        }
        if (lbl && lbl.length <= 120) {
          candidates.push({ kind: "drawing", boxIdx: bIdx, label: lbl });
        }
      }
    }

    if (candidates.length === 0) {
      return { bytes: xlsxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }

    const rawFields: PdfFormField[] = candidates.map((c, idx): PdfFormField => ({
      key: `xlsx_${idx}`,
      name: "",
      tooltip: "",
      label: c.label,
      type: "text",
      maxLength: 0,
      options: [],
    }));
    const inputs = rawFields.map(pdfFieldInput);
    const described = await this.describeFormInputs(fileName, rawFields, inputs);
    if (described.length === 0) {
      return {
        bytes: xlsxBytes,
        filled: 0,
        filledFields: [],
        unfilledFields: candidates.map((c) => ({ label: c.label })),
      };
    }
    const choices: ChosenField[] = [];
    for (const item of described) {
      if (item.format) {
        inputs[item.index].format ||= item.format;
      }
      const attr =
        item.whose === "official_only"
          ? ""
          : item.whose !== "applicant" && item.whose !== "employer" && !isPersonScopedAttribute(item.detail)
            ? ""
            : item.detail;
      choices.push({ id: inputs[item.index].id, attribute: attr, owner: item.whose });
    }
    const { matches } = fill_fields_from_profile({
      fields: inputs,
      profile: profileFields,
      explicit_fill: true,
      choices,
    });

    const cellReplacements = new Map<number, string>();
    const drawingReplacements = new Map<number, string>();
    const filledFields: FilledFieldSummary[] = [];
    const unfilledFields: UnfilledFieldSummary[] = [];
    const eaFont = eastAsianFontName();
    matches.forEach((match, idx) => {
      const cand = candidates[idx];
      const val = match.value?.trim();
      if (!val) {
        if (match.owner !== "official_only") {
          unfilledFields.push({ label: cand.label });
        }
        return;
      }
      if (cand.kind === "cell") {
        const targetCell = cells[cand.cellIdx];
        const cleanAttrs = targetCell.attrs.replace(/\s*\bt="[^"]*"/g, "");
        cellReplacements.set(
          cand.cellIdx,
          `<c${cleanAttrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`,
        );
      } else {
        const block = drawingBlocks[cand.boxIdx].raw;
        const run = `<a:r><a:rPr sz="900"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="${eaFont}"/></a:rPr><a:t>${xmlEscape(val)}</a:t></a:r>`;
        const endParaPos = block.indexOf("<a:endParaRPr");
        const closePPos = block.lastIndexOf("</a:p>");
        if (endParaPos >= 0) {
          drawingReplacements.set(
            cand.boxIdx,
            `${block.slice(0, endParaPos)}${run}${block.slice(endParaPos)}`,
          );
        } else if (closePPos >= 0) {
          drawingReplacements.set(
            cand.boxIdx,
            `${block.slice(0, closePPos)}${run}${block.slice(closePPos)}`,
          );
        }
      }
      filledFields.push({ label: cand.label, value: val });
    });
    const totalReplaced = cellReplacements.size + drawingReplacements.size;
    if (totalReplaced === 0) {
      return { bytes: xlsxBytes, filled: 0, filledFields: [], unfilledFields };
    }

    if (cellReplacements.size > 0) {
      let rebuilt = "";
      let lastPos = 0;
      cells.forEach((cell, idx) => {
        rebuilt += sheetXml.slice(lastPos, cell.start);
        rebuilt += cellReplacements.get(idx) ?? cell.raw;
        lastPos = cell.end;
      });
      rebuilt += sheetXml.slice(lastPos);
      zip.file("xl/worksheets/sheet1.xml", rebuilt);
    }
    if (drawingReplacements.size > 0 && drawingXml !== "") {
      let dRebuilt = "";
      let dLast = 0;
      drawingBlocks.forEach((blk, idx) => {
        dRebuilt += drawingXml.slice(dLast, blk.start);
        dRebuilt += drawingReplacements.get(idx) ?? blk.raw;
        dLast = blk.end;
      });
      dRebuilt += drawingXml.slice(dLast);
      zip.file("xl/drawings/drawing1.xml", dRebuilt);
    }
    return {
      bytes: await zip.generateAsync({ type: "uint8array" }),
      filled: totalReplaced,
      filledFields,
      unfilledFields,
    };
  }

  /** Matching sends field descriptions and held attribute names; values stay in the vault. */
  private async choicesFor(
    fields: ReturnType<typeof pdfFieldInput>[],
    profile: CipherView,
  ): Promise<ChosenField[]> {
    const held = [...(profile_details(profileFieldsOf(profile))?.details?.keys() ?? [])];
    const settings = await ipc.capture.decisionSettings();
    return chooseDetails(fields, held, (r) => this.decide(r as DecisionRequest), settings?.perRequest ?? 0);
  }

  /** Where a file handed over by path, rather than dropped in this window, lives. */
  rememberPath(file: File, path: string): void {
    this.paths.set(file, path);
  }

  private sourcePathOf(file: File): string | undefined {
    const remembered = this.paths.get(file);
    if (remembered) {
      return remembered;
    }
    try {
      return ipc.capture.pathForFile(file) || undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether the PDF contains interactive form fields. */
  isPdfForm(bytes: Uint8Array): boolean {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512 * 1024));
    return head.includes("/AcroForm") || (head.includes("<field") && head.includes("xfa"));
  }

  /** Whether a file's name marks it as a blank form to be filled rather than a source document. */
  isFormFileName(name: string): boolean {
    return /(?:form|todoke|shinsei|tokhai|to[\s_-]*khai|ct01|tk1|bhxh|isa|change|application|declaration|arrival|onboarding|届|申請書|申告書|申込書|届出書)/i.test(
      name,
    );
  }

  /**
   * Classifies a dropped or chosen file from its content and visual layout rather than its filename,
   * returning `"form"`, `"document"`, or `"ambiguous"`.
   */
  async classifyDroppedFile(
    file: File,
    bytes: Uint8Array,
  ): Promise<"form" | "document" | "ambiguous"> {
    if (/\.hwpx$/i.test(file.name)) {
      return "form";
    }
    if (/\.(docx|xlsx)$/i.test(file.name)) {
      return classifyOfficeArchive(file.name, bytes, this.isFormFileName(file.name));
    }
    if (/\.pdf$/i.test(file.name) && this.isPdfForm(bytes)) {
      return "form";
    }
    if (!/\.(?:pdf|png|jpe?g|webp|heic|tiff?)$/i.test(file.name)) {
      return "document";
    }
    if (typeof ipc !== "undefined" && typeof ipc.capture?.classifyFile === "function") {
      try {
        const res = await ipc.capture.classifyFile(bytes, file.name);
        if (res?.kind === "form" || res?.kind === "document" || res?.kind === "ambiguous") {
          return res.kind;
        }
      } catch {
        // Helper classification failure falls back cleanly below.
      }
    }
    return this.isFormFileName(file.name) ? "form" : "document";
  }
}

export function documentProfileActionsFactory(documents: DocumentCaptureService): ProfileDocumentActions {
  return {
    remove: (profileId, sourceId) => documents.deleteDocument(profileId, sourceId),
    move: (profileId, sourceId, destinationId) => documents.moveDocument(profileId, sourceId, destinationId),
    profiles: () => documents.profiles(),
    pending: () => documents.pendingOperations(),
    retry: (id) => documents.retryOperation(id),
    replace: async (profileId, sourceId, file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { captured, unclear } = await documents.read(file, bytes);
      if (unclear != null) {
        throw new Error(UNREADABLE_PHOTO_MESSAGE);
      }
      const result = await documents.replaceDocument(profileId, sourceId, captured, file, bytes);
      if (result == null) {
        throw new Error("No details were found. The original document is unchanged.");
      }
      if (!result.attached) {
        throw new Error("The replacement upload is waiting. Retry it from the quick bar.");
      }
      return result.profile;
    },
  };
}

function validLocator(value: unknown): boolean {
  if (value == null) { return true; }
  if (typeof value !== "object" || Array.isArray(value) || !("kind" in value) || !("page" in value) ||
    !Number.isInteger(value.page) || Number(value.page) < 0) { return false; }
  if (value.kind === "page") {
    if (!("x" in value && "y" in value && "w" in value && "h" in value)) { return false; }
    return [value.x, value.y, value.w, value.h].every((coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1) &&
      Number(value.x) + Number(value.w) <= 1.000001 && Number(value.y) + Number(value.h) <= 1.000001;
  }
  return value.kind === "cell" && "row" in value && "column" in value &&
    Number.isInteger(value.row) && Number(value.row) >= 0 && Number.isInteger(value.column) && Number(value.column) >= 0 &&
    (!("a1" in value) || value.a1 == null || typeof value.a1 === "string") &&
    (!("table" in value) || value.table == null || Number.isInteger(value.table) && Number(value.table) >= 0);
}

function parseDocumentOperation(value: unknown): DocumentOperation {
  const unreadable = new Error("The document operation is unreadable. Its saved data has been kept.");
  if (value == null || typeof value !== "object" || Array.isArray(value)) { throw unreadable; }
  // The journal is encrypted; still validate its complete consumed shape before dispatching it.
  const operation = value as DocumentOperation;
  if (operation.v !== 1 || !["capture", "move", "delete"].includes(operation.kind) ||
    ![operation.intentId, operation.cipherId, operation.sourceId].every((id) => typeof id === "string" && !!id) ||
    operation.uploaded != null && typeof operation.uploaded !== "boolean" ||
    operation.created != null && typeof operation.created !== "boolean" ||
    operation.replaceSourceId != null && typeof operation.replaceSourceId !== "string") { throw unreadable; }
  if (operation.kind !== "delete") {
    const source = operation.source;
    if (source == null || typeof source !== "object" ||
      ![source.fileName, source.mediaType, source.kind].every((entry) => typeof entry === "string") ||
      ![source.documentDate, source.effectiveOn, source.expiresOn].every((date) =>
        date == null || typeof date === "string") ||
      source.sides != null && (!Array.isArray(source.sides) || !source.sides.every((side) => typeof side === "string"))) { throw unreadable; }
  }
  if (operation.kind === "capture" && (typeof operation.bytes !== "string" ||
    typeof operation.capturedAt !== "string" || !Number.isFinite(Date.parse(operation.capturedAt)) ||
    !Array.isArray(operation.values) || !operation.values.every((entry) => entry != null && typeof entry === "object" &&
      typeof entry.key === "string" && typeof entry.value === "string" && typeof entry.verified === "boolean" &&
      ["mrz", "barcode", "ocr", "chip", "text", "typed", "correction", "derived", "import"].includes(entry.origin) &&
      validLocator(entry.locator)))) { throw unreadable; }
  if (operation.kind === "move" && (![operation.originCipherId, operation.originSourceId].every((id) =>
    typeof id === "string" && !!id))) { throw unreadable; }
  for (const key of ["create", "upload"] as const) {
    const payload = operation[key];
    if (payload != null && (typeof payload !== "object" || typeof payload.localId !== "string" ||
      typeof payload.hash !== "string" || !/^[a-f0-9]{64}$/.test(payload.hash) ||
      payload.body == null || typeof payload.body !== "object" || Array.isArray(payload.body))) { throw unreadable; }
  }
  if (operation.upload != null && (typeof operation.upload.contents !== "string" ||
    typeof operation.upload.body.key !== "string" || typeof operation.upload.body.fileName !== "string" ||
    typeof operation.upload.body.bytesChecksum !== "string" ||
    !Number.isInteger(operation.upload.body.fileSize) || Number(operation.upload.body.fileSize) < 0)) { throw unreadable; }
  if (operation.allocation != null && (typeof operation.allocation !== "object" ||
    typeof operation.allocation.attachmentId !== "string" || typeof operation.allocation.uploadUrl !== "string")) { throw unreadable; }
  if (operation.uploaded && (operation.upload == null || operation.allocation == null)) { throw unreadable; }
  return operation;
}

/** What the engine needs to know about a PDF field: the words that name it, as a person reads them. */
function pdfFieldInput(field: PdfFormField) {
  const words = [field.tooltip, field.label, field.name]
    .map((word) => word.trim())
    .filter((word) => word !== "" && !OPAQUE_NAME.test(word));
  return {
    id: field.name || field.key,
    name: field.name,
    label: [...new Set(words)].join(" — ") || field.label || field.name,
    placeholder: "",
    autocomplete: "",
    input_type:
      field.type === "select-one"
        ? "select-one"
        : field.type === "checkbox"
          ? "checkbox"
          : "text",
    section: field.section?.trim() ?? "",
    form: "",
    pattern: "",
    max_length: Math.max(0, field.maxLength),
    format: "",
    op_ignore: false,
  };
}

const PERSON_SCOPED_PREFIXES = [
  "name.",
  "birth.",
  "person.",
  "id.",
  "visa.",
  "address.",
  "contact.",
];

function isPersonScopedAttribute(detail: string): boolean {
  return PERSON_SCOPED_PREFIXES.some((prefix) => detail.startsWith(prefix));
}

const OPTION_EQUIVALENCE_GROUPS: string[][] = [
  ["f", "female", "女", "女性", "nữ", "nu", "féminin", "feminin", "weiblich", "femenino", "femmina"],
  ["m", "male", "男", "男性", "nam", "masculin", "männlich", "masculino", "maschio"],
  ["yes", "true", "1", "有", "あり", "có", "ja", "oui", "sí", "si"],
  ["no", "false", "0", "無", "なし", "không", "khong", "nein", "non"],
  ["married", "既婚", "配偶者あり", "verheiratet", "marié", "mariée", "casado", "casada", "đã kết hôn"],
  ["single", "unmarried", "未婚", "独身", "配偶者なし", "ledig", "célibataire", "soltero", "soltera", "độc thân"],
  ["vnm", "vn", "vietnam", "viet nam", "việt nam", "ベトナム", "越南"],
  ["jpn", "jp", "japan", "nippon", "japon", "日本", "日本国"],
  ["usa", "us", "united states", "united states of america", "états-unis", "etats-unis", "estados unidos", "アメリカ", "米国", "アメリカ合衆国"],
  ["kor", "kr", "korea", "south korea", "republic of korea", "corée", "coree", "韓国", "大韓民国", "대한민국"],
  ["chn", "cn", "china", "chine", "中国", "中華人民共和国"],
  ["twn", "tw", "taiwan", "taïwan", "台湾"],
  ["hkg", "hk", "hong kong", "香港"],
  ["sgp", "sg", "singapore", "singapour", "シンガポール"],
  ["tha", "th", "thailand", "thaïlande", "thailande", "タイ"],
  ["idn", "id", "indonesia", "indonésie", "indonesie", "インドネシア"],
  ["phl", "ph", "philippines", "フィリピン"],
  ["ind", "in", "india", "inde", "インド"],
  ["aus", "au", "australia", "australie", "オーストラリア"],
  ["can", "ca", "canada", "カナダ"],
  ["gbr", "gb", "uk", "united kingdom", "great britain", "royaume-uni", "イギリス", "英国"],
  ["deu", "de", "germany", "deutschland", "deutsch", "german", "allemagne", "alemania", "ドイツ"],
  ["fra", "fr", "france", "frankreich", "francia", "フランス"],
  ["bra", "br", "brazil", "brasil", "brésil", "bresil", "ブラジル"],
  ["esp", "es", "spain", "españa", "espana", "espagne", "spanien", "スペイン"],
  ["ita", "it", "italy", "italia", "italie", "italien", "イタリア"],
  ["nld", "nl", "netherlands", "nederland", "pays-bas", "niederlande", "オランダ"],
  ["che", "ch", "switzerland", "schweiz", "suisse", "svizzera", "スイス"],
];

export function resolveSelectOption(value: string, options: string[]): string | undefined {
  const norm = value.trim().toLowerCase();
  if (!norm || options.length === 0) {
    return undefined;
  }
  const exact = options.find((opt) => opt.trim().toLowerCase() === norm);
  if (exact != null) {
    return exact;
  }
  for (const group of OPTION_EQUIVALENCE_GROUPS) {
    if (group.includes(norm)) {
      const matched = options.find((opt) => {
        const clean = opt.trim().toLowerCase();
        if (group.includes(clean)) {
          return true;
        }
        // Check multi-word synonyms first (e.g. "viet nam", "united states", "royaume-uni")
        if (group.some((syn) => syn.length >= 4 && syn.includes(" ") && clean === syn)) {
          return true;
        }
        const tokens = clean.split(/[\s\-–—/()（）\[\]:,・]+/).filter(Boolean);
        // Never match 1- or 2-letter ISO codes inside multi-word options (e.g. French "REPUBLIQUE DE", "AFRIQUE DU")
        return (
          tokens.length <= 4 &&
          tokens.some((tok) => (tokens.length === 1 || tok.length >= 4) && group.includes(tok))
        );
      });
      if (matched != null) {
        return matched;
      }
    }
  }
  if (norm.length >= 3) {
    return options.find((opt) => {
      const clean = opt.trim().toLowerCase();
      return clean.startsWith(`${norm} `) || clean.endsWith(`(${norm})`);
    });
  }
  return undefined;
}

function matchesCheckboxChoice(value: string, field: PdfFormField): boolean {
  const norm = value.trim().toLowerCase();
  if (norm === "true" || norm === "1" || norm === "yes") {
    return true;
  }
  const labels = [field.label, field.tooltip, field.name]
    .map((s) => s.trim())
    .filter((s) => s !== "" && !OPAQUE_NAME.test(s));
  return resolveSelectOption(value, labels) != null;
}

function normalizeWhose(raw: string | undefined): string {
  const clean = (raw ?? "").trim().toLowerCase();
  if (
    clean === "" ||
    clean === "self" ||
    clean === "applicant" ||
    clean === "holder" ||
    clean === "person" ||
    clean === "user"
  ) {
    return "applicant";
  }
  if (clean === "company" || clean === "organization") {
    return "employer";
  }
  if (clean === "agent" || clean === "representative" || clean === "legal_representative") {
    return "preparer";
  }
  if (clean === "office" || clean === "official" || clean === "for_official_use") {
    return "official_only";
  }
  return clean;
}

function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((code >>> 8) | ((code & 0xff) << 8)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function eastAsianFontName(): string {
  if (typeof navigator !== "undefined" && !/Mac/i.test(navigator.platform ?? "")) {
    return "Microsoft YaHei";
  }
  return "Hiragino Sans";
}

interface OfficePiece {
  text: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  confidence?: number;
  locator?: {
    kind: "cell";
    page: number;
    row: number;
    column: number;
    a1?: string;
    table?: number;
  };
}

export async function extractOfficePieces(fileName: string, bytes: Uint8Array): Promise<string> {
  const sdkExtract = (
    sdk as unknown as { extract_office_pieces?: (b: Uint8Array, n: string) => string }
  ).extract_office_pieces;
  if (typeof sdkExtract === "function") {
    try {
      const out = sdkExtract(bytes, fileName);
      if (out && out !== "{}") {
        return out;
      }
    } catch {
      // Fall through to JSZip XML extractor.
    }
  }

  const zip = await new JSZip().loadAsync(bytes);
  if (/\.docx$/i.test(fileName)) {
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      return JSON.stringify({ pages: [] });
    }
    const xml = await docEntry.async("string");
    const pieces: OfficePiece[] = [];
    const blockRe = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const readXmlText = (fragment: string): string => {
      let acc = "";
      let m: RegExpExecArray | null;
      textRe.lastIndex = 0;
      while ((m = textRe.exec(fragment)) != null) {
        acc += xmlUnescape(m[1]);
      }
      return acc.replace(/\s+/g, " ").trim();
    };
    let bm: RegExpExecArray | null;
    let tableIndex = 0;
    let syntheticRow = 0;
    while ((bm = blockRe.exec(xml)) != null) {
      const block = bm[0];
      if (block.startsWith("<w:tbl")) {
        let rm: RegExpExecArray | null;
        rowRe.lastIndex = 0;
        let rowIdx = 0;
        while ((rm = rowRe.exec(block)) != null) {
          const cells: string[] = [];
          let cm: RegExpExecArray | null;
          cellRe.lastIndex = 0;
          while ((cm = cellRe.exec(rm[0])) != null) {
            cells.push(readXmlText(cm[0]));
          }
          const colCount = Math.max(cells.length, 1);
          cells.forEach((cellText, colIdx) => {
            if (!cellText) {
              return;
            }
            const x = Math.min(0.95, colIdx / colCount);
            const y = Math.min(0.95, syntheticRow * 0.025);
            pieces.push({
              text: cellText,
              x,
              y,
              w: Math.min(1 - x, 1 / colCount),
              h: 0.02,
              confidence: 1,
              locator: {
                kind: "cell",
                page: 0,
                table: tableIndex,
                row: rowIdx,
                column: colIdx,
              },
            });
          });
          rowIdx++;
          syntheticRow++;
        }
        tableIndex++;
      } else {
        const text = readXmlText(block);
        if (text) {
          const y = Math.min(0.95, syntheticRow * 0.025);
          pieces.push({
            text,
            x: 0.05,
            y,
            w: 0.9,
            h: 0.02,
            confidence: 1,
          });
          syntheticRow++;
        }
      }
    }
    return JSON.stringify({ pages: [{ index: 0, pieces }] });
  }

  // .xlsx
  const sharedStrings: string[] = [];
  const sharedEntry = zip.file("xl/sharedStrings.xml");
  if (sharedEntry) {
    const sXml = (await sharedEntry.async("string")).replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let sm: RegExpExecArray | null;
    while ((sm = siRe.exec(sXml)) != null) {
      let txt = "";
      let tm: RegExpExecArray | null;
      tRe.lastIndex = 0;
      while ((tm = tRe.exec(sm[1])) != null) {
        txt += xmlUnescape(tm[1]);
      }
      sharedStrings.push(txt.trim());
    }
  }
  const sheetNames = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(/sheet(\d+)\.xml/i.exec(a)?.[1] ?? 0);
      const nb = Number(/sheet(\d+)\.xml/i.exec(b)?.[1] ?? 0);
      return na - nb;
    });
  const colToIndex = (col: string): number => {
    let n = 0;
    for (let i = 0; i < col.length; i++) {
      n = n * 26 + (col.charCodeAt(i) - 64);
    }
    return Math.max(0, n - 1);
  };
  const pages: { index: number; pieces: OfficePiece[] }[] = [];
  const cellRe = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
  for (let sheetIdx = 0; sheetIdx < sheetNames.length; sheetIdx++) {
    const entry = zip.file(sheetNames[sheetIdx]);
    if (!entry) {
      continue;
    }
    const xml = await entry.async("string");
    const pieces: OfficePiece[] = [];
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(xml)) != null) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs);
      if (!refMatch) {
        continue;
      }
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const valMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
      let text = "";
      if (typeMatch?.[1] === "s" && valMatch != null) {
        text = sharedStrings[Number(valMatch[1])] ?? "";
      } else if (inlineMatch != null) {
        text = xmlUnescape(inlineMatch[1]).trim();
      } else if (valMatch != null) {
        text = xmlUnescape(valMatch[1]).trim();
      }
      if (!text) {
        continue;
      }
      const colZero = colToIndex(refMatch[1]);
      const rowZero = Math.max(0, Number(refMatch[2]) - 1);
      const x = Math.min(0.92, colZero * 0.12);
      const y = Math.min(0.95, rowZero * 0.025);
      pieces.push({
        text,
        x,
        y,
        w: Math.min(1 - x, 0.11),
        h: 0.02,
        confidence: 1,
        locator: {
          kind: "cell",
          page: sheetIdx,
          row: rowZero,
          column: colZero,
          a1: `${refMatch[1]}${refMatch[2]}`,
        },
      });
    }
    pages.push({ index: sheetIdx, pieces });
  }
  return JSON.stringify({ pages });
}

function officePiecesToPlainText(reading: string): string {
  try {
    const pages = (JSON.parse(reading).pages ?? []) as { pieces?: OfficePiece[] }[];
    const lines: string[] = [];
    for (const page of pages) {
      let currentRowKey = "";
      let rowTokens: string[] = [];
      for (const piece of page.pieces ?? []) {
        const loc = piece.locator;
        const rowKey = loc ? `${loc.page}:${loc.table ?? -1}:${loc.row}` : `p:${lines.length}:${rowTokens.length}`;
        if (loc && rowKey === currentRowKey) {
          rowTokens.push(piece.text);
        } else {
          if (rowTokens.length > 0) {
            lines.push(rowTokens.join("\t"));
          }
          currentRowKey = loc ? rowKey : "";
          rowTokens = [piece.text];
        }
      }
      if (rowTokens.length > 0) {
        lines.push(rowTokens.join("\t"));
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function classifyOfficeArchive(
  fileName: string,
  bytes: Uint8Array,
  nameLooksLikeForm: boolean,
): Promise<"form" | "document" | "ambiguous"> {
  const sdkClassify = (
    sdk as unknown as { classify_office_bytes?: (b: Uint8Array, n: string) => string }
  ).classify_office_bytes;
  if (typeof sdkClassify === "function") {
    try {
      const raw = sdkClassify(bytes, fileName);
      const parsedKind = raw.trim().startsWith("{")
        ? (JSON.parse(raw) as { kind?: string }).kind
        : raw;
      if (parsedKind === "form" || parsedKind === "document" || parsedKind === "ambiguous") {
        return parsedKind;
      }
    } catch {
      // Fall through to JSZip inspection.
    }
  }

  let zip: JSZip;
  try {
    zip = await new JSZip().loadAsync(bytes);
  } catch {
    return "form";
  }

  let emptySlots = 0;
  let populatedPairs = 0;
  let proseBlocks = 0;

  if (/\.docx$/i.test(fileName)) {
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      return "form";
    }
    const xml = await docEntry.async("string");
    const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const getText = (frag: string) => {
      let s = "";
      let m: RegExpExecArray | null;
      textRe.lastIndex = 0;
      while ((m = textRe.exec(frag)) != null) {
        s += xmlUnescape(m[1]);
      }
      return s.replace(/\s+/g, " ").trim();
    };
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(xml)) != null) {
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rm[0])) != null) {
        cells.push(getText(cm[0]));
      }
      for (let i = 0; i < cells.length; i++) {
        const cur = cells[i];
        if (!cur) {
          continue;
        }
        if (/_{3,}|□|\[\s{2,}\]/.test(cur)) {
          emptySlots++;
        }
        if (i + 1 < cells.length) {
          if (cells[i + 1] === "") {
            emptySlots++;
          } else if (cur.length <= 60) {
            populatedPairs++;
          }
        }
      }
    }
    const withoutTables = xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, "");
    const pRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(withoutTables)) != null) {
      const txt = getText(pm[0]);
      if (/_{4,}|□|\[\s{2,}\]/.test(txt)) {
        emptySlots++;
      } else if (txt.length >= 60 || /[:：]\s*\S+/.test(txt)) {
        proseBlocks++;
      }
    }
  } else {
    const sharedStrings: string[] = [];
    const sharedEntry = zip.file("xl/sharedStrings.xml");
    if (sharedEntry) {
      const sXml = (await sharedEntry.async("string")).replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let sm: RegExpExecArray | null;
      while ((sm = siRe.exec(sXml)) != null) {
        let txt = "";
        let tm: RegExpExecArray | null;
        tRe.lastIndex = 0;
        while ((tm = tRe.exec(sm[1])) != null) {
          txt += xmlUnescape(tm[1]);
        }
        sharedStrings.push(txt.trim());
      }
    }
    const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
    if (!sheetEntry) {
      return "form";
    }
    const xml = await sheetEntry.async("string");
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    const cellRe = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rowRe.exec(xml)) != null) {
      const rowCells: { col: string; text: string }[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rMatch[1])) != null) {
        const attrs = cm[1] ?? "";
        const body = cm[2] ?? "";
        const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs);
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const valMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        let text = "";
        if (typeMatch?.[1] === "s" && valMatch != null) {
          text = sharedStrings[Number(valMatch[1])] ?? "";
        } else if (inlineMatch != null) {
          text = xmlUnescape(inlineMatch[1]).trim();
        } else if (valMatch != null) {
          text = xmlUnescape(valMatch[1]).trim();
        }
        rowCells.push({ col: refMatch?.[1] ?? "", text });
      }
      for (let i = 0; i < rowCells.length; i++) {
        const cur = rowCells[i].text;
        if (!cur) {
          continue;
        }
        if (/_{3,}|□/.test(cur)) {
          emptySlots++;
        }
        if (i + 1 < rowCells.length) {
          if (rowCells[i + 1].text === "") {
            emptySlots++;
          } else {
            populatedPairs++;
          }
        }
      }
    }
  }

  const docSignals = populatedPairs + proseBlocks * 2;
  if (emptySlots > 0 && (nameLooksLikeForm || emptySlots >= docSignals)) {
    return "form";
  }
  if (docSignals >= 2 && emptySlots === 0) {
    return "document";
  }
  if (emptySlots > 0 && docSignals >= 2) {
    return "ambiguous";
  }
  return nameLooksLikeForm ? "form" : emptySlots > 0 ? "form" : docSignals > 0 ? "document" : "form";
}
