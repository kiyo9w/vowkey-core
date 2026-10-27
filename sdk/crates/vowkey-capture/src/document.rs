//! Extracts canonical profile details from document text (residence cards, bank passbooks,
//! employment contracts, payslips, tax slips and résumés) alongside MRZ and barcode payloads.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    aamva::AamvaCard,
    cccd::CccdCard,
    format::{parse_japanese_date, to_fullwidth_katakana, to_hiragana, to_wareki, to_zengin_halfwidth_kana},
    mrz::{Mrz, find_mrz},
};

/// Canonical details extracted from one or more identity or supporting documents.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct CapturedDocument {
    /// Canonical attribute keys (`name.full`, `id.residence_card.number`, `bank.code` and so on)
    /// mapped to their normalized values.
    pub details: BTreeMap<String, String>,
    /// How each detail was read, by the same keys.
    pub sources: BTreeMap<String, DetailSource>,
}

/// Where a detail came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct DetailSource {
    /// `mrz`, `aamva`, `cccd`, `text` for a `label: value` pair, or `derived` for a detail worked
    /// out from another, such as the Japanese-era date from a birth date.
    pub kind: String,
    /// True for a machine-readable zone whose check digits all pass.
    pub verified: bool,
}

const KNOWN_LABELS: &[(&str, &str)] = &[
    ("在留カード番号", "id.residence_card.number"),
    ("交付年月日", "id.residence_card.issued"),
    ("在留資格", "visa.status"),
    ("在留期間の満了日", "visa.expiry"),
    ("在留期間満了日", "visa.expiry"),
    ("在留期間", "visa.period"),
    ("氏名（ローマ字）", "name.full.latin"),
    ("姓（ローマ字）", "name.family.latin"),
    ("名（ローマ字）", "name.given.latin"),
    ("ローマ字", "name.full.latin"),
    ("氏名（漢字）", "name.full"),
    ("姓（漢字）", "name.family"),
    ("名（漢字）", "name.given"),
    ("労働者氏名", "name.full"),
    ("従業員氏名", "name.full"),
    ("氏名（フリガナ）", "name.full.kana"),
    ("姓（フリガナ）", "name.family.kana"),
    ("名（フリガナ）", "name.given.kana"),
    ("生年月日", "birth.date"),
    ("国籍・地域", "person.nationality"),
    ("国籍", "person.nationality"),
    ("性別", "person.sex"),
    ("郵便番号", "address.postal"),
    ("住居地", "address.full"),
    ("現住所", "address.full"),
    ("都道府県", "address.prefecture"),
    ("市区町村", "address.city"),
    ("町名・番地", "address.street"),
    ("建物名・部屋番号", "address.building"),
    ("金融機関名", "bank.name"),
    ("金融機関コード", "bank.code"),
    ("支店名（カナ）", "bank.branch.name.kana"),
    ("支店名", "bank.branch.name"),
    ("店番", "bank.branch.code"),
    ("支店コード", "bank.branch.code"),
    ("預金種目", "bank.account.type"),
    ("口座番号", "bank.account.number"),
    ("口座名義（カナ）", "bank.account.holder.kana"),
    ("口座名義（漢字）", "bank.account.holder.kanji"),
    ("ゆうちょ記号", "bank.jp_post.symbol"),
    ("ゆうちょ番号", "bank.jp_post.number"),
    ("使用者名称", "work.employer.name"),
    ("会社名（フリガナ）", "work.employer.name.kana"),
    ("会社名", "work.employer.name"),
    ("事業場所在地", "work.employer.address"),
    ("事業場電話番号", "work.employer.phone"),
    ("代表者氏名", "work.employer.representative"),
    ("職種・役職", "work.title"),
    ("所属部署", "work.department"),
    ("社員番号", "work.employee_id"),
    ("雇用形態", "work.employment_type"),
    ("入社年月日", "work.start.date"),
    ("想定年収", "income.annual"),
    ("携帯電話番号", "contact.phone.mobile"),
    ("携帯電話", "contact.phone.mobile"),
    ("自宅電話", "contact.phone.home"),
    ("メールアドレス", "contact.email"),
    ("E-mail", "contact.email"),
    ("最終学歴（学校名）", "education.school.name"),
    ("卒業年月", "education.graduation.date"),
    ("緊急連絡先氏名", "emergency.name"),
    ("緊急連絡先フリガナ", "emergency.name.kana"),
    ("緊急連絡先続柄", "emergency.relation"),
    ("緊急連絡先電話", "emergency.phone"),
    ("緊急連絡先住所", "emergency.address"),
    ("基礎年金番号", "id.pension.number"),
    ("雇用保険被保険者番号", "id.employment_insurance.number"),
    ("健康保険記号・番号", "id.health_insurance.number"),
    ("旅券番号", "id.passport.number"),
    ("個人番号", "id.mynumber"),
    ("対象年月", "income.pay_period"),
    ("支給日", "income.pay_date"),
    ("基本給", "income.monthly.base"),
    ("時間外手当", "income.monthly.overtime"),
    ("通勤手当", "income.monthly.commute"),
    ("住宅手当", "income.monthly.housing"),
    ("総支給額", "income.monthly.gross"),
    ("差引支給額", "income.monthly.net"),
    ("健康保険料", "income.insurance.health"),
    ("厚生年金保険料", "income.insurance.pension"),
    ("雇用保険料", "income.insurance.employment"),
    ("社会保険料合計", "income.insurance.total"),
    ("源泉所得税", "income.tax.income"),
    ("住民税", "income.tax.resident"),
    ("Driver's Licence (ON)", "id.driver_license.number"),
    ("Employer Address", "work.employer.address"),
    ("Employer", "work.employer.name"),
    ("Employee ID", "work.employee_id"),
    ("Employment Type", "work.employment_type"),
    ("Job Title", "work.title"),
    ("Title", "work.title"),
    ("Department", "work.department"),
    ("Account Holder", "name.full"),
    ("Account Number", "bank.account.number"),
    ("ABA Routing Number", "bank.code"),
    ("Account Type", "bank.account.type"),
    ("Steuer-ID (Tax ID)", "id.tax.de_steuer_id"),
    ("SV-Nummer (Social Sec. No.)", "id.pension.number"),
];

const AMOUNT_KEYS: &[&str] = &[
    "income.annual",
    "income.bonus",
    "income.monthly.base",
    "income.monthly.overtime",
    "income.monthly.commute",
    "income.monthly.housing",
    "income.monthly.gross",
    "income.monthly.net",
    "income.insurance.health",
    "income.insurance.pension",
    "income.insurance.employment",
    "income.insurance.total",
    "income.tax.income",
    "income.tax.resident",
];

const DATE_KEYS: &[&str] = &[
    "birth.date",
    "id.residence_card.issued",
    "visa.expiry",
    "work.start.date",
    "education.graduation.date",
    "income.pay_date",
    "income.pay_period",
];

/// Reads canonical profile details from document text, including any embedded MRZ, AAMVA or CCCD
/// payload and any `label: value` fields. `current_year` places a two-digit birth year in its
/// century.
pub fn extract_document_details(text: &str, current_year: u16) -> CapturedDocument {
    let mut document = extract_payload_details(text, current_year);

    document.read("text", false, |details| {
        for line in text.lines() {
            extract_line_pairs(line, details);
        }
    });

    document.read("derived", false, derive_companion_details);
    document
}

/// Reads only what a document carries in a standard form: an AAMVA or CCCD payload and a
/// machine-readable zone.
pub fn extract_payload_details(text: &str, current_year: u16) -> CapturedDocument {
    let mut document = CapturedDocument::default();

    if let Ok(aamva) = AamvaCard::parse(text) {
        document.read("aamva", false, |details| details.extend(aamva.details()));
    }
    if let Ok(cccd) = CccdCard::parse(text) {
        document.read("cccd", false, |details| details.extend(cccd.details()));
    }
    for zone in find_mrz(text) {
        if let Ok(mrz) = Mrz::parse_ocr(&zone) {
            document.read("mrz", mrz.verified(), |details| {
                details.insert("id.passport.number".to_string(), mrz.document_number.clone());
                details.insert("id.passport.country".to_string(), mrz.issuer.clone());
                details.insert("name.family.latin".to_string(), mrz.family_name.clone());
                details.insert("name.given.latin".to_string(), mrz.given_names.clone());
                details.insert(
                    "name.full.latin".to_string(),
                    format!("{} {}", mrz.family_name, mrz.given_names)
                        .trim()
                        .to_string(),
                );
                details.insert("person.nationality".to_string(), mrz.nationality.clone());
                let sex = mrz.sex.as_mrz_char();
                if sex != '<' {
                    details.insert("person.sex".to_string(), sex.to_string());
                }
                let birth_iso = mrz.birth_date.resolve_birth(current_year).iso();
                if !birth_iso.is_empty() {
                    details.insert("birth.date".to_string(), birth_iso);
                }
                let expiry_iso = mrz.expiry_date.resolve_expiry().iso();
                if !expiry_iso.is_empty() {
                    details.insert("id.passport.expiry".to_string(), expiry_iso);
                }
            });
        }
    }

    document
}

impl CapturedDocument {
    /// Runs `read` on the details and records `kind` as the source of every detail it added or
    /// changed.
    fn read(&mut self, kind: &str, verified: bool, read: impl FnOnce(&mut BTreeMap<String, String>)) {
        let before = self.details.clone();
        read(&mut self.details);
        for (key, value) in &self.details {
            if before.get(key) != Some(value) {
                self.sources.insert(
                    key.clone(),
                    DetailSource {
                        kind: kind.to_string(),
                        verified,
                    },
                );
            }
        }
    }
}

fn extract_line_pairs(line: &str, details: &mut BTreeMap<String, String>) {
    let mut hits: Vec<(usize, usize, &str)> = Vec::new();
    for &(label, key) in KNOWN_LABELS {
        for sep in [":", "："] {
            let pattern = format!("{label}{sep}");
            let mut search_from = 0;
            while let Some(rel) = line.get(search_from..).and_then(|s| s.find(&pattern)) {
                let start = search_from + rel;
                let end = start + pattern.len();
                let overlapped = hits
                    .iter()
                    .any(|&(s, e, _)| start < e && end > s);
                if !overlapped {
                    hits.push((start, end, key));
                }
                search_from = end;
            }
        }
    }
    hits.sort_by_key(|&(start, _, _)| start);

    for (idx, &(_, value_start, key)) in hits.iter().enumerate() {
        let value_end = hits
            .get(idx + 1)
            .map(|&(next_start, _, _)| next_start)
            .unwrap_or(line.len());
        let Some(raw_val) = line.get(value_start..value_end) else {
            continue;
        };
        let trimmed = raw_val.trim();
        if trimmed.is_empty() {
            continue;
        }
        let normalized = normalize_value(key, trimmed);
        details.insert(key.to_string(), normalized);
    }
}

fn normalize_value(key: &str, raw: &str) -> String {
    if AMOUNT_KEYS.contains(&key) {
        let cleaned: String = raw
            .chars()
            .filter(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if !cleaned.is_empty() {
            return cleaned;
        }
    }
    if DATE_KEYS.contains(&key) {
        if let Some(iso) = parse_japanese_date(raw) {
            return iso;
        }
    }
    raw.to_string()
}

/// Populates script, calendar and split-field companions (`birth.date.wareki`,
/// `bank.account.holder.zengin`, `name.full.hiragana`, etc.) from the primary details.
pub fn derive_companion_details(details: &mut BTreeMap<String, String>) {
    if let Some(birth) = details.get("birth.date").cloned() {
        if let Some(wareki) = to_wareki(&birth) {
            details
                .entry("birth.date.wareki".to_string())
                .or_insert_with(|| wareki.format_kanji(true));
            details
                .entry("birth.era".to_string())
                .or_insert_with(|| wareki.era_kanji.clone());
            details
                .entry("birth.era_year".to_string())
                .or_insert_with(|| wareki.year.to_string());
        }
        let parts: Vec<&str> = birth.split('-').collect();
        if let [y, m, d] = parts.as_slice() {
            details
                .entry("birth.year".to_string())
                .or_insert_with(|| (*y).to_string());
            details
                .entry("birth.month".to_string())
                .or_insert_with(|| (*m).to_string());
            details
                .entry("birth.day".to_string())
                .or_insert_with(|| (*d).to_string());
        }
    }

    if let Some(kana) = details.get("name.full.kana").cloned() {
        details
            .entry("name.full.hiragana".to_string())
            .or_insert_with(|| to_hiragana(&kana));
        details
            .entry("name.full.zengin".to_string())
            .or_insert_with(|| to_zengin_halfwidth_kana(&kana));
    }
    if let Some(hira) = details.get("name.full.hiragana").cloned() {
        details
            .entry("name.full.kana".to_string())
            .or_insert_with(|| to_fullwidth_katakana(&hira));
    }

    if let Some(holder_kana) = details
        .get("bank.account.holder.kana")
        .or_else(|| details.get("name.full.kana"))
        .cloned()
    {
        details
            .entry("bank.account.holder.zengin".to_string())
            .or_insert_with(|| to_zengin_halfwidth_kana(&holder_kana));
    }
}
