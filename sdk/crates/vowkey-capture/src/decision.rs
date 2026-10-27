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
    document::{CapturedDocument, DetailSource, derive_companion_details, extract_payload_details},
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
            .map(|line| ReadPiece { text: line.to_string(), x: 0.0, y: 0.0, w: 0.0, h: 0.0 })
            .collect();
        Reading { pages: vec![ReadPage { index: 0, aspect: 1.0, pieces }] }
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
                    });
                }
            }
        }
        Reading { pages: vec![ReadPage { index: 0, aspect: columns / height, pieces }] }
    }
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
        let (value, next) = if i + 1 < parts.len() {
            match chunk.rsplit_once(|c: char| c.is_whitespace() || c == '\u{3000}') {
                Some((value, next)) if usable(next.trim()) => (value.trim(), next.trim()),
                _ => (chunk, ""),
            }
        } else {
            (chunk, "")
        };
        if !value.is_empty() && !label.is_empty() {
            pairs.push((Some(label.clone()), value.to_string()));
        }
        label = next.to_string();
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
        let text = clip(&pieces[index].text, NEAR_LENGTH);
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
    let beside = ((next.y + next.h / 2.0) - (last.y + last.h / 2.0)).abs() < 0.5 * tall
        && (-0.01..=1.5 * tall / last.aspect.max(0.1)).contains(&(next.x - (last.x + last.w)));
    under || beside
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
                let mut piece = json!({ "id": c.id, "text": c.text, "near": c.near });
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
        if requests.is_empty() {
            requests.push(json!({ "state": state, "questions": {} }));
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
            let joins = match (merged.last(), group.as_deref()) {
                (Some(last), Some(group)) if !matches!(group, "label" | "other") => {
                    self.groups.get(&last.id).is_some_and(|g| g.value == group) && follows(last, &candidate)
                }
                _ => false,
            };
            if joins {
                if let Some(last) = merged.last_mut() {
                    let glue = if last.text.ends_with([',', '-', '(']) || candidate.text.starts_with([')', ',']) {
                        " "
                    } else if self.groups.get(&last.id).is_some_and(|g| g.value == "address") {
                        ", "
                    } else {
                        " "
                    };
                    last.text = format!("{}{glue}{}", last.text, candidate.text);
                    last.w = last.w.max(candidate.x + candidate.w - last.x);
                    last.h = (candidate.y + candidate.h - last.y).max(last.h);
                }
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
        asked
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
            .collect()
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
                placed.push((position, choice.value.clone(), Choice { value: choice.value, p: choice.p * before }));
            }
        }
        placed.sort_by_key(|(position, _, _)| *position);

        // Pieces of one detail that sit one under another are one value, such as an address that
        // runs over two lines. Otherwise the piece the model was surest of is the value.
        let mut values: BTreeMap<String, (String, f32, usize)> = BTreeMap::new();
        for (position, key, choice) in placed {
            let candidate = &self.candidates[position];
            match values.get_mut(&key) {
                Some((text, p, last)) if self.continues(*last, position) => {
                    let joiner = if text.ends_with(',') { " " } else { ", " };
                    text.push_str(joiner);
                    text.push_str(&candidate.text);
                    *p = p.min(choice.p);
                    *last = position;
                }
                Some((text, p, last)) => {
                    if choice.p > *p {
                        *text = candidate.text.clone();
                        *p = choice.p;
                        *last = position;
                    }
                }
                None => {
                    values.insert(key, (candidate.text.clone(), choice.p, position));
                }
            }
        }

        for (key, (text, _, _)) in values {
            let value = normalize_value(&key, &text);
            if value.is_empty() || document.details.contains_key(&key) {
                continue;
            }
            document.details.insert(key.clone(), value);
            document
                .sources
                .insert(key, DetailSource { kind: "decision".to_string(), verified: false });
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
                    .insert(key.clone(), DetailSource { kind: "derived".to_string(), verified: false });
            }
        }
        document
    }

    /// Whether the piece at `next` carries on the piece at `last`: the next line of the same block.
    fn continues(&self, last: usize, next: usize) -> bool {
        let (a, b) = (&self.candidates[last], &self.candidates[next]);
        if a.page != b.page || next != last + 1 {
            return false;
        }
        let boxed = (a.w > 0.0 || a.h > 0.0) && (b.w > 0.0 || b.h > 0.0);
        if !boxed {
            return true;
        }
        let below = b.y - (a.y + a.h);
        (-0.2 * a.h..=1.5 * a.h.max(b.h)).contains(&below) && (b.x - a.x).abs() <= 0.04
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
        ReadPiece { text: text.to_string(), x, y, w, h }
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
}
