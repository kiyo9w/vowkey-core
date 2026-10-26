//! The QR code on a Vietnamese citizen identity card (Căn cước công dân / Căn cước).

use std::collections::BTreeMap;

use icu_normalizer::ComposingNormalizerBorrowed;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use vowkey_error::vowkey_error;

use crate::mrz::Sex;

/// Why a string is not a Vietnamese CCCD QR payload.
#[vowkey_error(flat)]
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CccdError {
    /// Fewer than seven pipe-separated fields were found.
    #[error("a Vietnamese CCCD QR payload has at least seven pipe-separated fields")]
    TooFewFields,
    /// The personal identification number is not twelve digits.
    #[error("a Vietnamese personal identification number is twelve digits")]
    InvalidIdNumber,
    /// A date field is not eight digits in `DDMMYYYY` order.
    #[error("field {field} is not an eight-digit DDMMYYYY date")]
    InvalidDate {
        /// The name of the date field.
        field: &'static str,
    },
}

/// A Vietnamese citizen identity card read from its QR code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct CccdCard {
    /// The twelve-digit personal identification number (`Số định danh cá nhân`).
    pub id_number: String,
    /// The nine-digit legacy CMND number when present (`Số CMND cũ`).
    pub previous_id_number: Option<String>,
    /// The three-digit province or country-registration code from `id_number`.
    pub province_code: String,
    /// The full name in NFC Unicode (`Họ và tên`).
    pub full_name: String,
    /// The family name (first word of `full_name`).
    pub family_name: String,
    /// The middle name or names, when present.
    pub middle_name: Option<String>,
    /// The given name (last word of `full_name`).
    pub given_name: String,
    /// The date of birth as `YYYY-MM-DD`.
    pub birth_date: String,
    /// The holder's sex (`Nam` -> `Male`, `Nữ` -> `Female`).
    pub sex: Sex,
    /// The full permanent residence address (`Nơi thường trú`).
    pub full_address: String,
    /// The street or hamlet part of `full_address`, when comma-separated.
    pub street: Option<String>,
    /// The ward or commune (`Phường` / `Xã`), when comma-separated.
    pub ward: Option<String>,
    /// The district (`Quận` / `Huyện`), when comma-separated.
    pub district: Option<String>,
    /// The province or centrally governed city (`Tỉnh` / `Thành phố`), when comma-separated.
    pub province: Option<String>,
    /// The issue date as `YYYY-MM-DD`.
    pub issue_date: String,
    /// The expiry date as `YYYY-MM-DD`, when present on 2024 Law on Identity cards.
    pub expiry_date: Option<String>,
    /// Whether the century, gender and birth-year digits in `id_number` agree with `birth_date`
    /// and `sex`.
    pub verified: bool,
}

impl CccdCard {
    /// Reads a pipe-separated Vietnamese CCCD QR payload and normalizes its text to Unicode NFC.
    pub fn parse(raw: &str) -> Result<Self, CccdError> {
        let nfc = ComposingNormalizerBorrowed::new_nfc().normalize(raw.trim());
        let parts: Vec<&str> = nfc.split('|').map(str::trim).collect();
        if parts.len() < 7 {
            return Err(CccdError::TooFewFields);
        }

        let id_number = parts.first().copied().unwrap_or_default();
        if id_number.len() != 12 || !id_number.bytes().all(|b| b.is_ascii_digit()) {
            return Err(CccdError::InvalidIdNumber);
        }

        let province_code = id_number
            .get(0..3)
            .ok_or(CccdError::InvalidIdNumber)?
            .to_string();
        let century_gender_digit = id_number
            .as_bytes()
            .get(3)
            .map(|b| b - b'0')
            .ok_or(CccdError::InvalidIdNumber)?;
        let id_year_two_digits = id_number
            .get(4..6)
            .and_then(|s| s.parse::<u16>().ok())
            .ok_or(CccdError::InvalidIdNumber)?;

        let previous_id_number = parts
            .get(1)
            .copied()
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let full_name = parts.get(2).copied().unwrap_or_default().to_string();
        let words: Vec<&str> = full_name.split_whitespace().collect();
        let (family_name, middle_name, given_name) = match words.as_slice() {
            [] => (String::new(), None, String::new()),
            [single] => ((*single).to_string(), None, (*single).to_string()),
            [first, last] => ((*first).to_string(), None, (*last).to_string()),
            [first, middle @ .., last] => (
                (*first).to_string(),
                Some(middle.join(" ")),
                (*last).to_string(),
            ),
        };

        let (birth_date, birth_year) =
            parse_ddmmyyyy(parts.get(3).copied().unwrap_or_default(), "birth_date")?;

        let sex_raw = parts.get(4).copied().unwrap_or_default();
        let sex = if sex_raw.eq_ignore_ascii_case("Nam") || sex_raw.eq_ignore_ascii_case("M") {
            Sex::Male
        } else if sex_raw == "Nữ"
            || sex_raw == "Nu"
            || sex_raw.eq_ignore_ascii_case("F")
        {
            Sex::Female
        } else {
            Sex::Unspecified('X')
        };

        let full_address = parts.get(5).copied().unwrap_or_default().to_string();
        let addr_parts: Vec<&str> = full_address
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        let (street, ward, district, province) = if addr_parts.len() >= 4 {
            let len = addr_parts.len();
            let street_joined = addr_parts
                .get(0..len - 3)
                .map(|slice| slice.join(", "));
            (
                street_joined,
                addr_parts.get(len - 3).map(|s| (*s).to_string()),
                addr_parts.get(len - 2).map(|s| (*s).to_string()),
                addr_parts.get(len - 1).map(|s| (*s).to_string()),
            )
        } else if addr_parts.len() == 3 {
            (
                addr_parts.first().map(|s| (*s).to_string()),
                addr_parts.get(1).map(|s| (*s).to_string()),
                None,
                addr_parts.get(2).map(|s| (*s).to_string()),
            )
        } else {
            (None, None, None, None)
        };

        let (issue_date, _) =
            parse_ddmmyyyy(parts.get(6).copied().unwrap_or_default(), "issue_date")?;

        let expiry_date = match parts.get(7).copied().filter(|s| !s.is_empty()) {
            Some(raw_exp) => Some(parse_ddmmyyyy(raw_exp, "expiry_date")?.0),
            None => None,
        };

        let expected_century_base = 1900_u16 + u16::from(century_gender_digit / 2) * 100;
        let expected_year = expected_century_base + id_year_two_digits;
        let expected_sex = if century_gender_digit % 2 == 0 {
            Sex::Male
        } else {
            Sex::Female
        };
        let verified = birth_year == expected_year && sex == expected_sex;

        Ok(Self {
            id_number: id_number.to_string(),
            previous_id_number,
            province_code,
            full_name,
            family_name,
            middle_name,
            given_name,
            birth_date,
            sex,
            full_address,
            street,
            ward,
            district,
            province,
            issue_date,
            expiry_date,
            verified,
        })
    }

    /// The canonical profile details read from this card.
    pub fn details(&self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        out.insert("id.national.number".to_string(), self.id_number.clone());
        out.insert("id.national_id.number".to_string(), self.id_number.clone());
        if let Some(prev) = &self.previous_id_number {
            out.insert("id.national.previous_number".to_string(), prev.clone());
            out.insert("id.national_id.previous_number".to_string(), prev.clone());
        }
        out.insert("name.full".to_string(), self.full_name.clone());
        out.insert("name.family".to_string(), self.family_name.clone());
        if let Some(mid) = &self.middle_name {
            out.insert("name.middle".to_string(), mid.clone());
        }
        out.insert("name.given".to_string(), self.given_name.clone());
        out.insert("birth.date".to_string(), self.birth_date.clone());
        out.insert("person.sex".to_string(), self.sex.as_mrz_char().to_string());
        out.insert("address.full".to_string(), self.full_address.clone());
        if let Some(street) = &self.street {
            out.insert("address.street".to_string(), street.clone());
        }
        if let Some(ward) = &self.ward {
            out.insert("address.ward".to_string(), ward.clone());
        }
        if let Some(district) = &self.district {
            out.insert("address.district".to_string(), district.clone());
        }
        if let Some(province) = &self.province {
            out.insert("address.prefecture".to_string(), province.clone());
            out.insert("address.province".to_string(), province.clone());
        }
        out.insert("address.country".to_string(), "VN".to_string());
        out.insert(
            "id.national.issued".to_string(),
            self.issue_date.clone(),
        );
        out.insert(
            "id.national_id.issue_date".to_string(),
            self.issue_date.clone(),
        );
        if let Some(exp) = &self.expiry_date {
            out.insert("id.national.expiry".to_string(), exp.clone());
            out.insert("id.national_id.expiry_date".to_string(), exp.clone());
        }
        out
    }
}

fn parse_ddmmyyyy(raw: &str, field: &'static str) -> Result<(String, u16), CccdError> {
    if raw.len() != 8 || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(CccdError::InvalidDate { field });
    }
    let day = raw.get(0..2).ok_or(CccdError::InvalidDate { field })?;
    let month = raw.get(2..4).ok_or(CccdError::InvalidDate { field })?;
    let year_str = raw.get(4..8).ok_or(CccdError::InvalidDate { field })?;
    let year = year_str
        .parse::<u16>()
        .map_err(|_| CccdError::InvalidDate { field })?;
    Ok((format!("{year_str}-{month}-{day}"), year))
}
