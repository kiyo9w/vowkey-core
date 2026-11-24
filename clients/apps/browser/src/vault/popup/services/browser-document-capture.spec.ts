import { webcrypto } from "node:crypto";

import { of } from "rxjs";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import {
  DocumentCaptureError,
  ProductInference,
  ReadingServiceUnavailableError,
} from "@vowkey/common/vault/local/product-inference";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import * as sdk from "@vowkey/sdk-internal";

import { captureAndSaveBrowserDocument } from "./browser-document-capture";

jest.mock("@vowkey/common/platform/abstractions/sdk/sdk-load.service", () => ({
  SdkLoadService: { Ready: Promise.resolve() },
}));

jest.mock("pdfjs-dist", () => ({ getDocument: jest.fn() }));
jest.mock("pdfjs-dist/webpack.mjs", () => ({}));

jest.mock("@vowkey/sdk-internal", () => ({
  detail_label: (key: string) => `label:${key}`,
  decode_document_barcode: jest.fn(),
  capture_document_text: jest.fn(),
}));

const PHOTO = "id-card.jpg";
const BYTES = new Uint8Array([1, 2, 3]);

function file(name = PHOTO, type = "image/jpeg"): File {
  return {
    name,
    type,
    arrayBuffer: async () => Uint8Array.from(BYTES).buffer,
  } as unknown as File;
}

function inference(mode: "local" | "masked" | "cloud_vision"): jest.Mocked<ProductInference> {
  return {
    getPrivacyMode: jest.fn(() => mode),
    readDocumentVision: jest.fn(),
  } as unknown as jest.Mocked<ProductInference>;
}

function localVault(deps: { saved: Array<{ id: string; fileName: string; bytes: Uint8Array }> }) {
  return {
    initialize: jest.fn(async () => {}),
    ensureUnlocked: jest.fn(async () => {}),
    save: jest.fn(async (view: CipherView, attachments: typeof deps.saved = []) => {
      deps.saved.push(...attachments);
      view.id ||= "cipher-1";
      return view;
    }),
  };
}

const noAccount = { activeAccount$: of(null) } as unknown as AccountService;

describe("captureAndSaveBrowserDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (sdk.capture_document_text as jest.Mock).mockReturnValue({
      details: new Map(),
      sources: new Map(),
    });
  });

  it("reads a photo through the hosted reader, keeping the box the reader placed", async () => {
    (sdk.decode_document_barcode as jest.Mock).mockImplementation(() => {
      throw new Error("no barcode");
    });
    const reader = inference("masked");
    reader.readDocumentVision.mockResolvedValue({
      details: { "id.passport.number": "C9481023" },
      kind: "passport",
      locators: { "id.passport.number": { page: 0, x: 0.11, y: 0.2, w: 0.3, h: 0.05 } },
    });
    const vault = localVault({ saved: [] });

    const result = await captureAndSaveBrowserDocument(file(), {
      accountService: noAccount,
      localVaultService: vault as never,
      productInference: reader,
    });

    expect(reader.readDocumentVision).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/jpeg;base64,/),
      PHOTO,
    );
    const envelope = readEnvelope(result.cipher)!;
    const detail = envelope.details.find((item) => item.attribute === "id.passport.number")!;
    const variant = detail.variants.find((item) => item.current)!;
    expect(variant.value).toBe("C9481023");
    expect(variant.origin).toBe("ocr");
    expect(variant.locator).toEqual({ kind: "page", page: 0, x: 0.11, y: 0.2, w: 0.3, h: 0.05 });
    expect(envelope.sources).toHaveLength(1);
    expect(variant.sourceId).toBe(envelope.sources[0].id);
    expect(envelope.sources[0].fileName).toBe(PHOTO);
    expect(vault.save).toHaveBeenCalledTimes(1);
    expect(vault.save.mock.calls[0][1]).toEqual([
      expect.objectContaining({ id: envelope.sources[0].attachmentId, fileName: PHOTO, bytes: BYTES }),
    ]);
    expect(envelope.sources[0].attachmentId).not.toBeNull();
  });

  it("keeps the barcode fast path and never calls the hosted reader", async () => {
    (sdk.decode_document_barcode as jest.Mock).mockReturnValue({ text: "SPECI2014" });
    (sdk.capture_document_text as jest.Mock).mockReturnValue({
      details: new Map([["id.passport.number", "SPECI2014"]]),
      sources: new Map(),
    });
    const reader = inference("masked");
    const vault = localVault({ saved: [] });

    const result = await captureAndSaveBrowserDocument(file(), {
      accountService: noAccount,
      localVaultService: vault as never,
      productInference: reader,
    });

    expect(reader.readDocumentVision).not.toHaveBeenCalled();
    expect(result.readCount).toBe(1);
    expect(readEnvelope(result.cipher)!.sources[0].attachmentId).not.toBeNull();
  });

  it("refuses a photo on device-only mode without any network call", async () => {
    (sdk.decode_document_barcode as jest.Mock).mockImplementation(() => {
      throw new Error("no barcode");
    });
    const reader = inference("local");
    const vault = localVault({ saved: [] });

    await expect(
      captureAndSaveBrowserDocument(file(), {
        accountService: noAccount,
        localVaultService: vault as never,
        productInference: reader,
      }),
    ).rejects.toMatchObject({ i18nKey: "vkDocumentPhotoUnsupported" });
    expect(reader.readDocumentVision).not.toHaveBeenCalled();
    expect(vault.save).not.toHaveBeenCalled();
  });

  it("keeps the reader's answer when no reader is configured out of the saved item", async () => {
    (sdk.decode_document_barcode as jest.Mock).mockImplementation(() => {
      throw new Error("no barcode");
    });
    const vault = localVault({ saved: [] });

    await expect(
      captureAndSaveBrowserDocument(file(), { accountService: noAccount, localVaultService: vault as never }),
    ).rejects.toBeInstanceOf(DocumentCaptureError);
    expect(vault.save).not.toHaveBeenCalled();
  });

  it("reports a reader that failed instead of saving an empty item", async () => {
    (sdk.decode_document_barcode as jest.Mock).mockImplementation(() => {
      throw new Error("no barcode");
    });
    const reader = inference("cloud_vision");
    reader.readDocumentVision.mockRejectedValue(new ReadingServiceUnavailableError(502));
    const vault = localVault({ saved: [] });

    const failure = captureAndSaveBrowserDocument(file(), {
      accountService: noAccount,
      localVaultService: vault as never,
      productInference: reader,
    });
    await expect(failure).rejects.toMatchObject({ i18nKey: "vkDocumentReadFailed" });
    await expect(failure).rejects.toMatchObject({ reason: expect.any(ReadingServiceUnavailableError) });
    expect(vault.save).not.toHaveBeenCalled();
  });
});
