import { getDocument } from "pdfjs-dist";
import "pdfjs-dist/webpack.mjs";
import { firstValueFrom } from "rxjs";

import * as sdkInternal from "@vowkey/sdk-internal";
import {
  capture_document_text,
  CapturedDocument,
  decode_document_barcode,
  detail_label,
  Locator as SdkLocator,
} from "@vowkey/sdk-internal";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ProductInference } from "@vowkey/common/vault/local/product-inference";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import {
  applyProjection,
  CapturedValue,
  Locator,
  migrateLegacyProfile,
  projectEnvelope,
  recordCapture,
  VariantOrigin,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";

export interface BrowserDocumentSaveResult {
  cipher: CipherView;
  readCount: number;
  savedLocally: boolean;
}

export async function captureAndSaveBrowserDocument(
  file: File,
  deps: {
    cipherService?: CipherService;
    accountService?: AccountService;
    localVaultService?: LocalVaultService;
    productInference?: ProductInference;
  },
): Promise<BrowserDocumentSaveResult> {
  await SdkLoadService.Ready;
  const bytes = await readFileBytes(file);
  const captured = await captureDocumentBytes(file, bytes, deps.productInference);
  const read = new Map(
    [...captured.details].filter(([key]) => captured.sources.get(key)?.kind !== "derived"),
  );

  const profile = buildProfileFromRead(read, file);
  const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
  const previous = [...projectEnvelope(meta).text.keys()];
  const sourceId = crypto.randomUUID();
  const values: CapturedValue[] = [...read].map(([key, value]) => {
    const src = captured.sources.get(key);
    return {
      key,
      value,
      origin: mapCaptureOrigin(src?.kind),
      verified: src?.verified ?? false,
      locator: mapSdkLocator(src?.locator),
    };
  });
  let firstId = true;
  recordCapture(
    meta,
    {
      fileName: file.name,
      mediaType: mediaTypeForDocument(file),
      kind: "document",
      documentDate: statedDateFromRead(read, ".issued"),
      expiresOn: statedDateFromRead(read, ".expiry"),
    },
    values,
    {
      labelOf: detail_label,
      newId: () => {
        if (firstId) {
          firstId = false;
          return sourceId;
        }
        return crypto.randomUUID();
      },
    },
  );
  writeEnvelope(profile, meta);
  applyProjection(profile, projectEnvelope(meta), previous);

  const activeAccount = deps.accountService?.activeAccount$
    ? await firstValueFrom(deps.accountService.activeAccount$)
    : null;
  const userId = (activeAccount?.id as UserId | undefined) ?? null;

  if (userId != null && deps.cipherService != null) {
    const saved = await deps.cipherService.createWithServer(profile, userId);
    return { cipher: saved, readCount: read.size, savedLocally: false };
  }

  if (deps.localVaultService != null) {
    await deps.localVaultService.initialize();
    await deps.localVaultService.ensureUnlocked();
    profile.id ||= crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const saved = await deps.localVaultService.save(profile, [
      { id: attachmentId, fileName: file.name, bytes },
    ]);
    return { cipher: saved, readCount: read.size, savedLocally: true };
  }

  throw new Error("Vault is unavailable.");
}

async function captureDocumentBytes(
  file: File,
  bytes: Uint8Array,
  productInference?: ProductInference,
): Promise<CapturedDocument> {
  const year = new Date().getFullYear();
  const lower = file.name.toLowerCase();
  if (/\.(png|jpe?g|webp|bmp)$/i.test(lower)) {
    if (typeof decode_document_barcode === "function") {
      try {
        const decoded = decode_document_barcode(bytes);
        if (decoded?.text?.trim()) {
          const captured = capture_document_text(decoded.text, year);
          if (captured.details.size > 0) {
            return captured;
          }
        }
      } catch {
        // Image does not carry a machine-readable barcode.
      }
    }
    if (productInference && typeof (productInference as any).readDocumentImage === "function") {
      try {
        const inferred = await (productInference as any).readDocumentImage(bytes, file.type);
        if (inferred?.details?.size > 0) {
          return inferred;
        }
      } catch {
        // Offline or cloud vision disabled.
      }
    }
    return { details: new Map(), sources: new Map() };
  }
  const extractOfficeFn = (sdkInternal as Record<string, unknown>).extract_office_pieces;
  const text = lower.endsWith(".pdf")
    ? await extractPdfText(bytes)
    : /\.(docx|xlsx)$/i.test(lower) && typeof extractOfficeFn === "function"
      ? (() => {
          try {
            const raw = (extractOfficeFn as (b: Uint8Array, name: string) => string)(
              bytes,
              file.name,
            );
            const parsed = JSON.parse(raw) as { text?: string };
            return parsed.text ?? "";
          } catch {
            return "";
          }
        })()
      : new TextDecoder().decode(bytes);
  if (!text.trim()) {
    return { details: new Map(), sources: new Map() };
  }
  return capture_document_text(text, year);
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const resources = new URL("pdfjs/", document.baseURI).href;
  const loading = getDocument({
    data: bytes.slice(),
    cMapUrl: `${resources}cmaps/`,
    standardFontDataUrl: `${resources}standard_fonts/`,
    wasmUrl: `${resources}wasm/`,
    iccUrl: `${resources}iccs/`,
  });
  const pdf = await loading.promise;
  try {
    const pages: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      if (line) {
        pages.push(line);
      }
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await loading.destroy();
  }
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsArrayBuffer(file);
  });
}

function mediaTypeForDocument(file: File): string {
  if (file.type) {
    return file.type;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "text/plain";
}

function buildProfileFromRead(read: Map<string, string>, file: File): CipherView {
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

function statedDateFromRead(read: Map<string, string>, suffix: string): string | null {
  for (const [key, value] of read) {
    if (key.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function mapCaptureOrigin(kind: string | undefined): VariantOrigin {
  if (
    kind === "mrz" ||
    kind === "barcode" ||
    kind === "ocr" ||
    kind === "chip" ||
    kind === "text"
  ) {
    return kind;
  }
  return "ocr";
}

function mapSdkLocator(locator: SdkLocator | undefined): Locator | null {
  if (!locator) {
    return null;
  }
  if (locator.kind === "page") {
    return {
      kind: "page",
      page: locator.page,
      x: locator.x,
      y: locator.y,
      w: locator.w,
      h: locator.h,
    };
  }
  if (locator.kind === "cell") {
    return {
      kind: "cell",
      page: locator.page,
      row: locator.row,
      column: locator.column,
      a1: locator.a1 ?? null,
      table: locator.table ?? null,
    };
  }
  return null;
}
