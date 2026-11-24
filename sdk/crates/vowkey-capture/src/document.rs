//! Details a document carries in a standard form: machine-readable zones and barcode payloads.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    aamva::AamvaCard,
    cccd::CccdCard,
    format::{
        kana_to_hepburn, parse_e164_phone, title_case_latin_name, to_fullwidth_katakana,
        to_hiragana, to_wareki, to_zengin_halfwidth_kana,
    },
    mrz::{Mrz, find_mrz},
    normalize::lookup_country,
};

/// Canonical details extracted from one or more identity or supporting documents.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct CapturedDocument {
    /// Canonical attribute keys (`name.full`, `id.residence_card.number`, `bank.code` and so on)
    /// mapped to their normalized values.
    pub details: BTreeMap<String, String>,
    /// How each detail was read, by the same keys.
    pub sources: BTreeMap<String, DetailSource>,
}

/// Where on a document a detail was printed: a box on a page, as fractions from its top left
/// corner, or a cell of a sheet or a table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct Locator {
    /// `page` for a printed or photographed page, `cell` for a cell.
    pub kind: String,
    /// The page, or the sheet, from 0.
    pub page: u32,
    /// Left edge of the box. All four box values are zero for a file that has no layout.
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
    /// The row of a cell, from 0.
    pub row: Option<u32>,
    /// The column of a cell, from 0 (A is 0).
    pub column: Option<u32>,
    /// The cell's A1 reference in an Excel sheet. A Word cell has none.
    pub a1: Option<String>,
    /// The table of a Word file. No reader gives one yet.
    pub table: Option<u32>,
}

/// Where a detail came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct DetailSource {
    /// `mrz`, `aamva`, `cccd`, `text` for a `label: value` pair, or `derived` for a detail worked
    /// out from another, such as the Japanese-era date from a birth date.
    pub kind: String,
    /// True for a machine-readable zone whose check digits all pass.
    pub verified: bool,
    /// Where on the document it was printed, when a reader placed it.
    #[serde(default)]
    pub locator: Option<Locator>,
}

/// Reads what a document carries in a standard form from its text: an embedded MRZ, AAMVA or CCCD
/// payload, with the script and calendar companions that follow from it. What the rest of the
/// document says is read by a Decision model (see `decision`). `current_year` places a two-digit
/// birth year in its century.
pub fn extract_document_details(text: &str, current_year: u16) -> CapturedDocument {
    let mut document = extract_payload_details(text, current_year);
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
                        locator: None,
                    },
                );
            }
        }
    }
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

    for (alias, canonical) in [
        ("name.full.katakana", "name.full.kana"),
        ("name.family.katakana", "name.family.kana"),
        ("name.given.katakana", "name.given.kana"),
    ] {
        if !details.contains_key(canonical)
            && let Some(val) = details.get(alias).cloned()
        {
            details.insert(canonical.to_string(), val);
        }
    }

    if let Some(kana) = details.get("name.full.kana").cloned() {
        details
            .entry("name.full.hiragana".to_string())
            .or_insert_with(|| to_hiragana(&kana));
        details
            .entry("name.full.zengin".to_string())
            .or_insert_with(|| to_zengin_halfwidth_kana(&kana));
        let parts: Vec<&str> = kana
            .split(|c: char| c.is_whitespace() || c == '・' || c == '･')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() >= 2 {
            let family = parts[0];
            let given = parts[1..].join(" ");
            details
                .entry("name.family.kana".to_string())
                .or_insert_with(|| family.to_string());
            details
                .entry("name.given.kana".to_string())
                .or_insert_with(|| given.clone());
            if details.contains_key("name.full.katakana") {
                details
                    .entry("name.family.katakana".to_string())
                    .or_insert_with(|| family.to_string());
                details
                    .entry("name.given.katakana".to_string())
                    .or_insert_with(|| given.clone());
            }
            details
                .entry("name.family.hiragana".to_string())
                .or_insert_with(|| to_hiragana(family));
            details
                .entry("name.given.hiragana".to_string())
                .or_insert_with(|| to_hiragana(&given));
        }
    }
    if let Some(hira) = details.get("name.full.hiragana").cloned() {
        details
            .entry("name.full.kana".to_string())
            .or_insert_with(|| to_fullwidth_katakana(&hira));
        let parts: Vec<&str> = hira
            .split(|c: char| c.is_whitespace() || c == '・' || c == '･')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() >= 2 {
            let family = parts[0];
            let given = parts[1..].join(" ");
            details
                .entry("name.family.hiragana".to_string())
                .or_insert_with(|| family.to_string());
            details
                .entry("name.given.hiragana".to_string())
                .or_insert_with(|| given.clone());
            details
                .entry("name.family.kana".to_string())
                .or_insert_with(|| to_fullwidth_katakana(family));
            details
                .entry("name.given.kana".to_string())
                .or_insert_with(|| to_fullwidth_katakana(&given));
        }
    }

    for (kana_key, romaji_key) in [
        ("name.full.kana", "name.full.romaji"),
        ("name.family.kana", "name.family.romaji"),
        ("name.given.kana", "name.given.romaji"),
    ] {
        if let Some(kana_val) = details.get(kana_key).cloned() {
            let hepburn = kana_to_hepburn(&kana_val);
            if !hepburn.is_empty() {
                details.entry(romaji_key.to_string()).or_insert(hepburn);
            }
        }
    }

    if !details.contains_key("contact.phone.country") {
        let parsed = ["contact.phone", "contact.phone.mobile", "contact.phone.home"]
            .iter()
            .find_map(|k| details.get(*k).and_then(|v| parse_e164_phone(v)));
        if let Some(parts) = parsed {
            details.insert("contact.phone.country".to_string(), parts.country_code);
        }
    }

    if let (Some(full), Some(building)) = (
        details.get("address.full").cloned(),
        details.get("address.building").cloned(),
    ) {
        if !building.is_empty() && !full.contains(&building) {
            details.insert("address.full".to_string(), format!("{full} {building}"));
        }
    } else if !details.contains_key("address.full") {
        if let (Some(street), Some(tail)) = (
            details.get("address.street").cloned(),
            details
                .get("address.city")
                .or_else(|| details.get("address.prefecture"))
                .cloned(),
        ) {
            if !street.contains(&tail) {
                let sep = if street.ends_with(',') { " " } else { ", " };
                details.insert("address.full".to_string(), format!("{street}{sep}{tail}"));
            }
        }
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

    if !details.contains_key("id.national.number") {
        if let Some(card_no) = details.get("id.card.number").cloned() {
            if card_no.len() == 12 && card_no.starts_with('0') && card_no.bytes().all(|b| b.is_ascii_digit()) {
                details.insert("id.national.number".to_string(), card_no);
            }
        }
    }
    backfill_unsuffixed_script_details(details);
    reconcile_latin_names(details);
    split_full_name_if_needed(details);
}

fn backfill_unsuffixed_script_details(details: &mut BTreeMap<String, String>) {
    const SCRIPT_SUFFIXES: &[&str] = &[".kanji", ".kana", ".latin", ".hiragana", ".hangul"];
    let mut backfill: BTreeMap<String, (usize, String)> = BTreeMap::new();
    for (key, value) in details.iter() {
        if value.trim().is_empty() {
            continue;
        }
        for (rank, suffix) in SCRIPT_SUFFIXES.iter().enumerate() {
            if let Some(base) = key.strip_suffix(suffix) {
                if base.is_empty() || base.starts_with("name.") || details.contains_key(base) {
                    break;
                }
                match backfill.get(base) {
                    Some((existing_rank, _)) if *existing_rank <= rank => {}
                    _ => {
                        backfill.insert(base.to_string(), (rank, value.clone()));
                    }
                }
                break;
            }
        }
    }
    for (base, (_, value)) in backfill {
        details.insert(base, value);
    }
}

fn has_vietnamese_diacritics(text: &str) -> bool {
    text.chars().any(|c| {
        let lo = c.to_lowercase().next().unwrap_or(c);
        matches!(lo, 'ă' | 'â' | 'đ' | 'ê' | 'ô' | 'ơ' | 'ư')
            || ('\u{1EA0}'..='\u{1EF9}').contains(&c)
    })
}

fn split_full_name_if_needed(details: &mut BTreeMap<String, String>) {
    if details.contains_key("name.family") && details.contains_key("name.given") {
        return;
    }
    let Some(full) = details.get("name.full").cloned() else {
        return;
    };
    let trimmed = full.trim();
    if trimmed.is_empty() {
        return;
    }
    if let Some((left, right)) = trimmed.split_once(',') {
        let family = left.trim();
        let given = right.trim();
        if !family.is_empty() && !given.is_empty() {
            details
                .entry("name.family".to_string())
                .or_insert_with(|| family.to_string());
            details
                .entry("name.given".to_string())
                .or_insert_with(|| given.to_string());
        }
        return;
    }

    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() < 2 {
        return;
    }

    let is_family_first = !is_latin_script(trimmed)
        || has_vietnamese_diacritics(trimmed)
        || family_first_country(details);

    let (family, given) = if is_family_first {
        (parts[0].to_string(), parts[1..].join(" "))
    } else if parts.len() >= 3
        && matches!(
            parts[parts.len() - 2].to_ascii_lowercase().as_str(),
            "van" | "von" | "de" | "del" | "della" | "da" | "di" | "dos" | "das" | "du" | "la" | "le"
        )
    {
        let split_at = parts.len() - 2;
        (parts[split_at..].join(" "), parts[..split_at].join(" "))
    } else {
        let last = parts.len() - 1;
        (parts[last].to_string(), parts[..last].join(" "))
    };

    if !family.is_empty() && !given.is_empty() {
        details.entry("name.family".to_string()).or_insert(family);
        details.entry("name.given".to_string()).or_insert(given);
    }
}

fn is_latin_script(text: &str) -> bool {
    let mut has_alpha = false;
    for ch in text.chars() {
        if ch.is_alphabetic() {
            has_alpha = true;
            let code = ch as u32;
            if code >= 0x0250 && !(0x1E00..=0x1EFF).contains(&code) {
                return false;
            }
        }
    }
    has_alpha
}

fn fold_ascii_letters(text: &str) -> String {
    text.chars()
        .filter_map(|ch| {
            let lower = ch.to_lowercase().next().unwrap_or(ch);
            if lower.is_ascii_alphabetic() {
                Some(lower)
            } else {
                match lower {
                    'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ă' | 'ą' => Some('a'),
                    'ç' | 'ć' | 'č' => Some('c'),
                    'ď' | 'đ' => Some('d'),
                    'è' | 'é' | 'ê' | 'ë' | 'ě' | 'ę' => Some('e'),
                    'ì' | 'í' | 'î' | 'ï' => Some('i'),
                    'ĺ' | 'ľ' | 'ł' => Some('l'),
                    'ñ' | 'ń' | 'ň' => Some('n'),
                    'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ơ' => Some('o'),
                    'ŕ' | 'ř' => Some('r'),
                    'ś' | 'š' | 'ş' | 'ș' => Some('s'),
                    'ť' | 'ț' => Some('t'),
                    'ù' | 'ú' | 'û' | 'ü' | 'ů' | 'ư' => Some('u'),
                    'ý' | 'ÿ' => Some('y'),
                    'ź' | 'ż' | 'ž' => Some('z'),
                    _ => None,
                }
            }
        })
        .collect()
}

fn family_first_country(details: &BTreeMap<String, String>) -> bool {
    let raw = details
        .get("person.nationality.code")
        .or_else(|| details.get("person.nationality"))
        .or_else(|| details.get("nationality"))
        .or_else(|| details.get("id.passport.country"))
        .or_else(|| details.get("birth.country"));
    let Some(raw) = raw else {
        return false;
    };
    if let Some(info) = lookup_country(raw) {
        return matches!(info.alpha2, "VN" | "CN" | "JP" | "KR" | "KP" | "TW" | "HU");
    }
    matches!(
        raw.trim().to_ascii_uppercase().as_str(),
        "VNM" | "VN" | "CHN" | "CN" | "JPN" | "JP" | "KOR" | "KR" | "PRK" | "KP" | "TWN" | "TW" | "HUN" | "HU"
    )
}

fn title_case_if_all_caps(text: &str) -> String {
    let has_upper = text.chars().any(char::is_uppercase);
    let has_lower = text.chars().any(char::is_lowercase);
    if has_upper && !has_lower {
        title_case_latin_name(text)
    } else {
        text.to_string()
    }
}

fn reconcile_latin_names(details: &mut BTreeMap<String, String>) {
    let has_non_latin_parts = details
        .get("name.given")
        .is_some_and(|s| !is_latin_script(s))
        || details
            .get("name.family")
            .is_some_and(|s| !is_latin_script(s))
        || details
            .get("name.full")
            .is_some_and(|s| !is_latin_script(s));

    if !has_non_latin_parts {
        if !details.contains_key("name.given") {
            if let Some(given_latin) = details.get("name.given.latin").cloned() {
                details.insert(
                    "name.given".to_string(),
                    title_case_if_all_caps(&given_latin),
                );
            }
        }
        if !details.contains_key("name.family") {
            if let Some(family_latin) = details.get("name.family.latin").cloned() {
                details.insert(
                    "name.family".to_string(),
                    title_case_if_all_caps(&family_latin),
                );
            }
        }
    }

    let given = details
        .get("name.given")
        .filter(|s| is_latin_script(s))
        .cloned()
        .or_else(|| details.get("name.given.latin").map(|s| title_case_if_all_caps(s)));
    let family = details
        .get("name.family")
        .filter(|s| is_latin_script(s))
        .cloned()
        .or_else(|| details.get("name.family.latin").map(|s| title_case_if_all_caps(s)));

    if let (Some(given_val), Some(family_val)) = (given, family) {
        let canonical = if family_first_country(details) {
            format!("{} {}", family_val.trim(), given_val.trim())
        } else {
            format!("{} {}", given_val.trim(), family_val.trim())
        };
        let canonical = canonical.trim().to_string();
        match details.get("name.full") {
            None => {
                details.insert("name.full".to_string(), canonical);
            }
            Some(existing) if is_latin_script(existing) => {
                let folded_full = fold_ascii_letters(existing);
                let folded_family = fold_ascii_letters(&family_val);
                let first_given = given_val.split_whitespace().next().unwrap_or(&given_val);
                let folded_given = fold_ascii_letters(first_given);
                let matches_parts = !folded_family.is_empty()
                    && !folded_given.is_empty()
                    && folded_full.contains(&folded_family)
                    && folded_full.contains(&folded_given);
                if !matches_parts && !canonical.is_empty() {
                    details.insert("name.full".to_string(), canonical);
                }
            }
            Some(_) => {}
        }
        return;
    }

    if !details.contains_key("name.full") {
        if let Some(latin) = details.get("name.full.latin").cloned() {
            details.insert("name.full".to_string(), title_case_if_all_caps(&latin));
        }
    }
}
