import { readKoreanHealthCertificate } from "./korean-health-certificate";

function certificate(overrides: Record<string, string> = {}) {
  const facts = {
    name: "김 하나 (KIM HANA)", birth: "1999.08.24", registration: "990824-6000002",
    nationality: "몽골 (MONGOLIA)", qualification: "직장가입자", start: "2026.07.15",
    end: "해당 없음 (N/A)", address: "부산광역시 해운대구 달맞이길 15 (48095)",
    purpose: "자격 확인용", number: "00881001234", issued: "2026.08.01", ...overrides,
  };
  const rowValues = [
    ["성명", "Name", facts.name], ["생년월일", "Date of Birth", facts.birth],
    ["외국인등록번호", "Foreign Resident Registration No.", facts.registration],
    ["국적", "Nationality", facts.nationality], ["자격구분", "Qualification", facts.qualification],
    ["자격취득일", "Date of Qualification", facts.start],
    ["자격상실일", "Date of Disqualification", facts.end],
    ["주소", "Address", facts.address], ["발급사유", "Purpose of Issue", facts.purpose],
  ];
  const piece = (text: string, x: number, y: number, w: number, confidence = 1) =>
    ({ text, x, y, w, h: 0.012, confidence });
  // Native OCR can report a complete label column before the value column.
  return { pages: [{ pieces: [
    piece("건강보험 자격확인서", 0.35, 0.08, 0.3),
    piece(`증번호 (Certificate No.) ${facts.number}`, 0.1, 0.04, 0.35),
    ...rowValues.flatMap(([ko, en], index) => [
      piece(ko, 0.1, 0.18 + index * 0.05, 0.2, 0.5),
      piece(en, 0.1, 0.192 + index * 0.05, 0.25),
    ]),
    ...rowValues.map(([, , value], index) => piece(value, 0.42, 0.185 + index * 0.05, 0.47,
      index === 0 || index === 4 || index === 6 ? 0.5 : 1)),
    piece(`발급일자 (Date of Issue) ${facts.issued}`, 0.1, 0.76, 0.35),
    piece("국민건강보험공단 이사장", 0.65, 0.75, 0.25),
  ] }] };
}

it("reads actual column-separated values, keeps leading zeroes and associates the value boxes", () => {
  const result = readKoreanHealthCertificate(JSON.stringify(certificate()));
  expect(Object.fromEntries(result!.details)).toEqual({
    "name.full": "KIM HANA", "name.full.hangul": "김 하나", "birth.date": "1999-08-24",
    "id.residence_card.number": "990824-6000002", "person.nationality": "몽골 (MONGOLIA)",
    "custom.insurance_qualification": "직장가입자", "custom.qualification_date": "2026-07-15",
    "custom.disqualification_status": "해당 없음 (N/A)",
    "address.full": "부산광역시 해운대구 달맞이길 15 (48095)", "address.postal": "48095",
    "custom.purpose_of_issue": "자격 확인용", "id.certificate.issued": "2026-08-01",
    "id.health_insurance.number": "00881001234", "id.issuing_authority": "국민건강보험공단 이사장",
  });
  expect(result!.sources.get("id.residence_card.number")!.locator).toMatchObject({
    kind: "page", page: 0, x: 0.42, w: 0.47, h: 0.012,
  });
  expect(result!.sources.get("id.residence_card.number")!.locator!.y).toBeCloseTo(0.285, 10);
  const changed = readKoreanHealthCertificate(JSON.stringify(certificate({
    name: "박 민수 (PARK MINSU)", birth: "2001.01.09", registration: "010109-7000013",
    number: "00007776665", start: "2026.04.09",
  })))!;
  expect(changed.details.get("name.full")).toBe("PARK MINSU");
  expect(changed.details.get("birth.date")).toBe("2001-01-09");
  expect(changed.details.get("id.residence_card.number")).toBe("010109-7000013");
  expect(changed.details.get("id.health_insurance.number")).toBe("00007776665");
  expect(changed.details.get("custom.qualification_date")).toBe("2026-04-09");
});

it("leaves an extended table to the general reader rather than dropping an unknown fact", () => {
  const document = certificate();
  document.pages[0].pieces.push(
    { text: "직장명", x: 0.1, y: 0.257, w: 0.2, h: 0.012, confidence: 1 },
    { text: "가온상사", x: 0.42, y: 0.257, w: 0.3, h: 0.012, confidence: 1 },
  );
  expect(readKoreanHealthCertificate(JSON.stringify(document))).toBeNull();
});

it("does not accept incomplete or ambiguous identity information as a complete certificate", () => {
  const cropped = certificate();
  cropped.pages[0].pieces = cropped.pages[0].pieces.filter((piece) =>
    !["외국인등록번호", "Foreign Resident Registration No."].includes(piece.text));
  expect(readKoreanHealthCertificate(JSON.stringify(cropped))).toBeNull();
  const uncertain = certificate();
  uncertain.pages[0].pieces.find((piece) => piece.text === "990824-6000002")!.confidence = 0.3;
  expect(readKoreanHealthCertificate(JSON.stringify(uncertain))).toBeNull();
  expect(readKoreanHealthCertificate(JSON.stringify(certificate({ birth: "1999.02.30", registration: "990230-6000002" })))).toBeNull();
  expect(readKoreanHealthCertificate(JSON.stringify(certificate({ registration: "990825-6000002" })))).toBeNull();
});
