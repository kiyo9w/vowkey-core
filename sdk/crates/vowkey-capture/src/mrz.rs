//! The machine-readable zone of passports, cards and visas (ICAO Doc 9303, parts 3 to 7).

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vowkey_error::vowkey_error;

/// The layout of a machine-readable zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub enum MrzFormat {
    /// An ID card or residence permit: three lines of 30 characters.
    Td1,
    /// A card: two lines of 36 characters.
    Td2,
    /// A passport: two lines of 44 characters.
    Td3,
    /// A visa: two lines of 44 characters, without a composite check digit.
    MrvA,
    /// A visa: two lines of 36 characters, without a composite check digit.
    MrvB,
}

impl MrzFormat {
    fn line_length(self) -> usize {
        match self {
            Self::Td1 => 30,
            Self::Td2 | Self::MrvB => 36,
            Self::Td3 | Self::MrvA => 44,
        }
    }
}

/// Why a block of text is not a machine-readable zone.
#[vowkey_error(flat)]
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum MrzError {
    /// The lines do not form one of the five layouts.
    #[error("a machine-readable zone is two lines of 36 or 44 characters, or three of 30")]
    UnknownLayout,
    /// A line holds a character outside A to Z, 0 to 9 and `<`.
    #[error("line {line} holds {found:?}; a machine-readable zone uses only A to Z, 0 to 9 and <")]
    InvalidCharacter {
        /// The line, counting from 1.
        line: usize,
        /// The character that does not belong.
        found: char,
    },
}

/// The field a check digit covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub enum MrzField {
    /// The document number.
    DocumentNumber,
    /// The date of birth.
    BirthDate,
    /// The date of expiry.
    ExpiryDate,
    /// The personal number of a passport, or the optional data of a card.
    PersonalNumber,
    /// The digit that covers the other fields together.
    Composite,
}

/// One check digit, with what it covered, what the document prints and what it should be.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct MrzCheck {
    /// The field the digit covers.
    pub field: MrzField,
    /// The characters the digit covers.
    pub data: String,
    /// The character the document prints: a digit, or `<` on an empty field.
    pub printed: char,
    /// The digit the characters add up to.
    pub expected: u8,
    /// Whether the printed digit matches.
    pub ok: bool,
}

/// The sex printed in the zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub enum Sex {
    /// `F`.
    Female,
    /// `M`.
    Male,
    /// `X`, or `<` when the document does not print it, as the character the zone holds.
    Unspecified(char),
}

impl Sex {
    /// The character the zone uses.
    pub fn as_mrz_char(self) -> char {
        match self {
            Self::Female => 'F',
            Self::Male => 'M',
            Self::Unspecified(printed) => printed,
        }
    }

    fn from_byte(byte: u8) -> Self {
        match byte {
            b'F' => Self::Female,
            b'M' => Self::Male,
            other => Self::Unspecified(char::from(other)),
        }
    }
}

/// A date as printed, `YYMMDD`, with `<` where a part is unknown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct MrzDate(String);

/// A date with the parts the document gave.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct PartialDate {
    /// The four-digit year.
    pub year: Option<u16>,
    /// The month, 1 to 12.
    pub month: Option<u8>,
    /// The day of the month.
    pub day: Option<u8>,
}

impl PartialDate {
    /// `YYYY-MM-DD`, ending where the first unknown part starts.
    pub fn iso(&self) -> String {
        match (self.year, self.month, self.day) {
            (Some(y), Some(m), Some(d)) => format!("{y:04}-{m:02}-{d:02}"),
            (Some(y), Some(m), None) => format!("{y:04}-{m:02}"),
            (Some(y), None, _) => format!("{y:04}"),
            _ => String::new(),
        }
    }
}

impl MrzDate {
    /// The six characters as printed.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn two_digits(&self, from: usize) -> Option<u8> {
        let tens = digit(*self.0.as_bytes().get(from)?)?;
        let ones = digit(*self.0.as_bytes().get(from + 1)?)?;
        Some(tens * 10 + ones)
    }

    /// The two-digit year.
    pub fn year(&self) -> Option<u8> {
        self.two_digits(0)
    }

    /// The month, when printed.
    pub fn month(&self) -> Option<u8> {
        self.two_digits(2).filter(|m| (1..=12).contains(m))
    }

    /// The day, when printed.
    pub fn day(&self) -> Option<u8> {
        self.two_digits(4).filter(|d| (1..=31).contains(d))
    }

    /// A birth date is never in the future, so a two-digit year after `current_year` belongs to the
    /// last century. A holder older than 99 years reads as born a century late.
    pub fn resolve_birth(&self, current_year: u16) -> PartialDate {
        let year = self.year().map(|yy| {
            let this_century = current_year - current_year % 100 + u16::from(yy);
            if this_century > current_year {
                this_century - 100
            } else {
                this_century
            }
        });
        PartialDate {
            year,
            month: self.month(),
            day: self.day(),
        }
    }

    /// An expiry date is in this century: documents are valid for years, not for a century.
    pub fn resolve_expiry(&self) -> PartialDate {
        PartialDate {
            year: self.year().map(|yy| 2000 + u16::from(yy)),
            month: self.month(),
            day: self.day(),
        }
    }
}

/// A machine-readable zone, read and checked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct Mrz {
    /// The layout the lines follow.
    pub format: MrzFormat,
    /// The lines as read, cleaned of spacing.
    pub lines: Vec<String>,
    /// The document code, such as `P`, `ID`, `IR` or `V`.
    pub document_code: String,
    /// The issuing state as printed: an ISO 3166 alpha-3 code, `D<<` for Germany, `UTO` in the
    /// examples.
    pub issuer: String,
    /// The family name. A name cut at the end of the line is cut here too.
    pub family_name: String,
    /// The given names.
    pub given_names: String,
    /// The document number, with its padding removed.
    pub document_number: String,
    /// The holder's nationality, as printed.
    pub nationality: String,
    /// The date of birth.
    pub birth_date: MrzDate,
    /// The sex.
    pub sex: Sex,
    /// The date of expiry.
    pub expiry_date: MrzDate,
    /// The personal number of a passport, or the optional data of a card or visa.
    pub optional_data: String,
    /// The second optional field of a three-line card.
    pub optional_data_2: String,
    /// Every check digit the layout has.
    pub checks: Vec<MrzCheck>,
}

impl Mrz {
    /// Whether every check digit passes. A zone that fails one has a character that was misread
    /// or a field that was changed.
    pub fn verified(&self) -> bool {
        self.checks.iter().all(|check| check.ok)
    }

    /// The check digits that do not match.
    pub fn failed_checks(&self) -> impl Iterator<Item = &MrzCheck> {
        self.checks.iter().filter(|check| !check.ok)
    }

    /// Reads the lines of a zone, as printed.
    pub fn parse<S: AsRef<str>>(lines: &[S]) -> Result<Self, MrzError> {
        let lines = lines
            .iter()
            .enumerate()
            .map(|(index, line)| clean(line.as_ref(), index + 1))
            .collect::<Result<Vec<_>, _>>()?;
        let format = detect(&lines)?;
        Ok(read(format, &lines))
    }

    /// Reads lines recognized from a photo. Letters and digits that OCR confuses are corrected by
    /// where they stand, a character that breaks a document number's check digit is replaced by
    /// the lookalike that satisfies it, and lines that lost trailing fillers are padded.
    pub fn parse_ocr<S: AsRef<str>>(lines: &[S]) -> Result<Self, MrzError> {
        let normalized: Vec<String> = lines
            .iter()
            .map(|line| normalize_ocr(line.as_ref()))
            .collect();
        let mut bytes = normalized
            .iter()
            .enumerate()
            .map(|(index, line)| clean(line, index + 1))
            .collect::<Result<Vec<_>, _>>()?;
        let format = detect_loose(&bytes)?;
        fit(&mut bytes, format);
        correct_by_position(&mut bytes, format);
        let first = read(format, &bytes);
        if first.verified() {
            return Ok(first);
        }
        Ok(repair_by_check_digits(format, &bytes).unwrap_or(first))
    }
}

/// Finds the zones in text that OCR recognized from a page, in the order they appear.
pub fn find_mrz(text: &str) -> Vec<Vec<String>> {
    let lines: Vec<String> = text
        .lines()
        .map(normalize_ocr)
        .filter(|line| !line.is_empty())
        .collect();
    let mut found = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let near =
            |line: &String, target: usize| line.len().abs_diff(target) <= 2 && line.len() >= 20;
        let group = |count: usize, length: usize| {
            lines
                .get(index..index + count)
                .filter(|group| group.iter().all(|l| near(l, length)))
        };
        if let Some(group) = group(3, 30)
            .or_else(|| group(2, 44))
            .or_else(|| group(2, 36))
        {
            found.push(group.to_vec());
            index += group.len();
        } else {
            index += 1;
        }
    }
    found
}

fn digit(byte: u8) -> Option<u8> {
    byte.is_ascii_digit().then(|| byte - b'0')
}

fn clean(line: &str, number: usize) -> Result<Vec<u8>, MrzError> {
    let upper = line.trim().to_ascii_uppercase();
    for found in upper.chars() {
        if !(found.is_ascii_uppercase() || found.is_ascii_digit() || found == '<') {
            return Err(MrzError::InvalidCharacter {
                line: number,
                found,
            });
        }
    }
    Ok(upper.into_bytes())
}

fn detect(lines: &[Vec<u8>]) -> Result<MrzFormat, MrzError> {
    let lengths: Vec<usize> = lines.iter().map(Vec::len).collect();
    let visa = lines.first().and_then(|line| line.first()) == Some(&b'V');
    match lengths.as_slice() {
        [30, 30, 30] => Ok(MrzFormat::Td1),
        [36, 36] if visa => Ok(MrzFormat::MrvB),
        [36, 36] => Ok(MrzFormat::Td2),
        [44, 44] if visa => Ok(MrzFormat::MrvA),
        [44, 44] => Ok(MrzFormat::Td3),
        _ => Err(MrzError::UnknownLayout),
    }
}

/// Like `detect`, for lines that OCR may have shortened or lengthened by a character or two.
fn detect_loose(lines: &[Vec<u8>]) -> Result<MrzFormat, MrzError> {
    let near = |target: usize| lines.iter().all(|line| line.len().abs_diff(target) <= 3);
    let visa = lines.first().and_then(|line| line.first()) == Some(&b'V');
    match lines.len() {
        3 if near(30) => Ok(MrzFormat::Td1),
        2 if near(44) && visa => Ok(MrzFormat::MrvA),
        2 if near(44) => Ok(MrzFormat::Td3),
        2 if near(36) && visa => Ok(MrzFormat::MrvB),
        2 if near(36) => Ok(MrzFormat::Td2),
        _ => Err(MrzError::UnknownLayout),
    }
}

/// Pads a line that lost trailing fillers and trims one that gained stray characters.
fn fit(lines: &mut [Vec<u8>], format: MrzFormat) {
    for line in lines.iter_mut() {
        line.resize(format.line_length(), b'<');
    }
}

fn normalize_ocr(line: &str) -> String {
    line.chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '«' | '‹' | '〈' | '＜' => '<',
            other => other.to_ascii_uppercase(),
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq)]
enum Class {
    Alpha,
    Num,
    Any,
}

fn text(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| char::from(b)).collect()
}

fn span(line: &[u8], from: usize, to: usize) -> &[u8] {
    line.get(from..to).unwrap_or_default()
}

fn at(line: &[u8], index: usize) -> u8 {
    line.get(index).copied().unwrap_or(b'<')
}

fn padded(bytes: &[u8]) -> String {
    text(bytes).trim_end_matches('<').to_string()
}

fn check_digit(data: &[u8]) -> u8 {
    const WEIGHTS: [u32; 3] = [7, 3, 1];
    let sum: u32 = data
        .iter()
        .enumerate()
        .map(|(index, &byte)| {
            let value = match byte {
                b'0'..=b'9' => u32::from(byte - b'0'),
                b'A'..=b'Z' => u32::from(byte - b'A') + 10,
                _ => 0,
            };
            value * WEIGHTS[index % 3]
        })
        .sum();
    u8::try_from(sum % 10).unwrap_or(0)
}

fn check(field: MrzField, data: &[u8], printed: u8) -> MrzCheck {
    let expected = check_digit(data);
    let ok = match printed {
        // An empty field may carry a filler where the digit would be.
        b'<' => data.iter().all(|&byte| byte == b'<'),
        printed => digit(printed) == Some(expected),
    };
    MrzCheck {
        field,
        data: text(data),
        printed: char::from(printed),
        expected,
        ok,
    }
}

/// The name field: `FAMILY<<GIVEN<NAMES`, where a single `<` stands for a space or a hyphen.
fn name(bytes: &[u8]) -> (String, String) {
    let raw = text(bytes);
    let (family, given) = raw.split_once("<<").unwrap_or((raw.as_str(), ""));
    let words = |part: &str| {
        part.split('<')
            .filter(|word| !word.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    };
    (words(family), words(given))
}

fn document_code(bytes: &[u8]) -> String {
    padded(bytes)
}

fn read(format: MrzFormat, lines: &[Vec<u8>]) -> Mrz {
    let strings: Vec<String> = lines.iter().map(|line| text(line)).collect();
    let mut checks = Vec::new();

    let (
        document_code_bytes,
        issuer,
        family_given,
        document_number,
        nationality,
        birth,
        sex,
        expiry,
        optional,
        optional_2,
    );
    match format {
        MrzFormat::Td1 => {
            let (l1, l2, l3) = (&lines[0], &lines[1], &lines[2]);
            document_code_bytes = span(l1, 0, 2).to_vec();
            issuer = text(span(l1, 2, 5));
            let mut number = span(l1, 5, 14).to_vec();
            let mut number_check = at(l1, 14);
            let mut first_optional = span(l1, 15, 30).to_vec();
            if number_check == b'<' {
                // A number longer than nine characters runs into the optional field, and its
                // check digit is the last character before the next filler.
                let end = first_optional
                    .iter()
                    .position(|&b| b == b'<')
                    .unwrap_or(first_optional.len());
                if end > 0 {
                    number_check = first_optional[end - 1];
                    let tail = first_optional[..end - 1].to_vec();
                    number.extend(tail);
                    first_optional = first_optional[end..].to_vec();
                }
            }
            checks.push(check(MrzField::DocumentNumber, &number, number_check));
            family_given = name(l3);
            document_number = padded(&number);
            optional = padded(&first_optional);
            birth = MrzDate(text(span(l2, 0, 6)));
            checks.push(check(MrzField::BirthDate, span(l2, 0, 6), at(l2, 6)));
            sex = Sex::from_byte(at(l2, 7));
            expiry = MrzDate(text(span(l2, 8, 14)));
            checks.push(check(MrzField::ExpiryDate, span(l2, 8, 14), at(l2, 14)));
            nationality = text(span(l2, 15, 18));
            optional_2 = padded(span(l2, 18, 29));
            let composite: Vec<u8> = [
                span(l1, 5, 30),
                span(l2, 0, 7),
                span(l2, 8, 15),
                span(l2, 18, 29),
            ]
            .concat();
            checks.push(check(MrzField::Composite, &composite, at(l2, 29)));
        }
        MrzFormat::Td2 | MrzFormat::MrvB | MrzFormat::Td3 | MrzFormat::MrvA => {
            let (l1, l2) = (&lines[0], &lines[1]);
            document_code_bytes = span(l1, 0, 2).to_vec();
            issuer = text(span(l1, 2, 5));
            family_given = name(span(l1, 5, format.line_length()));
            document_number = padded(span(l2, 0, 9));
            checks.push(check(MrzField::DocumentNumber, span(l2, 0, 9), at(l2, 9)));
            nationality = text(span(l2, 10, 13));
            birth = MrzDate(text(span(l2, 13, 19)));
            checks.push(check(MrzField::BirthDate, span(l2, 13, 19), at(l2, 19)));
            sex = Sex::from_byte(at(l2, 20));
            expiry = MrzDate(text(span(l2, 21, 27)));
            checks.push(check(MrzField::ExpiryDate, span(l2, 21, 27), at(l2, 27)));
            optional_2 = String::new();
            match format {
                MrzFormat::Td3 => {
                    optional = padded(span(l2, 28, 42));
                    checks.push(check(
                        MrzField::PersonalNumber,
                        span(l2, 28, 42),
                        at(l2, 42),
                    ));
                    let composite: Vec<u8> =
                        [span(l2, 0, 10), span(l2, 13, 20), span(l2, 21, 43)].concat();
                    checks.push(check(MrzField::Composite, &composite, at(l2, 43)));
                }
                MrzFormat::Td2 => {
                    optional = padded(span(l2, 28, 35));
                    let composite: Vec<u8> =
                        [span(l2, 0, 10), span(l2, 13, 20), span(l2, 21, 35)].concat();
                    checks.push(check(MrzField::Composite, &composite, at(l2, 35)));
                }
                _ => optional = padded(span(l2, 28, format.line_length())),
            }
        }
    }

    Mrz {
        format,
        lines: strings,
        document_code: document_code(&document_code_bytes),
        issuer,
        family_name: family_given.0,
        given_names: family_given.1,
        document_number,
        nationality,
        birth_date: birth,
        sex,
        expiry_date: expiry,
        optional_data: optional,
        optional_data_2: optional_2,
        checks,
    }
}

/// Which of letters and digits each position can hold.
fn classes(format: MrzFormat) -> Vec<Vec<(usize, usize, Class)>> {
    use Class::{Alpha, Any, Num};
    match format {
        MrzFormat::Td3 | MrzFormat::MrvA => vec![
            vec![(0, 2, Alpha), (2, 5, Alpha), (5, 44, Alpha)],
            vec![
                (0, 9, Any),
                (9, 10, Num),
                (10, 13, Alpha),
                (13, 20, Num),
                (20, 21, Alpha),
                (21, 28, Num),
                (28, if format == MrzFormat::Td3 { 42 } else { 44 }, Any),
                (42, 44, if format == MrzFormat::Td3 { Num } else { Any }),
            ],
        ],
        MrzFormat::Td2 | MrzFormat::MrvB => vec![
            vec![(0, 2, Alpha), (2, 5, Alpha), (5, 36, Alpha)],
            vec![
                (0, 9, Any),
                (9, 10, Num),
                (10, 13, Alpha),
                (13, 20, Num),
                (20, 21, Alpha),
                (21, 28, Num),
                (28, if format == MrzFormat::Td2 { 35 } else { 36 }, Any),
                (35, 36, if format == MrzFormat::Td2 { Num } else { Any }),
            ],
        ],
        MrzFormat::Td1 => vec![
            vec![(0, 2, Alpha), (2, 5, Alpha), (5, 30, Any)],
            vec![
                (0, 7, Num),
                (7, 8, Alpha),
                (8, 15, Num),
                (15, 18, Alpha),
                (18, 29, Any),
                (29, 30, Num),
            ],
            vec![(0, 30, Alpha)],
        ],
    }
}

fn to_digit(byte: u8) -> u8 {
    match byte {
        b'O' | b'Q' | b'D' => b'0',
        b'I' | b'L' => b'1',
        b'Z' => b'2',
        b'S' => b'5',
        b'G' => b'6',
        b'B' => b'8',
        other => other,
    }
}

fn to_letter(byte: u8) -> u8 {
    match byte {
        b'0' => b'O',
        b'1' => b'I',
        b'2' => b'Z',
        b'5' => b'S',
        b'8' => b'B',
        other => other,
    }
}

fn correct_by_position(lines: &mut [Vec<u8>], format: MrzFormat) {
    for (line, segments) in lines.iter_mut().zip(classes(format)) {
        for (from, to, class) in segments {
            for byte in line.iter_mut().take(to).skip(from) {
                match class {
                    Class::Num => *byte = to_digit(*byte),
                    Class::Alpha => *byte = to_letter(*byte),
                    Class::Any => {}
                }
            }
        }
    }
}

/// Characters that OCR swaps for one another.
const LOOKALIKES: [(u8, u8); 6] = [
    (b'0', b'O'),
    (b'1', b'I'),
    (b'2', b'Z'),
    (b'5', b'S'),
    (b'8', b'B'),
    (b'6', b'G'),
];

fn lookalikes(byte: u8) -> impl Iterator<Item = u8> {
    LOOKALIKES.iter().filter_map(move |&(a, b)| {
        if byte == a {
            Some(b)
        } else if byte == b {
            Some(a)
        } else {
            None
        }
    })
}

/// Where the free-text fields sit: the document number and the personal number or optional data.
fn text_fields(format: MrzFormat) -> Vec<(usize, usize, usize)> {
    match format {
        MrzFormat::Td3 => vec![(1, 0, 9), (1, 28, 42)],
        MrzFormat::Td2 => vec![(1, 0, 9), (1, 28, 35)],
        MrzFormat::MrvA | MrzFormat::MrvB => vec![(1, 0, 9)],
        MrzFormat::Td1 => vec![(0, 5, 14), (0, 15, 30), (1, 18, 29)],
    }
}

/// Replaces one character of a free-text field by its lookalike when that makes every check pass.
fn repair_by_check_digits(format: MrzFormat, lines: &[Vec<u8>]) -> Option<Mrz> {
    for (line_index, from, to) in text_fields(format) {
        for position in from..to {
            let byte = at(&lines[line_index], position);
            for replacement in lookalikes(byte) {
                let mut candidate = lines.to_vec();
                candidate[line_index][position] = replacement;
                let read = read(format, &candidate);
                if read.verified() {
                    return Some(read);
                }
            }
        }
    }
    None
}
