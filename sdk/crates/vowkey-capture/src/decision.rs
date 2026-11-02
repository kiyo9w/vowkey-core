//! Reads a document by asking a Decision model what each printed piece of it is.
//!
//! The pieces come from a reader with their place on the page. Code finds the printed words
//! beside each piece, so the model sees a value together with its label, and the model chooses
//! from the list of details a vault keeps, or says the piece holds none. The text of the piece is
//! the value; the model never writes one. Two rounds keep each question short: first the group a
//! piece belongs to (a name, an address, a bank detail), then the detail within the group.
//!
//! Nothing here sends anything. [`Plan`] makes the requests, in the wire format of Jev's
//! `/v1/systemone` that Decision speaks, and reads the answers back, so the same code runs in the
//! desktop app, in a browser and in tests.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    document::{
        CapturedDocument, DetailSource, Locator, derive_companion_details, extract_payload_details,
    },
    normalize::normalize_value,
    vocab::{self, DETAILS, GROUPS, KINDS},
};

/// Questions asked in one request. A request holds the pieces once and the questions after them.
const QUESTIONS_PER_REQUEST: usize = 50;
/// The most pieces of a document that are asked about.
const MAX_PIECES: usize = 400;
/// How many printed words near a piece are given with it, and how long each may be.
const NEAR_WORDS: usize = 4;
const NEAR_LENGTH: usize = 60;
/// A piece is cut into parts only when it has between two and this many; a longer one is a sentence.
const MAX_PARTS: usize = 24;
/// The most parts of a document that are asked about.
const MAX_PART_QUESTIONS: usize = 300;
/// The groups whose pieces often hold several details at once: a name with its family and given
/// parts, an address, a bank line, a line of a work history.
const GROUPS_WITH_PARTS: [&str; 6] = ["name", "address", "work", "bank", "emergency", "education"];
/// The groups whose values run together without a space, so a cut falls at a unit of the address.
const GROUPS_OF_ADDRESSES: [&str; 3] = ["address", "work", "emergency"];

/// What a reader found on the pages of a document, each piece with its place on the page.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Reading {
    /// The pages, in order.
    pub pages: Vec<ReadPage>,
}

/// One page of a reading.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadPage {
    /// The page number, from 0.
    #[serde(default)]
    pub index: u32,
    /// Width over height of the page.
    #[serde(default = "square")]
    pub aspect: f32,
    /// The pieces of text on the page.
    pub pieces: Vec<ReadPiece>,
    /// Whether the pieces are the cells of a table or a sheet, where each cell holds its own value
    /// and two cells side by side are never one.
    #[serde(default)]
    pub cells: bool,
    /// Whether the cells are those of an Excel sheet, so a cell has an A1 reference.
    #[serde(default)]
    pub sheet: bool,
    /// Fraction of lines whose recognition confidence was uncertain, when reported by the reader.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsure: Option<f32>,
    /// Median height of a printed line in pixels, when reported by the reader.
    #[serde(default, rename = "lineHeight", skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f32>,
}

/// A piece of printed text and its box, as fractions of the page from its top left corner. A piece
/// with no box has all four at zero, as in a file that has no layout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadPiece {
    /// The text.
    pub text: String,
    /// Left edge.
    #[serde(default)]
    pub x: f32,
    /// Top edge.
    #[serde(default)]
    pub y: f32,
    /// Width.
    #[serde(default)]
    pub w: f32,
    /// Height.
    #[serde(default)]
    pub h: f32,
    /// The row of a cell, from 0.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<u32>,
    /// The column of a cell, from 0 (A is 0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    /// Recognition confidence in `0.0..=1.0`, when reported by the OCR reader.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

fn square() -> f32 {
    1.0
}

impl Reading {
    /// A reading of plain text, one piece for each line.
    pub fn from_text(text: &str) -> Reading {
        let pieces = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|line| ReadPiece {
                text: line.to_string(),
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0,
                row: None,
                column: None,
                confidence: None,
            })
            .collect();
        Reading { pages: vec![ReadPage { index: 0, aspect: 1.0, pieces, cells: false, sheet: false, unsure: None, line_height: None }] }
    }

    /// A reading of a grid of cells, such as a sheet or a table: each cell sits where its row and
    /// column put it, so what is left of it and above it is found as on a printed page.
    pub fn from_grid(rows: &[Vec<String>]) -> Reading {
        let columns = rows.iter().map(Vec::len).max().unwrap_or(1).max(1) as f32;
        let height = rows.len().max(1) as f32;
        let mut pieces = Vec::new();
        for (r, row) in rows.iter().enumerate() {
            for (c, cell) in row.iter().enumerate() {
                let text = cell.trim();
                if !text.is_empty() {
                    pieces.push(ReadPiece {
                        text: text.to_string(),
                        x: c as f32 / columns,
                        y: r as f32 / height,
                        w: 0.9 / columns,
                        h: 0.9 / height,
                        row: u32::try_from(r).ok(),
                        column: u32::try_from(c).ok(),
                        confidence: None,
                    });
                }
            }
        }
        Reading { pages: vec![ReadPage { index: 0, aspect: columns / height, pieces, cells: true, sheet: false, unsure: None, line_height: None }] }
    }

    /// A reading built from an OTSL (`<fcel>`, `<ecel>`, `<lcel>`, `<nl>`) table stream such as
    /// `Xiaomi-OCR-0` whole-page parsing output.
    pub fn from_otsl(otsl_text: &str) -> Reading {
        let rows = parse_otsl_rows(otsl_text);
        if rows.is_empty() {
            return Reading::default();
        }
        Self::from_grid(&rows)
    }

    /// Whether the reading's print is too small or uncertain to trust a table VLM that would
    /// invent plausible text on unreadable images.
    pub fn is_unclear(&self) -> bool {
        let total_pieces: usize = self.pages.iter().map(|p| p.pieces.len()).sum();
        if total_pieces == 0 {
            return true;
        }
        self.pages.iter().any(|p| {
            p.unsure.is_some_and(|u| u >= 0.5) || p.line_height.is_some_and(|lh| lh > 0.0 && lh < 10.0)
        })
    }

    /// Appends an OTSL table grid page to a primary OCR reading when the primary reading is legible
    /// and contains a dense table (`>= 25` pieces), giving `Decision` row/column coordinates for
    /// dense tables while preserving exact primary OCR bounding boxes.
    pub fn merge_otsl(&mut self, otsl_text: &str) {
        let total_pieces: usize = self.pages.iter().map(|p| p.pieces.len()).sum();
        if self.is_unclear() || total_pieces < 25 {
            return;
        }
        let grid = Self::from_otsl(otsl_text);
        let next_index = self.pages.iter().map(|p| p.index + 1).max().unwrap_or(0);
        for (offset, mut page) in grid.pages.into_iter().enumerate() {
            if !page.pieces.is_empty() {
                page.index = next_index + offset as u32;
                self.pages.push(page);
            }
        }
    }
}

fn is_japanese_era_year(text: &str) -> bool {
    let trimmed = text.trim();
    for era in ["令和", "平成", "昭和", "大正", "明治"] {
        if let Some(rest) = trimmed.strip_prefix(era) {
            let rest = rest.trim();
            if rest == "元" || (!rest.is_empty() && rest.chars().count() <= 2 && rest.chars().all(char::is_numeric)) {
                return true;
            }
        }
    }
    false
}

fn parse_otsl_rows(otsl_text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for raw_row in otsl_text.split("<nl>") {
        let normalized = raw_row
            .replace("<ecel>", "<fcel>")
            .replace("<lcel>", "<fcel>")
            .replace("<ucel>", "<fcel>")
            .replace("<xcel>", "<fcel>");
        let mut parts: Vec<String> = normalized
            .split("<fcel>")
            .map(|cell| {
                let with_breaks = cell.replace("<br>", " ").replace("<br/>", " ");
                with_breaks.split_whitespace().collect::<Vec<_>>().join(" ")
            })
            .collect();
        if parts.first().is_some_and(String::is_empty) {
            parts.remove(0);
        }
        if !parts.iter().any(|c| !c.is_empty()) {
            continue;
        }
        let mut merged = Vec::with_capacity(parts.len());
        let mut i = 0;
        while i < parts.len() {
            if i + 1 < parts.len()
                && is_japanese_era_year(&parts[i])
                && parts[i + 1].parse::<u32>().is_ok_and(|m| (1..=12).contains(&m))
            {
                merged.push(format!("{}年{}月", parts[i].trim(), parts[i + 1].trim()));
                i += 2;
            } else {
                merged.push(parts[i].clone());
                i += 1;
            }
        }
        rows.push(merged);
    }
    rows
}

/// A piece of a document to be asked about, with the printed words near it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Candidate {
    /// The name the questions use for it.
    pub id: String,
    /// The page it is on.
    pub page: u32,
    /// The value it would give a detail.
    pub text: String,
    /// The printed words beside it, nearest first.
    pub near: Vec<String>,
    /// Width over height of its page.
    #[serde(default = "square")]
    pub aspect: f32,
    /// Its box on the page, as in [`ReadPiece`].
    pub x: f32,
    /// Top edge.
    pub y: f32,
    /// Width.
    pub w: f32,
    /// Height.
    pub h: f32,
    /// Whether it is a cell of a table or a sheet.
    #[serde(default)]
    pub cell: bool,
    /// The row of a cell, from 0.
    #[serde(default)]
    pub row: Option<u32>,
    /// The column of a cell, from 0.
    #[serde(default)]
    pub column: Option<u32>,
    /// Whether the cell is in an Excel sheet.
    #[serde(default)]
    pub sheet: bool,
    /// Recognition confidence in `0.0..=1.0`, when reported by the OCR reader.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

/// A1 letters for a column from 0: 0 is A, 25 is Z, 26 is AA.
fn column_letters(mut column: u32) -> String {
    let mut letters = Vec::new();
    loop {
        letters.push(b'A' + (column % 26) as u8);
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    letters.reverse();
    String::from_utf8(letters).unwrap_or_default()
}

impl Locator {
    /// Where a piece sits: its box on a page, or its row and column in a sheet or a table.
    fn of(candidate: &Candidate) -> Locator {
        match (candidate.cell, candidate.row, candidate.column) {
            (true, Some(row), Some(column)) => Locator {
                kind: "cell".to_string(),
                page: candidate.page,
                x: 0.0,
                y: 0.0,
                w: 0.0,
                h: 0.0,
                row: Some(row),
                column: Some(column),
                a1: candidate
                    .sheet
                    .then(|| format!("{}{}", column_letters(column), row + 1)),
                table: None,
            },
            _ => Locator {
                kind: "page".to_string(),
                page: candidate.page,
                x: candidate.x,
                y: candidate.y,
                w: candidate.w,
                h: candidate.h,
                row: None,
                column: None,
                a1: None,
                table: None,
            },
        }
    }

    /// Widens a page box to take in the next line of a value that runs over several.
    fn grow(&mut self, candidate: &Candidate) {
        if self.kind != "page" || candidate.page != self.page {
            return;
        }
        let right = (self.x + self.w).max(candidate.x + candidate.w);
        let bottom = (self.y + self.h).max(candidate.y + candidate.h);
        self.x = self.x.min(candidate.x);
        self.y = self.y.min(candidate.y);
        self.w = right - self.x;
        self.h = bottom - self.y;
    }
}

/// What Decision chose, and how sure it was.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Choice {
    /// The option chosen.
    pub value: String,
    /// The probability the model gave it.
    pub p: f32,
}

/// A document being read: the pieces to ask about and what has been answered so far.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    /// The pieces to ask about.
    pub candidates: Vec<Candidate>,
    /// The kind of document, once asked.
    pub kind: Option<String>,
    /// The group each piece belongs to, once asked.
    pub groups: BTreeMap<String, Choice>,
    /// The text of every piece in reading order, for the readers of standard payloads.
    pub text: String,
    /// How many questions go in one request, or 0 for the usual number. A model that answers
    /// questions better alone is asked one at a time.
    #[serde(default)]
    pub per_request: usize,
}

static DATE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?x)
        (?:令和|平成|昭和)\s*[元\d０-９]+\s*年\s*[\d０-９]{1,2}\s*月\s*[\d０-９]{1,2}\s*日
        | \b\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日
        | \b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b
        | \b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b
        | \b\d{1,2}\.?\s*\p{L}{3,9}\.?\s+\d{4}\b
        ",
    )
    .expect("a valid pattern")
});

/// A line of a machine-readable zone or a similar run of fillers, which a parser reads and a
/// person's detail is never found in.
fn looks_machine_readable(text: &str) -> bool {
    let compact: String = text.split_whitespace().collect();
    compact.contains("<<")
        || (compact.chars().count() >= 24 && compact.chars().filter(|c| *c == '<').count() >= 3)
        || (compact.chars().count() >= 28 && compact.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '<'))
}

fn has_content(text: &str) -> bool {
    text.chars().any(char::is_alphanumeric)
}

fn clip(text: &str, length: usize) -> String {
    let clipped: String = text.chars().take(length).collect();
    clipped.trim().to_string()
}

/// Splits text at the separators that stand outside brackets, so `Mã NH (CITAD / BIN)` stays whole.
fn split_outside(text: &str, separators: &[&str]) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0_i32;
    let mut start = 0;
    let mut index = 0;
    while let Some(rest) = text.get(index..) {
        let Some(ch) = rest.chars().next() else { break };
        match ch {
            '(' | '（' | '[' | '【' | '「' => depth += 1,
            ')' | '）' | ']' | '】' | '」' => depth = (depth - 1).max(0),
            _ => {}
        }
        let inside_number = ch == ':'
            && text.get(..index).is_some_and(|before| before.ends_with(|c: char| c.is_ascii_digit()))
            && rest.get(1..).is_some_and(|after| after.starts_with(|c: char| c.is_ascii_digit()));
        let in_link = ch == ':' && rest.get(1..).is_some_and(|after| after.starts_with("//"));
        if depth == 0 && !inside_number && !in_link {
            if let Some(separator) = separators.iter().find(|s| rest.starts_with(**s)) {
                if let Some(part) = text.get(start..index) {
                    parts.push(part.to_string());
                }
                index += separator.len();
                start = index;
                continue;
            }
        }
        index += ch.len_utf8();
    }
    if let Some(part) = text.get(start..) {
        parts.push(part.to_string());
    }
    parts
}

/// The `label: value` pairs of a text. Several can share a line: the value of one ends where the
/// label of the next begins, at the last space before its colon.
fn labelled_values(segment: &str) -> Vec<(Option<String>, String)> {
    let parts = split_outside(segment, &[":", "："]);
    let usable = |label: &str| (1..=48).contains(&label.chars().count()) && label.chars().any(char::is_alphabetic);
    let first = parts.first().map_or("", |p| p.trim());
    if parts.len() < 2 || !usable(first) || parts[1..].iter().all(|p| p.trim().is_empty()) {
        return vec![(None, segment.to_string())];
    }
    let mut pairs = Vec::new();
    let mut label = first.to_string();
    for (i, part) in parts.iter().enumerate().skip(1) {
        let chunk = part.trim();
        let (value, next): (&str, String) = if i + 1 < parts.len() {
            if let Some((before_slash, after_slash)) =
                chunk.rsplit_once(" / ").or_else(|| chunk.rsplit_once('／'))
            {
                if usable(after_slash.trim()) {
                    if let Some((val, native_label)) = before_slash
                        .trim()
                        .split_once(|c: char| c.is_whitespace() || c == '\u{3000}')
                    {
                        let full_label = format!("{} / {}", native_label.trim(), after_slash.trim());
                        if usable(&full_label) {
                            (val.trim(), full_label)
                        } else {
                            (chunk, String::new())
                        }
                    } else {
                        (chunk, String::new())
                    }
                } else {
                    (chunk, String::new())
                }
            } else {
                match chunk.rsplit_once(|c: char| c.is_whitespace() || c == '\u{3000}') {
                    Some((value, next)) if usable(next.trim()) => (value.trim(), next.trim().to_string()),
                    _ => (chunk, String::new()),
                }
            }
        } else {
            (chunk, String::new())
        };
        if !value.is_empty() && !label.is_empty() {
            pairs.push((Some(label.clone()), value.to_string()));
        }
        label = next;
    }
    if pairs.is_empty() { vec![(None, segment.to_string())] } else { pairs }
}

/// A piece's text cut into the values it holds. A date sits apart from the words around it, and a
/// printed `label: value` is a value with its label.
fn values_in(text: &str) -> Vec<(Option<String>, String)> {
    let mut out = Vec::new();
    for segment in split_outside(text, &["|", "｜"]) {
        let segment = segment.trim();
        if !has_content(segment) {
            continue;
        }
        for (label, value) in labelled_values(segment) {
            for cell in split_outside(&value, &[" / ", "／"]) {
                for part in split_dates(cell.trim()) {
                    if has_content(&part) {
                        out.push((label.clone(), part));
                    }
                }
            }
        }
    }
    out
}

static SPACED_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b\d{1,2} \d{1,2} \d{4}\b").expect("a valid pattern"));

/// The dates in a value: those written with separators, and those written with spaces that read as
/// a real date.
fn dates_in(value: &str) -> Vec<regex::Match<'_>> {
    let mut dates: Vec<_> = DATE.find_iter(value).collect();
    for found in SPACED_DATE.find_iter(value) {
        let overlaps = dates.iter().any(|d| found.start() < d.end() && found.end() > d.start());
        if !overlaps && crate::normalize::parse_date(found.as_str()).is_some() {
            dates.push(found);
        }
    }
    dates.sort_by_key(regex::Match::start);
    dates
}

/// A value with its dates taken out as values of their own, when other words stand beside them.
fn split_dates(value: &str) -> Vec<String> {
    let dates = dates_in(value);
    if dates.is_empty() {
        return vec![value.to_string()];
    }
    let mut parts = Vec::new();
    let mut from = 0;
    for found in &dates {
        if let Some(between) = value.get(from..found.start()) {
            parts.push(between.trim_matches(|c: char| c.is_whitespace() || "/,-:;|–—~〜".contains(c)).to_string());
        }
        parts.push(found.as_str().trim().to_string());
        from = found.end();
    }
    if let Some(rest) = value.get(from..) {
        parts.push(rest.trim_matches(|c: char| c.is_whitespace() || "/,-:;|–—~〜".contains(c)).to_string());
    }
    let others = parts.iter().filter(|p| has_content(p) && !DATE.is_match(p)).count();
    if others == 0 && dates.len() == 1 {
        return vec![value.to_string()];
    }
    parts.into_iter().filter(|p| has_content(p)).collect()
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30ff}' | '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}' | '\u{ac00}'..='\u{d7af}')
}

fn close_run(text: &str, parts: &mut Vec<(usize, usize)>, from: &mut Option<usize>, to: usize) {
    if let Some(start) = from.take() {
        if text.get(start..to).is_some_and(has_content) {
            parts.push((start, to));
        }
    }
}

/// The words and units a value is made of, as byte ranges. A cut falls where a person would draw a
/// line between two details that share a piece: at spaces, brackets and punctuation, and in an
/// address written without spaces, after a prefecture, city or ward and before a number that
/// follows a name. A cut only proposes a part; the model says what the part is.
fn segments(text: &str, address: bool) -> Vec<(usize, usize)> {
    const BREAKS: &str = "・/／、，,;；|｜()（）[]【】「」『』〒:：";
    const UNITS: &str = "都道府県市区町村郡省";
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut parts = Vec::new();
    let mut from: Option<usize> = None;
    for (i, &(at, ch)) in chars.iter().enumerate() {
        let before = i.checked_sub(1).map(|j| chars[j].1);
        let after = chars.get(i + 1).map(|c| c.1);
        let between_digits = before.is_some_and(|c| c.is_ascii_digit()) && after.is_some_and(|c| c.is_ascii_digit());
        if ch.is_whitespace() || (BREAKS.contains(ch) && !between_digits) {
            close_run(text, &mut parts, &mut from, at);
            continue;
        }
        let start = *from.get_or_insert(at);
        let after_a_name = address && is_cjk(ch) && after.is_some_and(|c| c.is_ascii_digit());
        let after_a_unit = address && UNITS.contains(ch) && start < at && after.is_some_and(is_cjk);
        if after_a_name || after_a_unit {
            close_run(text, &mut parts, &mut from, at + ch.len_utf8());
        }
    }
    close_run(text, &mut parts, &mut from, text.len());
    parts
}

/// The pieces of a page in reading order: rows from the top, each row from the left.
fn reading_order(pieces: &[ReadPiece]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..pieces.len()).collect();
    let boxed = pieces.iter().any(|p| p.w > 0.0 || p.h > 0.0);
    if !boxed {
        return order;
    }
    order.sort_by(|&a, &b| pieces[a].y.total_cmp(&pieces[b].y));
    let mut rows: Vec<Vec<usize>> = Vec::new();
    for index in order {
        let piece = &pieces[index];
        let centre = piece.y + piece.h / 2.0;
        match rows.last() {
            Some(row)
                if row.first().is_some_and(|&first| {
                    let anchor = &pieces[first];
                    (centre - (anchor.y + anchor.h / 2.0)).abs() < 0.5 * piece.h.max(anchor.h)
                }) =>
            {
                if let Some(row) = rows.last_mut() {
                    row.push(index);
                }
            }
            _ => rows.push(vec![index]),
        }
    }
    rows.into_iter()
        .flat_map(|mut row| {
            row.sort_by(|&a, &b| pieces[a].x.total_cmp(&pieces[b].x));
            row
        })
        .collect()
}

/// The printed words near a piece: the pieces to its left on the same row, then those above it.
fn words_near(pieces: &[ReadPiece], order: &[usize], me: usize, aspect: f32) -> Vec<String> {
    let piece = &pieces[order[me]];
    let boxed = piece.w > 0.0 || piece.h > 0.0;
    if !boxed {
        return order[..me].iter().rev().take(2).map(|&i| clip(&pieces[i].text, NEAR_LENGTH)).collect();
    }
    let mut left: Vec<(f32, usize)> = Vec::new();
    let mut above: Vec<(f32, usize)> = Vec::new();
    for &other in order {
        if other == order[me] {
            continue;
        }
        let o = &pieces[other];
        // A label has letters; a number or a date beside a piece is another value, not what names it.
        if !o.text.chars().any(char::is_alphabetic) || !(o.w > 0.0 || o.h > 0.0) {
            continue;
        }
        let overlap_y = (piece.y + piece.h).min(o.y + o.h) - piece.y.max(o.y);
        let overlap_x = (piece.x + piece.w).min(o.x + o.w) - piece.x.max(o.x);
        if overlap_y >= 0.5 * piece.h.min(o.h) && o.x + o.w <= piece.x + 0.02 {
            let gap = (piece.x - (o.x + o.w)) * aspect;
            if gap <= 0.45 * aspect.max(1.0) {
                left.push((gap, other));
            }
        } else if overlap_x >= 0.3 * piece.w.min(o.w) && o.y + o.h <= piece.y + 0.01 {
            let gap = piece.y - (o.y + o.h);
            if gap <= (4.0 * piece.h.max(o.h)).min(0.12) {
                above.push((gap, other));
            }
        }
    }
    left.sort_by(|a, b| a.0.total_cmp(&b.0));
    above.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut nearest: Vec<(f32, usize)> = left.into_iter().take(2).chain(above.into_iter().take(2)).collect();
    nearest.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut words: Vec<String> = Vec::new();
    for (_, index) in nearest {
        let raw = labelled_values(&pieces[index].text)
            .into_iter()
            .find_map(|(l, _)| l)
            .unwrap_or_else(|| pieces[index].text.clone());
        let text = clip(&raw, NEAR_LENGTH);
        if !text.is_empty() && !words.contains(&text) {
            words.push(text);
        }
    }
    words
}

/// Whether `next` carries on `last`: under it, left aligned, or beside it, with the same label.
fn follows(last: &Candidate, next: &Candidate) -> bool {
    if last.page != next.page || last.near.first() != next.near.first() {
        return false;
    }
    let boxed = (last.w > 0.0 || last.h > 0.0) && (next.w > 0.0 || next.h > 0.0);
    if !boxed {
        return false;
    }
    let tall = last.h.max(next.h);
    let below = next.y - (last.y + last.h);
    let under = (-0.2 * tall..=1.2 * tall).contains(&below) && next.y > last.y + 0.5 * last.h && (next.x - last.x).abs() <= 0.04;
    // The next cell of a table row is the next column's value, as the current and year-to-date
    // amounts of a payslip line are.
    let beside = !(last.cell && next.cell)
        && ((next.y + next.h / 2.0) - (last.y + last.h / 2.0)).abs() < 0.5 * tall
        && (-0.01..=1.5 * tall / last.aspect.max(0.1)).contains(&(next.x - (last.x + last.w)));
    under || beside
}

/// Whether `s` is a Japanese postal code (`150-0013` or `〒150-0013`).
fn is_postal_code(s: &str) -> bool {
    let clean = s.trim().trim_start_matches('〒').trim();
    let bytes = clean.as_bytes();
    bytes.len() == 8
        && bytes[0..3].iter().all(u8::is_ascii_digit)
        && bytes[3] == b'-'
        && bytes[4..8].iter().all(u8::is_ascii_digit)
}

/// Masks secret identifiers (ID numbers, passport numbers, residence card numbers, bank accounts,
/// phone numbers, email addresses) before a candidate is sent to a cloud Decision endpoint, while
/// preserving character class, prefix, length, and formatting so classification accuracy is unchanged.
/// Local `Candidate.text` remains unmasked in memory so `Plan::finish()` extracts the real values.
pub fn mask_for_cloud(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() || !dates_in(trimmed).is_empty() || is_postal_code(trimmed) {
        return text.to_string();
    }

    // Check if the entire piece is a phone number, national ID, card number, or alphanumeric ID
    // (possibly with spaces, hyphens, plus, or parentheses, e.g. "03 6400 5510", "AB12345678CD").
    let digit_count = trimmed.chars().filter(|c| c.is_ascii_digit()).count();
    let all_id_chars = trimmed.chars().all(|c| {
        c.is_ascii_digit()
            || c.is_ascii_uppercase()
            || matches!(c, ' ' | '-' | '(' | ')' | '+')
    });
    let has_comma_or_dot_or_colon = trimmed.contains([',', '.', ':', '/', '〜']);
    if digit_count >= 7 && all_id_chars && !has_comma_or_dot_or_colon {
        let has_alpha = trimmed.chars().any(|c| c.is_ascii_alphabetic());
        let keep_digits = if has_alpha {
            2
        } else if trimmed.starts_with(['0', '+']) && trimmed.contains([' ', '-', '(']) {
            4
        } else {
            3
        };
        let mut seen_digits = 0usize;
        return text
            .chars()
            .map(|c| {
                if c.is_ascii_digit() {
                    seen_digits += 1;
                    if seen_digits > keep_digits { '0' } else { c }
                } else {
                    c
                }
            })
            .collect();
    }

    // Otherwise mask individual tokens (emails, inline account numbers, inline ID tokens)
    let mut out = String::with_capacity(text.len());
    let mut last = 0usize;
    for (idx, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if last < idx {
                out.push_str(&mask_token_for_cloud(&text[last..idx]));
            }
            out.push(ch);
            last = idx + ch.len_utf8();
        }
    }
    if last < text.len() {
        out.push_str(&mask_token_for_cloud(&text[last..]));
    }
    out
}

fn mask_token_for_cloud(token: &str) -> String {
    if let Some(at) = token.find('@') {
        if at > 0 && at + 1 < token.len() {
            let mut masked = String::with_capacity(token.len());
            for (i, c) in token[..at].chars().enumerate() {
                if i == 0 || matches!(c, '(' | '<' | '"' | '\'') {
                    masked.push(c);
                } else {
                    masked.push('*');
                }
            }
            masked.push_str(&token[at..]);
            return masked;
        }
    }
    if !dates_in(token).is_empty()
        || is_postal_code(token)
        || token.contains([',', '.', ':', '/', '〜', '年', '月', '日'])
    {
        return token.to_string();
    }
    let digits = token.chars().filter(|c| c.is_ascii_digit()).count();
    if digits >= 6 {
        let has_alpha = token.chars().any(|c| c.is_ascii_alphabetic());
        let keep_digits = if has_alpha { 2 } else { 3 };
        let mut seen = 0usize;
        return token
            .chars()
            .map(|c| {
                if c.is_ascii_digit() {
                    seen += 1;
                    if seen > keep_digits { '0' } else { c }
                } else {
                    c
                }
            })
            .collect();
    }
    token.to_string()
}

impl Plan {
    /// Finds the pieces of a reading to ask about, each with the printed words beside it.
    pub fn new(reading: &Reading) -> Plan {
        let mut plan = Plan::default();
        let mut text = String::new();
        for page in &reading.pages {
            let pieces: Vec<ReadPiece> = page.pieces.iter().filter(|p| has_content(&p.text)).cloned().collect();
            let order = reading_order(&pieces);
            for (position, &index) in order.iter().enumerate() {
                let piece = &pieces[index];
                text.push_str(piece.text.trim());
                text.push('\n');
                let near = words_near(&pieces, &order, position, page.aspect);
                for (label, value) in values_in(&piece.text) {
                    if plan.candidates.len() >= MAX_PIECES || looks_machine_readable(&value) {
                        continue;
                    }
                    if piece.confidence.is_some_and(|c| c < 0.38)
                        && !value.chars().any(|ch| ch.is_ascii_digit())
                    {
                        continue;
                    }
                    let mut words: Vec<String> = label.iter().map(|l| clip(l, NEAR_LENGTH)).collect();
                    words.extend(near.iter().filter(|n| **n != value).cloned());
                    words.truncate(NEAR_WORDS);
                    plan.candidates.push(Candidate {
                        id: format!("c{}", plan.candidates.len()),
                        page: page.index,
                        text: value,
                        near: words,
                        aspect: page.aspect,
                        x: piece.x,
                        y: piece.y,
                        w: piece.w,
                        h: piece.h,
                        cell: page.cells,
                        row: piece.row,
                        column: piece.column,
                        sheet: page.sheet,
                        confidence: piece.confidence,
                    });
                }
            }
        }
        plan.text = text;
        plan
    }

    /// Reads the JSON a reader prints.
    pub fn from_reading_json(json: &str) -> Result<Plan, serde_json::Error> {
        Ok(Plan::new(&serde_json::from_str(json)?))
    }

    fn batch(&self) -> usize {
        if self.per_request == 0 { QUESTIONS_PER_REQUEST } else { self.per_request }
    }

    fn state(&self, with_groups: bool) -> Value {
        let pieces: Vec<Value> = self
            .candidates
            .iter()
            .map(|c| {
                let near: Vec<String> = c.near.iter().map(|n| mask_for_cloud(n)).collect();
                let mut piece = json!({ "id": c.id, "text": mask_for_cloud(&c.text), "near": near });
                if with_groups {
                    if let (Some(choice), Some(map)) = (self.groups.get(&c.id), piece.as_object_mut()) {
                        map.insert("group".to_string(), json!(choice.value));
                    }
                }
                piece
            })
            .collect();
        let mut state = json!({
            "about": "Pieces of printed text read from one document, each with the printed words near it. A piece is a value only when it is the person's own detail; a printed label is not.",
            "pieces": pieces,
        });
        if let (Some(kind), Some(map)) = (&self.kind, state.as_object_mut()) {
            map.insert("document_kind".to_string(), json!(kind));
        }
        state
    }

    /// The requests of the first round: what group each piece belongs to, and what kind of
    /// document it is.
    pub fn first_requests(&self) -> Vec<Value> {
        let groups: serde_json::Map<String, Value> =
            GROUPS.iter().map(|g| (g.id.to_string(), json!(g.about))).collect();
        let kinds: serde_json::Map<String, Value> =
            KINDS.iter().map(|(id, about)| ((*id).to_string(), json!(about))).collect();
        let state = self.state(false);
        let mut requests = Vec::new();
        for (round, chunk) in self.candidates.chunks(self.batch()).enumerate() {
            let mut questions = serde_json::Map::new();
            if round == 0 {
                questions.insert(
                    "kind".to_string(),
                    json!({
                        "type": "choice",
                        "instructions": "What kind of document are these pieces of text from?",
                        "criteria": kinds,
                    }),
                );
            }
            for c in chunk {
                questions.insert(
                    c.id.clone(),
                    json!({
                        "type": "choice",
                        "instructions": format!(
                            "What does piece {} hold? Decide from its text and the printed words near it. If it is only a printed label, heading, instruction or decoration, with no value of the person, answer label.",
                            c.id
                        ),
                        "criteria": groups,
                    }),
                );
            }
            requests.push(json!({ "state": state, "questions": questions }));
        }
        requests
    }

    /// Takes in the answers of the first round.
    pub fn take_first_answers(&mut self, responses: &[Value]) {
        for response in responses {
            let Some(answers) = response.get("answers").and_then(Value::as_object) else {
                continue;
            };
            for (id, answer) in answers {
                let Some(choice) = read_choice(answer) else {
                    continue;
                };
                if id == "kind" {
                    self.kind = Some(choice.value);
                } else {
                    self.groups.insert(id.clone(), choice);
                }
            }
        }
        self.merge_blocks();
    }

    /// Pieces of one group under the same label that sit one after another are one value: the lines
    /// of an address, or a name and the word in brackets after it.
    fn merge_blocks(&mut self) {
        let mut merged: Vec<Candidate> = Vec::new();
        for candidate in std::mem::take(&mut self.candidates) {
            let group = self.groups.get(&candidate.id).map(|g| g.value.clone());
            let target_idx = match group.as_deref() {
                Some(group) if !matches!(group, "label" | "other") => (0..merged.len()).rev().find(|&idx| {
                    let prev = &merged[idx];
                    self.groups.get(&prev.id).is_some_and(|g| g.value == group)
                        && follows(prev, &candidate)
                        && !merged[(idx + 1)..]
                            .iter()
                            .any(|c| c.page == prev.page && (c.x - prev.x).abs() <= 0.08)
                }),
                _ => None,
            };
            if let Some(idx) = target_idx {
                let last = &mut merged[idx];
                let mid_phrase_wrap = !last.text.contains(',')
                    && candidate
                        .text
                        .split_whitespace()
                        .next()
                        .is_some_and(|w| w.ends_with(','));
                let glue = if last.text.ends_with([',', '-', '('])
                    || candidate.text.starts_with([')', ','])
                    || mid_phrase_wrap
                {
                    " "
                } else if self.groups.get(&last.id).is_some_and(|g| g.value == "address") {
                    ", "
                } else {
                    " "
                };
                last.text = format!("{}{glue}{}", last.text, candidate.text);
                last.w = last.w.max(candidate.x + candidate.w - last.x);
                last.h = (candidate.y + candidate.h - last.y).max(last.h);
                self.groups.remove(&candidate.id);
            } else {
                merged.push(candidate);
            }
        }
        self.candidates = merged;
    }

    /// The requests of the second round: which detail of its group each piece holds.
    pub fn second_requests(&self) -> Vec<Value> {
        let state = self.state(true);
        let mut asked: Vec<(&Candidate, &str)> = Vec::new();
        for c in &self.candidates {
            if let Some(choice) = self.groups.get(&c.id) {
                if !matches!(choice.value.as_str(), "label" | "other") && GROUPS.iter().any(|g| g.id == choice.value) {
                    asked.push((c, choice.value.as_str()));
                }
            }
        }
        let mut requests: Vec<Value> = asked
            .chunks(self.batch())
            .map(|chunk| {
                let mut questions = serde_json::Map::new();
                for (c, group) in chunk {
                    let mut options: serde_json::Map<String, Value> =
                        vocab::details_of(group).map(|d| (d.key.to_string(), json!(d.about))).collect();
                    options.insert(
                        "none".to_string(),
                        json!("Not any of these saved details: a heading, an explanation, part of a date, or something the vault has no entry for."),
                    );
                    questions.insert(
                        c.id.clone(),
                        json!({
                            "type": "choice",
                            "instructions": format!(
                                "Which saved detail does piece {} hold? Decide from its text and the printed words near it. Answer none if no listed detail fits.",
                                c.id
                            ),
                            "criteria": options,
                        }),
                    );
                }
                json!({ "state": state, "questions": questions })
            })
            .collect();
        requests.extend(self.parts_requests());
        requests
    }

    /// The pieces that hold more than one word or unit and may hold several details, with the cuts
    /// between their parts.
    fn cuttable(&self) -> Vec<(usize, &str, Vec<(usize, usize)>)> {
        let mut found = Vec::new();
        let mut questions = 0;
        for (position, c) in self.candidates.iter().enumerate() {
            let Some(group) = self.groups.get(&c.id).map(|g| g.value.as_str()) else {
                continue;
            };
            if !GROUPS_WITH_PARTS.contains(&group) || !c.text.chars().any(char::is_alphabetic) {
                continue;
            }
            let cuts = segments(&c.text, GROUPS_OF_ADDRESSES.contains(&group));
            if !(2..=MAX_PARTS).contains(&cuts.len()) || questions + cuts.len() > MAX_PART_QUESTIONS {
                continue;
            }
            questions += cuts.len();
            found.push((position, group, cuts));
        }
        found
    }

    /// The details a part of a piece can be: those of the piece's group, except a whole name or address.
    fn part_options(group: &str) -> Vec<&'static vocab::Detail> {
        vocab::details_of(group).filter(|d| !vocab::WHOLE.contains(&d.key)).collect()
    }

    /// Questions about the parts of the pieces that hold several: which detail each word or unit is.
    /// They need only the group of the piece, so they go out with the second round.
    fn parts_requests(&self) -> Vec<Value> {
        let mut asked: Vec<(String, &str, &Candidate, &str)> = Vec::new();
        for (position, group, cuts) in self.cuttable() {
            let c = &self.candidates[position];
            for (i, &(from, to)) in cuts.iter().enumerate() {
                asked.push((format!("{}.{i}", c.id), &c.text[from..to], c, group));
            }
        }
        asked
            .chunks(self.batch())
            .map(|chunk| {
                let parts: Vec<Value> = chunk
                    .iter()
                    .map(|(id, text, c, _)| {
                        let near: Vec<String> = c.near.iter().take(2).map(|n| mask_for_cloud(n)).collect();
                        json!({
                            "id": id,
                            "text": mask_for_cloud(text),
                            "of": mask_for_cloud(&clip(&c.text, 100)),
                            "near": near,
                        })
                    })
                    .collect();
                let mut questions = serde_json::Map::new();
                for (id, _, _, group) in chunk {
                    let mut options: serde_json::Map<String, Value> =
                        Plan::part_options(group).into_iter().map(|d| (d.key.to_string(), json!(d.about))).collect();
                    options.insert(
                        "none".to_string(),
                        json!("Not any of these saved details: a label, a connecting word, a unit, or something the vault has no entry for."),
                    );
                    questions.insert(
                        id.clone(),
                        json!({
                            "type": "choice",
                            "instructions": format!(
                                "Part {id} is one word or unit cut from a longer piece, shown as `of`. Which saved detail is this part by itself? Answer none if no listed detail fits.",
                            ),
                            "criteria": options,
                        }),
                    );
                }
                json!({
                    "state": {
                        "about": "Parts cut from longer pieces of printed text read from one document. Each part has the piece it was cut from and the printed words near that piece.",
                        "parts": parts,
                    },
                    "questions": questions,
                })
            })
            .collect()
    }

    /// The details found inside pieces: parts of a piece that Decision gave one detail, joined when
    /// only a space lies between them. Each comes with the position of its piece and whether the
    /// parts of that piece gave more than one detail.
    fn part_values(&self, answers: &BTreeMap<String, Choice>) -> Vec<(usize, String, String, f32, bool)> {
        let mut found = Vec::new();
        for (position, group, cuts) in self.cuttable() {
            let c = &self.candidates[position];
            let before = self.groups.get(&c.id).map_or(1.0, |g| g.p);
            let options = Plan::part_options(group);
            let mut local: Vec<(String, String, f32)> = Vec::new();
            let mut run: Option<(String, usize, usize, f32)> = None;
            for (i, &(from, to)) in cuts.iter().enumerate() {
                let choice = answers
                    .get(&format!("{}.{i}", c.id))
                    .filter(|ch| options.iter().any(|d| d.key == ch.value));
                match (run.take(), choice) {
                    (Some((key, start, end, p)), Some(ch)) if key == ch.value && c.text[end..from].trim().is_empty() => {
                        run = Some((key, start, to, p.min(ch.p * before)));
                    }
                    (previous, choice) => {
                        if let Some((key, start, end, p)) = previous {
                            local.push((key, c.text[start..end].to_string(), p));
                        }
                        run = choice.map(|ch| (ch.value.clone(), from, to, ch.p * before));
                    }
                }
            }
            if let Some((key, start, end, p)) = run {
                local.push((key, c.text[start..end].to_string(), p));
            }
            let several = local.iter().map(|(key, _, _)| key).collect::<std::collections::BTreeSet<_>>().len() > 1;
            found.extend(local.into_iter().map(|(key, text, p)| (position, key, text, p, several)));
        }
        found
    }

    /// What the document gave: the details a standard payload carries, then the details Decision
    /// placed. A value that a verified machine-readable zone gives is not replaced.
    pub fn finish(&self, responses: &[Value], current_year: u16) -> CapturedDocument {
        let mut document = extract_payload_details(&self.text, current_year);

        let mut placed: Vec<(usize, String, Choice)> = Vec::new();
        for response in responses {
            let Some(answers) = response.get("answers").and_then(Value::as_object) else {
                continue;
            };
            for (id, answer) in answers {
                let (Some(choice), Some(position)) =
                    (read_choice(answer), self.candidates.iter().position(|c| &c.id == id))
                else {
                    continue;
                };
                if choice.value == "none" || !vocab::knows(&choice.value) {
                    continue;
                }
                let before = self.groups.get(id).map_or(1.0, |g| g.p);
                let ocr_weight = self.candidates[position]
                    .confidence
                    .map_or(1.0, |c| c.clamp(0.25, 1.0));
                placed.push((
                    position,
                    choice.value.clone(),
                    Choice { value: choice.value, p: choice.p * before * ocr_weight },
                ));
            }
        }
        placed.sort_by_key(|(position, _, _)| *position);

        // Pieces of one detail that sit one under another are one value, such as an address that
        // runs over two lines. Otherwise the piece the model was surest of is the value.
        let mut values: BTreeMap<String, (String, f32, usize)> = BTreeMap::new();
        let mut places: BTreeMap<String, Locator> = BTreeMap::new();
        for (position, key, choice) in placed {
            let candidate = &self.candidates[position];
            match values.get_mut(&key) {
                Some((text, p, last)) if self.continues(*last, position) => {
                    let joiner = if text.ends_with(',') { " " } else { ", " };
                    text.push_str(joiner);
                    text.push_str(&candidate.text);
                    *p = p.min(choice.p);
                    *last = position;
                    if let Some(place) = places.get_mut(&key) {
                        place.grow(candidate);
                    }
                }
                Some((text, p, last)) => {
                    if choice.p > *p {
                        *text = candidate.text.clone();
                        *p = choice.p;
                        *last = position;
                        places.insert(key.clone(), Locator::of(candidate));
                    }
                }
                None => {
                    places.insert(key.clone(), Locator::of(candidate));
                    values.insert(key, (candidate.text.clone(), choice.p, position));
                }
            }
        }

        // When the parts of a piece are several details, the piece was not one detail: a bank line
        // that holds a bank, a branch and an account type gives each its own value, and a part
        // replaces the whole under the same key. A piece whose parts are all one detail keeps its
        // whole value: the model may have labelled only some words of a family name such as De Bruijn.
        let mut part_answers: BTreeMap<String, Choice> = BTreeMap::new();
        for response in responses {
            let Some(answers) = response.get("answers").and_then(Value::as_object) else {
                continue;
            };
            for (id, answer) in answers {
                if let (true, Some(choice)) = (id.contains('.'), read_choice(answer)) {
                    part_answers.insert(id.clone(), choice);
                }
            }
        }
        for (position, key, text, p, several) in self.part_values(&part_answers) {
            match values.get_mut(&key) {
                Some((existing, existing_p, last)) => {
                    let own = *last == position;
                    if (own && several) || (!own && p > *existing_p) {
                        *existing = text;
                        *existing_p = p;
                        *last = position;
                        places.insert(key.clone(), Locator::of(&self.candidates[position]));
                    }
                }
                None => {
                    places.insert(key.clone(), Locator::of(&self.candidates[position]));
                    values.insert(key, (text, p, position));
                }
            }
        }

        for (key, (text, _, _)) in values {
            let value = normalize_value(&key, &text);
            if value.is_empty() || document.details.contains_key(&key) {
                continue;
            }
            document.details.insert(key.clone(), value);
            let locator = places.remove(&key);
            document
                .sources
                .insert(key, DetailSource { kind: "decision".to_string(), verified: false, locator });
        }

        // Sex and nationality stay as printed; their codes are kept beside them.
        for (key, code) in [("person.sex", crate::normalize::sex_code as fn(&str) -> Option<String>), ("person.nationality", crate::normalize::nationality)] {
            if let Some(code) = document.details.get(key).and_then(|v| code(v)) {
                document.details.entry(format!("{key}.code")).or_insert(code);
            }
        }
        let before = document.details.clone();
        derive_companion_details(&mut document.details);
        for key in document.details.keys() {
            if !before.contains_key(key) {
                document
                    .sources
                    .insert(key.clone(), DetailSource { kind: "derived".to_string(), verified: false, locator: None });
            }
        }
        document
    }

    /// Whether the piece at `next` carries on the piece at `last`: the next line of the same block.
    fn continues(&self, last: usize, next: usize) -> bool {
        let (a, b) = (&self.candidates[last], &self.candidates[next]);
        if a.page != b.page || next <= last {
            return false;
        }
        let boxed = (a.w > 0.0 || a.h > 0.0) && (b.w > 0.0 || b.h > 0.0);
        if !boxed {
            return next == last + 1;
        }
        let below = b.y - (a.y + a.h);
        if !((-0.2 * a.h..=1.5 * a.h.max(b.h)).contains(&below) && (b.x - a.x).abs() <= 0.04) {
            return false;
        }
        if next == last + 1 {
            return true;
        }
        // In a multi-column table, OCR reading order by `y` can place cells from other columns
        // between two lines of the same cell. They still continue one another if `b` sits below `a`
        // and no intervening piece occupies the same column.
        b.y > a.y + 0.2 * a.h.min(b.h)
            && !self.candidates[(last + 1)..next]
                .iter()
                .any(|c| c.page == a.page && (c.x - a.x).abs() <= 0.08)
    }
}

fn read_choice(answer: &Value) -> Option<Choice> {
    let value = answer.get("choice")?.as_str()?.to_string();
    let p = answer
        .get("probabilities")
        .and_then(|p| p.get(&value))
        .and_then(Value::as_f64)
        .unwrap_or(1.0) as f32;
    Some(Choice { value, p })
}

/// Which details the vocabulary lists in each group, for a reader that wants to show them.
pub fn details_in_group(group: &str) -> Vec<&'static str> {
    DETAILS.iter().filter(|d| d.group == group).map(|d| d.key).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn piece(text: &str, x: f32, y: f32, w: f32, h: f32) -> ReadPiece {
        ReadPiece { text: text.to_string(), x, y, w, h, row: None, column: None, confidence: None }
    }

    fn card() -> Reading {
        Reading {
            pages: vec![ReadPage {
                index: 0,
                aspect: 1.6,
                pieces: vec![
                    piece("Vornamen / Given names", 0.43, 0.39, 0.26, 0.03),
                    piece("ERIKA", 0.44, 0.42, 0.10, 0.05),
                    piece("Geburtstag / Date of birth", 0.44, 0.50, 0.21, 0.03),
                    piece("12.08.1983 DEUTSCH", 0.43, 0.56, 0.37, 0.06),
                    piece("Gültig bis / Date of expiry", 0.43, 0.73, 0.20, 0.03),
                    piece("01.05.2034", 0.44, 0.78, 0.21, 0.07),
                ],
                cells: false,
                sheet: false,
                unsure: None,
                line_height: None,
            }],
        }
    }

    fn answer(choice: &str, p: f64) -> Value {
        json!({ "type": "choice", "choice": choice, "probabilities": { choice: p } })
    }

    #[test]
    fn a_value_is_given_the_label_printed_above_it() {
        let plan = Plan::new(&card());
        let erika = plan.candidates.iter().find(|c| c.text == "ERIKA").expect("a piece");
        assert_eq!(erika.near.first().map(String::as_str), Some("Vornamen / Given names"));
    }

    #[test]
    fn a_date_and_the_word_beside_it_are_two_pieces() {
        let plan = Plan::new(&card());
        let texts: Vec<_> = plan.candidates.iter().map(|c| c.text.as_str()).collect();
        assert!(texts.contains(&"12.08.1983"), "{texts:?}");
        assert!(texts.contains(&"DEUTSCH"), "{texts:?}");
        assert!(!texts.contains(&"12.08.1983 DEUTSCH"), "{texts:?}");
        let birth = plan.candidates.iter().find(|c| c.text == "12.08.1983").expect("a piece");
        assert!(birth.near.iter().any(|n| n.contains("Date of birth")), "{:?}", birth.near);
    }

    #[test]
    fn a_date_written_with_spaces_is_split_from_its_neighbour() {
        let plan = Plan::new(&Reading::from_text("01 08 1995 31 08 2035"));
        let texts: Vec<_> = plan.candidates.iter().map(|c| c.text.as_str()).collect();
        assert_eq!(texts, ["01 08 1995", "31 08 2035"]);
    }

    #[test]
    fn a_machine_readable_zone_is_left_to_its_parser() {
        let plan = Plan::new(&Reading::from_text("P<NOROESTENBYEN<<AASAMUND<SPECIMEN<<<<<<<<<<<<<<\nCCC0022514NOR5604230M3004157<<<<<<<<<<<<<<04"));
        assert!(plan.candidates.is_empty(), "{:?}", plan.candidates);
        assert!(plan.text.contains("P<NOROESTENBYEN"));
    }

    #[test]
    fn several_pairs_on_one_line_and_times_inside_a_value() {
        let plan = Plan::new(&Reading::from_text("基本給: 420,000 時間外手当: 45,000\n勤務時間: 10:00〜19:00"));
        let pairs: Vec<_> = plan
            .candidates
            .iter()
            .map(|c| (c.near.first().cloned().unwrap_or_default(), c.text.clone()))
            .collect();
        assert_eq!(
            pairs,
            [
                ("基本給".to_string(), "420,000".to_string()),
                ("時間外手当".to_string(), "45,000".to_string()),
                ("勤務時間".to_string(), "10:00〜19:00".to_string()),
            ]
        );
    }

    #[test]
    fn a_printed_label_and_value_in_one_piece_are_split() {
        let reading = Reading::from_text("Họ và tên: Lê Hoàng Minh | Mã nhân viên: HV-2048\nSố điện thoại: 0905-882-194");
        let plan = Plan::new(&reading);
        let pairs: Vec<_> = plan
            .candidates
            .iter()
            .map(|c| (c.near.first().cloned().unwrap_or_default(), c.text.clone()))
            .collect();
        assert!(pairs.contains(&("Họ và tên".to_string(), "Lê Hoàng Minh".to_string())), "{pairs:?}");
        assert!(pairs.contains(&("Mã nhân viên".to_string(), "HV-2048".to_string())), "{pairs:?}");
        assert!(pairs.contains(&("Số điện thoại".to_string(), "0905-882-194".to_string())), "{pairs:?}");
    }

    #[test]
    fn a_grid_gives_each_cell_the_header_above_and_the_label_left() {
        let reading = Reading::from_grid(&[
            vec!["Name".into(), "Annual income".into()],
            vec!["Ada Lovelace".into(), "5,000,000".into()],
        ]);
        let plan = Plan::new(&reading);
        let income = plan.candidates.iter().find(|c| c.text == "5,000,000").expect("a cell");
        assert!(income.near.iter().any(|n| n == "Annual income"), "{:?}", income.near);
    }

    #[test]
    fn the_first_round_asks_every_piece_and_the_kind_once() {
        let plan = Plan::new(&card());
        let requests = plan.first_requests();
        assert_eq!(requests.len(), 1);
        let questions = requests[0]["questions"].as_object().expect("questions");
        assert!(questions.contains_key("kind"));
        assert_eq!(questions.len(), plan.candidates.len() + 1);
        assert!(questions["c0"]["criteria"].get("label").is_some());
    }

    #[test]
    fn answers_become_details_in_the_form_the_vault_keeps() {
        let mut plan = Plan::new(&card());
        let id_of = |plan: &Plan, text: &str| plan.candidates.iter().find(|c| c.text == text).expect("a piece").id.clone();
        let (erika, birth, nation, expiry) = (
            id_of(&plan, "ERIKA"),
            id_of(&plan, "12.08.1983"),
            id_of(&plan, "DEUTSCH"),
            id_of(&plan, "01.05.2034"),
        );
        let mut first = serde_json::Map::new();
        first.insert("kind".into(), answer("id_card", 0.97));
        for id in plan.candidates.iter().map(|c| c.id.clone()) {
            let group = if id == erika {
                "name"
            } else if id == birth || id == nation {
                "person"
            } else if id == expiry {
                "id"
            } else {
                "label"
            };
            first.insert(id, answer(group, 0.99));
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        assert_eq!(plan.kind.as_deref(), Some("id_card"));

        let second = plan.second_requests();
        assert_eq!(second.len(), 1);
        let asked: Vec<_> = second[0]["questions"].as_object().expect("questions").keys().cloned().collect();
        assert_eq!(asked.len(), 4, "{asked:?}");

        let mut answers = serde_json::Map::new();
        answers.insert(erika, answer("name.given", 0.98));
        answers.insert(birth, answer("birth.date", 0.99));
        answers.insert(nation, answer("person.nationality", 0.9));
        answers.insert(expiry, answer("id.card.expiry", 0.95));
        let document = plan.finish(&[json!({ "answers": answers })], 2026);
        assert_eq!(document.details.get("name.given").map(String::as_str), Some("ERIKA"));
        assert_eq!(document.details.get("birth.date").map(String::as_str), Some("1983-08-12"));
        assert_eq!(document.details.get("person.nationality").map(String::as_str), Some("DEUTSCH"));
        assert_eq!(document.details.get("person.nationality.code").map(String::as_str), Some("DE"));
        assert_eq!(document.details.get("id.card.expiry").map(String::as_str), Some("2034-05-01"));
        assert_eq!(document.sources.get("name.given").map(|s| s.kind.as_str()), Some("decision"));
    }

    #[test]
    fn a_detail_remembers_the_box_it_was_printed_in() {
        let mut plan = Plan::new(&card());
        let id_of = |plan: &Plan, text: &str| plan.candidates.iter().find(|c| c.text == text).expect("a piece").id.clone();
        let erika = id_of(&plan, "ERIKA");
        let mut first = serde_json::Map::new();
        first.insert("kind".into(), answer("id_card", 0.97));
        for id in plan.candidates.iter().map(|c| c.id.clone()) {
            first.insert(id.clone(), answer(if id == erika { "name" } else { "label" }, 0.99));
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        let mut answers = serde_json::Map::new();
        answers.insert(erika, answer("name.given", 0.98));
        let document = plan.finish(&[json!({ "answers": answers })], 2026);

        let place = document.sources["name.given"].locator.as_ref().expect("a place");
        assert_eq!(place.kind, "page");
        assert_eq!(place.page, 0);
        assert_eq!((place.x, place.y, place.w, place.h), (0.44, 0.42, 0.10, 0.05));
        assert_eq!(place.row, None);
        assert_eq!(place.a1, None);
    }

    #[test]
    fn two_lines_of_one_address_share_one_box_that_takes_in_both() {
        let reading = Reading {
            pages: vec![ReadPage {
                index: 2,
                aspect: 0.7,
                pieces: vec![
                    piece("Nơi cư trú", 0.08, 0.13, 0.13, 0.012),
                    piece("Tổ 5, Phường Ví Dụ,", 0.27, 0.132, 0.12, 0.012),
                    piece("Thành phố Đà Nẵng", 0.27, 0.147, 0.14, 0.012),
                ],
                cells: false,
                sheet: false,
                unsure: None,
                line_height: None,
            }],
        };
        let mut plan = Plan::new(&reading);
        let ids: Vec<String> = plan.candidates.iter().map(|c| c.id.clone()).collect();
        let mut first = serde_json::Map::new();
        let mut second = serde_json::Map::new();
        first.insert("kind".into(), answer("id_card", 0.97));
        for id in &ids {
            let group = if id == &ids[0] { "label" } else { "address" };
            first.insert(id.clone(), answer(group, 0.99));
            if id != &ids[0] {
                second.insert(id.clone(), answer("address.street", 0.95));
            }
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        let document = plan.finish(&[json!({ "answers": second })], 2026);

        let place = document.sources["address.street"].locator.as_ref().expect("a place");
        assert_eq!(place.page, 2);
        assert!((place.x - 0.27).abs() < 1e-6);
        assert!((place.y - 0.132).abs() < 1e-6);
        assert!((place.w - 0.14).abs() < 1e-6);
        assert!((place.h - (0.147 + 0.012 - 0.132)).abs() < 1e-6);
    }

    #[test]
    fn a_sheet_cell_is_placed_by_zero_based_row_and_column_with_its_a1_reference() {
        let mut reading = Reading::from_grid(&[
            vec!["Name".into(), "Passport".into()],
            vec!["Ada".into(), "C8492011".into()],
        ]);
        reading.pages[0].sheet = true;
        reading.pages[0].index = 1;
        let mut plan = Plan::new(&reading);
        let number = plan.candidates.iter().find(|c| c.text == "C8492011").expect("a cell").id.clone();
        let mut first = serde_json::Map::new();
        first.insert("kind".into(), answer("form", 0.9));
        for id in plan.candidates.iter().map(|c| c.id.clone()) {
            first.insert(id.clone(), answer(if id == number { "id" } else { "label" }, 0.99));
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        let mut answers = serde_json::Map::new();
        answers.insert(number, answer("id.passport.number", 0.99));
        let document = plan.finish(&[json!({ "answers": answers })], 2026);

        let place = document.sources["id.passport.number"].locator.as_ref().expect("a place");
        assert_eq!(place.kind, "cell");
        assert_eq!(place.page, 1);
        assert_eq!((place.row, place.column), (Some(1), Some(1)));
        assert_eq!(place.a1.as_deref(), Some("B2"));
        assert_eq!(place.table, None);
    }

    #[test]
    fn column_letters_run_past_z() {
        assert_eq!(column_letters(0), "A");
        assert_eq!(column_letters(25), "Z");
        assert_eq!(column_letters(26), "AA");
        assert_eq!(column_letters(27), "AB");
        assert_eq!(column_letters(701), "ZZ");
        assert_eq!(column_letters(702), "AAA");
    }

    #[test]
    fn two_lines_of_one_address_are_one_value() {
        let reading = Reading {
            pages: vec![ReadPage {
                index: 0,
                aspect: 0.7,
                pieces: vec![
                    piece("Nơi cư trú", 0.08, 0.13, 0.13, 0.012),
                    piece("Tổ 5, Phường Ví Dụ,", 0.27, 0.132, 0.12, 0.012),
                    piece("Thành phố Đà Nẵng", 0.27, 0.147, 0.12, 0.012),
                ],
                cells: false,
                sheet: false,
                unsure: None,
                line_height: None,
            }],
        };
        let mut plan = Plan::new(&reading);
        let mut first = serde_json::Map::new();
        let mut second = serde_json::Map::new();
        for c in &plan.candidates {
            let group = if c.text.starts_with("Nơi") { "label" } else { "address" };
            first.insert(c.id.clone(), answer(group, 0.9));
            if group == "address" {
                second.insert(c.id.clone(), answer("address.full", 0.9));
            }
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        let document = plan.finish(&[json!({ "answers": second })], 2026);
        assert_eq!(
            document.details.get("address.full").map(String::as_str),
            Some("Tổ 5, Phường Ví Dụ, Thành phố Đà Nẵng")
        );
    }

    #[test]
    fn two_lines_in_the_left_column_join_across_intervening_right_column_pieces() {
        let reading = Reading {
            pages: vec![ReadPage {
                index: 0,
                aspect: 0.7,
                pieces: vec![
                    piece("Địa chỉ đơn vị", 0.08, 0.195, 0.14, 0.008),
                    piece("Tầng 9 Tòa nhà Công viên Phần mềm,", 0.2608, 0.1962, 0.23, 0.0086),
                    piece("Ngày trả lương", 0.5284, 0.1995, 0.10, 0.0086),
                    piece("05/10/2026", 0.6929, 0.1995, 0.08, 0.0073),
                    piece("Phường Hải Châu, TP. Đà Nẵng", 0.2628, 0.2062, 0.18, 0.0086),
                ],
                cells: false,
                sheet: false,
                unsure: None,
                line_height: None,
            }],
        };
        let mut plan = Plan::new(&reading);
        let mut first = serde_json::Map::new();
        let mut second = serde_json::Map::new();
        for c in &plan.candidates {
            let is_addr = c.text.starts_with("Tầng 9") || c.text.starts_with("Phường Hải Châu");
            first.insert(c.id.clone(), answer(if is_addr { "work" } else { "label" }, 0.99));
            if is_addr {
                second.insert(c.id.clone(), answer("work.employer.address", 0.99));
            }
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        let document = plan.finish(&[json!({ "answers": second })], 2026);
        assert_eq!(
            document.details.get("work.employer.address").map(String::as_str),
            Some("Tầng 9 Tòa nhà Công viên Phần mềm, Phường Hải Châu, TP. Đà Nẵng")
        );
    }

    #[test]
    fn otsl_table_tokens_become_a_grid_and_join_split_japanese_era_year_and_month() {
        let otsl = "<table><fcel>年<fcel>月<fcel>学歴・職歴<nl><fcel>平成31<fcel>3<fcel>東京工業大学 卒業<nl><fcel>令和5<fcel>4<fcel>株式会社蒼穹システムズ 入社<nl></table>";
        let reading = Reading::from_otsl(otsl);
        assert_eq!(reading.pages.len(), 1);
        assert!(reading.pages[0].cells);
        let texts: Vec<&str> = reading.pages[0].pieces.iter().map(|p| p.text.as_str()).collect();
        assert!(texts.contains(&"平成31年3月"), "{texts:?}");
        assert!(texts.contains(&"令和5年4月"), "{texts:?}");
    }

    #[test]
    fn merge_otsl_skips_unclear_low_res_readings() {
        let mut unclear = Reading {
            pages: vec![ReadPage {
                index: 0,
                aspect: 0.7,
                pieces: (0..30).map(|i| piece(&format!("line {i}"), 0.1, i as f32 * 0.02, 0.2, 0.01)).collect(),
                cells: false,
                sheet: false,
                unsure: Some(0.1),
                line_height: Some(6.0),
            }],
        };
        unclear.merge_otsl("<fcel>氏名<fcel>佐藤 健太郎<nl>");
        assert_eq!(unclear.pages.len(), 1, "low-res reading must not merge VLM table output");

        let mut clear = Reading {
            pages: vec![ReadPage {
                index: 0,
                aspect: 0.7,
                pieces: (0..30).map(|i| piece(&format!("line {i}"), 0.1, i as f32 * 0.02, 0.2, 0.01)).collect(),
                cells: false,
                sheet: false,
                unsure: Some(0.05),
                line_height: Some(18.0),
            }],
        };
        clear.merge_otsl("<fcel>氏名<fcel>高橋 美咲<nl>");
        assert_eq!(clear.pages.len(), 2, "clear dense reading merges OTSL grid as page 1");
        assert!(clear.pages[1].cells);
    }

    #[test]
    fn two_cells_side_by_side_are_two_values() {
        let reading = Reading::from_grid(&[
            vec!["Medical / Dental / Vision Ins.".to_string(), "240.00".to_string(), "4,560.00".to_string()],
        ]);
        let mut plan = Plan::new(&reading);
        let mut first = serde_json::Map::new();
        let mut second = serde_json::Map::new();
        for c in &plan.candidates {
            let group = if c.text.starts_with("Medical") { "label" } else { "income" };
            first.insert(c.id.clone(), answer(group, 0.9));
            if c.text == "240.00" {
                second.insert(c.id.clone(), answer("income.insurance.health", 0.9));
            }
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        assert!(plan.candidates.iter().any(|c| c.text == "4,560.00"), "{:?}", plan.candidates);
        let document = plan.finish(&[json!({ "answers": second })], 2026);
        assert_eq!(document.details.get("income.insurance.health").map(String::as_str), Some("240"));
    }

    fn cut(text: &str, address: bool) -> Vec<String> {
        segments(text, address).into_iter().map(|(from, to)| text[from..to].to_string()).collect()
    }

    #[test]
    fn a_value_is_cut_into_the_words_and_units_it_holds() {
        assert_eq!(cut("高橋 美咲", false), ["高橋", "美咲"]);
        assert_eq!(
            cut("〒150-0013 東京都渋谷区恵比寿4-20-3 恵比寿ガーデンプレイスタワー 25F", true),
            ["150-0013", "東京都", "渋谷区", "恵比寿", "4-20-3", "恵比寿ガーデンプレイスタワー", "25F"]
        );
        assert_eq!(cut("高橋 健司（続柄：父）", false), ["高橋", "健司", "続柄", "父"]);
        assert_eq!(cut("勤務時間 10:00〜19:00 420,000", false), ["勤務時間", "10:00〜19:00", "420,000"]);
        assert_eq!(cut("123 Main St, Richmond, VA 23219", true), ["123", "Main", "St", "Richmond", "VA", "23219"]);
        assert_eq!(cut("市川 太郎", true), ["市川", "太郎"]);
    }

    /// A plan whose pieces have been given a group: those named in `groups`, and a label for the rest.
    fn grouped(text: &str, groups: &[(&str, &str)]) -> Plan {
        let mut plan = Plan::new(&Reading::from_text(text));
        let mut first = serde_json::Map::new();
        for c in &plan.candidates {
            let group = groups.iter().find(|(t, _)| c.text == *t).map_or("label", |(_, g)| *g);
            first.insert(c.id.clone(), answer(group, 0.95));
        }
        plan.take_first_answers(&[json!({ "answers": first })]);
        plan
    }

    fn id_of(plan: &Plan, text: &str) -> String {
        plan.candidates.iter().find(|c| c.text == text).expect("a piece").id.clone()
    }

    #[test]
    fn the_parts_of_a_name_and_an_address_are_asked_and_kept_beside_the_whole() {
        let address = "〒150-0013 東京都渋谷区恵比寿4-20-3 恵比寿ガーデンプレイスタワー 25F";
        let plan = grouped(&format!("氏名\n高橋 美咲\n住所\n{address}"), &[("高橋 美咲", "name"), (address, "address")]);
        let (name, home) = (id_of(&plan, "高橋 美咲"), id_of(&plan, address));

        let requests = plan.second_requests();
        let options = requests
            .iter()
            .find_map(|r| r["questions"].get(&format!("{name}.0")))
            .map(|q| q["criteria"].clone())
            .expect("a question about the first part of the name");
        assert!(options.get("name.family").is_some() && options.get("none").is_some());
        assert!(options.get("name.full").is_none(), "a part is never the whole name");

        let mut answers = serde_json::Map::new();
        answers.insert(name.clone(), answer("name.full", 0.9));
        answers.insert(home.clone(), answer("address.full", 0.9));
        answers.insert(format!("{name}.0"), answer("name.family", 0.9));
        answers.insert(format!("{name}.1"), answer("name.given", 0.9));
        for (i, key) in ["address.postal", "address.prefecture", "address.city", "address.street", "address.street", "address.building", "address.building"]
            .iter()
            .enumerate()
        {
            answers.insert(format!("{home}.{i}"), answer(key, 0.9));
        }
        let document = plan.finish(&[json!({ "answers": answers })], 2026);
        let get = |key: &str| document.details.get(key).map(String::as_str);
        assert_eq!(get("name.full"), Some("高橋 美咲"));
        assert_eq!(get("name.family"), Some("高橋"));
        assert_eq!(get("name.given"), Some("美咲"));
        assert_eq!(get("address.full"), Some(address));
        assert_eq!(get("address.postal"), Some("150-0013"));
        assert_eq!(get("address.prefecture"), Some("東京都"));
        assert_eq!(get("address.city"), Some("渋谷区"));
        assert_eq!(get("address.street"), Some("恵比寿4-20-3"));
        assert_eq!(get("address.building"), Some("恵比寿ガーデンプレイスタワー 25F"));
    }

    #[test]
    fn a_part_is_more_exact_than_the_piece_it_was_cut_from() {
        let line = "高橋 健司（続柄：父）";
        let plan = grouped(line, &[(line, "emergency")]);
        let id = id_of(&plan, line);
        let mut answers = serde_json::Map::new();
        answers.insert(id.clone(), answer("emergency.name", 0.9));
        answers.insert(format!("{id}.0"), answer("emergency.name", 0.9));
        answers.insert(format!("{id}.1"), answer("emergency.name", 0.9));
        answers.insert(format!("{id}.2"), answer("none", 0.9));
        answers.insert(format!("{id}.3"), answer("emergency.relation", 0.9));
        let document = plan.finish(&[json!({ "answers": answers })], 2026);
        assert_eq!(document.details.get("emergency.name").map(String::as_str), Some("高橋 健司"));
        assert_eq!(document.details.get("emergency.relation").map(String::as_str), Some("父"));
    }

    #[test]
    fn a_number_with_spaces_is_not_cut() {
        let plan = grouped("電話\n03 6400 5510", &[("03 6400 5510", "contact")]);
        let requests = plan.second_requests();
        let asked: Vec<_> = requests.iter().flat_map(|r| r["questions"].as_object().into_iter().flat_map(|q| q.keys().cloned())).collect();
        assert!(asked.iter().all(|id| !id.contains('.')), "{asked:?}");
    }

    #[test]
    fn requests_mask_secret_numbers_while_finish_keeps_real_values() {
        let text = "在留カード番号: AB12345678CD\n旅券番号: C8492011\nSố định danh cá nhân: 079300012345\n電話番号: 080-4129-8831\nEmail: linh.nguyen@tsubame.jp\n振込先: みずほ銀行 新宿支店 普通 1234567\n生年月日: 1998-03-14";
        let mut plan = Plan::new(&Reading::from_text(text));

        let first_payload = serde_json::to_string(&plan.first_requests()).expect("json");
        assert!(!first_payload.contains("AB12345678CD"), "Residence card must be masked: {first_payload}");
        assert!(first_payload.contains("AB12000000CD"), "Masked residence card preserves pattern: {first_payload}");
        assert!(!first_payload.contains("C8492011"), "Passport must be masked: {first_payload}");
        assert!(first_payload.contains("C8400000"), "Masked passport preserves pattern: {first_payload}");
        assert!(!first_payload.contains("079300012345"), "CCCD must be masked: {first_payload}");
        assert!(first_payload.contains("079000000000"), "Masked CCCD preserves prefix: {first_payload}");
        assert!(!first_payload.contains("080-4129-8831"), "Phone must be masked: {first_payload}");
        assert!(first_payload.contains("080-4000-0000"), "Masked phone preserves carrier prefix: {first_payload}");
        assert!(!first_payload.contains("linh.nguyen@tsubame.jp"), "Email handle must be masked: {first_payload}");
        assert!(first_payload.contains("l**********@tsubame.jp"), "Masked email preserves domain: {first_payload}");
        assert!(!first_payload.contains("1234567"), "Bank account number must be masked: {first_payload}");
        assert!(first_payload.contains("1230000"), "Masked bank account preserves length: {first_payload}");
        assert!(first_payload.contains("1998-03-14"), "Dates remain unmasked for era/birth/expiry classification");

        let rc_id = id_of(&plan, "AB12345678CD");
        let pp_id = id_of(&plan, "C8492011");
        let cccd_id = id_of(&plan, "079300012345");
        let phone_id = id_of(&plan, "080-4129-8831");
        let email_id = id_of(&plan, "linh.nguyen@tsubame.jp");
        let bank_id = id_of(&plan, "みずほ銀行 新宿支店 普通 1234567");
        let dob_id = id_of(&plan, "1998-03-14");

        let mut first = serde_json::Map::new();
        first.insert(rc_id.clone(), answer("id", 0.99));
        first.insert(pp_id.clone(), answer("id", 0.99));
        first.insert(cccd_id.clone(), answer("id", 0.99));
        first.insert(phone_id.clone(), answer("contact", 0.99));
        first.insert(email_id.clone(), answer("contact", 0.99));
        first.insert(bank_id.clone(), answer("bank", 0.99));
        first.insert(dob_id.clone(), answer("person", 0.99));
        plan.take_first_answers(&[json!({ "answers": first })]);

        let second_payload = serde_json::to_string(&plan.second_requests()).expect("json");
        assert!(!second_payload.contains("AB12345678CD"));
        assert!(!second_payload.contains("1234567"));

        let mut second = serde_json::Map::new();
        second.insert(rc_id, answer("id.residence_card.number", 0.99));
        second.insert(pp_id, answer("id.passport.number", 0.99));
        second.insert(cccd_id, answer("id.national.number", 0.99));
        second.insert(phone_id, answer("contact.phone", 0.99));
        second.insert(email_id, answer("contact.email", 0.99));
        second.insert(format!("{bank_id}.0"), answer("bank.name", 0.99));
        second.insert(format!("{bank_id}.1"), answer("bank.branch.name", 0.99));
        second.insert(format!("{bank_id}.2"), answer("bank.account.type", 0.99));
        second.insert(format!("{bank_id}.3"), answer("bank.account.number", 0.99));
        second.insert(dob_id, answer("birth.date", 0.99));

        let document = plan.finish(&[json!({ "answers": second })], 2026);
        assert_eq!(document.details.get("id.residence_card.number").map(String::as_str), Some("AB12345678CD"));
        assert_eq!(document.details.get("id.passport.number").map(String::as_str), Some("C8492011"));
        assert_eq!(document.details.get("id.national.number").map(String::as_str), Some("079300012345"));
        assert_eq!(document.details.get("contact.phone").map(String::as_str), Some("080-4129-8831"));
        assert_eq!(document.details.get("contact.email").map(String::as_str), Some("linh.nguyen@tsubame.jp"));
        assert_eq!(document.details.get("bank.account.number").map(String::as_str), Some("1234567"));
        assert_eq!(document.details.get("birth.date").map(String::as_str), Some("1998-03-14"));
    }
}
