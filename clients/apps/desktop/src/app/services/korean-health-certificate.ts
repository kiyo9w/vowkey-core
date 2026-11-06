import type { CapturedDocument } from "@vowkey/sdk-internal";

interface Piece {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
}

const rows = [
  ["성명", "Name", "name.full"],
  ["생년월일", "Date of Birth", "birth.date"],
  ["외국인등록번호", "Foreign Resident Registration No.", "id.residence_card.number"],
  ["국적", "Nationality", "person.nationality"],
  ["자격구분", "Qualification", "custom.insurance_qualification"],
  ["자격취득일", "Date of Qualification", "custom.qualification_date"],
  ["자격상실일", "Date of Disqualification", "custom.disqualification_status"],
  ["주소", "Address", "address.full"],
  ["발급사유", "Purpose of Issue", "custom.purpose_of_issue"],
  ["발급일자", "Date of Issue", "id.certificate.issued"],
] as const;
const normalized = (text: string) => text.normalize("NFKC").replace(/[\s/():.·]/g, "").toLowerCase();
const attributes = new Map(rows.flatMap(([ko, en, attribute]) =>
  [ko, en, ko + en].map((label) => [normalized(label), attribute] as const),
));

function isoDate(value: string): string | null {
  const match = /^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})\.?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Reads a complete, single-person Korean health eligibility layout from actual OCR pieces. */
export function readKoreanHealthCertificate(reading: string): CapturedDocument | null {
  let pages: { pieces?: Piece[] }[];
  try {
    pages = JSON.parse(reading).pages;
  } catch {
    return null;
  }
  if (!Array.isArray(pages) || pages.length !== 1 || !Array.isArray(pages[0].pieces)) return null;
  const pieces = pages[0].pieces.filter((piece) => typeof piece.text === "string" && piece.text.trim() &&
    [piece.x, piece.y, piece.w, piece.h].every(Number.isFinite) &&
    piece.x >= 0 && piece.y >= 0 && piece.w > 0 && piece.h > 0 &&
    piece.x + piece.w <= 1.001 && piece.y + piece.h <= 1.001);
  if (!pieces.some((piece) => /^(?:건강보험자격확인서|healthinsuranceeligibilitycertificate)$/.test(normalized(piece.text)))) {
    return null;
  }
  const labels = pieces.map((piece) => attributes.get(normalized(piece.text)));
  const valueFor = (label: Piece): Piece | undefined => {
    let best: Piece | undefined;
    let distance = Infinity;
    for (let index = 0; index < pieces.length; index++) {
      const candidate = pieces[index];
      if (labels[index] || candidate === label || candidate.x < label.x + label.w + 0.008) continue;
      const dy = Math.abs(candidate.y + candidate.h / 2 - label.y - label.h / 2);
      if (dy > Math.max(label.h, candidate.h, 0.012)) continue;
      const cost = dy * 8 + candidate.x - label.x - label.w;
      if (cost < distance) {
        distance = cost;
        best = candidate;
      }
    }
    return best;
  };
  const found = new Map<string, Piece>();
  const rowLabels: Piece[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const attribute = labels[index];
    if (!attribute) continue;
    const label = pieces[index];
    const value = valueFor(label);
    if (!value || (label.confidence ?? 1) < 0.45 || (value.confidence ?? 1) < 0.45) return null;
    const prior = found.get(attribute);
    if (prior && normalized(prior.text) !== normalized(value.text)) return null;
    found.set(attribute, value);
    rowLabels.push(label);
  }
  const issuedInline = pieces.find((piece) => /(?:발급일자|date\s+of\s+issue).*\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}/i.test(piece.text));
  if (!found.has("id.certificate.issued") && issuedInline) found.set("id.certificate.issued", issuedInline);
  if (!rows.every(([, , key]) => found.has(key))) return null;

  // An additional data row belongs to the general reader rather than being silently discarded.
  const left = Math.min(...rowLabels.map((piece) => piece.x));
  const top = Math.min(...rowLabels.map((piece) => piece.y));
  const bottom = Math.max(...rowLabels.map((piece) => piece.y + piece.h));
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    if (!labels[index] && piece !== issuedInline && Math.abs(piece.x - left) < 0.035 &&
        piece.y >= top && piece.y + piece.h <= bottom + 0.005 && valueFor(piece)) return null;
  }

  const certificate = pieces.map((piece) => ({ piece, match: /(?:Certificate\s*No\.?|증번호|증명서번호)\)?\s*[:：]?\s+([0-9][0-9 -]{5,24})\s*$/i.exec(piece.text) }))
    .filter(({ match }) => match != null);
  if (certificate.length !== 1 || (certificate[0].piece.confidence ?? 1) < 0.9) return null;
  const authority = pieces.find((piece) => /국민건강보험공단.*이사장/.test(piece.text));
  if (!authority || (authority.confidence ?? 1) < 0.9) return null;

  const details = new Map<string, string>();
  const sources: CapturedDocument["sources"] = new Map();
  const add = (key: string, value: string, piece: Piece) => {
    details.set(key, value);
    sources.set(key, { kind: "text", verified: false, locator: {
      kind: "page", page: 0, x: piece.x, y: piece.y, w: piece.w, h: piece.h,
      row: undefined, column: undefined, a1: undefined, table: undefined,
    } });
  };
  for (const [key, piece] of found) add(key, piece.text.trim(), piece);
  if (["birth.date", "id.residence_card.number", "custom.qualification_date", "id.certificate.issued"]
    .some((key) => (found.get(key)!.confidence ?? 1) < 0.9)) return null;
  const birth = isoDate(details.get("birth.date")!);
  const qualification = isoDate(details.get("custom.qualification_date")!);
  const issuedText = details.get("id.certificate.issued")!;
  const issued = isoDate(issuedText.match(/\d{4}[.\/-]\d{1,2}[.\/-]\d{1,2}/)?.[0] ?? "");
  const registration = details.get("id.residence_card.number")!.replace(/\s/g, "");
  if (!birth || !qualification || !issued || !/^\d{6}-?\d{7}$/.test(registration) ||
      registration.slice(0, 6) !== birth.slice(2).replace(/-/g, "")) return null;
  details.set("birth.date", birth);
  details.set("custom.qualification_date", qualification);
  details.set("id.certificate.issued", issued);
  details.set("id.residence_card.number", registration.replace(/^(\d{6})(\d{7})$/, "$1-$2"));
  const name = details.get("name.full")!;
  const bilingual = /^([\p{Script=Hangul}\s]+)\s*\(([A-Za-z][A-Za-z .'-]+)\)$/u.exec(name);
  if (bilingual) {
    add("name.full", bilingual[2].trim(), found.get("name.full")!);
    add("name.full.hangul", bilingual[1].trim(), found.get("name.full")!);
  } else if (!/^[A-Za-z\p{Script=Hangul} .'-]+$/u.test(name)) {
    return null;
  }
  add("id.health_insurance.number", certificate[0].match![1].replace(/\s/g, ""), certificate[0].piece);
  add("id.issuing_authority", authority.text.trim(), authority);
  const postal = /\((\d{5})\)\s*$/.exec(details.get("address.full")!);
  if (postal) add("address.postal", postal[1], found.get("address.full")!);
  return { details, sources };
}
