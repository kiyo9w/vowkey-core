import { FieldType , CipherType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";

import {
  addTypedDetail,
  agentRuleOf,
  alternativesOf,
  applyProjection,
  buildEnvelopeFromLegacy,
  chooseVariant,
  cloneProfileEnvelope,
  copySourceToProfile,
  correctVariant,
  deleteDetail,
  detailDescriptors,
  envelopeState,
  markSourceDeleted,
  migrateLegacyProfile,
  prepareProfileSave,
  profileRefOf,
  profileUsableForFill,
  projectEnvelope,
  projectedIdentityVariant,
  readEnvelope,
  recordCapture,
  reconcileProjection,
  relabelDetail,
  resolveDetailVariant,
  resolveEnvelopePath,
  resolveLearnedDocumentLabel,
  setProfileRef,
  splitKey,
  VK_META_FIELD,
  VkMetaV1,
  writeEnvelope,
} from "./vk-meta";

let counter = 0;
const options = {
  newId: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
  now: () => new Date("2026-04-02T08:15:00.000Z"),
};

function textField(name: string, value: string): FieldView {
  const f = new FieldView();
  f.name = name;
  f.value = value;
  f.type = FieldType.Text;
  return f;
}

function legacyProfile(): CipherView {
  const cipher = new CipherView();
  cipher.id = "6f1c0a2e-7b34-4c1d-9a10-2d5e6f708192";
  cipher.type = CipherType.Identity;
  cipher.identity = new IdentityView();
  cipher.identity.firstName = "Linh";
  cipher.identity.passportNumber = "C8492011";
  cipher.fields = [
    textField("passport.number", "C8492011"),
    textField("id.drivers_license.number", "DL-998877"),
    textField("name.given.latin", "Linh"),
    textField("name.given.kana", "リン"),
    textField("name.given.kanji", "玲"),
    textField("sex", "F"),
    textField("birth.date", "1990-03-04"),
  ];
  return cipher;
}

beforeEach(() => {
  counter = 0;
});

describe("splitKey", () => {
  it("turns script suffixes into scripts and companion suffixes into tags", () => {
    expect(splitKey("name.given.latin")).toEqual({
      attribute: "name.given",
      script: "Latn",
      tag: null,
    });
    expect(splitKey("name.given.kana")).toEqual({
      attribute: "name.given",
      script: "Kana",
      tag: null,
    });
    expect(splitKey("name.given.hiragana").script).toBe("Hira");
    expect(splitKey("name.given.kanji").script).toBe("Hani");
    expect(splitKey("name.given.hangul").script).toBe("Hang");
    expect(splitKey("birth.date.wareki")).toEqual({
      attribute: "birth.date",
      script: null,
      tag: "wareki",
    });
    expect(splitKey("bank.account.holder.zengin").tag).toBe("zengin");
  });

  it("renames the legacy spellings once", () => {
    expect(splitKey("passport.number").attribute).toBe("id.passport.number");
    expect(splitKey("id.drivers_license.issue_date").attribute).toBe("id.driver_license.issued");
    expect(splitKey("address.state").attribute).toBe("address.prefecture");
    expect(splitKey("sex").attribute).toBe("person.sex");
  });

  it("leaves an unknown suffix part of the attribute", () => {
    expect(splitKey("custom.thing.other")).toEqual({
      attribute: "custom.thing.other",
      script: null,
      tag: null,
    });
  });
});

describe("migrating a profile with named fields", () => {
  it("makes one detail per attribute, with script variants under it, and removes the named fields", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);

    expect(meta.profileId).toBe(cipher.id);
    const given = meta.details.find((d) => d.attribute === "name.given")!;
    // The Identity item's own first name is the plain spelling; the Latin, kana and kanji
    // spellings are variants of the same detail, not details of their own.
    expect(given.variants.map((v) => [v.script, v.value]).sort()).toEqual([
      [null, "Linh"],
      ["Hani", "玲"],
      ["Kana", "リン"],
      ["Latn", "Linh"],
    ]);
    // The passport number appears once, from the Identity field and the legacy custom field.
    expect(meta.details.filter((d) => d.attribute === "id.passport.number")).toHaveLength(1);
    expect(meta.details.find((d) => d.attribute === "id.passport.number")!.variants).toHaveLength(1);
    expect(meta.details.find((d) => d.attribute === "id.driver_license.number")).toBeDefined();
    expect(meta.details.find((d) => d.attribute === "person.sex")!.variants[0].value).toBe("F");
    // Every detail reads as Ask first.
    expect(meta.details.every((d) => agentRuleOf(d) === "ask")).toBe(true);
  });

  it("keeps the fields fillers read, named as before, and the envelope in a Hidden field", () => {
    const cipher = legacyProfile();
    migrateLegacyProfile(cipher, options);

    const names = cipher.fields!.filter((f) => f.type === FieldType.Text).map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["name.given.latin", "name.given.kana", "name.given.kanji"]),
    );
    expect(names).toContain("id.passport.number");
    // The legacy spellings are gone, replaced by the canonical ones.
    expect(names).not.toContain("passport.number");
    expect(names).not.toContain("id.drivers_license.number");
    expect(names).not.toContain("sex");
    expect(names).toContain("person.sex");
    const carrier = cipher.fields!.find((f) => f.name === VK_META_FIELD)!;
    expect(carrier.type).toBe(FieldType.Hidden);
    expect(envelopeState(cipher)).toBe("v1");
    // Latin is what the Identity field holds.
    expect(cipher.identity.firstName).toBe("Linh");
  });

  it("does nothing the second time", () => {
    const cipher = legacyProfile();
    const first = migrateLegacyProfile(cipher, options);
    const second = migrateLegacyProfile(cipher, options);
    expect(second.details.map((d) => d.id)).toEqual(first.details.map((d) => d.id));
  });

  it("turns two fields that collapse to one attribute with different values into two current variants", () => {
    const cipher = legacyProfile();
    cipher.fields!.push(textField("id.passport.number", "X1111111"));
    const meta = buildEnvelopeFromLegacy(cipher, options);
    const detail = meta.details.find((d) => d.attribute === "id.passport.number")!;
    expect(
      detail.variants
        .filter((v) => v.current)
        .map((v) => v.value)
        .sort(),
    ).toEqual(["C8492011", "X1111111"]);
    // Fill writes one, deterministically, and the other is its alternative.
    expect(resolveDetailVariant(meta, detail)).not.toBeNull();
    expect(alternativesOf(meta, detail)).toHaveLength(1);
  });

  it("refuses to touch an envelope written by a newer version", () => {
    const cipher = legacyProfile();
    cipher.fields!.push(
      (() => {
        const f = textField(VK_META_FIELD, JSON.stringify({ v: 2, future: true }));
        f.type = FieldType.Hidden;
        return f;
      })(),
    );
    expect(envelopeState(cipher)).toBe("unsupported");
    expect(readEnvelope(cipher)).toBeNull();
    expect(() => migrateLegacyProfile(cipher, options)).toThrow("newer version");
    expect(cipher.fields!.find((f) => f.name === VK_META_FIELD)!.value).toBe(
      '{"v":2,"future":true}',
    );
  });

  it("keeps keys it does not know when the envelope is read and written again", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    (meta as Record<string, unknown>)["futureKey"] = { keep: "me" };
    writeEnvelope(cipher, meta);
    const again = readEnvelope(cipher)!;
    expect(again["futureKey"]).toEqual({ keep: "me" });
  });
});

describe("capturing a document", () => {
  const passportPage = {
    kind: "page" as const,
    page: 0,
    x: 0.62,
    y: 0.41,
    w: 0.28,
    h: 0.04,
  };

  function profile(): { cipher: CipherView; meta: VkMetaV1 } {
    const cipher = new CipherView();
    cipher.id = "6f1c0a2e-7b34-4c1d-9a10-2d5e6f708192";
    cipher.type = CipherType.Identity;
    cipher.identity = new IdentityView();
    const meta = migrateLegacyProfile(cipher, options);
    return { cipher, meta };
  }

  it("points each value at its document and the place it was printed", () => {
    const { meta } = profile();
    const { sourceId, changed } = recordCapture(
      meta,
      {
        fileName: "ho-chieu.pdf",
        mediaType: "application/pdf",
        kind: "passport",
        documentDate: "2024-05-02",
        effectiveOn: "2024-05-02",
        expiresOn: "2034-05-01",
      },
      [
        {
          key: "id.passport.number",
          value: "LZ6311T47",
          origin: "mrz",
          verified: true,
          locator: passportPage,
        },
      ],
      options,
    );
    expect(changed).toEqual(["id.passport.number"]);
    const detail = meta.details.find((d) => d.attribute === "id.passport.number")!;
    expect(detail.variants[0]).toMatchObject({
      value: "LZ6311T47",
      sourceId,
      verified: true,
      origin: "mrz",
      locator: passportPage,
      script: null,
    });
    expect(meta.sources[0]).toMatchObject({
      id: sourceId,
      fileName: "ho-chieu.pdf",
      status: "current",
      attachmentId: null,
    });
  });

  it("keeps a name in three scripts as one detail", () => {
    const { meta } = profile();
    recordCapture(
      meta,
      { fileName: "id.png", mediaType: "image/png", kind: "residence card" },
      [
        { key: "name.given.latin", value: "Hani", origin: "ocr", verified: false },
        { key: "name.given.kana", value: "ハニ", origin: "ocr", verified: false },
        { key: "name.given.kanji", value: "羽仁", origin: "ocr", verified: false },
      ],
      options,
    );
    const given = meta.details.filter((d) => d.attribute === "name.given");
    expect(given).toHaveLength(1);
    expect(given[0].variants.map((v) => v.script).sort()).toEqual(["Hani", "Kana", "Latn"]);
  });

  it("gives a label with no vocabulary key a detail of its own, not forced into a category", () => {
    const { meta } = profile();
    const detail = addTypedDetail(
      meta,
      { label: "Crew badge", value: "CB-77", valueType: "text" },
      options,
    );
    expect(detail.attribute).toBeNull();
    expect(detail.variants[0].origin).toBe("typed");
    expect(detail.chosenVariantId).toBe(detail.variants[0].id);
    expect(profileDescriptorIds(meta)).toContain(detail.id);
  });

  it("lets a later document by its stated dates replace the value, and keeps the old one in history", () => {
    const { meta } = profile();
    recordCapture(
      meta,
      {
        fileName: "old.pdf",
        mediaType: "application/pdf",
        kind: "passport",
        effectiveOn: "2019-01-01",
      },
      [{ key: "id.passport.number", value: "OLD111", origin: "ocr", verified: false }],
      options,
    );
    const second = recordCapture(
      meta,
      {
        fileName: "new.pdf",
        mediaType: "application/pdf",
        kind: "passport",
        effectiveOn: "2024-05-02",
      },
      [{ key: "id.passport.number", value: "NEW222", origin: "ocr", verified: false }],
      options,
    );

    const detail = meta.details.find((d) => d.attribute === "id.passport.number")!;
    expect(detail.variants.map((v) => v.value)).toEqual(["NEW222"]);
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({
      reason: "superseded",
      variant: { value: "OLD111", current: false },
    });
    expect(resolveDetailVariant(meta, detail)!.sourceId).toBe(second.sourceId);
    // The older document's bytes are kept: its source is retained, not removed.
    expect(meta.sources.find((s) => s.fileName === "old.pdf")!.status).toBe("retained");
  });

  it("keeps both values current when the dates do not order them, however late each was added", () => {
    const { meta } = profile();
    recordCapture(
      meta,
      { fileName: "a.pdf", mediaType: "application/pdf", kind: "passport" },
      [{ key: "id.passport.number", value: "AAA111", origin: "ocr", verified: false }],
      options,
    );
    recordCapture(
      meta,
      { fileName: "b.pdf", mediaType: "application/pdf", kind: "passport" },
      [{ key: "id.passport.number", value: "BBB222", origin: "ocr", verified: false }],
      options,
    );

    const detail = meta.details.find((d) => d.attribute === "id.passport.number")!;
    expect(detail.variants.filter((v) => v.current)).toHaveLength(2);
    expect(detail.history).toHaveLength(0);
    // Fill writes one value, never leaves the field empty, and shows the other.
    const winner = resolveDetailVariant(meta, detail)!;
    expect(["AAA111", "BBB222"]).toContain(winner.value);
    expect(alternativesOf(meta, detail).map((v) => v.value)).toEqual([
      ["AAA111", "BBB222"].find((v) => v !== winner.value),
    ]);
    // The person's choice is what the next fill uses.
    const other = detail.variants.find((v) => v.id !== winner.id)!;
    chooseVariant(meta, detail.id, other.id);
    expect(resolveDetailVariant(meta, detail)!.id).toBe(other.id);
  });

  it("files an older document's value as history instead of replacing a newer one", () => {
    const { meta } = profile();
    recordCapture(
      meta,
      {
        fileName: "new.pdf",
        mediaType: "application/pdf",
        kind: "passport",
        effectiveOn: "2024-05-02",
      },
      [{ key: "id.passport.number", value: "NEW222", origin: "ocr", verified: false }],
      options,
    );
    recordCapture(
      meta,
      {
        fileName: "old.pdf",
        mediaType: "application/pdf",
        kind: "passport",
        effectiveOn: "2019-01-01",
      },
      [{ key: "id.passport.number", value: "OLD111", origin: "ocr", verified: false }],
      options,
    );
    const detail = meta.details.find((d) => d.attribute === "id.passport.number")!;
    expect(detail.variants.map((v) => v.value)).toEqual(["NEW222"]);
    expect(detail.history.map((h) => h.variant.value)).toEqual(["OLD111"]);
  });

  it("keeps both document sources for the same value without reporting a changed detail", () => {
    const { meta } = profile();
    recordCapture(
      meta,
      { fileName: "a.pdf", mediaType: "application/pdf", kind: "passport" },
      [{ key: "id.passport.number", value: "AAA111", origin: "ocr", verified: false }],
      options,
    );
    const again = recordCapture(
      meta,
      { fileName: "b.pdf", mediaType: "application/pdf", kind: "passport" },
      [{ key: "id.passport.number", value: " AAA111 ", origin: "mrz", verified: true }],
      options,
    );
    expect(again.changed).toEqual([]);
    const variants = meta.details.find((d) => d.attribute === "id.passport.number")!.variants;
    expect(variants.map((variant) => variant.value)).toEqual(["AAA111", "AAA111"]);
    expect(new Set(variants.map((variant) => variant.sourceId)).size).toBe(2);
  });
});

function profileDescriptorIds(meta: VkMetaV1): string[] {
  return detailDescriptors(meta).map((d) => d.detailId);
}

describe("editing and deleting", () => {
  function captured() {
    const cipher = new CipherView();
    cipher.id = "6f1c0a2e-7b34-4c1d-9a10-2d5e6f708192";
    cipher.type = CipherType.Identity;
    cipher.identity = new IdentityView();
    const meta = migrateLegacyProfile(cipher, options);
    const { sourceId } = recordCapture(
      meta,
      { fileName: "p.pdf", mediaType: "application/pdf", kind: "passport" },
      [{ key: "id.passport.number", value: "WRONG1", origin: "ocr", verified: false }],
      options,
    );
    return {
      cipher,
      meta,
      sourceId,
      detail: meta.details.find((d) => d.attribute === "id.passport.number")!,
    };
  }

  it("makes the new value the chosen one and keeps the previous value in history with its document", () => {
    const { cipher, meta, sourceId, detail } = captured();
    const corrected = correctVariant(meta, detail.id, detail.variants[0].id, "RIGHT22", options);

    expect(detail.chosenVariantId).toBe(corrected.id);
    expect(resolveDetailVariant(meta, detail)!.value).toBe("RIGHT22");
    expect(detail.history[0]).toMatchObject({
      reason: "correction",
      variant: { value: "WRONG1", sourceId },
    });
    // The Text projection matches.
    applyProjection(cipher, projectEnvelope(meta), ["id.passport.number"]);
    expect(cipher.fields!.find((f) => f.name === "id.passport.number")!.value).toBe("RIGHT22");
    expect(cipher.identity.passportNumber).toBe("RIGHT22");
  });

  it("takes in an edit made to the projected field by a screen that does not know the envelope", () => {
    const { cipher, meta, detail } = captured();
    applyProjection(cipher, projectEnvelope(meta), []);
    cipher.fields!.find((f) => f.name === "id.passport.number")!.value = "TYPED33";
    const changes = reconcileProjection(cipher, meta, options);
    expect(changes).toBe(1);
    expect(resolveDetailVariant(meta, detail)!.value).toBe("TYPED33");
    expect(detail.history.map((h) => h.variant.value)).toEqual(["WRONG1"]);
  });

  it("does not make a correction just because the envelope is carried in a Hidden field", () => {
    const { cipher, meta } = captured();
    applyProjection(cipher, projectEnvelope(meta), []);
    expect(reconcileProjection(cipher, meta, options)).toBe(0);
  });

  it("removes a deleted detail and its projected field, and the reference no longer resolves", () => {
    const { cipher, meta, detail } = captured();
    applyProjection(cipher, projectEnvelope(meta), []);
    writeEnvelope(cipher, meta);
    const path = `detail.${detail.id}`;
    expect(resolveEnvelopePath(cipher, path)).toBe("WRONG1");

    deleteDetail(meta, detail.id);
    writeEnvelope(cipher, meta);
    applyProjection(cipher, projectEnvelope(meta), ["id.passport.number"]);
    expect(resolveEnvelopePath(cipher, path)).toBeNull();
    expect(cipher.fields!.some((f) => f.name === "id.passport.number")).toBe(false);
  });

  it("keeps the facts when a document is deleted, and says its bytes are gone", () => {
    const { meta, sourceId, detail } = captured();
    markSourceDeleted(meta, sourceId);
    const source = meta.sources.find((s) => s.id === sourceId)!;
    expect(source).toMatchObject({ status: "deleted", attachmentId: null });
    expect(detail.variants[0].sourceId).toBe(sourceId);
    expect(resolveDetailVariant(meta, detail)!.value).toBe("WRONG1");
  });
});

describe("references", () => {
  it("resolves a detail by id, a variant by id, and identity paths to the exact projected value", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    const given = meta.details.find((d) => d.attribute === "name.given")!;
    const kana = given.variants.find((v) => v.script === "Kana")!;

    const hani = given.variants.find((variant) => variant.script === "Hani")!;
    chooseVariant(meta, given.id, hani.id);
    writeEnvelope(cipher, meta);
    expect(resolveEnvelopePath(cipher, `detail.${given.id}`)).toBe("玲");
    expect(resolveEnvelopePath(cipher, `detail.${given.id}.${kana.id}`)).toBe("リン");
    expect(resolveEnvelopePath(cipher, "identity.firstName")).toBe("Linh");
    expect(resolveEnvelopePath(cipher, "identity.passportNumber")).toBe("C8492011");
    expect(resolveEnvelopePath(cipher, "detail.not-a-detail")).toBeNull();
    expect(resolveEnvelopePath(cipher, "field.name.given.kana")).toBeNull();
  });

  it("does not list a draft profile's details", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    meta.status = "draft";
    expect(detailDescriptors(meta)).toEqual([]);
  });
});

describe("a login, card or key's link to a profile", () => {
  function login(): CipherView {
    const c = new CipherView();
    c.id = "login-1";
    c.type = CipherType.Login;
    return c;
  }

  it("stores only the profile's id and can clear it, leaving the profile alone", () => {
    const item = login();
    expect(profileRefOf(item)).toBeNull();
    setProfileRef(item, "profile-1");
    expect(profileRefOf(item)).toBe("profile-1");
    expect(JSON.parse(item.fields!.find((f) => f.name === VK_META_FIELD)!.value!)).toEqual({
      v: 1,
      profileRef: { cipherId: "profile-1" },
    });
    setProfileRef(item, null);
    expect(profileRefOf(item)).toBeNull();
  });

  it("is unavailable when the profile is missing, in the trash or still a draft", () => {
    expect(profileUsableForFill(null)).toBe(false);
    const gone = legacyProfile();
    gone.deletedDate = new Date();
    expect(profileUsableForFill(gone)).toBe(false);
    const draft = legacyProfile();
    const meta = migrateLegacyProfile(draft, options);
    meta.status = "draft";
    writeEnvelope(draft, meta);
    expect(profileUsableForFill(draft)).toBe(false);
    const ok = legacyProfile();
    migrateLegacyProfile(ok, options);
    expect(profileUsableForFill(ok)).toBe(true);
  });

  it("keeps a link written by a newer version as it is", () => {
    const item = login();
    const f = textField(VK_META_FIELD, '{"v":3}');
    f.type = FieldType.Hidden;
    item.fields = [f];
    expect(() => setProfileRef(item, "x")).toThrow("newer version");
  });
});

describe("an envelope this version must not rewrite", () => {
  function carrier(value: string): CipherView {
    const cipher = legacyProfile();
    const field = textField(VK_META_FIELD, value);
    field.type = FieldType.Hidden;
    cipher.fields!.push(field);
    return cipher;
  }

  it("leaves malformed JSON and a v1 object that is not an envelope or a link", () => {
    const broken = carrier("{not json");
    expect(envelopeState(broken)).toBe("unreadable");
    expect(() => prepareProfileSave(broken, options)).not.toThrow();
    expect(prepareProfileSave(broken, options)).toBeNull();
    expect(broken.fields!.find((f) => f.name === VK_META_FIELD)!.value).toBe("{not json");

    const odd = carrier(JSON.stringify({ v: 1, futureShape: { keep: true } }));
    expect(envelopeState(odd)).toBe("unreadable");
    expect(prepareProfileSave(odd, options)).toBeNull();
    expect(JSON.parse(odd.fields!.find((f) => f.name === VK_META_FIELD)!.value!)).toEqual({
      v: 1,
      futureShape: { keep: true },
    });
  });

  it("refuses to store a profile link on a type 4 envelope", () => {
    const profile = legacyProfile();
    migrateLegacyProfile(profile, options);
    expect(() => setProfileRef(profile, "other")).toThrow("profileRef");
    expect(readEnvelope(profile)!.details.length).toBeGreaterThan(0);
  });
});

describe("an authorized save", () => {
  it("writes a missing agent rule, keeps detail ids, and takes a projected edit as a correction", () => {
    const cipher = legacyProfile();
    const first = migrateLegacyProfile(cipher, options);
    const passport = first.details.find((d) => d.attribute === "id.passport.number")!;
    delete (passport as { agentRule?: string }).agentRule;
    writeEnvelope(cipher, first);
    cipher.identity.passportNumber = "EDITED99";

    const saved = prepareProfileSave(cipher, options)!;
    const again = saved.details.find((d) => d.id === passport.id)!;
    expect(saved.profileId).toBe(cipher.id);
    expect(saved.details.map((d) => d.id)).toEqual(first.details.map((d) => d.id));
    expect(again.agentRule).toBe("ask");
    expect(resolveDetailVariant(saved, again)!.value).toBe("EDITED99");
    expect(again.history.map((h) => h.variant.value)).toContain("C8492011");
    expect(cipher.identity.passportNumber).toBe("EDITED99");
  });

  it("projects firstName from Latin even when another script is chosen", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    const given = meta.details.find((d) => d.attribute === "name.given")!;
    const hani = given.variants.find((v) => v.script === "Hani")!;
    chooseVariant(meta, given.id, hani.id);
    writeEnvelope(cipher, meta);
    applyProjection(cipher, projectEnvelope(meta), []);

    expect(resolveDetailVariant(meta, given)!.script).toBe("Hani");
    expect(projectedIdentityVariant(meta, given, "firstName")!.script).toBe("Latn");
    expect(cipher.identity.firstName).toBe("Linh");
    expect(resolveEnvelopePath(cipher, "identity.firstName")).toBe("Linh");
    expect(resolveEnvelopePath(cipher, `detail.${given.id}`)).toBe("玲");
  });

  it("hides a secret detail when the member cannot view passwords, and shows it otherwise", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    const secret = addTypedDetail(
      meta,
      { attribute: "credential.pin", label: "PIN", value: "4821", valueType: "secret" },
      options,
    );
    writeEnvelope(cipher, meta);
    applyProjection(cipher, projectEnvelope(meta), []);
    expect(cipher.fields!.some((f) => f.type === FieldType.Text && f.value === "4821")).toBe(false);

    cipher.viewPassword = false;
    expect(resolveEnvelopePath(cipher, `detail.${secret.id}`, true)).toBeNull();
    expect(resolveEnvelopePath(cipher, `detail.${secret.id}`)).toBe("4821");
    cipher.viewPassword = true;
    expect(resolveEnvelopePath(cipher, `detail.${secret.id}`)).toBe("4821");
  });
});

describe("clone, share and moving a document", () => {
  function capturedProfile(): CipherView {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    recordCapture(
      meta,
      { fileName: "p.pdf", mediaType: "application/pdf", kind: "passport" },
      [{ key: "id.passport.number", value: "LZ1", origin: "mrz", verified: true }],
      options,
    );
    writeEnvelope(cipher, meta);
    return cipher;
  }

  it("mints new inner ids for a clone and leaves the original's ids for a share", () => {
    const original = capturedProfile();
    const before = readEnvelope(original)!;
    const copy = new CipherView();
    copy.type = CipherType.Identity;
    copy.identity = new IdentityView();
    copy.fields = original.fields!.map((f) => {
      const field = textField(f.name!, f.value!);
      field.type = f.type;
      return field;
    });
    copy.id = original.id;

    const cloned = cloneProfileEnvelope(copy, options)!;
    expect(copy.id).toBeUndefined();
    expect(cloned.profileId).toBe("");
    expect(cloned.details.map((d) => d.id)).not.toEqual(before.details.map((d) => d.id));
    expect(cloned.sources.map((s) => s.id)).not.toEqual(before.sources.map((s) => s.id));
    expect(cloned.sources.every((s) => s.attachmentId == null)).toBe(true);
    // Share and a collection move keep the cipher and do not remint.
    expect(readEnvelope(original)!.details.map((d) => d.id)).toEqual(before.details.map((d) => d.id));
  });

  it("copies a document onto a new source without changing the origin", () => {
    const destinationSourceId = "destination-source";
    const origin = capturedProfile();
    const originMeta = readEnvelope(origin)!;
    const originSource = originMeta.sources[0];
    const destination = new CipherView();
    destination.id = "dest";
    destination.type = CipherType.Identity;
    const destinationMeta = migrateLegacyProfile(destination, options);
    copySourceToProfile(destinationMeta, originMeta, originSource.id, destinationSourceId, "att-9");
    expect(destinationMeta.sources.map((s) => s.id)).toContain(destinationSourceId);
    expect(destinationMeta.sources.find((s) => s.id === destinationSourceId)!.attachmentId).toBe(
      "att-9",
    );
    expect(originMeta.sources[0].id).toBe(originSource.id);
    expect(originMeta.sources[0].status).not.toBe("deleted");
  });

  it("remembers a taught document label and applies it on the next capture", () => {
    const cipher = legacyProfile();
    const meta = migrateLegacyProfile(cipher, options);
    recordCapture(
      meta,
      { fileName: "zairyu.png", mediaType: "image/png", kind: "residence_card" },
      [{ key: "番号", value: "AB12345678CD", origin: "ocr", verified: false }],
      options,
    );
    const unclassified = meta.details.find((d) => d.attribute === "番号")!;
    expect(unclassified).toBeDefined();

    relabelDetail(
      meta,
      unclassified.id,
      "id.residence_card.number",
      "Residence card number",
    );
    expect(resolveLearnedDocumentLabel("番号")).toEqual({
      attribute: "id.residence_card.number",
      label: "Residence card number",
    });

    // Next capture with the same printed label "番号" automatically maps to id.residence_card.number!
    recordCapture(
      meta,
      { fileName: "zairyu-renewed.png", mediaType: "image/png", kind: "residence_card" },
      [{ key: "番号", value: "ZX98765432KL", origin: "ocr", verified: false }],
      options,
    );
    const resCardDetail = meta.details.find((d) => d.attribute === "id.residence_card.number")!;
    expect(resCardDetail.variants.map((v) => v.value)).toEqual(
      expect.arrayContaining(["AB12345678CD", "ZX98765432KL"]),
    );
  });
});
