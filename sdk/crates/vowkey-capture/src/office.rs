//! Reads Word and Excel files as documents: the paragraphs and table cells of a Word file, the
//! cells of each sheet of an Excel file, with the row and column each sits in, so that what is left
//! of a cell and above it is found as on a printed page.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::{
    decision::Reading,
    file_fill::{read_zip_entries, xml_unescape},
};

/// The most rows and columns of a sheet that are read.
const MAX_ROWS: usize = 400;
const MAX_COLUMNS: usize = 40;

static BLOCK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<w:tbl>.*?</w:tbl>|<w:p[ >].*?</w:p>").expect("a valid pattern"));
static ROW: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<w:tr[ >].*?</w:tr>").expect("a valid pattern"));
static CELL: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<w:tc>.*?</w:tc>").expect("a valid pattern"));
static TEXT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:t(?:\s[^>]*)?>(.*?)</w:t>|<w:tab/>|<w:br/>").expect("a valid pattern"));
static SHARED: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<si>(.*?)</si>").expect("a valid pattern"));
static SHEET_TEXT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<t(?:\s[^>]*)?>(.*?)</t>").expect("a valid pattern"));
static SHEET_CELL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<c\s([^>]*?)(?:/>|>(.*?)</c>)").expect("a valid pattern"));
static VALUE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?s)<v>(.*?)</v>").expect("a valid pattern"));
static REFERENCE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\br="([A-Z]+)(\d+)""#).expect("a valid pattern"));
static KIND: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\bt="(\w+)""#).expect("a valid pattern"));

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

/// The paragraphs and tables of a Word file, in order: a paragraph is a row of one cell, a table row
/// a row of its cells.
pub fn reading_from_docx(bytes: &[u8]) -> Option<Reading> {
    let entries = read_zip_entries(bytes).ok()?;
    let document = entries.iter().find(|e| e.name == "word/document.xml")?;
    let xml = String::from_utf8_lossy(&document.data);
    let mut rows: Vec<Vec<String>> = Vec::new();
    for block in BLOCK.find_iter(&xml) {
        let block = block.as_str();
        if block.starts_with("<w:tbl>") {
            for row in ROW.find_iter(block) {
                let cells: Vec<String> = CELL.find_iter(row.as_str()).map(|c| words_in(c.as_str())).collect();
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
    letters.bytes().fold(0, |n, b| n * 26 + usize::from(b - b'A' + 1)) - 1
}

/// The cells of each sheet of an Excel file, one page for each sheet.
pub fn reading_from_xlsx(bytes: &[u8]) -> Option<Reading> {
    let entries = read_zip_entries(bytes).ok()?;
    let shared: Vec<String> = entries
        .iter()
        .find(|e| e.name == "xl/sharedStrings.xml")
        .map(|e| {
            let xml = String::from_utf8_lossy(&e.data);
            SHARED
                .captures_iter(&xml)
                .map(|si| {
                    SHEET_TEXT
                        .captures_iter(si.get(1).map_or("", |m| m.as_str()))
                        .map(|t| xml_unescape(t.get(1).map_or("", |m| m.as_str())))
                        .collect::<String>()
                })
                .collect()
        })
        .unwrap_or_default();

    let mut sheets: Vec<&crate::file_fill::ZipEntry> =
        entries.iter().filter(|e| e.name.starts_with("xl/worksheets/sheet") && e.name.ends_with(".xml")).collect();
    sheets.sort_by(|a, b| {
        let number = |name: &str| name.trim_start_matches("xl/worksheets/sheet").trim_end_matches(".xml").parse::<u32>().unwrap_or(0);
        number(&a.name).cmp(&number(&b.name))
    });

    let mut pages = Vec::new();
    for sheet in sheets {
        let xml = String::from_utf8_lossy(&sheet.data);
        let mut grid: Vec<Vec<String>> = Vec::new();
        for cell in SHEET_CELL.captures_iter(&xml) {
            let attributes = cell.get(1).map_or("", |m| m.as_str());
            let body = cell.get(2).map_or("", |m| m.as_str());
            let Some(reference) = REFERENCE.captures(attributes) else { continue };
            let column = column_number(reference.get(1).map_or("A", |m| m.as_str()));
            let row = reference.get(2).and_then(|m| m.as_str().parse::<usize>().ok()).unwrap_or(1).saturating_sub(1);
            if row >= MAX_ROWS || column >= MAX_COLUMNS {
                continue;
            }
            let kind = KIND.captures(attributes).and_then(|k| k.get(1)).map_or("n", |m| m.as_str());
            let value = match kind {
                "s" => VALUE
                    .captures(body)
                    .and_then(|v| v.get(1))
                    .and_then(|i| i.as_str().parse::<usize>().ok())
                    .and_then(|i| shared.get(i).cloned())
                    .unwrap_or_default(),
                "inlineStr" => SHEET_TEXT
                    .captures_iter(body)
                    .map(|t| xml_unescape(t.get(1).map_or("", |m| m.as_str())))
                    .collect::<String>(),
                _ => VALUE.captures(body).and_then(|v| v.get(1)).map(|v| xml_unescape(v.as_str())).unwrap_or_default(),
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
            grid[row][column] = value;
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

/// A reading of a Word or Excel file by its extension, or nothing when it cannot be read.
pub fn reading_from_office(bytes: &[u8], extension: &str) -> Option<Reading> {
    match extension.trim_start_matches('.').to_lowercase().as_str() {
        "docx" => reading_from_docx(bytes),
        "xlsx" => reading_from_xlsx(bytes),
        _ => None,
    }
}

