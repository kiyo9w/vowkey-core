import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { applyProfileFields, profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";

import { PdfFormField } from "../../capture/types/capture";
import {
  capture_document_text,
  decode_document_barcode,
  detail_label,
  fill_docx_with_profile,
  fill_fields_from_profile,
  fill_hwpx_with_profile,
  fill_xlsx_with_profile,
  profile_details,
  profile_stored_details,
  update_profile,
} from "@vowkey/sdk-internal";

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
const OPAQUE_NAME = /^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$/i;

/** Reads documents into profiles, and fills forms from them. */
@Injectable({ providedIn: "root" })
export class DocumentCaptureService {
  private accountService = inject(AccountService);
  private cipherService = inject(CipherService);
  private paths = new WeakMap<File, string>();

  /** The people whose details the vault holds: its Identity items. */
  async profiles(): Promise<CipherView[]> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const ciphers = await this.cipherService.getAllDecrypted(userId);
    return ciphers.filter((c) => c.type === CipherType.Identity && !c.deletedDate);
  }

  /** The details a profile holds, as they were saved. */
  detailsOf(profile: CipherView): Map<string, string> {
    return profile_stored_details(profileFieldsOf(profile)).details;
  }

  /** The text of a document: what this computer reads from a PDF or a photo, or a plain file's. */
  async readText(file: File, bytes: Uint8Array): Promise<string> {
    if (TEXT_FILE.test(file.name)) {
      return new TextDecoder().decode(bytes);
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

  /** Adds what a document says to the profile it belongs to, or to a new one. */
  async add(text: string, file: File, bytes: Uint8Array): Promise<DocumentAdded | null> {
    const captured = capture_document_text(text, new Date().getFullYear());
    const read = new Map(
      [...captured.details].filter(([key]) => captured.sources.get(key)?.kind !== "derived"),
    );
    if (read.size === 0) {
      return null;
    }

    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const profiles = await this.profiles();
    const existing = profiles.find((p) => isSamePerson(this.detailsOf(p), read));
    const profile = existing ?? this.newProfile(read, file);
    const known = existing ? this.detailsOf(existing) : new Map<string, string>();

    const added: AddedDetail[] = [...read]
      .filter(([key, value]) => known.get(key) !== value)
      .map(([key, value]) => ({
        key,
        label: detail_label(key),
        value,
        verified: captured.sources.get(key)?.verified ?? false,
      }));
    if (existing && added.length === 0) {
      return { profile, created: false, added, attached: false };
    }

    applyProfileFields(profile, update_profile(profileFieldsOf(profile), { details: read }));
    const saved = existing
      ? await this.cipherService.updateWithServer(profile, userId)
      : await this.cipherService.createWithServer(profile, userId);

    let attached = false;
    try {
      const { cipher } = await this.cipherService.encrypt(saved, userId);
      await this.cipherService.saveAttachmentRawWithServer(cipher, file.name, bytes, userId);
      attached = true;
    } catch {
      // The details are saved; the file stays where it was.
    }
    return { profile: saved, created: existing == null, added, attached };
  }

  private newProfile(read: Map<string, string>, file: File): CipherView {
    const given = read.get("name.given.latin");
    const family = read.get("name.family.latin");
    const profile = new CipherView();
    profile.type = CipherType.Identity;
    profile.identity = new IdentityView();
    profile.name =
      (given && family ? `${given} ${family}` : undefined) ??
      read.get("name.full.latin") ??
      read.get("name.full") ??
      file.name.replace(/\.[^.]+$/, "");
    return profile;
  }

  /** Fills a Word, Excel or Hangul form from a profile and saves the copy beside the original. */
  async fillForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const details = { details: profile_details(profileFieldsOf(profile)).details };
    const lower = file.name.toLowerCase();
    const result = lower.endsWith(".docx")
      ? fill_docx_with_profile(bytes, details)
      : lower.endsWith(".xlsx")
        ? fill_xlsx_with_profile(bytes, details)
        : fill_hwpx_with_profile(bytes, details);
    if (result.report.filled_count === 0) {
      return { path: null, filled: 0 };
    }
    const path = await ipc.capture.saveCopy({
      sourcePath: this.sourcePathOf(file),
      name: file.name,
      bytes: Uint8Array.from(result.bytes),
    });
    return { path, filled: result.report.filled_count };
  }

  /** Fills a PDF form from a profile the way Preview does, and saves the copy beside the original. */
  async fillPdfForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const fields = (await ipc.capture.readPdfForm(bytes)).filter(
      (field) => field.type === "text" || field.type === "select-one",
    );
    const { matches } = fill_fields_from_profile({
      fields: fields.map(pdfFieldInput),
      profile: profileFieldsOf(profile),
      explicit_fill: true,
    });
    const values: Record<string, string> = {};
    matches.forEach((match, index) => {
      const field = fields[index];
      let value = match.value?.trim();
      if (!value) {
        return;
      }
      if (field.maxLength > 0) {
        value = value.slice(0, field.maxLength);
      }
      if (field.type === "select-one") {
        value = field.options.find((option) => option.toLowerCase() === value!.toLowerCase());
      }
      if (value) {
        values[field.key] = value;
      }
    });
    if (Object.keys(values).length === 0) {
      return { path: null, filled: 0 };
    }
    return ipc.capture.fillPdfForm({
      sourcePath: this.sourcePathOf(file),
      name: file.name,
      bytes,
      values,
    });
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

  /** Whether the bytes are a PDF with form fields, which the app cannot fill yet. */
  isPdfForm(bytes: Uint8Array): boolean {
    return new TextDecoder("latin1").decode(bytes).includes("/AcroForm");
  }
}

/** What the engine needs to know about a PDF field: the words that name it, as a person reads them. */
function pdfFieldInput(field: PdfFormField) {
  const words = [field.tooltip, field.label, field.name]
    .map((word) => word.trim())
    .filter((word) => word !== "" && !OPAQUE_NAME.test(word));
  return {
    id: field.name,
    name: field.name,
    label: [...new Set(words)].join(" — ") || field.label || field.name,
    placeholder: "",
    autocomplete: "",
    input_type: field.type === "select-one" ? "select-one" : "text",
    section: "",
    form: "",
    pattern: "",
    max_length: Math.max(0, field.maxLength),
    format: "",
    op_ignore: false,
  };
}
