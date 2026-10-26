//! The PDF417 barcode on North American driver licences and ID cards (AAMVA DL/ID CDS).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vowkey_error::vowkey_error;

use crate::mrz::Sex;

/// Why a string is not an AAMVA barcode payload.
#[vowkey_error(flat)]
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AamvaError {
    /// The compliance indicator and `ANSI ` or `AAMVA` file type are missing.
    #[error("an AAMVA barcode starts with @\\n\\x1e\\r followed by ANSI or AAMVA")]
    MissingHeader,
    /// Neither a `DL` nor an `ID` subfile could be located.
    #[error("an AAMVA barcode holds a DL or ID subfile")]
    MissingSubfile,
    /// A required element is absent from the subfile.
    #[error("the AAMVA subfile is missing element {0}")]
    MissingElement(&'static str),
}

/// An AAMVA driver licence or identification card read from its PDF417 barcode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct AamvaCard {
    /// The six-digit Issuer Identification Number (such as `636000` for Virginia).
    pub iin: String,
    /// The AAMVA CDS version number (`1` to `10`).
    pub version: u8,
    /// The two-digit jurisdiction version number.
    pub jurisdiction_version: u8,
    /// The subfile type: `DL` or `ID`.
    pub subfile_type: String,
    /// The customer ID or driver licence number (`DAQ`).
    pub document_number: String,
    /// The family name (`DCS`).
    pub family_name: String,
    /// The given name (`DAC`).
    pub given_name: String,
    /// The middle name or names (`DAD`), with commas turned into spaces and `NONE` omitted.
    pub middle_names: Option<String>,
    /// The full name assembled in `given middle family` order.
    pub full_name: String,
    /// The date of birth (`DBB`) as `YYYY-MM-DD`.
    pub birth_date: Option<String>,
    /// The document issue date (`DBD`) as `YYYY-MM-DD`.
    pub issue_date: Option<String>,
    /// The document expiry date (`DBA`) as `YYYY-MM-DD`.
    pub expiry_date: Option<String>,
    /// The holder's sex (`DBC`).
    pub sex: Option<Sex>,
    /// The first line of the street address (`DAG`).
    pub street: Option<String>,
    /// The second line of the street address (`DAH`), when present.
    pub street_line_2: Option<String>,
    /// The city (`DAI`).
    pub city: Option<String>,
    /// The two-letter state, province or territory code (`DAJ`).
    pub state: Option<String>,
    /// The postal or ZIP code (`DAK`), with an all-zero `+4` suffix removed.
    pub postal_code: Option<String>,
    /// The three-letter issuing country (`DCG`), such as `USA` or `CAN`.
    pub country: Option<String>,
    /// The raw three-letter element codes and their trimmed values.
    pub elements: BTreeMap<String, String>,
}

impl AamvaCard {
    /// Reads an AAMVA PDF417 barcode payload.
    pub fn parse(raw: &str) -> Result<Self, AamvaError> {
        let header_pos = raw
            .find("ANSI ")
            .or_else(|| raw.find("AAMVA"))
            .ok_or(AamvaError::MissingHeader)?;
        let after_file_type = raw
            .get(header_pos + 5..)
            .ok_or(AamvaError::MissingHeader)?;
        if after_file_type.len() < 12 {
            return Err(AamvaError::MissingHeader);
        }

        let iin = after_file_type
            .get(0..6)
            .ok_or(AamvaError::MissingHeader)?
            .to_string();
        let version = after_file_type
            .get(6..8)
            .and_then(|s| s.parse::<u8>().ok())
            .ok_or(AamvaError::MissingHeader)?;
        let (jurisdiction_version, entries_start) = if version <= 1 {
            (0, 8)
        } else {
            let jv = after_file_type
                .get(8..10)
                .and_then(|s| s.parse::<u8>().ok())
                .ok_or(AamvaError::MissingHeader)?;
            (jv, 10)
        };
        let subfile_count = after_file_type
            .get(entries_start..entries_start + 2)
            .and_then(|s| s.parse::<usize>().ok())
            .ok_or(AamvaError::MissingHeader)?;

        let designators_start = entries_start + 2;
        let mut subfile_type = None;
        let mut subfile_slice = None;

        for idx in 0..subfile_count {
            let entry_offset = designators_start + idx * 10;
            let Some(entry) = after_file_type.get(entry_offset..entry_offset + 10) else {
                break;
            };
            let kind = entry.get(0..2).unwrap_or_default();
            if kind == "DL" || kind == "ID" {
                subfile_type = Some(kind.to_string());
                if let (Some(offset), Some(length)) = (
                    entry.get(2..6).and_then(|s| s.parse::<usize>().ok()),
                    entry.get(6..10).and_then(|s| s.parse::<usize>().ok()),
                ) {
                    if let Some(slice) = raw.get(offset..offset.saturating_add(length)) {
                        if slice.starts_with("DL") || slice.starts_with("ID") {
                            subfile_slice = Some(slice);
                            break;
                        }
                    }
                }
            }
        }

        let body_after_designators = after_file_type
            .get(designators_start + subfile_count * 10..)
            .unwrap_or(after_file_type);

        let (subfile_type, body) = match (subfile_type, subfile_slice) {
            (Some(kind), Some(slice)) => (kind, slice.get(2..).unwrap_or_default()),
            _ => {
                if let Some(pos) = body_after_designators.find("DLDAQ") {
                    (
                        "DL".to_string(),
                        body_after_designators.get(pos + 2..).unwrap_or_default(),
                    )
                } else if let Some(pos) = body_after_designators.find("IDDAQ") {
                    (
                        "ID".to_string(),
                        body_after_designators.get(pos + 2..).unwrap_or_default(),
                    )
                } else if let Some(rest) = body_after_designators.strip_prefix("DL") {
                    ("DL".to_string(), rest)
                } else if let Some(rest) = body_after_designators.strip_prefix("ID") {
                    ("ID".to_string(), rest)
                } else {
                    return Err(AamvaError::MissingSubfile);
                }
            }
        };

        let mut elements = BTreeMap::new();
        for segment in body.split(['\n', '\r', '\x1e']) {
            if segment.len() < 3 {
                continue;
            }
            let Some(code) = segment.get(0..3) else {
                continue;
            };
            if code.bytes().all(|b| b.is_ascii_uppercase()) {
                let value = segment.get(3..).unwrap_or_default().trim();
                if !value.is_empty() {
                    elements.insert(code.to_string(), value.to_string());
                }
            }
        }

        let document_number = elements
            .get("DAQ")
            .cloned()
            .ok_or(AamvaError::MissingElement("DAQ"))?;
        let family_name = elements
            .get("DCS")
            .or_else(|| elements.get("DAB"))
            .cloned()
            .ok_or(AamvaError::MissingElement("DCS"))?;
        let given_name = elements
            .get("DAC")
            .or_else(|| elements.get("DCT"))
            .cloned()
            .ok_or(AamvaError::MissingElement("DAC"))?;

        let middle_names = elements
            .get("DAD")
            .and_then(|raw_mid| clean_optional_field(raw_mid))
            .map(|mid| {
                mid.split([',', ' '])
                    .filter(|part| !part.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|mid| !mid.is_empty());

        let full_name = match &middle_names {
            Some(mid) => format!("{given_name} {mid} {family_name}"),
            None => format!("{given_name} {family_name}"),
        };

        let country = elements.get("DCG").cloned();
        let year_first = matches!(country.as_deref(), Some("CAN"));

        let birth_date = elements
            .get("DBB")
            .and_then(|raw_date| parse_aamva_date(raw_date, year_first));
        let issue_date = elements
            .get("DBD")
            .and_then(|raw_date| parse_aamva_date(raw_date, year_first));
        let expiry_date = elements
            .get("DBA")
            .and_then(|raw_date| parse_aamva_date(raw_date, year_first));

        let sex = elements.get("DBC").and_then(|s| match s.as_str() {
            "1" | "M" => Some(Sex::Male),
            "2" | "F" => Some(Sex::Female),
            "9" | "X" => Some(Sex::Unspecified('X')),
            _ => None,
        });

        let street = elements
            .get("DAG")
            .and_then(|s| clean_optional_field(s))
            .map(str::to_string);
        let street_line_2 = elements
            .get("DAH")
            .and_then(|s| clean_optional_field(s))
            .map(str::to_string);
        let city = elements
            .get("DAI")
            .and_then(|s| clean_optional_field(s))
            .map(str::to_string);
        let state = elements
            .get("DAJ")
            .and_then(|s| clean_optional_field(s))
            .map(str::to_string);
        let postal_code = elements
            .get("DAK")
            .and_then(|s| clean_optional_field(s))
            .map(normalize_postal_code);

        Ok(Self {
            iin,
            version,
            jurisdiction_version,
            subfile_type,
            document_number,
            family_name,
            given_name,
            middle_names,
            full_name,
            birth_date,
            issue_date,
            expiry_date,
            sex,
            street,
            street_line_2,
            city,
            state,
            postal_code,
            country,
            elements,
        })
    }

    /// The canonical profile details read from this card.
    pub fn details(&self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        out.insert(
            "id.driver_license.number".to_string(),
            self.document_number.clone(),
        );
        out.insert(
            "id.drivers_license.number".to_string(),
            self.document_number.clone(),
        );
        out.insert("name.family".to_string(), self.family_name.clone());
        out.insert("name.given".to_string(), self.given_name.clone());
        if let Some(middle) = &self.middle_names {
            out.insert("name.middle".to_string(), middle.clone());
        }
        out.insert("name.full".to_string(), self.full_name.clone());
        if let Some(birth) = &self.birth_date {
            out.insert("birth.date".to_string(), birth.clone());
        }
        if let Some(issue) = &self.issue_date {
            out.insert("id.driver_license.issued".to_string(), issue.clone());
            out.insert("id.drivers_license.issue_date".to_string(), issue.clone());
        }
        if let Some(expiry) = &self.expiry_date {
            out.insert("id.driver_license.expiry".to_string(), expiry.clone());
            out.insert("id.drivers_license.expiry_date".to_string(), expiry.clone());
        }
        if let Some(sex) = self.sex {
            out.insert("person.sex".to_string(), sex.as_mrz_char().to_string());
        }
        if let Some(street) = &self.street {
            out.insert("address.street".to_string(), street.clone());
        }
        if let Some(street2) = &self.street_line_2 {
            out.insert("address.line2".to_string(), street2.clone());
        }
        if let Some(city) = &self.city {
            out.insert("address.city".to_string(), city.clone());
        }
        if let Some(state) = &self.state {
            out.insert("address.prefecture".to_string(), state.clone());
            out.insert("address.state".to_string(), state.clone());
        }
        if let Some(postal) = &self.postal_code {
            out.insert("address.postal".to_string(), postal.clone());
            out.insert("address.postal_code".to_string(), postal.clone());
        }
        if let Some(country) = &self.country {
            out.insert("address.country".to_string(), country.clone());
        }
        out
    }
}

fn clean_optional_field(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("NONE")
        || trimmed.eq_ignore_ascii_case("UNAVL")
        || trimmed.eq_ignore_ascii_case("N/A")
    {
        None
    } else {
        Some(trimmed)
    }
}

fn parse_aamva_date(raw: &str, prefer_year_first: bool) -> Option<String> {
    let digits = raw.trim();
    if digits.len() != 8 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let first_four = digits.get(0..4)?.parse::<u16>().ok()?;
    let starts_with_year = (1900..=2100).contains(&first_four);
    if prefer_year_first || starts_with_year {
        let year = digits.get(0..4)?;
        let month = digits.get(4..6)?;
        let day = digits.get(6..8)?;
        Some(format!("{year}-{month}-{day}"))
    } else {
        let month = digits.get(0..2)?;
        let day = digits.get(2..4)?;
        let year = digits.get(4..8)?;
        Some(format!("{year}-{month}-{day}"))
    }
}

fn normalize_postal_code(raw: &str) -> String {
    let trimmed = raw.trim();
    let digits_only = trimmed.replace('-', "");
    if digits_only.len() == 9 && digits_only.bytes().all(|b| b.is_ascii_digit()) {
        let prefix = digits_only.get(0..5).unwrap_or(trimmed);
        let suffix = digits_only.get(5..9).unwrap_or_default();
        if suffix == "0000" {
            return prefix.to_string();
        }
        return format!("{prefix}-{suffix}");
    }
    trimmed.to_string()
}
