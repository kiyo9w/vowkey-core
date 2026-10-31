//! Details a document carries in a standard form: machine-readable zones and barcode payloads.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{
    aamva::AamvaCard,
    cccd::CccdCard,
    format::{to_fullwidth_katakana, to_hiragana, to_wareki, to_zengin_halfwidth_kana},
    mrz::{Mrz, find_mrz},
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

    if let Some(kana) = details.get("name.full.kana").cloned() {
        details
            .entry("name.full.hiragana".to_string())
            .or_insert_with(|| to_hiragana(&kana));
        details
            .entry("name.full.zengin".to_string())
            .or_insert_with(|| to_zengin_halfwidth_kana(&kana));
        let parts: Vec<&str> = kana.split_whitespace().collect();
        if let [family, given] = parts.as_slice() {
            details
                .entry("name.family.kana".to_string())
                .or_insert_with(|| (*family).to_string());
            details
                .entry("name.given.kana".to_string())
                .or_insert_with(|| (*given).to_string());
            details
                .entry("name.family.hiragana".to_string())
                .or_insert_with(|| to_hiragana(family));
            details
                .entry("name.given.hiragana".to_string())
                .or_insert_with(|| to_hiragana(given));
        }
    }
    if let Some(hira) = details.get("name.full.hiragana").cloned() {
        details
            .entry("name.full.kana".to_string())
            .or_insert_with(|| to_fullwidth_katakana(&hira));
        let parts: Vec<&str> = hira.split_whitespace().collect();
        if let [family, given] = parts.as_slice() {
            details
                .entry("name.family.hiragana".to_string())
                .or_insert_with(|| (*family).to_string());
            details
                .entry("name.given.hiragana".to_string())
                .or_insert_with(|| (*given).to_string());
            details
                .entry("name.family.kana".to_string())
                .or_insert_with(|| to_fullwidth_katakana(family));
            details
                .entry("name.given.kana".to_string())
                .or_insert_with(|| to_fullwidth_katakana(given));
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
    if !details.contains_key("name.full") {
        if let Some(latin) = details.get("name.full.latin").cloned() {
            details.insert("name.full".to_string(), latin);
        }
    }
}
