import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import worker from "../edge/worker.mjs";
import { readBody, TooLarge } from "../readers.mjs";

const env = { OPENAI_KEY: "test-provider-key", READER_MODEL: "test-reader" };
const image = "data:image/png;base64,iVBORw0KGgo=";
const graph = {
  v: 1, targetId: "application", formSignature: "application-v1",
  sections: [{ id: "applicant", label: "Applicant" }],
  fields: [{ id: "passport", sectionId: "applicant", label: "Passport number", type: "text", options: [] }],
};

function providerReply(value) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
}

function call(path, body) {
  return worker.fetch(new Request(`https://decision.example${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), env);
}

afterEach(() => mock.restoreAll());

test("the deployed image route returns printed details, normalized dates and their source boxes", async () => {
  mock.method(globalThis, "fetch", async () => providerReply({
    kind: "passport",
    items: [
      { key: "name.full", value: " Nguyễn Thị Linh ", box: [0.2, 0.3, 0.5, 0.1] },
      { key: "birth.date", value: "平成10年3月14日", box: null },
      { key: "id.passport.number", value: "SAMPLE01234", box: [0.7, 0.1, 0.2, 0.05] },
    ],
  }));
  const response = await call("/v1/documents/read-vision", { v: 1, imageDataUrl: image, fileName: "passport.png" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    kind: "passport",
    details: { "name.full": "Nguyễn Thị Linh", "birth.date": "1998-03-14", "id.passport.number": "SAMPLE01234" },
    locators: {
      "name.full": { page: 0, x: 0.2, y: 0.3, w: 0.5, h: 0.1 },
      "id.passport.number": { page: 0, x: 0.7, y: 0.1, w: 0.2, h: 0.05 },
    },
  });
});

test("the deployed form route describes the original target and fields", async () => {
  const asks = {
    v: 1, targetId: "application", formSignature: "application-v1",
    sections: [{ id: "applicant", label: "Applicant", profileHint: null }],
    fields: [{ id: "passport", sectionId: "applicant", what: "Passport number", whose: "Applicant",
      attribute: "id.passport.number", owner: "applicant", format: { label: "As printed", options: [] } }],
  };
  mock.method(globalThis, "fetch", async () => providerReply(asks));
  const response = await call("/v1/forms/describe", graph);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), asks);
});

test("an inaccurate model box does not discard otherwise usable document details", async () => {
  mock.method(globalThis, "fetch", async () => providerReply({
    kind: "passport", items: [{ key: "name.full", value: "SAMPLE", box: [0.9, 0.1, 0.5, 0.1] }],
  }));
  const response = await call("/v1/documents/read-vision", { v: 1, imageDataUrl: image });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: "passport", details: { "name.full": "SAMPLE" } });
});

test("provider failure remains a retryable failure, not an empty successful capture", async () => {
  mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  const response = await call("/v1/documents/read-vision", { v: 1, imageDataUrl: image });
  assert.equal(response.status, 502);
  assert.equal("details" in await response.json(), false);
});

test("body reading preserves multilingual text split across byte chunks and enforces the byte limit", async () => {
  const bytes = new TextEncoder().encode("Nguyễn 氏玲");
  const stream = () => new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.subarray(i, i + 2));
      controller.close();
    },
  });
  assert.equal(await readBody(stream(), bytes.length), "Nguyễn 氏玲");
  await assert.rejects(readBody(stream(), bytes.length - 1), TooLarge);
});

test("read-vision preserves multi-person household members, open-world dotted keys, and distinct repeated keys", async () => {
  mock.method(globalThis, "fetch", async () => providerReply({
    kind: "juminhyo",
    items: [
      { key: "name.full", value: "TRẦN MINH KHOA", box: [0.2, 0.2, 0.3, 0.04] },
      { key: "spouse.name", value: "NGUYỄN THỊ LAN ANH", box: [0.2, 0.3, 0.35, 0.04] },
      { key: "spouse.birth.date", value: "1991年9月3日", box: [0.6, 0.3, 0.2, 0.04] },
      { key: "dependent.name", value: "TRẦN BẢO NGỌC", box: [0.2, 0.4, 0.3, 0.04] },
      { key: "dependent.name", value: "TRẦN GIA BẢO", box: [0.2, 0.5, 0.3, 0.04] },
      { key: "address.previous", value: "東京都江戸川区西葛西5-2-1", box: [0.2, 0.6, 0.5, 0.04] },
      { key: "custom.property_parcel_id", value: "14-8-305", box: [0.2, 0.7, 0.15, 0.03] },
    ],
  }));
  const response = await call("/v1/documents/read-vision", { v: 1, imageDataUrl: image, fileName: "juminhyo.png" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    kind: "juminhyo",
    details: {
      "name.full": "TRẦN MINH KHOA",
      "spouse.name": "NGUYỄN THỊ LAN ANH",
      "spouse.birth.date": "1991-09-03",
      "dependent.name": "TRẦN BẢO NGỌC",
      "dependent.2.name": "TRẦN GIA BẢO",
      "address.previous": "東京都江戸川区西葛西5-2-1",
      "custom.property_parcel_id": "14-8-305",
    },
    locators: {
      "name.full": { page: 0, x: 0.2, y: 0.2, w: 0.3, h: 0.04 },
      "spouse.name": { page: 0, x: 0.2, y: 0.3, w: 0.35, h: 0.04 },
      "spouse.birth.date": { page: 0, x: 0.6, y: 0.3, w: 0.2, h: 0.04 },
      "dependent.name": { page: 0, x: 0.2, y: 0.4, w: 0.3, h: 0.04 },
      "dependent.2.name": { page: 0, x: 0.2, y: 0.5, w: 0.3, h: 0.04 },
      "address.previous": { page: 0, x: 0.2, y: 0.6, w: 0.5, h: 0.04 },
      "custom.property_parcel_id": { page: 0, x: 0.2, y: 0.7, w: 0.15, h: 0.03 },
    },
  });
});

test("fill-image plans text slots, comb grids, and circled choices against supplied profile facts", async () => {
  const planned = {
    fields: [
      { sourceKey: "name.full", label: "氏名", value: "NGUYỄN QUỐC VIỆT", box: [0.41, 0.26, 0.45, 0.024], comb: null, action: "text" },
      { sourceKey: "id.national.number", label: "Số định danh", value: "079206032383", box: [0.42, 0.31, 0.43, 0.027], comb: 12, action: "text" },
      { sourceKey: "person.sex", label: "性別", value: "女", box: [0.89, 0.26, 0.035, 0.017], comb: null, action: "circle" },
    ],
  };
  mock.method(globalThis, "fetch", async () => providerReply(planned));
  const response = await call("/v1/forms/fill-image", {
    v: 1,
    imageDataUrl: image,
    fileName: "form.png",
    details: { "name.full": "NGUYỄN QUỐC VIỆT", "id.national.number": "079206032383", "person.sex": "F" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), planned);
});

test("read-vision salvages multi-person shorthands and unlisted domain keys while fill-image clamps minor box overshoot", async () => {
  const visionItems = {
    kind: "household_register",
    items: [
      { key: "name.full", value: "TRẦN QUỐC BẢO", box: [0.2, 0.2, 0.3, 0.04] },
      { key: "spouse.relation", value: "妻", box: [0.2, 0.3, 0.08, 0.03] },
      { key: "dependent.2.name", value: "TRẦN GIA BẢO", box: [0.2, 0.4, 0.3, 0.04] },
      { key: "certificate.issued", value: "令和8年10月1日", box: [0.7, 0.1, 0.32, 0.03] },
      { key: "household_code", value: "HH-901", box: [0.1, 0.1, 0.2, 0.03] },
    ],
  };
  let callCount = 0;
  mock.method(globalThis, "fetch", async () => {
    callCount += 1;
    if (callCount === 1) return providerReply(visionItems);
    return providerReply({
      fields: [
        { sourceKey: "name.full", label: "氏名", value: "TRẦN QUỐC BẢO", box: [0.85, 0.2, 0.18, 0.04], comb: 1, action: "text" },
        { sourceKey: "name.full", label: "空", value: "   ", box: [0.1, 0.2, 0.2, 0.04], comb: null, action: "text" },
      ],
    });
  });

  const visionRes = await call("/v1/documents/read-vision", { v: 1, imageDataUrl: image, fileName: "juminhyo.jpg" });
  assert.equal(visionRes.status, 200);
  const visionBody = await visionRes.json();
  assert.equal(visionBody.details["spouse.relation"], "妻");
  assert.equal(visionBody.details["dependent.2.name"], "TRẦN GIA BẢO");
  assert.equal(visionBody.details["id.certificate.issued"], "2026-10-01");
  assert.equal(visionBody.details["custom.household_code"], "HH-901");
  assert.equal("id.certificate.issued" in (visionBody.locators ?? {}), false);

  const fillRes = await call("/v1/forms/fill-image", {
    v: 1,
    imageDataUrl: image,
    fileName: "form.png",
    details: { "name.full": "TRẦN QUỐC BẢO" },
  });
  assert.equal(fillRes.status, 200);
  const fillBody = await fillRes.json();
  assert.equal(fillBody.fields.length, 1);
  assert.equal(fillBody.fields[0].comb, null);
  assert.ok(fillBody.fields[0].box[0] + fillBody.fields[0].box[2] <= 1);
});
