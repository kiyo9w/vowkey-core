//! Reads Word, Excel and Korean HWPX files as documents, and classifies whether an office archive
//! is a blank or partially blank form to fill or a populated source document to read.

use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::{
    decision::Reading,
    file_fill::{read_zip_entries, xml_unescape},
    matcher::{FormFieldInput, classify_field},
};

/// The most rows and columns of a sheet that are read.
const MAX_ROWS: usize = 400;
const MAX_COLUMNS: usize = 40;

static BLOCK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<w:tbl\b[^>]*>.*?</w:tbl>|<w:p\b[^>]*>.*?</w:p>").expect("a valid pattern")
});
static ROW: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:tr\b[^>]*>.*?</w:tr>").expect("a valid pattern"));
static CELL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:tc\b[^>]*>.*?</w:tc>").expect("a valid pattern"));
static TEXT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<w:t(?:\s[^>]*)?>(.*?)</w:t>|<w:tab\b[^/>]*/>|<w:br\b[^/>]*/>")
        .expect("a valid pattern")
});

static RPH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<(?:[a-zA-Z0-9_]+:)?rPh\b[^>]*>.*?</(?:[a-zA-Z0-9_]+:)?rPh>")
        .expect("a valid pattern")
});
static SHARED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<(?:[a-zA-Z0-9_]+:)?si\b[^>]*>(.*?)</(?:[a-zA-Z0-9_]+:)?si>")
        .expect("a valid pattern")
});
static SHEET_TEXT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<(?:[a-zA-Z0-9_]+:)?t(?:\s[^>]*)?>(.*?)</(?:[a-zA-Z0-9_]+:)?t>")
        .expect("a valid pattern")
});
static SHEET_CELL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<(?:[a-zA-Z0-9_]+:)?c\b([^>]*?)(?:/>|>(.*?)</(?:[a-zA-Z0-9_]+:)?c>)")
        .expect("a valid pattern")
});
static SHEET_MERGE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<(?:[a-zA-Z0-9_]+:)?mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)""#)
        .expect("a valid pattern")
});
static VALUE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<(?:[a-zA-Z0-9_]+:)?v(?:\s[^>]*)?>(.*?)</(?:[a-zA-Z0-9_]+:)?v>")
        .expect("a valid pattern")
});
static REFERENCE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\br="([A-Z]+)(\d+)""#).expect("a valid pattern"));
static KIND: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\bt="([^"]+)""#).expect("a valid pattern"));

static HWPX_BLOCK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<hp:tbl\b[^>]*>.*?</hp:tbl>|<hp:p\b[^>]*>.*?</hp:p>").expect("a valid pattern")
});
static HWPX_ROW: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:tr\b[^>]*>.*?</hp:tr>").expect("a valid pattern"));
static HWPX_CELL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:tc\b[^>]*>.*?</hp:tc>").expect("a valid pattern"));
static HWPX_TEXT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:t(?:\s[^>]*)?>(.*?)</hp:t>").expect("a valid pattern"));

static BLANK_SLOT_TEXT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"_{3,}|…{2,}|\.{5,}|・{4,}|[□☐]|\[\s*\]|（\s{2,}）|\(\s{3,}\)")
        .expect("a valid pattern")
});
static INLINE_KV: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^([^:：_\.…\n]{2,50}?)\s*[:：]\s*(\S.+)$").expect("a valid pattern")
});
static W_SDT_BLOCK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:sdt\b[^>]*>(.*?)</w:sdt>").expect("a valid pattern"));
static W_SDT_PR: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:sdtPr\b[^>]*>(.*?)</w:sdtPr>").expect("a valid pattern"));
static W_SDT_CONTENT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<w:sdtContent\b[^>]*>(.*?)</w:sdtContent>").expect("a valid pattern")
});

/// Structural classification of an office archive (`.docx`, `.xlsx`, `.hwpx`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeClassification {
    /// `"form"`, `"document"`, or `"ambiguous"`.
    pub kind: String,
    /// Empty cells next to labels, blank underline leaders, unchecked checkboxes, or empty controls.
    pub blank_slots: usize,
    /// Populated `label -> value` pairs or verified machine-readable identity lines.
    pub populated_pairs: usize,
}

fn words_in(xml: &str) -> String {
    let mut text = String::new();
    for found in TEXT.captures_iter(xml) {
        match found.get(1) {
            Some(piece) => text.push_str(&xml_unescape(piece.as_str())),
            None => text.push(' '),
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn hwpx_words_in(xml: &str) -> String {
    let mut text = String::new();
    for found in HWPX_TEXT.captures_iter(xml) {
        if let Some(piece) = found.get(1) {
            text.push_str(&xml_unescape(piece.as_str()));
            text.push(' ');
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_shared_strings(entries: &[crate::file_fill::ZipEntry]) -> Vec<String> {
    entries
        .iter()
        .find(|e| e.name == "xl/sharedStrings.xml")
        .map(|e| {
            let raw_xml = String::from_utf8_lossy(&e.data);
            let stripped = RPH.replace_all(&raw_xml, "");
            SHARED
                .captures_iter(&stripped)
                .map(|si| {
                    SHEET_TEXT
                        .captures_iter(si.get(1).map_or("", |m| m.as_str()))
                        .map(|t| xml_unescape(t.get(1).map_or("", |m| m.as_str())))
                        .collect::<String>()
                        .trim()
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn sorted_worksheets(entries: &[crate::file_fill::ZipEntry]) -> Vec<&crate::file_fill::ZipEntry> {
    let mut sheets: Vec<&crate::file_fill::ZipEntry> = entries
        .iter()
        .filter(|e| e.name.starts_with("xl/worksheets/sheet") && e.name.ends_with(".xml"))
        .collect();
    sheets.sort_by(|a, b| {
        let number = |name: &str| {
            name.trim_start_matches("xl/worksheets/sheet")
                .trim_end_matches(".xml")
                .parse::<u32>()
                .unwrap_or(0)
        };
        number(&a.name).cmp(&number(&b.name))
    });
    sheets
}

fn sorted_hwpx_sections(
    entries: &[crate::file_fill::ZipEntry],
) -> Vec<&crate::file_fill::ZipEntry> {
    let mut sections: Vec<&crate::file_fill::ZipEntry> = entries
        .iter()
        .filter(|e| e.name.starts_with("Contents/section") && e.name.ends_with(".xml"))
        .collect();
    sections.sort_by(|a, b| {
        let number = |name: &str| {
            name.trim_start_matches("Contents/section")
                .trim_end_matches(".xml")
                .parse::<u32>()
                .unwrap_or(0)
        };
        number(&a.name).cmp(&number(&b.name))
    });
    sections
}

/// The paragraphs and tables of a Word file, in order: a paragraph is a row of one cell, a table row
/// a row of its cells.
pub fn reading_from_docx(bytes: &[u8]) -> Option<Reading> {
    let entries = read_zip_entries(bytes).ok()?;
    let document = entries.iter().find(|e| e.name == "word/document.xml")?;
    let xml = String::from_utf8_lossy(&document.data);
    let mut rows: Vec<Vec<String>> = Vec::new();
    for block in BLOCK.find_iter(&xml) {
        let block = block.as_str();
        if block.starts_with("<w:tbl") {
            for row in ROW.find_iter(block) {
                let cells: Vec<String> = CELL
                    .find_iter(row.as_str())
                    .map(|c| words_in(c.as_str()))
                    .collect();
                if cells.iter().any(|c| !c.is_empty()) {
                    rows.push(cells);
                }
            }
        } else {
            let text = words_in(block);
            if !text.is_empty() {
                rows.push(vec![text]);
            }
        }
    }
    (!rows.is_empty()).then(|| Reading::from_grid(&rows))
}

fn column_number(letters: &str) -> usize {
    letters
        .bytes()
        .fold(0, |n, b| n * 26 + usize::from(b - b'A' + 1))
        .saturating_sub(1)
}

/// The cells of each sheet of an Excel file, one page for each sheet, with `<rPh>` furigana runs
/// stripped so cell labels keep their printed wording.
pub fn reading_from_xlsx(bytes: &[u8]) -> Option<Reading> {
    let entries = read_zip_entries(bytes).ok()?;
    let shared = parse_shared_strings(&entries);
    let sheets = sorted_worksheets(&entries);

    let mut pages = Vec::new();
    for sheet in sheets {
        let xml = String::from_utf8_lossy(&sheet.data);
        let mut grid: Vec<Vec<String>> = Vec::new();
        for cell in SHEET_CELL.captures_iter(&xml) {
            let attributes = cell.get(1).map_or("", |m| m.as_str());
            let body = cell.get(2).map_or("", |m| m.as_str());
            let Some(reference) = REFERENCE.captures(attributes) else {
                continue;
            };
            let column = column_number(reference.get(1).map_or("A", |m| m.as_str()));
            let row = reference
                .get(2)
                .and_then(|m| m.as_str().parse::<usize>().ok())
                .unwrap_or(1)
                .saturating_sub(1);
            if row >= MAX_ROWS || column >= MAX_COLUMNS {
                continue;
            }
            let kind = KIND
                .captures(attributes)
                .and_then(|k| k.get(1))
                .map_or("n", |m| m.as_str());
            let value = match kind {
                "s" => VALUE
                    .captures(body)
                    .and_then(|v| v.get(1))
                    .and_then(|i| i.as_str().trim().parse::<usize>().ok())
                    .and_then(|i| shared.get(i).cloned())
                    .unwrap_or_default(),
                "inlineStr" => {
                    let clean_body = RPH.replace_all(body, "");
                    SHEET_TEXT
                        .captures_iter(&clean_body)
                        .map(|t| xml_unescape(t.get(1).map_or("", |m| m.as_str())))
                        .collect::<String>()
                }
                _ => VALUE
                    .captures(body)
                    .and_then(|v| v.get(1))
                    .map(|v| xml_unescape(v.as_str()))
                    .unwrap_or_default(),
            };
            if value.trim().is_empty() {
                continue;
            }
            while grid.len() <= row {
                grid.push(Vec::new());
            }
            while grid[row].len() <= column {
                grid[row].push(String::new());
            }
            grid[row][column] = value.trim().to_string();
        }
        if grid.iter().any(|row| row.iter().any(|c| !c.is_empty())) {
            let mut page = Reading::from_grid(&grid).pages.into_iter().next()?;
            page.index = u32::try_from(pages.len()).unwrap_or(0);
            page.sheet = true;
            pages.push(page);
        }
    }
    (!pages.is_empty()).then_some(Reading { pages })
}

/// The paragraphs and tables of a Korean `.hwpx` file, one page per section.
pub fn reading_from_hwpx(bytes: &[u8]) -> Option<Reading> {
    let entries = read_zip_entries(bytes).ok()?;
    let sections = sorted_hwpx_sections(&entries);
    let mut pages = Vec::new();
    for section in sections {
        let xml = String::from_utf8_lossy(&section.data);
        let mut rows: Vec<Vec<String>> = Vec::new();
        for block in HWPX_BLOCK.find_iter(&xml) {
            let block = block.as_str();
            if block.starts_with("<hp:tbl") {
                for row in HWPX_ROW.find_iter(block) {
                    let cells: Vec<String> = HWPX_CELL
                        .find_iter(row.as_str())
                        .map(|c| hwpx_words_in(c.as_str()))
                        .collect();
                    if cells.iter().any(|c| !c.is_empty()) {
                        rows.push(cells);
                    }
                }
            } else {
                let text = hwpx_words_in(block);
                if !text.is_empty() {
                    rows.push(vec![text]);
                }
            }
        }
        if !rows.is_empty() {
            let mut page = Reading::from_grid(&rows).pages.into_iter().next()?;
            page.index = u32::try_from(pages.len()).unwrap_or(0);
            pages.push(page);
        }
    }
    (!pages.is_empty()).then_some(Reading { pages })
}

fn normalized_office_ext(file_name_or_ext: &str, entries: Option<&[crate::file_fill::ZipEntry]>) -> String {
    let trimmed = file_name_or_ext.trim();
    let candidate = trimmed
        .rsplit('.')
        .next()
        .unwrap_or(trimmed)
        .trim()
        .to_ascii_lowercase();
    if matches!(candidate.as_str(), "docx" | "xlsx" | "hwpx") {
        return candidate;
    }
    if let Some(list) = entries {
        if list.iter().any(|e| e.name == "word/document.xml") {
            return "docx".to_string();
        }
        if list.iter().any(|e| e.name.starts_with("xl/worksheets/sheet")) {
            return "xlsx".to_string();
        }
        if list.iter().any(|e| e.name.starts_with("Contents/section")) {
            return "hwpx".to_string();
        }
    }
    candidate
}

/// A reading of a Word, Excel or HWPX file by its file name or extension, or nothing when it
/// cannot be read.
pub fn reading_from_office(bytes: &[u8], file_name_or_ext: &str) -> Option<Reading> {
    let entries = read_zip_entries(bytes).ok();
    match normalized_office_ext(file_name_or_ext, entries.as_deref()).as_str() {
        "docx" => reading_from_docx(bytes),
        "xlsx" => reading_from_xlsx(bytes),
        "hwpx" => reading_from_hwpx(bytes),
        _ => None,
    }
}

pub(crate) fn is_sdt_placeholder_text(text: &str) -> bool {
    let lower = text.trim().to_lowercase();
    matches!(
        lower.as_str(),
        "click or tap here to enter text."
            | "click or tap here to enter text"
            | "click here to enter text."
            | "click here to enter text"
            | "tap here to enter text."
            | "tap here to enter text"
            | "click or tap to enter a date."
            | "click or tap to enter a date"
            | "choose an item."
            | "choose an item"
            | "enter text"
            | "ここをクリックしてテキストを入力してください。"
            | "ここをクリックしてテキストを入力"
    )
}

fn is_unit_token(text: &str) -> bool {
    matches!(
        text.trim(),
        "年" | "月" | "日" | "Year" | "Month" | "Day" | "・" | "男" | "女" | "Male/Female"
    )
}

fn looks_like_prompt_label(text: &str) -> bool {
    let trimmed = text.trim();
    let count = trimmed.chars().count();
    if count == 0 || count > 90 || is_unit_token(trimmed) {
        return false;
    }
    if BLANK_SLOT_TEXT.is_match(trimmed) {
        return false;
    }
    // Purely numeric, currency, or ISO-date strings are data values rather than labels.
    if trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '-' | '/' | '.' | ',' | ':' | '+' | ' ' | '¥' | '$' | '€' | '%'))
    {
        return false;
    }
    if trimmed.contains('@') && trimmed.contains('.') {
        return false;
    }
    let m = classify_field(&FormFieldInput {
        label: trimmed.to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    });
    if !m.attribute.is_empty() && m.score > 0 {
        return true;
    }
    trimmed.ends_with(':') || trimmed.ends_with('：') || count <= 32
}

fn looks_like_data_value(label: &str, candidate: &str) -> bool {
    let trimmed = candidate.trim();
    if trimmed.is_empty()
        || is_unit_token(trimmed)
        || BLANK_SLOT_TEXT.is_match(trimmed)
        || is_sdt_placeholder_text(trimmed)
    {
        return false;
    }
    // If both adjacent cells classify as distinct field labels and the right cell has no digits,
    // `@`, or punctuation typical of data, treat them as two column headers rather than a pair.
    let left_match = classify_field(&FormFieldInput {
        label: label.trim().to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    });
    let right_match = classify_field(&FormFieldInput {
        label: trimmed.to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    });
    let has_value_shape = trimmed.chars().any(|c| c.is_ascii_digit())
        || trimmed.contains('@')
        || trimmed.chars().count() > 28;
    if !has_value_shape
        && !left_match.attribute.is_empty()
        && !right_match.attribute.is_empty()
        && left_match.attribute != right_match.attribute
    {
        return false;
    }
    true
}

fn score_table_rows(rows: &[Vec<String>], blank_slots: &mut usize, populated_pairs: &mut usize) {
    for r in 0..rows.len() {
        let cells = &rows[r];
        let next_row_all_empty_under_labels = r + 1 < rows.len()
            && rows[r + 1].len() == cells.len()
            && cells.iter().filter(|c| looks_like_prompt_label(c)).count() >= 2
            && rows[r + 1].iter().all(|c| c.trim().is_empty());

        if next_row_all_empty_under_labels {
            *blank_slots += cells.iter().filter(|c| looks_like_prompt_label(c)).count();
            continue;
        }

        let next_row_populated_under_headers = r == 0
            && rows.len() >= 2
            && rows[1].len() == cells.len()
            && cells.len() >= 2
            && cells.iter().all(|c| looks_like_prompt_label(c))
            && rows[1]
                .iter()
                .zip(cells.iter())
                .any(|(val, hdr)| looks_like_data_value(hdr, val));

        if next_row_populated_under_headers {
            for (hdr, val) in cells.iter().zip(rows[1].iter()) {
                if looks_like_data_value(hdr, val) {
                    *populated_pairs += 1;
                }
            }
            continue;
        }

        let mut i = 0;
        while i < cells.len() {
            let cur = cells[i].trim();
            if cur.is_empty() {
                i += 1;
                continue;
            }
            if BLANK_SLOT_TEXT.is_match(cur) {
                *blank_slots += 1;
            } else if let Some(cap) = INLINE_KV.captures(cur) {
                let k = cap.get(1).map_or("", |m| m.as_str());
                let v = cap.get(2).map_or("", |m| m.as_str());
                if looks_like_prompt_label(k) && looks_like_data_value(k, v) {
                    *populated_pairs += 1;
                }
            }

            if i + 1 < cells.len() {
                let next = cells[i + 1].trim();
                if next.is_empty() || is_sdt_placeholder_text(next) {
                    if looks_like_prompt_label(cur) {
                        *blank_slots += 1;
                    }
                    i += 2;
                    continue;
                } else if looks_like_prompt_label(cur) && looks_like_data_value(cur, next) {
                    *populated_pairs += 1;
                    i += 2;
                    continue;
                }
            }
            i += 1;
        }
    }
}

fn parse_a1_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let split = cell_ref.find(|c: char| c.is_ascii_digit())?;
    let col_str = &cell_ref[..split];
    let row_str = &cell_ref[split..];
    if col_str.is_empty() {
        return None;
    }
    let col = col_str
        .bytes()
        .fold(0u32, |n, b| n * 26 + u32::from(b - b'A' + 1));
    let row = row_str.parse::<u32>().ok()?;
    Some((col, row))
}

/// Inspects a `.docx`, `.xlsx` or `.hwpx` archive to determine whether it is a form with blank
/// slots to fill, a populated source document to read, or ambiguous.
pub fn classify_office(bytes: &[u8], file_name: &str) -> OfficeClassification {
    let Ok(entries) = read_zip_entries(bytes) else {
        return OfficeClassification {
            kind: "ambiguous".to_string(),
            blank_slots: 0,
            populated_pairs: 0,
        };
    };

    let ext = normalized_office_ext(file_name, Some(&entries));
    let mut blank_slots = 0usize;
    let mut populated_pairs = 0usize;
    let mut prose_blocks = 0usize;
    let mut full_text = String::new();

    match ext.as_str() {
        "docx" => {
            let Some(doc_entry) = entries.iter().find(|e| e.name == "word/document.xml") else {
                return OfficeClassification {
                    kind: "ambiguous".to_string(),
                    blank_slots: 0,
                    populated_pairs: 0,
                };
            };
            let xml = String::from_utf8_lossy(&doc_entry.data);

            // Count FORMTEXT / FORMCHECKBOX controls and <w:sdt> content controls.
            blank_slots += xml.matches("FORMTEXT").count() + xml.matches("FORMCHECKBOX").count();
            for sdt in W_SDT_BLOCK.captures_iter(&xml) {
                let inner = sdt.get(1).map_or("", |m| m.as_str());
                let pr = W_SDT_PR
                    .captures(inner)
                    .and_then(|c| c.get(1))
                    .map_or("", |m| m.as_str());
                if pr.contains("<w:docPartObj") || pr.contains("<w:bibliography") {
                    continue;
                }
                let content = W_SDT_CONTENT
                    .captures(inner)
                    .and_then(|c| c.get(1))
                    .map_or("", |m| m.as_str());
                let content_text = words_in(content);
                let showing_plc = pr.contains("<w:showingPlcHdr")
                    && !pr.contains("w:val=\"0\"")
                    && !pr.contains("w:val=\"false\"");
                let unchecked_box =
                    pr.contains("checkbox") && (pr.contains("val=\"0\"") || content_text == "☐");
                if showing_plc
                    || unchecked_box
                    || content_text.is_empty()
                    || is_sdt_placeholder_text(&content_text)
                {
                    blank_slots += 1;
                }
            }

            for block in BLOCK.find_iter(&xml) {
                let b = block.as_str();
                if b.starts_with("<w:tbl") {
                    let mut table_rows = Vec::new();
                    for row in ROW.find_iter(b) {
                        let cells: Vec<String> = CELL
                            .find_iter(row.as_str())
                            .map(|c| {
                                let t = words_in(c.as_str());
                                if !t.is_empty() {
                                    full_text.push_str(&t);
                                    full_text.push('\n');
                                }
                                t
                            })
                            .collect();
                        if !cells.is_empty() {
                            table_rows.push(cells);
                        }
                    }
                    score_table_rows(&table_rows, &mut blank_slots, &mut populated_pairs);
                } else {
                    let txt = words_in(b);
                    if txt.is_empty() {
                        continue;
                    }
                    full_text.push_str(&txt);
                    full_text.push('\n');
                    if BLANK_SLOT_TEXT.is_match(&txt) {
                        blank_slots += 1;
                    } else if let Some(cap) = INLINE_KV.captures(&txt) {
                        let k = cap.get(1).map_or("", |m| m.as_str());
                        let v = cap.get(2).map_or("", |m| m.as_str());
                        if looks_like_prompt_label(k) && looks_like_data_value(k, v) {
                            populated_pairs += 1;
                        } else if txt.chars().count() >= 60 {
                            prose_blocks += 1;
                        }
                    } else if txt.chars().count() >= 60 {
                        prose_blocks += 1;
                    }
                }
            }
        }
        "xlsx" => {
            let shared = parse_shared_strings(&entries);
            let sheets = sorted_worksheets(&entries);
            for sheet in sheets {
                let xml = String::from_utf8_lossy(&sheet.data);
                let mut merges: Vec<(u32, u32, u32, u32)> = Vec::new();
                for cap in SHEET_MERGE.captures_iter(&xml) {
                    if let (Some(s), Some(e)) = (
                        cap.get(1).and_then(|m| parse_a1_ref(m.as_str())),
                        cap.get(2).and_then(|m| parse_a1_ref(m.as_str())),
                    ) {
                        merges.push((s.0, s.1, e.0, e.1));
                    }
                }

                let mut cell_texts: HashMap<(u32, u32), String> = HashMap::new();
                let mut existing_coords: std::collections::HashSet<(u32, u32)> =
                    std::collections::HashSet::new();
                for cell in SHEET_CELL.captures_iter(&xml) {
                    let attrs = cell.get(1).map_or("", |m| m.as_str());
                    let body = cell.get(2).map_or("", |m| m.as_str());
                    let Some(reference) = REFERENCE.captures(attrs) else {
                        continue;
                    };
                    let col = u32::try_from(column_number(
                        reference.get(1).map_or("A", |m| m.as_str()),
                    ) + 1)
                    .unwrap_or(1);
                    let row = reference
                        .get(2)
                        .and_then(|m| m.as_str().parse::<u32>().ok())
                        .unwrap_or(1);
                    if row as usize > MAX_ROWS || col as usize > MAX_COLUMNS {
                        continue;
                    }
                    existing_coords.insert((col, row));
                    let kind = KIND
                        .captures(attrs)
                        .and_then(|k| k.get(1))
                        .map_or("n", |m| m.as_str());
                    let val = match kind {
                        "s" => VALUE
                            .captures(body)
                            .and_then(|v| v.get(1))
                            .and_then(|i| i.as_str().trim().parse::<usize>().ok())
                            .and_then(|i| shared.get(i).cloned())
                            .unwrap_or_default(),
                        "inlineStr" => {
                            let clean_body = RPH.replace_all(body, "");
                            SHEET_TEXT
                                .captures_iter(&clean_body)
                                .map(|t| xml_unescape(t.get(1).map_or("", |m| m.as_str())))
                                .collect::<String>()
                        }
                        _ => VALUE
                            .captures(body)
                            .and_then(|v| v.get(1))
                            .map(|v| xml_unescape(v.as_str()))
                            .unwrap_or_default(),
                    };
                    let trimmed = val.trim();
                    if !trimmed.is_empty() {
                        full_text.push_str(trimmed);
                        full_text.push('\n');
                        cell_texts.insert((col, row), trimmed.to_string());
                    }
                }

                let mut rows_map: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
                for ((col, row), text) in &cell_texts {
                    rows_map.entry(*row).or_default().push((*col, text.clone()));
                }
                for list in rows_map.values_mut() {
                    list.sort_by_key(|(c, _)| *c);
                }
                let mut row_nums: Vec<u32> = rows_map.keys().copied().collect();
                row_nums.sort_unstable();

                // Vertical header-above-data or header-above-blank check on 2-row tables
                if row_nums.len() >= 2 {
                    for w in row_nums.windows(2) {
                        let (r0, r1) = (w[0], w[1]);
                        if r1 == r0 + 1 {
                            let hdrs = &rows_map[&r0];
                            if hdrs.len() >= 2 && hdrs.iter().all(|(_, t)| looks_like_prompt_label(t)) {
                                for (c, h_txt) in hdrs {
                                    if let Some(v_txt) = cell_texts.get(&(*c, r1)) {
                                        if looks_like_data_value(h_txt, v_txt) {
                                            populated_pairs += 1;
                                        }
                                    } else if existing_coords.contains(&(*c, r1)) {
                                        blank_slots += 1;
                                    }
                                }
                            }
                        }
                    }
                }

                for &row in &row_nums {
                    let items = &rows_map[&row];
                    for (idx, (col, text)) in items.iter().enumerate() {
                        if BLANK_SLOT_TEXT.is_match(text) {
                            blank_slots += 1;
                            continue;
                        }
                        if is_unit_token(text) {
                            continue;
                        }
                        let mut next_non_unit_col = u32::MAX;
                        let mut next_non_unit_text: Option<&str> = None;
                        let mut has_unit_cells = false;
                        for (ncol, ntext) in items.iter().skip(idx + 1) {
                            if is_unit_token(ntext) {
                                has_unit_cells = true;
                            } else {
                                next_non_unit_col = *ncol;
                                next_non_unit_text = Some(ntext.as_str());
                                break;
                            }
                        }
                        if !looks_like_prompt_label(text) {
                            continue;
                        }
                        let own_end_col = merges
                            .iter()
                            .filter(|&&(sc, sr, _, er)| sc == *col && sr <= row && row <= er)
                            .map(|&(_, _, ec, _)| ec)
                            .max()
                            .unwrap_or(*col);

                        let empty_merge_after = merges.iter().any(|&(sc, sr, ec, _)| {
                            (sr == row || sr == row + 1)
                                && sc > own_end_col
                                && ec < next_non_unit_col
                                && !cell_texts.contains_key(&(sc, sr))
                        });
                        if empty_merge_after || has_unit_cells {
                            blank_slots += 1;
                        } else if own_end_col + 1 < next_non_unit_col
                            && existing_coords.contains(&(own_end_col + 1, row))
                            && !cell_texts.contains_key(&(own_end_col + 1, row))
                        {
                            blank_slots += 1;
                        } else if let Some(ntext) = next_non_unit_text
                            && next_non_unit_col <= own_end_col + 2
                            && looks_like_data_value(text, ntext)
                        {
                            populated_pairs += 1;
                        }
                    }
                }
            }
        }
        "hwpx" => {
            for section in sorted_hwpx_sections(&entries) {
                let xml = String::from_utf8_lossy(&section.data);
                for block in HWPX_BLOCK.find_iter(&xml) {
                    let b = block.as_str();
                    if b.starts_with("<hp:tbl") {
                        let mut table_rows = Vec::new();
                        for row in HWPX_ROW.find_iter(b) {
                            let cells: Vec<String> = HWPX_CELL
                                .find_iter(row.as_str())
                                .map(|c| {
                                    let t = hwpx_words_in(c.as_str());
                                    if !t.is_empty() {
                                        full_text.push_str(&t);
                                        full_text.push('\n');
                                    }
                                    t
                                })
                                .collect();
                            if !cells.is_empty() {
                                table_rows.push(cells);
                            }
                        }
                        score_table_rows(&table_rows, &mut blank_slots, &mut populated_pairs);
                    } else {
                        let txt = hwpx_words_in(b);
                        if txt.is_empty() {
                            continue;
                        }
                        full_text.push_str(&txt);
                        full_text.push('\n');
                        if BLANK_SLOT_TEXT.is_match(&txt) {
                            blank_slots += 1;
                        } else if txt.chars().count() >= 60 {
                            prose_blocks += 1;
                        }
                    }
                }
            }
        }
        _ => {
            return OfficeClassification {
                kind: "ambiguous".to_string(),
                blank_slots: 0,
                populated_pairs: 0,
            };
        }
    }

    let mrz_zones = crate::mrz::find_mrz(&full_text);
    if !mrz_zones.is_empty() {
        populated_pairs += mrz_zones.len() * 4;
    }

    let doc_signals = populated_pairs + prose_blocks * 2;
    let kind = if blank_slots > 0 && populated_pairs == 0 && mrz_zones.is_empty() {
        "form"
    } else if blank_slots >= 2 && blank_slots >= populated_pairs {
        "form"
    } else if blank_slots == 0 && (doc_signals >= 1 || !mrz_zones.is_empty()) {
        "document"
    } else if populated_pairs >= blank_slots.saturating_mul(3) && populated_pairs >= 3 {
        "document"
    } else {
        "ambiguous"
    };

    OfficeClassification {
        kind: kind.to_string(),
        blank_slots,
        populated_pairs,
    }
}
