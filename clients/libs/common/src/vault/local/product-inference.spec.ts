import {
  capturedFromVision,
  ProductInference,
  ReadingServiceUnavailableError,
} from "./product-inference";

function readerFor(response: unknown, mode: "local" | "masked" | "cloud_vision") {
  const fetchMock = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
  const inference = new ProductInference(
    async () => ({
      installationId: "inst-1",
      identityUrl: "https://identity.example.test",
      accountToken: "tok",
    }),
    "https://decision.example.test",
    fetchMock as never,
  );
  inference.setPrivacyMode(mode);
  return { inference, fetchMock };
}

describe("ProductInference.readDocumentVision", () => {
  it("reads a photo on the default assist mode and keeps good boxes only", async () => {
    const { inference, fetchMock } = readerFor(
      {
        kind: "passport",
        details: { "id.passport.number": "   SPECI2014 ", "name.given": "" },
        locators: {
          "id.passport.number": { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
          "name.given": { page: -1, x: 0, y: 0, w: 1, h: 1 },
        },
      },
      "masked",
    );

    const read = await inference.readDocumentVision("data:image/jpeg;base64,AA==", "id-card.jpg");

    expect(read.details).toEqual({ "id.passport.number": "SPECI2014" });
    expect(read.kind).toBe("passport");
    expect(read.locators).toEqual({ "id.passport.number": { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.05 } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://decision.example.test/v1/documents/read-vision",
      expect.objectContaining({ method: "POST" }),
    );
    expect(inference.getWireLog()[0].requestJson).toContain("[opt-in document image,");
  });

  it("drops boxes a reader placed with non-numbers", async () => {
    const { inference } = readerFor(
      {
        details: { "name.full": "A" },
        locators: { "name.full": { page: 0, x: "0.1", y: 0.2, w: 0.3, h: 0.05 } },
      },
      "cloud_vision",
    );

    const read = await inference.readDocumentVision("data:image/png;base64,AA==");

    expect(read.details).toEqual({ "name.full": "A" });
    expect(read.locators).toBeUndefined();
  });

  it("stays offline in device-only mode", async () => {
    const { inference, fetchMock } = readerFor({ details: { "name.full": "A" } }, "local");

    await expect(inference.readDocumentVision("data:image/png;base64,AA==")).rejects.toBeInstanceOf(
      ReadingServiceUnavailableError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("capturedFromVision", () => {
  it("maps values, their origin and their place on the page", () => {
    const captured = capturedFromVision({
      details: { "id.passport.number": "SPECI2014", "name.given": "   " },
      locators: { "id.passport.number": { page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.05 } },
    });

    expect([...captured.details]).toEqual([["id.passport.number", "SPECI2014"]]);
    expect(captured.sources.get("id.passport.number")).toEqual({
      kind: "ocr",
      verified: false,
      locator: expect.objectContaining({ kind: "page", page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.05 }),
    });
    expect(captured.sources.has("name.given")).toBe(false);
  });
});

describe("ProductInference.planImageFill", () => {
  it("plans text, comb, and circle placements on default mode while redacting image and details in wireLog", async () => {
    const { inference, fetchMock } = readerFor(
      {
        fields: [
          {
            sourceKey: "name.full",
            label: "氏名",
            value: "NGUYỄN QUỐC VIỆT",
            box: [0.41, 0.26, 0.45, 0.024],
            comb: null,
            action: "text",
          },
          {
            sourceKey: "person.sex",
            label: "性別",
            value: "女",
            box: [0.89, 0.26, 0.035, 0.017],
            comb: null,
            action: "circle",
          },
        ],
      },
      "masked",
    );

    const plan = await inference.planImageFill(
      "data:image/png;base64,AA==",
      { "name.full": "NGUYỄN QUỐC VIỆT", "person.sex": "F", empty: "  " },
      "form.png",
    );

    expect(plan.fields).toEqual([
      {
        sourceKey: "name.full",
        label: "氏名",
        value: "NGUYỄN QUỐC VIỆT",
        box: [0.41, 0.26, 0.45, 0.024],
        comb: null,
        action: "text",
      },
      {
        sourceKey: "person.sex",
        label: "性別",
        value: "女",
        box: [0.89, 0.26, 0.035, 0.017],
        comb: null,
        action: "circle",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://decision.example.test/v1/forms/fill-image",
      expect.objectContaining({ method: "POST" }),
    );
    expect(inference.getWireLog()[0].requestJson).toContain("[2 profile facts]");
    expect(inference.getWireLog()[0].requestJson).not.toContain("NGUYỄN");
  });

  it("refuses network calls in device-only mode", async () => {
    const { inference, fetchMock } = readerFor({ fields: [] }, "local");
    await expect(
      inference.planImageFill("data:image/png;base64,AA==", { "name.full": "A" }),
    ).rejects.toBeInstanceOf(ReadingServiceUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
