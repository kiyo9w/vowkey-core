//! Fills PDF (AcroForm, XFA hybrid and Dynamic XFA `datasets`), Word (`.docx` table cells, text boxes, and legacy `FORMTEXT` fields),
//! Excel (`.xlsx` unlocked/merged cells and list validations), and Korean `.hwpx` files.

use std::{
    collections::{BTreeMap, HashMap},
    io::{Read, Write},
};

use flate2::{
    Compression,
    read::DeflateDecoder,
    write::DeflateEncoder,
};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use vowkey_error::vowkey_error;

#[cfg(not(target_arch = "wasm32"))]
use crate::matcher::fill_form_fields;
use crate::{
    document::derive_companion_details,
    matcher::{
        FormFieldInput, applicant_holds_role_detail, classify_form_fields,
        resolve_and_format_value,
    },
    normalize::{lookup_country_option, sex as normalize_sex},
    office::is_sdt_placeholder_text,
};

/// Why a file could not be read or filled.
#[vowkey_error(flat)]
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum FileFillError {
    /// The archive could not be parsed as a valid ZIP container.
    #[error("invalid ZIP archive")]
    InvalidZipArchive,
    /// The file format is not supported or could not be processed.
    #[error("unsupported or unreadable file format")]
    UnsupportedFileFormat,
    /// The PDF has no form fields, and text cannot be placed on a flat page yet.
    #[error("this PDF has no form fields, and filling a flat PDF is not supported yet")]
    FlatPdf,
    /// PDF forms are filled with Python 3 and its `pypdf` and `cryptography` packages.
    #[error(
        "filling PDF forms needs Python 3 with the pypdf and cryptography packages \
         (pip install pypdf cryptography); VOWKEY_PYTHON names the interpreter"
    )]
    PdfToolsMissing,
}

/// One filled field or cell recorded in a [`FileFillReport`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FileFilledEntry {
    /// Target identifier (widget name, cell reference, XML path, or page box).
    pub target: String,
    /// Printed label that matched the profile.
    pub label: String,
    /// Canonical attribute key (`passport.number`, `name.full`, etc.).
    pub attribute: String,
    /// Owner role (`applicant`, `employer`, `spouse`, `dependent`, etc.).
    pub owner: String,
    /// Formatted value written into the file.
    pub value: String,
}

/// Summary of a file fill operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FileFillReport {
    /// Detected file format (`pdf-acroform`, `pdf-xfa-hybrid`, `pdf-xfa-dynamic`, `docx`,
    /// `xlsx`, `hwpx`).
    pub format: String,
    /// Number of fields, cells, or annotations filled.
    pub filled_count: usize,
    /// Individual filled entries.
    pub entries: Vec<FileFilledEntry>,
}

// ============================================================================
// Minimal pure-Rust ZIP reader & writer (Stored + Deflate, WASM-compatible)
// ============================================================================

#[derive(Debug, Clone)]
pub(crate) struct ZipEntry {
    pub(crate) name: String,
    pub(crate) data: Vec<u8>,
    compression: u16,
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Option<u16> {
    let slice = bytes.get(offset..offset + 2)?;
    Some(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Option<u32> {
    let slice = bytes.get(offset..offset + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

pub(crate) fn read_zip_entries(bytes: &[u8]) -> Result<Vec<ZipEntry>, FileFillError> {
    // Locate End of Central Directory (EOCD) signature 0x06054b50 from the end.
    if bytes.len() < 22 {
        return Err(FileFillError::InvalidZipArchive);
    }
    let min_pos = bytes.len().saturating_sub(65_557);
    let mut eocd_pos = None;
    for pos in (min_pos..=bytes.len() - 22).rev() {
        if read_u32_le(bytes, pos) == Some(0x0605_4b50) {
            eocd_pos = Some(pos);
            break;
        }
    }
    let eocd = eocd_pos.ok_or(FileFillError::InvalidZipArchive)?;
    let total_entries =
        read_u16_le(bytes, eocd + 10).ok_or(FileFillError::InvalidZipArchive)? as usize;
    let cd_offset = read_u32_le(bytes, eocd + 16).ok_or(FileFillError::InvalidZipArchive)? as usize;

    let mut entries = Vec::with_capacity(total_entries);
    let mut pos = cd_offset;
    for _ in 0..total_entries {
        if read_u32_le(bytes, pos) != Some(0x0201_4b50) {
            return Err(FileFillError::InvalidZipArchive);
        }
        let compression = read_u16_le(bytes, pos + 10).ok_or(FileFillError::InvalidZipArchive)?;
        let comp_size =
            read_u32_le(bytes, pos + 20).ok_or(FileFillError::InvalidZipArchive)? as usize;
        let name_len =
            read_u16_le(bytes, pos + 28).ok_or(FileFillError::InvalidZipArchive)? as usize;
        let extra_len =
            read_u16_le(bytes, pos + 30).ok_or(FileFillError::InvalidZipArchive)? as usize;
        let comment_len =
            read_u16_le(bytes, pos + 32).ok_or(FileFillError::InvalidZipArchive)? as usize;
        let lfh_offset =
            read_u32_le(bytes, pos + 42).ok_or(FileFillError::InvalidZipArchive)? as usize;

        let name_bytes = bytes
            .get(pos + 46..pos + 46 + name_len)
            .ok_or(FileFillError::InvalidZipArchive)?;
        let name = String::from_utf8_lossy(name_bytes).into_owned();

        // Read Local File Header at lfh_offset
        if read_u32_le(bytes, lfh_offset) != Some(0x0403_4b50) {
            return Err(FileFillError::InvalidZipArchive);
        }
        let lfh_name_len =
            read_u16_le(bytes, lfh_offset + 26).ok_or(FileFillError::InvalidZipArchive)? as usize;
        let lfh_extra_len =
            read_u16_le(bytes, lfh_offset + 28).ok_or(FileFillError::InvalidZipArchive)? as usize;
        let data_start = lfh_offset + 30 + lfh_name_len + lfh_extra_len;
        let comp_data = bytes
            .get(data_start..data_start + comp_size)
            .ok_or(FileFillError::InvalidZipArchive)?;

        let data = match compression {
            0 => comp_data.to_vec(),
            8 => {
                let mut decoder = DeflateDecoder::new(comp_data);
                let mut out = Vec::new();
                decoder
                    .read_to_end(&mut out)
                    .map_err(|_| FileFillError::InvalidZipArchive)?;
                out
            }
            _ => return Err(FileFillError::InvalidZipArchive),
        };

        entries.push(ZipEntry {
            name,
            data,
            compression,
        });
        pos += 46 + name_len + extra_len + comment_len;
    }
    Ok(entries)
}

fn write_zip_entries(entries: &[ZipEntry]) -> Result<Vec<u8>, FileFillError> {
    let mut out = Vec::new();
    let mut cd = Vec::new();

    for entry in entries {
        let lfh_offset = out.len() as u32;
        let crc = crc32fast::hash(&entry.data);
        let uncomp_size = entry.data.len() as u32;
        let (comp_method, comp_bytes) = if entry.compression == 0 {
            (0u16, entry.data.clone())
        } else {
            let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
            encoder
                .write_all(&entry.data)
                .map_err(|_| FileFillError::InvalidZipArchive)?;
            (
                8u16,
                encoder
                    .finish()
                    .map_err(|_| FileFillError::InvalidZipArchive)?,
            )
        };
        let comp_size = comp_bytes.len() as u32;
        let name_bytes = entry.name.as_bytes();
        let name_len = name_bytes.len() as u16;

        // Local File Header
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0u16.to_le_bytes()); // flags
        out.extend_from_slice(&comp_method.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // mod time
        out.extend_from_slice(&0u16.to_le_bytes()); // mod date
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&comp_size.to_le_bytes());
        out.extend_from_slice(&uncomp_size.to_le_bytes());
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes()); // extra len
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&comp_bytes);

        // Central Directory Header
        cd.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        cd.extend_from_slice(&20u16.to_le_bytes()); // version made by
        cd.extend_from_slice(&20u16.to_le_bytes()); // version needed
        cd.extend_from_slice(&0u16.to_le_bytes()); // flags
        cd.extend_from_slice(&comp_method.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes()); // mod time
        cd.extend_from_slice(&0u16.to_le_bytes()); // mod date
        cd.extend_from_slice(&crc.to_le_bytes());
        cd.extend_from_slice(&comp_size.to_le_bytes());
        cd.extend_from_slice(&uncomp_size.to_le_bytes());
        cd.extend_from_slice(&name_len.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes()); // extra len
        cd.extend_from_slice(&0u16.to_le_bytes()); // comment len
        cd.extend_from_slice(&0u16.to_le_bytes()); // disk number
        cd.extend_from_slice(&0u16.to_le_bytes()); // internal attrs
        cd.extend_from_slice(&0u32.to_le_bytes()); // external attrs
        cd.extend_from_slice(&lfh_offset.to_le_bytes());
        cd.extend_from_slice(name_bytes);
    }

    let cd_offset = out.len() as u32;
    let cd_size = cd.len() as u32;
    let count = entries.len() as u16;
    out.extend_from_slice(&cd);

    // End of Central Directory
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // disk
    out.extend_from_slice(&0u16.to_le_bytes()); // cd start disk
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment len

    Ok(out)
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(crate) fn xml_unescape(input: &str) -> String {
    input
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

// ============================================================================
// Word (.docx) XML Filling: Table cells, Text boxes (<w:txbxContent>), FORMTEXT
// ============================================================================

static W_TR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:tr\b[^>]*>.*?</w:tr>").expect("valid regex"));
static W_TC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:tc\b[^>]*>.*?</w:tc>").expect("valid regex"));
static W_T_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:t(?:\s[^>]*)?>(.*?)</w:t>").expect("valid regex"));
static W_P_CLOSE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"</w:p>").expect("valid regex"));
static W_FORMTEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)(<w:fldChar\s+[^>]*w:fldCharType="begin".*?FORMTEXT.*?<w:fldChar\s+[^>]*w:fldCharType="separate"[^>]*/>.*?</w:r>)(.*?)(<w:r\b[^>]*>\s*(?:<w:rPr>.*?</w:rPr>\s*)?<w:fldChar\s+[^>]*w:fldCharType="end")"#,
    )
    .expect("valid regex")
});
static W_HELPTEXT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<w:(?:statusText|helpText)\b[^>]*w:val="([^"]+)""#).expect("valid regex")
});
static W_FFNAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<w:name\b[^>]*w:val="([^"]+)""#).expect("valid regex"));
static W_MAXLEN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<w:maxLength\b[^>]*w:val="(\d+)""#).expect("valid regex"));
static W_TXBX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:txbxContent\b[^>]*>.*?</w:txbxContent>").expect("valid regex"));

fn extract_w_text(xml_fragment: &str) -> String {
    let mut out = String::new();
    for cap in W_T_RE.captures_iter(xml_fragment) {
        if let Some(m) = cap.get(1) {
            out.push_str(&xml_unescape(m.as_str()));
        }
    }
    out.trim().to_string()
}

fn word_run_xml(value: &str) -> String {
    let escaped = xml_escape(value);
    if value.chars().any(|c| u32::from(c) >= 0x3000) {
        format!(
            "<w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:eastAsia=\"Hiragino Sans\"/></w:rPr><w:t xml:space=\"preserve\">{escaped}</w:t></w:r>"
        )
    } else {
        format!("<w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r>")
    }
}

fn inject_w_tc_text(tc_xml: &str, value: &str) -> String {
    let run = word_run_xml(value);
    if let Some(m) = W_P_CLOSE_RE.find(tc_xml) {
        let mut updated = String::with_capacity(tc_xml.len() + run.len());
        updated.push_str(&tc_xml[..m.start()]);
        updated.push_str(&run);
        updated.push_str(&tc_xml[m.start()..]);
        updated
    } else if let Some(pos) = tc_xml.rfind("</w:tc>") {
        let mut updated = String::with_capacity(tc_xml.len() + run.len() + 14);
        updated.push_str(&tc_xml[..pos]);
        updated.push_str("<w:p>");
        updated.push_str(&run);
        updated.push_str("</w:p>");
        updated.push_str(&tc_xml[pos..]);
        updated
    } else {
        tc_xml.to_string()
    }
}

/// True when `haystack` contains any of `needles`.
fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

/// Reads as a printed field label rather than an instruction, a banner, a note or an option button.
fn label_reads_as_field(label: &str) -> bool {
    let clean = label.trim();
    if clean.is_empty() || clean.chars().count() > 90 {
        return false;
    }
    const LEADING: [&str; 16] = [
        "※", "（注）", "(注)", "注：", "注:", "Note", "NOTE", "○", "□", "◎", "✻", "✱", "＊", "⇒", "→",
        "（※）",
    ];
    if LEADING.iter().any(|marker| clean.starts_with(marker)) {
        return false;
    }
    if clean.ends_with('。') || clean.ends_with('．') || clean.ends_with('！') || clean.ends_with('？')
    {
        return false;
    }
    true
}

fn label_names_organization(label: &str) -> bool {
    contains_any(label, &["施設名", "会社名", "法人名", "学校名", "事業所名"])
        || ["facility name", "company name", "employer name", "organization name", "school name"]
            .iter()
            .any(|needle| label.as_bytes().windows(needle.len())
                .any(|part| part.eq_ignore_ascii_case(needle.as_bytes())))
}

fn label_asks_for_name(label: &str) -> bool {
    if label_names_organization(label) {
        return false;
    }
    let clean = label.trim();
    if clean.is_empty() || !label_reads_as_field(clean) {
        return false;
    }
    let field = FormFieldInput {
        label: clean.to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    };
    let matched = crate::matcher::classify_field(&field);
    matched.score > 0 && matched.attribute.starts_with("name.")
}

/// The role a section heading or a label names, when it names one. A heading naming the person who
/// signs (`借主`, `申請人`) returns `applicant`; headings naming anyone else return their role.
fn role_named_by(text: &str) -> Option<&'static str> {
    let t = text;
    if contains_any(&t, &["借主", "lessee", "borrower", "申請人", "申請者", "applicant"]) {
        return Some("applicant");
    }
    if contains_any(&t, &["連帯保証人", "保証人", "guarantor"]) {
        return Some("guarantor");
    }
    if contains_any(&t, &["緊急", "emergency"]) {
        return Some("emergency");
    }
    if contains_any(&t, &["同居人", "同居者", "cohabitant", "roommate"]) {
        return Some("cohabitant");
    }
    if contains_any(
        &t,
        &[
            "貸主",
            "大家",
            "管理業者",
            "建物の所有者",
            "媒介",
            "宅地建物取引士",
            "landlord",
            "lessor",
            "管理会社",
        ],
    ) {
        return Some("landlord");
    }
    if contains_any(
        &t,
        &[
            "在日親族",
            "同居家族",
            "扶養",
            "きょうだい",
            "兄弟姉妹",
            "祖父母",
            "申請児",
            "児童",
            "子ども",
            "家族",
        ],
    ) {
        return Some("family");
    }
    if contains_any(&t, &["勤務先", "所属機関", "employer", "organization", "organisation"]) {
        return Some("employer");
    }
    None
}

/// True when a heading says the rows that follow are the applicant's own details again.
fn section_returns_to_applicant(text: &str) -> bool {
    contains_any(text, &["申請人", "申請者", "本人", "applicant", "届出人", "被保険者"])
}

/// Resolve strong printed cues, or rescue a label the matcher could not resolve.
fn cue_value(
    label: &str,
    attr: &str,
    profile: &BTreeMap<String, String>,
    rescue: bool,
) -> Option<(String, String)> {
    let matches = |needles: &[&str]| needles.iter().any(|needle| {
        label.as_bytes().windows(needle.len())
            .any(|part| part.eq_ignore_ascii_case(needle.as_bytes()))
    });
    let (keys, strong): (&[&str], bool) = if matches(&["本国", "home country", "home-country"]) {
        (&["address.home_country.full", "address.home_country.city"], true)
    } else if matches(&["住居地", "address in japan", "residence in japan"]) {
        (&["address.japan.full", "address.full"], true)
    } else if attr != "person.nationality" && matches(&["国籍", "nationality", "citizenship", "quốc tịch"]) {
        (&["person.nationality"], true)
    } else if matches(&["更新の理由", "reason for extension", "extension reason"]) {
        (&["visa.extension_reason", "visa.reason"], false)
    } else if matches(&["卒業", "graduat"]) {
        (&["education.graduation.date"], false)
    } else if matches(&["給与", "報酬", "salary", "remuneration"]) {
        (&["income.annual"], false)
    } else if matches(&["商号", "会社名", "法人名", "company name", "employer name"]) {
        (&["work.employer.name"], false)
    } else if matches(&["法人番号", "corporate number", "corporation no"]) {
        (&["id.employer.ein"], false)
    } else if matches(&["雇用保険", "employment insurance"]) {
        (&["id.employment_insurance.number"], false)
    } else if matches(&["学校名", "大学名", "school name", "university name"]) {
        (&["education.school.name"], false)
    } else if attr.starts_with("address.") && matches(&["住所", "所在地", "address"]) {
        (&["address.full"], false)
    } else {
        return None;
    };
    if !strong && !rescue {
        return None;
    }
    keys.iter().find_map(|key| profile.get(*key).filter(|value| !value.trim().is_empty())
        .map(|value| ((*key).to_string(), value.clone())))
}

/// Use the form's explicit Japanese/Chinese sex and spouse-presence choices.
fn form_print_value(label: &str, attr: &str, value: String) -> String {
    if attr.ends_with(".sex") && contains_any(label, &["性別", "性别", "男", "女"]) {
        match normalize_sex(&value).as_deref() {
            Some("male") => return "男".to_string(),
            Some("female") => return "女".to_string(),
            _ => {}
        }
    }
    if attr.contains("marital") && label.contains('有') && label.contains('無') {
        if ["married", "有", "既婚"].iter().any(|known| value.eq_ignore_ascii_case(known)) {
            return "有".to_string();
        }
        if ["single", "unmarried", "無", "未婚", "divorced", "widowed"]
            .iter().any(|known| value.eq_ignore_ascii_case(known)) {
            return "無".to_string();
        }
    }
    value
}


fn match_and_resolve_label(
    label: &str,
    section_hint: Option<&str>,
    profile: &BTreeMap<String, String>,
) -> Option<(String, String, String)> {
    let clean = label.trim();
    if clean.is_empty() || clean.chars().count() > 180 || !label_reads_as_field(clean) {
        return None;
    }
    let field = FormFieldInput {
        label: clean.to_string(),
        input_type: "text".to_string(),
        section: section_hint.unwrap_or("").to_string(),
        ..FormFieldInput::default()
    };
    let matches = classify_form_fields(std::slice::from_ref(&field), true);
    let mut m = matches.into_iter().next()?;
    if m.attribute.is_empty() || m.score <= 0 || m.owner == "official_only" {
        return None;
    }
    // A facility or company name must not take the applicant's personal name.
    if m.attribute.starts_with("name.") && label_names_organization(clean) {
        return None;
    }
    // A section that names someone else — a guarantor, a cohabitant, the landlord, family in
    // Japan — is not answered from the applicant's own details. The label's own words are not a
    // section: `Family name` is a field, `在日親族` in a heading is a different person.
    if let Some(role) = section_hint.and_then(role_named_by) {
        if role != "applicant" && m.owner == "applicant" {
            m.owner = role.to_string();
        }
    }
    if !applicant_holds_role_detail(&m.owner, &m.attribute)
        && !profile.contains_key(&format!("{}.{}", m.owner, m.attribute))
    {
        return None;
    }
    // A label whose own words name the detail beats a near match; `〒住所` takes the whole address.
    let resolved = resolve_and_format_value(&field, &m, profile);
    let rescue = resolved.is_none() || m.score <= 4;
    if let Some((attr, raw_value)) = cue_value(clean, &m.attribute, profile, rescue) {
        let mut cue_match = m.clone();
        cue_match.attribute = attr.clone();
        let value = resolve_and_format_value(&field, &cue_match, profile).unwrap_or(raw_value);
        let value = if clean.contains('〒')
            && attr.starts_with("address.")
            && !value.contains('〒')
            && !attr.ends_with(".postal")
        {
            match profile.get("address.postal").filter(|v| !v.trim().is_empty()) {
                Some(postal) => format!("〒{postal} {value}"),
                None => value,
            }
        } else {
            value
        };
        return Some((attr, m.owner, value));
    }
    let formatted = form_print_value(clean, &m.attribute, resolved?);
    if formatted.trim().is_empty() {
        return None;
    }
    Some((m.attribute, m.owner, formatted))
}

static W_SDT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:sdt\b[^>]*>.*?</w:sdt>").expect("valid regex"));
static W_SDT_PR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<w:sdtPr\b[^>]*>(.*?)</w:sdtPr>").expect("valid regex"));
static W_SDT_CONTENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)(<w:sdtContent\b[^>]*>)(.*?)(</w:sdtContent>)").expect("valid regex")
});
static W_SDT_ALIAS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<w:alias\b[^>]*w:val="([^"]+)""#).expect("valid regex"));
static W_SDT_TAG_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<w:tag\b[^>]*w:val="([^"]+)""#).expect("valid regex"));
static W_SDT_LISTITEM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<w:listItem\b[^>]*?(?:w:value="([^"]*)"|w:displayText="([^"]*)")[^>]*?>"#)
        .expect("valid regex")
});
static W_SDT_SHOW_PLC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<w:showingPlcHdr(?:\s[^>]*?)?(?:/>|>.*?</w:showingPlcHdr>)"#)
        .expect("valid regex")
});
static W_P_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)(<w:p\b[^>]*>)(.*?)(</w:p>)").expect("valid regex"));
static W_PPR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)^\s*(<w:pPr\b[^>]*>.*?</w:pPr>)").expect("valid regex"));

fn replace_sdt_content_text(content_inner: &str, value: &str) -> String {
    let run = word_run_xml(value);
    if let Some(p_cap) = W_P_BLOCK_RE.captures(content_inner) {
        let whole = p_cap.get(0).map_or("", |m| m.as_str());
        let p_open = p_cap.get(1).map_or("<w:p>", |m| m.as_str());
        let p_body = p_cap.get(2).map_or("", |m| m.as_str());
        let p_close = p_cap.get(3).map_or("</w:p>", |m| m.as_str());
        let p_pr = W_PPR_RE
            .captures(p_body)
            .and_then(|c| c.get(1))
            .map_or("", |m| m.as_str());
        let new_p = format!("{p_open}{p_pr}{run}{p_close}");
        content_inner.replacen(whole, &new_p, 1)
    } else {
        run
    }
}

fn preceding_context_label(xml_before: &str) -> Option<String> {
    // Check if inside a <w:tr> right after a preceding <w:tc> label cell.
    if let Some(tr_pos) = xml_before.rfind("<w:tr") {
        let row_prefix = &xml_before[tr_pos..];
        if !row_prefix.contains("</w:tr>") {
            let prev_cells: Vec<String> = W_TC_RE
                .find_iter(row_prefix)
                .map(|m| extract_w_text(m.as_str()))
                .filter(|t| !t.is_empty() && !is_sdt_placeholder_text(t))
                .collect();
            if let Some(last_cell) = prev_cells.last() {
                return Some(last_cell.clone());
            }
        }
    }
    // Check if inside a <w:p> right after inline label text (`Full Name: <w:sdt>...`).
    if let Some(p_pos) = xml_before.rfind("<w:p") {
        let p_prefix = &xml_before[p_pos..];
        if !p_prefix.contains("</w:p>") {
            let txt = extract_w_text(p_prefix);
            let cleaned = txt
                .trim_end_matches(|c: char| c == ':' || c == '：' || c == '_' || c.is_whitespace());
            if !cleaned.is_empty() && cleaned.chars().count() <= 80 {
                return Some(cleaned.to_string());
            }
        }
    }
    None
}

fn fill_word_sdt_controls(
    xml: &str,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> String {
    let mut out = String::with_capacity(xml.len() + 512);
    let mut last = 0usize;
    let mut sdt_idx = 0usize;

    for m in W_SDT_RE.find_iter(xml) {
        out.push_str(&xml[last..m.start()]);
        let block = m.as_str();
        last = m.end();

        // Skip outer wrapper SDTs that contain nested <w:sdt> blocks.
        if block[6..].contains("<w:sdt>") || block[6..].contains("<w:sdt ") {
            out.push_str(block);
            continue;
        }

        let Some(pr_cap) = W_SDT_PR_RE.captures(block) else {
            out.push_str(block);
            continue;
        };
        let pr_body = pr_cap.get(1).map_or("", |g| g.as_str());
        if pr_body.contains("<w:docPartObj") || pr_body.contains("<w:bibliography") {
            out.push_str(block);
            continue;
        }
        let Some(cnt_cap) = W_SDT_CONTENT_RE.captures(block) else {
            out.push_str(block);
            continue;
        };
        let cnt_whole = cnt_cap.get(0).map_or("", |g| g.as_str());
        let cnt_open = cnt_cap.get(1).map_or("<w:sdtContent>", |g| g.as_str());
        let cnt_inner = cnt_cap.get(2).map_or("", |g| g.as_str());
        let cnt_close = cnt_cap.get(3).map_or("</w:sdtContent>", |g| g.as_str());

        let existing_text = extract_w_text(cnt_inner);
        let showing_plc = pr_body.contains("<w:showingPlcHdr")
            && !pr_body.contains("w:val=\"0\"")
            && !pr_body.contains("w:val=\"false\"");
        if !showing_plc && !existing_text.is_empty() && !is_sdt_placeholder_text(&existing_text) {
            out.push_str(block);
            continue;
        }

        let alias = W_SDT_ALIAS_RE
            .captures(pr_body)
            .and_then(|c| c.get(1))
            .map(|g| xml_unescape(g.as_str()))
            .unwrap_or_default();
        let tag = W_SDT_TAG_RE
            .captures(pr_body)
            .and_then(|c| c.get(1))
            .map(|g| xml_unescape(g.as_str()))
            .unwrap_or_default();
        let mut options = Vec::new();
        for li in W_SDT_LISTITEM_RE.captures_iter(pr_body) {
            if let Some(v) = li.get(1).or_else(|| li.get(2)) {
                let opt = xml_unescape(v.as_str());
                if !opt.trim().is_empty() && !is_sdt_placeholder_text(&opt) {
                    options.push(opt);
                }
            }
        }

        let context_lbl = if alias.trim().is_empty() && tag.trim().is_empty() {
            preceding_context_label(&xml[..m.start()]).unwrap_or_default()
        } else {
            String::new()
        };
        let effective_label = if !alias.trim().is_empty() {
            alias.clone()
        } else if !context_lbl.is_empty() {
            context_lbl
        } else {
            tag.clone()
        };

        if effective_label.trim().is_empty() && tag.trim().is_empty() {
            out.push_str(block);
            continue;
        }

        let field = FormFieldInput {
            id: tag.clone(),
            name: tag,
            label: effective_label.clone(),
            input_type: if !options.is_empty() {
                "select-one".to_string()
            } else {
                "text".to_string()
            },
            options,
            ..FormFieldInput::default()
        };
        let matched = classify_form_fields(std::slice::from_ref(&field), true)
            .into_iter()
            .next()
            .unwrap_or_else(|| crate::matcher::FieldMatch {
                attribute: String::new(),
                chrome_type: String::new(),
                owner: "applicant".to_string(),
                score: 0,
                section_id: 0,
                value: None,
            });
        if matched.attribute.is_empty()
            || matched.score <= 0
            || matched.owner == "official_only"
            || (!applicant_holds_role_detail(&matched.owner, &matched.attribute)
                && !profile.contains_key(&format!("{}.{}", matched.owner, matched.attribute)))
        {
            out.push_str(block);
            continue;
        }
        let Some(val) = resolve_and_format_value(&field, &matched, profile) else {
            out.push_str(block);
            continue;
        };
        if val.trim().is_empty() {
            out.push_str(block);
            continue;
        }

        let new_cnt = format!(
            "{cnt_open}{}{cnt_close}",
            replace_sdt_content_text(cnt_inner, &val)
        );
        let updated_block = W_SDT_SHOW_PLC_RE
            .replace_all(&block.replacen(cnt_whole, &new_cnt, 1), "")
            .into_owned();
        sdt_idx += 1;
        filled.push(FileFilledEntry {
            target: format!("sdt:{sdt_idx}"),
            label: effective_label,
            attribute: matched.attribute,
            owner: matched.owner,
            value: val,
        });
        out.push_str(&updated_block);
    }

    out.push_str(&xml[last..]);
    out
}

/// Fills a `.docx` file in memory and returns the updated `.docx` bytes and report.
pub fn fill_docx_bytes(
    docx_bytes: &[u8],
    profile: &BTreeMap<String, String>,
) -> Result<(Vec<u8>, FileFillReport), FileFillError> {
    let mut entries = read_zip_entries(docx_bytes)?;
    let mut filled = Vec::new();
    let mut enriched = profile.clone();
    derive_companion_details(&mut enriched);

    for entry in &mut entries {
        if entry.name != "word/document.xml" {
            continue;
        }
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        let updated_xml = fill_word_document_xml(&xml, &enriched, &mut filled);
        entry.data = updated_xml.into_bytes();
    }

    let out_bytes = write_zip_entries(&entries)?;
    Ok((
        out_bytes,
        FileFillReport {
            format: "docx".to_string(),
            filled_count: filled.len(),
            entries: filled,
        },
    ))
}

fn fill_word_document_xml(
    xml: &str,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> String {
    // 0. Fill <w:sdt> structured document tag content controls first so populated controls are
    //    respected by subsequent table-cell passes.
    let xml_after_sdt = fill_word_sdt_controls(xml, profile, filled);
    let xml = xml_after_sdt.as_str();

    // 1. Collect all table rows so we can fill both horizontal (Label | Empty) and
    //    vertical (Label row above Empty row) table layouts, plus multi-box character cells.
    let row_matches: Vec<(usize, usize, String)> = W_TR_RE
        .find_iter(xml)
        .map(|m| (m.start(), m.end(), m.as_str().to_string()))
        .collect();

    let mut comb_date_order: HashMap<(usize, usize), &'static str> = HashMap::new();
    let mut row_cells: Vec<Vec<(usize, usize, String, String)>> = row_matches
        .iter()
        .enumerate()
        .map(|(r_idx, (_, _, row_xml))| {
            let mut cells: Vec<(usize, usize, String, String)> = W_TC_RE
                .find_iter(row_xml)
                .map(|cm| {
                    let tc_str = cm.as_str().to_string();
                    let raw_text = extract_w_text(&tc_str);
                    let trimmed = raw_text.trim();
                    let is_blank_placeholder = is_sdt_placeholder_text(&raw_text)
                        || (trimmed.chars().count() >= 3
                            && trimmed
                                .chars()
                                .all(|c| matches!(c, '_' | '.' | '…' | ' ' | '\u{00A0}')));
                    let text = if is_blank_placeholder {
                        String::new()
                    } else {
                        raw_text
                    };
                    (cm.start(), cm.end(), tc_str, text)
                })
                .collect();

            // Detect 6- or 8-cell date comb hints such as D|D|M|M|Y|Y|Y|Y or Y|Y|Y|Y|M|M|D|D
            let mut c = 0usize;
            while c + 6 <= cells.len() {
                let mut run_len = 0usize;
                let mut pattern = String::new();
                while c + run_len < cells.len() {
                    let tok = cells[c + run_len].3.trim();
                    if matches!(tok, "D" | "M" | "Y" | "d" | "m" | "y") {
                        pattern.push(tok.chars().next().unwrap().to_ascii_uppercase());
                        run_len += 1;
                    } else {
                        break;
                    }
                }
                if matches!(
                    pattern.as_str(),
                    "DDMMYYYY" | "DDMMYY" | "YYYYMMDD" | "YYMMDD" | "MMDDYYYY"
                ) {
                    let order = if pattern.starts_with("DD") {
                        "DMY"
                    } else if pattern.starts_with("MM") {
                        "MDY"
                    } else {
                        "YMD"
                    };
                    comb_date_order.insert((r_idx, c), order);
                    for k in 0..run_len {
                        cells[c + k].3.clear();
                    }
                    c += run_len;
                } else {
                    c += 1;
                }
            }
            cells
        })
        .collect();

    // Which heading and which role each row prints under: a contract repeats `（氏名）` under the
    // lessee, the cohabitants, the guarantor and the agent, and only one of them is this person.
    let headings: Vec<(usize, String)> = W_TOP_BLOCK_RE
        .find_iter(xml)
        .filter(|m| !m.as_str().starts_with("<w:tbl"))
        .map(|m| (m.start(), extract_w_text(m.as_str())))
        .filter(|(_, text)| !text.is_empty() && text.chars().count() <= 96)
        .collect();
    let table_starts: Vec<usize> = xml
        .match_indices("<w:tbl")
        .map(|(pos, _)| pos)
        .collect();
    let mut active_role: Option<&'static str> = None;
    let mut role_table: Option<usize> = None;
    let mut row_context: Vec<String> = Vec::with_capacity(row_cells.len());
    let mut row_own_role: Vec<bool> = Vec::with_capacity(row_cells.len());
    for (r_idx, cells) in row_cells.iter().enumerate() {
        let table_idx = table_starts
            .partition_point(|start| *start <= row_matches[r_idx].0)
            .saturating_sub(1);
        for (_, _, _, text) in cells {
            let t = text.trim();
            if t.chars().count() <= 24 {
                if let Some(role) = role_named_by(t) {
                    active_role = Some(role);
                    role_table = Some(table_idx);
                    break;
                }
            }
        }
        let heading = headings
            .iter()
            .rev()
            .find(|(start, _)| *start < row_matches[r_idx].0)
            .map(|(_, text)| text.as_str())
            .unwrap_or("");
        row_context.push(match active_role {
            Some(role) => format!("{heading} {role}"),
            None => heading.to_string(),
        });
        row_own_role.push(
            role_table == Some(table_idx)
                && active_role == Some("applicant")
                && cells.iter().any(|(_, _, _, text)| {
                    let t = text.trim();
                    t.chars().count() <= 24 && role_named_by(t) == Some("applicant")
                }),
        );
    }
    // A person's name printed over and over inside one table is a list of further people.
    let mut repeated_name_rows: std::collections::HashSet<usize> = std::collections::HashSet::new();
    {
        let mut seen: HashMap<(usize, String), Vec<usize>> = HashMap::new();
        for (r_idx, cells) in row_cells.iter().enumerate() {
            let table_idx = table_starts
                .partition_point(|start| *start <= row_matches[r_idx].0)
                .saturating_sub(1);
            for (_, _, _, text) in cells {
                if !text.is_empty() && label_asks_for_name(text) {
                    seen.entry((table_idx, text.clone())).or_default().push(r_idx);
                }
            }
        }
        for rows in seen.values().filter(|rows| rows.len() >= 2) {
            for r_idx in rows {
                if !row_own_role[*r_idx] {
                    repeated_name_rows.insert(*r_idx);
                }
            }
        }
    }

    let mut cell_replacements: HashMap<(usize, usize), String> = HashMap::new();

    for r_idx in 0..row_cells.len() {
        let n_cols = row_cells[r_idx].len();
        let mut c_idx = 0;
        while c_idx < n_cols {
            let label_text = row_cells[r_idx][c_idx].3.clone();
            if !label_text.is_empty() {
                // Check if following cells on the same row are empty
                let mut empty_run = 0;
                while c_idx + 1 + empty_run < n_cols
                    && row_cells[r_idx][c_idx + 1 + empty_run].3.is_empty()
                    && !cell_replacements.contains_key(&(r_idx, c_idx + 1 + empty_run))
                {
                    empty_run += 1;
                }

                let section = row_context[r_idx].as_str();
                // A person's name repeated inside one table is a list of further people, not the
                // one whose details this profile holds.
                let repeated_name_row = repeated_name_rows.contains(&r_idx);
                if empty_run >= 1 {
                    if let Some((attr, owner, val)) =
                        match_and_resolve_label(&label_text, Some(section), profile)
                    {
                        if !repeated_name_row || !label_asks_for_name(&label_text) {
                            if empty_run >= 4 {
                                // Character-box run (e.g. Date comb, National ID, Account Number, Postal Code)
                                let comb_str = if let Some(order) = comb_date_order.get(&(r_idx, c_idx + 1)) {
                                    let raw_iso = profile
                                        .get(&attr)
                                        .map(String::as_str)
                                        .unwrap_or(val.as_str());
                                    let parts: Vec<&str> = raw_iso.trim().split(['-', '/', '.']).collect();
                                    if let [p0, p1, p2] = parts.as_slice()
                                        && p0.len() == 4
                                        && p1.len() <= 2
                                        && p2.len() <= 2
                                    {
                                        let y = if empty_run == 6 { &p0[2..] } else { *p0 };
                                        let m_pad = format!("{:0>2}", p1);
                                        let d_pad = format!("{:0>2}", p2);
                                        match *order {
                                            "DMY" => format!("{d_pad}{m_pad}{y}"),
                                            "MDY" => format!("{m_pad}{d_pad}{y}"),
                                            _ => format!("{y}{m_pad}{d_pad}"),
                                        }
                                    } else {
                                        val.chars()
                                            .filter(|c| !c.is_whitespace() && !matches!(*c, '-' | '/' | '.'))
                                            .collect()
                                    }
                                } else {
                                    let stripped: String = val
                                        .chars()
                                        .filter(|c| !c.is_whitespace() && !matches!(*c, '-' | '/'))
                                        .collect();
                                    if stripped.chars().count() <= empty_run {
                                        stripped
                                    } else {
                                        val.chars().filter(|c| !c.is_whitespace()).collect()
                                    }
                                };
                                let chars: Vec<char> = comb_str.chars().collect();
                                for (i, ch) in chars.iter().take(empty_run).enumerate() {
                                    let target_c = c_idx + 1 + i;
                                    let orig_tc = &row_cells[r_idx][target_c].2;
                                    cell_replacements
                                        .insert((r_idx, target_c), inject_w_tc_text(orig_tc, &ch.to_string()));
                                }
                            } else {
                                let target_c = c_idx + 1;
                                let orig_tc = &row_cells[r_idx][target_c].2;
                                cell_replacements
                                    .insert((r_idx, target_c), inject_w_tc_text(orig_tc, &val));
                            }
                            filled.push(FileFilledEntry {
                                target: format!("table:r{}c{}", r_idx, c_idx + 1),
                                label: label_text.clone(),
                                attribute: attr,
                                owner,
                                value: val,
                            });
                            c_idx += 1 + empty_run;
                            continue;
                        }
                    }
                }

                // Vertical header-above-empty-row check: if row r_idx+1 has the same number of
                // cells (or at least c_idx+1 cells) and cell (r_idx+1, c_idx) is empty.
                if r_idx + 1 < row_cells.len()
                    && c_idx < row_cells[r_idx + 1].len()
                    && row_cells[r_idx + 1][c_idx].3.is_empty()
                    && !cell_replacements.contains_key(&(r_idx + 1, c_idx))
                {
                    let section_hint = Some(row_context[r_idx].as_str());
                    let repeated_name_row = repeated_name_rows.contains(&r_idx);
                    if let Some((attr, owner, val)) =
                        match_and_resolve_label(&label_text, section_hint, profile)
                    {
                        if !repeated_name_row || !label_asks_for_name(&label_text) {
                            let orig_tc = &row_cells[r_idx + 1][c_idx].2;
                            cell_replacements
                                .insert((r_idx + 1, c_idx), inject_w_tc_text(orig_tc, &val));
                            filled.push(FileFilledEntry {
                                target: format!("table:r{}c{}", r_idx + 1, c_idx),
                                label: label_text,
                                attribute: attr,
                                owner,
                                value: val,
                            });
                        }
                    }
                }
            }
            c_idx += 1;
        }
    }

    // Rebuild XML with updated table rows
    let mut rebuilt = String::with_capacity(xml.len() + 1024);
    let mut last_pos = 0;
    for (r_idx, (r_start, r_end, r_xml)) in row_matches.iter().enumerate() {
        rebuilt.push_str(&xml[last_pos..*r_start]);
        let mut row_out = String::with_capacity(r_xml.len());
        let mut cell_last = 0;
        for (c_idx, (c_start, c_end, c_xml, _)) in row_cells[r_idx].iter_mut().enumerate() {
            row_out.push_str(&r_xml[cell_last..*c_start]);
            if let Some(rep) = cell_replacements.get(&(r_idx, c_idx)) {
                row_out.push_str(rep);
            } else {
                row_out.push_str(c_xml);
            }
            cell_last = *c_end;
        }
        row_out.push_str(&r_xml[cell_last..]);
        rebuilt.push_str(&row_out);
        last_pos = *r_end;
    }
    rebuilt.push_str(&xml[last_pos..]);

    // 2. Legacy FORMTEXT fields (e.g. sg-iras-ir8a-2026.docx)
    let mut formtext_idx = 0usize;
    let rebuilt_formtext = W_FORMTEXT_RE
        .replace_all(&rebuilt, |caps: &regex::Captures<'_>| {
            let prefix = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let existing = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let suffix = caps.get(3).map(|m| m.as_str()).unwrap_or("");
            let label = W_HELPTEXT_RE
                .captures(prefix)
                .and_then(|c| c.get(1))
                .or_else(|| W_FFNAME_RE.captures(prefix).and_then(|c| c.get(1)))
                .map(|m| xml_unescape(m.as_str()))
                .unwrap_or_default();
            let max_len = W_MAXLEN_RE
                .captures(prefix)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse::<usize>().ok());

            if let Some((attr, owner, mut val)) = match_and_resolve_label(&label, None, profile) {
                if let Some(limit) = max_len {
                    val = val.chars().take(limit).collect();
                }
                formtext_idx += 1;
                filled.push(FileFilledEntry {
                    target: format!("formtext:{formtext_idx}"),
                    label,
                    attribute: attr,
                    owner,
                    value: val.clone(),
                });
                let run = word_run_xml(&val);
                format!("{prefix}{run}{suffix}")
            } else {
                format!("{prefix}{existing}{suffix}")
            }
        })
        .into_owned();

    // 3. Text boxes (<w:txbxContent>) with a label and empty space/paragraph
    let mut txbx_idx = 0usize;
    let rebuilt_txbx = W_TXBX_RE
        .replace_all(&rebuilt_formtext, |caps: &regex::Captures<'_>| {
            let block = caps.get(0).map(|m| m.as_str()).unwrap_or("");
            let text = extract_w_text(block);
            let cleaned = text.trim_end_matches(|c: char| c == '_' || c == ':' || c == '：' || c.is_whitespace());
            if !cleaned.is_empty() && cleaned.len() <= 80 {
                if let Some((attr, owner, val)) = match_and_resolve_label(cleaned, None, profile) {
                    if !text.contains(&val) {
                        txbx_idx += 1;
                        filled.push(FileFilledEntry {
                            target: format!("textbox:{txbx_idx}"),
                            label: cleaned.to_string(),
                            attribute: attr,
                            owner,
                            value: val.clone(),
                        });
                        let run = word_run_xml(&format!(" {val}"));
                        if let Some(pos) = block.rfind("</w:p>") {
                            let mut out = String::with_capacity(block.len() + run.len() + 8);
                            out.push_str(&block[..pos]);
                            out.push_str(&run);
                            out.push_str(&block[pos..]);
                            return out;
                        }
                    }
                }
            }
            block.to_string()
        })
        .into_owned();

    // 4. Standalone paragraphs outside tables containing `Label: _____` or `Label: .....` blanks
    fill_docx_paragraph_blanks(&rebuilt_txbx, profile, filled)
}

static W_TOP_BLOCK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<w:tbl\b[^>]*>.*?</w:tbl>|<w:p\b[^>]*>.*?</w:p>").expect("valid regex")
});
static W_T_INNER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)").expect("valid regex")
});
static W_PARA_BLANK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"([^:：_\.…\n]{2,64}?)\s*[:：]\s*(_{4,}|\.{4,}|…{2,})").expect("valid regex")
});

fn fill_single_w_p_blanks(
    block: &str,
    active_section: Option<&str>,
    para_idx: &mut usize,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> Option<String> {
    if block.contains("<w:txbxContent") || block.contains("FORMTEXT") || block.contains("<w:sdt") {
        return None;
    }
    let plain = extract_w_text(block);
    let trimmed = plain.trim();
    if trimmed.is_empty()
        || !W_PARA_BLANK_RE.is_match(trimmed)
        || trimmed.starts_with('(')
        || trimmed.starts_with('[')
        || trimmed.starts_with('☐')
    {
        return None;
    }
    *para_idx += 1;
    let mut t_nodes: Vec<(usize, usize, String, String, String, usize, usize)> = Vec::new();
    let mut full_decoded = String::new();
    for cap in W_T_INNER_RE.captures_iter(block) {
        let Some(whole) = cap.get(0) else { continue };
        let open_tag = cap.get(1).map_or("", |g| g.as_str()).to_string();
        let decoded = xml_unescape(cap.get(2).map_or("", |g| g.as_str()));
        let close_tag = cap.get(3).map_or("", |g| g.as_str()).to_string();
        let c_start = full_decoded.len();
        full_decoded.push_str(&decoded);
        let c_end = full_decoded.len();
        t_nodes.push((
            whole.start(),
            whole.end(),
            open_tag,
            decoded,
            close_tag,
            c_start,
            c_end,
        ));
    }

    let mut blank_edits: Vec<(usize, usize, String)> = Vec::new();
    for cap in W_PARA_BLANK_RE.captures_iter(&full_decoded) {
        let Some(raw_label) = cap.get(1) else { continue };
        let Some(blank_span) = cap.get(2) else { continue };
        let clean_label = raw_label
            .as_str()
            .trim_matches(|c: char| c == '_' || c == '.' || c == '…' || c.is_whitespace());
        if clean_label.chars().count() < 2 {
            continue;
        }
        if let Some((attr, owner, val)) =
            match_and_resolve_label(clean_label, active_section, profile)
        {
            filled.push(FileFilledEntry {
                target: format!("para:{}:{}", *para_idx, blank_edits.len() + 1),
                label: clean_label.to_string(),
                attribute: attr,
                owner,
                value: val.clone(),
            });
            blank_edits.push((blank_span.start(), blank_span.end(), format!(" {val} ")));
        }
    }

    if blank_edits.is_empty() {
        return None;
    }

    for (edit_start, edit_end, replacement) in blank_edits.into_iter().rev() {
        let mut placed = false;
        for (_, _, open_tag, decoded, _, c_start, c_end) in &mut t_nodes {
            if edit_end <= *c_start || edit_start >= *c_end {
                continue;
            }
            let local_start = edit_start.saturating_sub(*c_start);
            let local_end = (edit_end - *c_start).min(decoded.len());
            if !decoded.is_char_boundary(local_start) || !decoded.is_char_boundary(local_end) {
                continue;
            }
            let insert_str = if !placed {
                placed = true;
                if !open_tag.contains("xml:space") {
                    *open_tag = "<w:t xml:space=\"preserve\">".to_string();
                }
                replacement.as_str()
            } else {
                ""
            };
            decoded.replace_range(local_start..local_end, insert_str);
        }
    }

    let mut new_block = String::with_capacity(block.len() + 64);
    let mut b_last = 0usize;
    for (xml_start, xml_end, open_tag, decoded, close_tag, _, _) in t_nodes {
        new_block.push_str(&block[b_last..xml_start]);
        new_block.push_str(&open_tag);
        new_block.push_str(&xml_escape(&decoded));
        new_block.push_str(&close_tag);
        b_last = xml_end;
    }
    new_block.push_str(&block[b_last..]);
    Some(new_block)
}

fn fill_docx_paragraph_blanks(
    xml: &str,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> String {
    let mut out = String::with_capacity(xml.len() + 512);
    let mut last = 0usize;
    let mut active_section: Option<String> = None;
    let mut para_idx = 0usize;

    for m in W_TOP_BLOCK_RE.find_iter(xml) {
        out.push_str(&xml[last..m.start()]);
        let block = m.as_str();
        last = m.end();

        if block.starts_with("<w:tbl") {
            if W_PARA_BLANK_RE.is_match(&extract_w_text(block)) {
                let mut tbl_out = String::with_capacity(block.len() + 128);
                let mut tbl_last = 0usize;
                for tc_m in W_TC_RE.find_iter(block) {
                    tbl_out.push_str(&block[tbl_last..tc_m.start()]);
                    let tc_xml = tc_m.as_str();
                    tbl_last = tc_m.end();
                    if W_PARA_BLANK_RE.is_match(&extract_w_text(tc_xml)) {
                        let mut tc_out = String::with_capacity(tc_xml.len() + 64);
                        let mut tc_last = 0usize;
                        for p_m in W_P_BLOCK_RE.find_iter(tc_xml) {
                            tc_out.push_str(&tc_xml[tc_last..p_m.start()]);
                            let p_xml = p_m.as_str();
                            tc_last = p_m.end();
                            if let Some(updated_p) = fill_single_w_p_blanks(
                                p_xml,
                                active_section.as_deref(),
                                &mut para_idx,
                                profile,
                                filled,
                            ) {
                                tc_out.push_str(&updated_p);
                            } else {
                                tc_out.push_str(p_xml);
                            }
                        }
                        tc_out.push_str(&tc_xml[tc_last..]);
                        tbl_out.push_str(&tc_out);
                    } else {
                        tbl_out.push_str(tc_xml);
                    }
                }
                tbl_out.push_str(&block[tbl_last..]);
                out.push_str(&tbl_out);
            } else {
                out.push_str(block);
            }
            continue;
        }

        if block.contains("<w:txbxContent") || block.contains("FORMTEXT") {
            out.push_str(block);
            continue;
        }

        let plain = extract_w_text(block);
        let trimmed = plain.trim();
        if trimmed.is_empty() {
            out.push_str(block);
            continue;
        }

        if !W_PARA_BLANK_RE.is_match(trimmed) {
            if trimmed.chars().count() <= 96
                && !trimmed.starts_with('(')
                && !trimmed.ends_with('.')
                && !trimmed.ends_with('。')
            {
                active_section = Some(trimmed.to_string());
            }
            out.push_str(block);
            continue;
        }

        if let Some(updated_p) = fill_single_w_p_blanks(
            block,
            active_section.as_deref(),
            &mut para_idx,
            profile,
            filled,
        ) {
            out.push_str(&updated_p);
        } else {
            out.push_str(block);
        }
    }

    out.push_str(&xml[last..]);
    out
}

// ============================================================================
// Excel (.xlsx) XML Filling: SharedStrings (<rPh> strip), MergeCells, List Validation
// ============================================================================

static XL_RPH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<(?:[a-zA-Z0-9_]+:)?rPh\b[^>]*>.*?</(?:[a-zA-Z0-9_]+:)?rPh>")
        .expect("valid regex")
});
static XL_SI_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<si\b[^>]*>(.*?)</si>").expect("valid regex"));
static XL_T_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<t(?:\s[^>]*)?>(.*?)</t>").expect("valid regex"));
static XL_MERGE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<mergeCell\s+[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)""#).expect("valid regex"));
static XL_CELL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<c\b([^>]*?)(?:>(.*?)</c>|/>)"#).expect("valid regex")
});
static XL_REF_ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\br="([A-Z]+)(\d+)""#).expect("valid regex"));
static XL_STYLE_ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\bs="(\d+)""#).expect("valid regex"));
static XL_TYPE_ATTR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\bt="([^"]+)""#).expect("valid regex"));
static XL_V_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<v>(.*?)</v>").expect("valid regex"));
static XL_DV_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?s)<dataValidation\b([^>]*)>(.*?)</dataValidation>"#).expect("valid regex")
});
static XL_SQREF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\bsqref="([^"]+)""#).expect("valid regex"));
static XL_FORMULA1_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<formula1>(.*?)</formula1>").expect("valid regex"));

fn col_to_index(col: &str) -> u32 {
    let mut idx = 0u32;
    for b in col.bytes() {
        if b.is_ascii_uppercase() {
            idx = idx * 26 + u32::from(b - b'A' + 1);
        }
    }
    idx
}

fn index_to_col(mut idx: u32) -> String {
    let mut bytes = Vec::new();
    while idx > 0 {
        let rem = ((idx - 1) % 26) as u8;
        bytes.push(b'A' + rem);
        idx = (idx - 1) / 26;
    }
    bytes.reverse();
    String::from_utf8(bytes).unwrap_or_else(|_| "A".to_string())
}

fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let attr_str = format!("r=\"{cell_ref}\"");
    let cap = XL_REF_ATTR_RE.captures(&attr_str)?;
    let col = col_to_index(cap.get(1)?.as_str());
    let row = cap.get(2)?.as_str().parse::<u32>().ok()?;
    Some((col, row))
}

#[derive(Debug, Clone)]
struct MergeRange {
    start_col: u32,
    start_row: u32,
    end_col: u32,
    _end_row: u32,
    anchor_ref: String,
}

/// Fills an `.xlsx` workbook in memory and returns the updated `.xlsx` bytes and report.
pub fn fill_xlsx_bytes(
    xlsx_bytes: &[u8],
    profile: &BTreeMap<String, String>,
) -> Result<(Vec<u8>, FileFillReport), FileFillError> {
    let mut entries = read_zip_entries(xlsx_bytes)?;
    let mut shared_strings = Vec::new();
    let mut shaded_styles: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut enriched = profile.clone();
    derive_companion_details(&mut enriched);

    for entry in &entries {
        if entry.name == "xl/sharedStrings.xml" {
            let raw_xml = String::from_utf8_lossy(&entry.data);
            // Strip Japanese phonetic ruby (<rPh>...</rPh>) before concatenating <t> tags!
            let cleaned = XL_RPH_RE.replace_all(&raw_xml, "");
            for si_cap in XL_SI_RE.captures_iter(&cleaned) {
                let si_body = si_cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let mut text = String::new();
                for t_cap in XL_T_RE.captures_iter(si_body) {
                    if let Some(m) = t_cap.get(1) {
                        text.push_str(&xml_unescape(m.as_str()));
                    }
                }
                shared_strings.push(text);
            }
        } else if entry.name == "xl/styles.xml" {
            let styles_xml = String::from_utf8_lossy(&entry.data);
            shaded_styles = parse_xlsx_shaded_styles(&styles_xml);
        }
    }

    let mut filled = Vec::new();
    let mut first_sheet_texts: HashMap<(u32, u32), String> = HashMap::new();
    for entry in &mut entries {
        if !entry.name.starts_with("xl/worksheets/sheet") || !entry.name.ends_with(".xml") {
            continue;
        }
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        let sheet_name = entry.name.clone();
        let (updated, sheet_texts) = fill_worksheet_xml(
            &sheet_name,
            &xml,
            &shared_strings,
            &shaded_styles,
            &enriched,
            &mut filled,
        );
        if first_sheet_texts.is_empty() {
            first_sheet_texts = sheet_texts;
        }
        entry.data = updated.into_bytes();
    }

    if !first_sheet_texts.is_empty() {
        for entry in &mut entries {
            if !entry.name.starts_with("xl/drawings/drawing") || !entry.name.ends_with(".xml") {
                continue;
            }
            let xml = String::from_utf8_lossy(&entry.data).into_owned();
            let drawing_name = entry.name.clone();
            let updated =
                fill_drawing_xml(&drawing_name, &xml, &first_sheet_texts, &enriched, &mut filled);
            entry.data = updated.into_bytes();
        }
    }

    let out_bytes = write_zip_entries(&entries)?;
    Ok((
        out_bytes,
        FileFillReport {
            format: "xlsx".to_string(),
            filled_count: filled.len(),
            entries: filled,
        },
    ))
}

static XLSX_FILL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<fill\b[^>]*>(.*?)</fill>").expect("valid regex"));
static XLSX_FG_RGB_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<fgColor\b[^>]*\brgb="([0-9A-Fa-f]{6,8})""#).expect("valid regex"));
static XLSX_CELL_XFS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<cellXfs\b[^>]*>(.*?)</cellXfs>").expect("valid regex"));
static XLSX_XF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<xf\b([^>]*)(?:/>|>.*?</xf>)").expect("valid regex"));
static XLSX_FILL_ID_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\bfillId="(\d+)""#).expect("valid regex"));
static XDR_ANCHOR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?s)<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>.*?</xdr:(?:twoCellAnchor|oneCellAnchor)>",
    )
    .expect("valid regex")
});
static XDR_FROM_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?s)<xdr:from>.*?<xdr:col>(\d+)</xdr:col>.*?<xdr:row>(\d+)</xdr:row>.*?</xdr:from>",
    )
    .expect("valid regex")
});
static XDR_A_T_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<a:t(?:\s[^>]*)?>(.*?)</a:t>").expect("valid regex"));

fn parse_xlsx_shaded_styles(styles_xml: &str) -> std::collections::HashSet<String> {
    let mut shaded_fills = std::collections::HashSet::new();
    for (idx, cap) in XLSX_FILL_RE.captures_iter(styles_xml).enumerate() {
        let body = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if !body.contains("patternType=\"solid\"") {
            continue;
        }
        let is_dark_tint = body.contains("tint=\"-");
        let is_colored_rgb = XLSX_FG_RGB_RE
            .captures(body)
            .and_then(|c| c.get(1))
            .map(|m| {
                let hex = m.as_str().to_ascii_uppercase();
                let rgb6 = if hex.len() == 8 { &hex[2..] } else { &hex[..] };
                rgb6 != "FFFFFF"
            })
            .unwrap_or(false);
        if is_dark_tint || is_colored_rgb {
            shaded_fills.insert(idx);
        }
    }
    let mut out = std::collections::HashSet::new();
    if let Some(xfs_block) = XLSX_CELL_XFS_RE.captures(styles_xml).and_then(|c| c.get(1)) {
        for (s_idx, cap) in XLSX_XF_RE.captures_iter(xfs_block.as_str()).enumerate() {
            let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            if let Some(fid) = XLSX_FILL_ID_RE
                .captures(attrs)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse::<usize>().ok())
            {
                if shaded_fills.contains(&fid) {
                    out.insert(s_idx.to_string());
                }
            }
        }
    }
    out
}

fn fill_drawing_xml(
    drawing_name: &str,
    xml: &str,
    cell_texts: &HashMap<(u32, u32), String>,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> String {
    let mut box_idx = 0usize;

    XDR_ANCHOR_RE
        .replace_all(xml, |caps: &regex::Captures<'_>| {
            let block = caps.get(0).map(|m| m.as_str()).unwrap_or("");
            if !block.contains("<xdr:sp") || !block.contains("<xdr:txBody>") {
                return block.to_string();
            }
            let is_white_box = block.contains("txBox=\"1\"")
                || block.contains("lastClr=\"FFFFFF\"")
                || block.contains("val=\"FFFFFF\"");
            if !is_white_box {
                return block.to_string();
            }
            let mut existing = String::new();
            for tc in XDR_A_T_RE.captures_iter(block) {
                if let Some(m) = tc.get(1) {
                    existing.push_str(&xml_unescape(m.as_str()));
                }
            }
            if !existing.trim().is_empty() {
                return block.to_string();
            }
            let Some(f_cap) = XDR_FROM_RE.captures(block) else {
                return block.to_string();
            };
            let Some(col0) = f_cap.get(1).and_then(|m| m.as_str().parse::<u32>().ok()) else {
                return block.to_string();
            };
            let Some(row0) = f_cap.get(2).and_then(|m| m.as_str().parse::<u32>().ok()) else {
                return block.to_string();
            };
            let col1 = col0 + 1;
            let row1 = row0 + 1;
            let mut label = cell_texts.get(&(col1, row1)).cloned();
            if label.is_none() {
                for c in (1..=col1).rev() {
                    if let Some(txt) = cell_texts.get(&(c, row1)) {
                        label = Some(txt.clone());
                        break;
                    }
                }
            }
            if label.is_none() && row1 > 1 {
                for c in col1.saturating_sub(2)..=col1 + 1 {
                    if let Some(txt) = cell_texts.get(&(c, row1 - 1)) {
                        label = Some(txt.clone());
                        break;
                    }
                }
            }
            let Some(lbl) = label else {
                return block.to_string();
            };
            let Some((attr, owner, val)) = match_and_resolve_label(&lbl, None, profile) else {
                return block.to_string();
            };
            let escaped = xml_escape(&val);
            let run = format!(
                "<a:r><a:rPr sz=\"900\"><a:solidFill><a:srgbClr val=\"000000\"/></a:solidFill><a:latin typeface=\"Arial\"/><a:ea typeface=\"Hiragino Sans\"/></a:rPr><a:t>{escaped}</a:t></a:r>"
            );
            let updated = if let Some(pos) = block.find("<a:endParaRPr") {
                format!("{}{run}{}", &block[..pos], &block[pos..])
            } else if let Some(pos) = block.rfind("</a:p>") {
                format!("{}{run}{}", &block[..pos], &block[pos..])
            } else {
                return block.to_string();
            };
            box_idx += 1;
            filled.push(FileFilledEntry {
                target: format!("{drawing_name}:box:{box_idx}"),
                label: lbl,
                attribute: attr,
                owner,
                value: val,
            });
            updated
        })
        .into_owned()
}
/// True for the unit and axis words a form prints inside a row rather than as a field label.
fn is_unit_token(text: &str) -> bool {
    matches!(
        text.trim(),
        "年" | "月" | "日"
            | "Year"
            | "Month"
            | "Day"
            | "・"
            | "男"
            | "女"
            | "Male/Female"
            | "（年）"
            | "（月）"
            | "（日）"
            | "(年)"
            | "(月)"
            | "(日)"
    )
}

/// True for a cell printing the choices a field offers (`男・女`, `有・無`, `Yes / No`).
fn is_choice_token(text: &str) -> bool {
    let t: String = text.split_whitespace().collect();
    matches!(
        t.as_str(),
        "男・女" | "有・無" | "有無" | "Yes/No" | "Yes・No" | "Male/Female" | "Married/Single"
    ) || (t.contains('・') && contains_any(&t, &["男", "女", "有", "無", "Yes", "No"]))
}

fn fill_worksheet_xml(
    sheet_name: &str,
    xml: &str,
    shared_strings: &[String],
    shaded_styles: &std::collections::HashSet<String>,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> (String, HashMap<(u32, u32), String>) {
    // 1. Parse all merged ranges
    let mut merges = Vec::new();
    for cap in XL_MERGE_RE.captures_iter(xml) {
        if let (Some(s_ref), Some(e_ref)) = (cap.get(1), cap.get(2)) {
            if let (Some((sc, sr)), Some((ec, er))) =
                (parse_cell_ref(s_ref.as_str()), parse_cell_ref(e_ref.as_str()))
            {
                merges.push(MergeRange {
                    start_col: sc,
                    start_row: sr,
                    end_col: ec,
                    _end_row: er,
                    anchor_ref: s_ref.as_str().to_string(),
                });
            }
        }
    }

    // 2. Parse inline list dataValidations (<dataValidation type="list" sqref="...">)
    let mut list_validations: HashMap<String, Vec<String>> = HashMap::new();
    for cap in XL_DV_RE.captures_iter(xml) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let body = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        if !attrs.contains("type=\"list\"") {
            continue;
        }
        let Some(sqref) = XL_SQREF_RE.captures(attrs).and_then(|c| c.get(1)) else {
            continue;
        };
        let Some(f1) = XL_FORMULA1_RE.captures(body).and_then(|c| c.get(1)) else {
            continue;
        };
        let raw_f1 = xml_unescape(f1.as_str()).trim().trim_matches('"').to_string();
        if raw_f1.contains(',') {
            let options: Vec<String> = raw_f1
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            for token in sqref.as_str().split_whitespace() {
                let anchor = token.split(':').next().unwrap_or(token);
                list_validations.insert(anchor.to_string(), options.clone());
            }
        }
    }

    // 3. Parse all cells (col, row) -> text
    let mut cell_texts: HashMap<(u32, u32), String> = HashMap::new();
    let mut existing_cells: HashMap<(u32, u32), Option<String>> = HashMap::new();

    for cap in XL_CELL_RE.captures_iter(xml) {
        let attrs = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let body = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let Some(r_cap) = XL_REF_ATTR_RE.captures(attrs) else {
            continue;
        };
        let col = col_to_index(r_cap.get(1).map(|m| m.as_str()).unwrap_or("A"));
        let row = r_cap
            .get(2)
            .and_then(|m| m.as_str().parse::<u32>().ok())
            .unwrap_or(1);
        let style = XL_STYLE_ATTR_RE
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        existing_cells.insert((col, row), style);

        let cell_type = XL_TYPE_ATTR_RE
            .captures(attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
            .unwrap_or("");
        let text = if cell_type == "s" {
            XL_V_RE
                .captures(body)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().trim().parse::<usize>().ok())
                .and_then(|idx| shared_strings.get(idx).cloned())
                .unwrap_or_default()
        } else if cell_type == "inlineStr" {
            let clean_body = XL_RPH_RE.replace_all(body, "");
            let mut t = String::new();
            for tc in XL_T_RE.captures_iter(&clean_body) {
                if let Some(m) = tc.get(1) {
                    t.push_str(&xml_unescape(m.as_str()));
                }
            }
            t
        } else {
            XL_V_RE
                .captures(body)
                .and_then(|c| c.get(1))
                .map(|m| xml_unescape(m.as_str()))
                .unwrap_or_default()
        };

        if !text.trim().is_empty() {
            cell_texts.insert((col, row), text.trim().to_string());
        }
    }

    // Group non-empty cells by row
    let mut rows_map: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    for ((col, row), text) in &cell_texts {
        rows_map
            .entry(*row)
            .or_default()
            .push((*col, text.clone()));
    }
    for list in rows_map.values_mut() {
        list.sort_by_key(|(c, _)| *c);
    }

    let mut row_numbers: Vec<u32> = rows_map.keys().copied().collect();
    row_numbers.sort_unstable();

    let mut replacements: HashMap<String, String> = HashMap::new();
    let mut attr_rows: HashMap<String, u32> = HashMap::new();
    let mut sheet_section: Option<String> = None;

    for &row in &row_numbers {
        let Some(row_items) = rows_map.get(&row) else {
            continue;
        };
        let mut parent_prefix: Option<String> = None;

        // Track section banners (e.g. "Spouse / 配偶者", "Employer / 勤務先", "Applicant / 申請人",
        // "16 在日親族…", "②認定申請児・同居家族氏名") by what they say as well as how they classify.
        if let Some((_, banner_text)) = row_items.first() {
            let banner = banner_text.trim();
            if section_returns_to_applicant(banner) {
                sheet_section = None;
            } else if banner.chars().count() <= 96 && role_named_by(banner).is_some() {
                sheet_section = Some(banner.to_string());
            }
        }
        if row_items.len() == 1 {
            let (_, banner_text) = &row_items[0];
            let probe = FormFieldInput {
                label: "Name".to_string(),
                input_type: "text".to_string(),
                section: banner_text.clone(),
                ..FormFieldInput::default()
            };
            let banner_owner = classify_form_fields(std::slice::from_ref(&probe), true)
                .into_iter()
                .next()
                .map(|m| m.owner)
                .unwrap_or_default();
            if banner_owner != "applicant" && !banner_owner.is_empty() {
                sheet_section = Some(banner_text.clone());
            } else if section_returns_to_applicant(banner_text)
                || banner_text
                    .to_ascii_lowercase()
                    .contains("personal information")
            {
                sheet_section = None;
            }
        }

        for (idx, (col, text)) in row_items.iter().enumerate() {
            // Skip unit words and printed choices: they are not field labels.
            if is_unit_token(text) || is_choice_token(text) {
                continue;
            }

            // Find the next non-unit label column on this row. A printed choice (`男・女`,
            // `有・無`, `Male/Female`) bounds the label's own box but is not a label itself.
            let mut next_label_col = u32::MAX;
            let mut next_label_text: Option<&str> = None;
            let mut option_boundary = false;
            let mut unit_cells = Vec::new();
            for (ncol, ntext) in row_items.iter().skip(idx + 1) {
                if matches!(ntext.as_str(), "年" | "月" | "日") {
                    unit_cells.push((*ncol, ntext.as_str()));
                } else if is_unit_token(ntext) {
                    continue;
                } else if is_choice_token(ntext) {
                    next_label_col = *ncol;
                    option_boundary = true;
                    break;
                } else {
                    next_label_col = *ncol;
                    next_label_text = Some(ntext.as_str());
                    break;
                }
            }

            let own_end_col = merges
                .iter()
                .filter(|m| m.start_col == *col && m.start_row <= row && row <= m._end_row)
                .map(|m| m.end_col)
                .max()
                .unwrap_or(*col);
            let has_empty_merge_before_next = merges.iter().any(|m| {
                (m.start_row == row || m.start_row == row + 1)
                    && m.start_col > own_end_col
                    && m.end_col < next_label_col
                    && !cell_texts.contains_key(&(m.start_col, m.start_row))
            });
            let next_is_sub_item = next_label_text.is_some_and(|nt| {
                let t = nt.trim_start();
                t.starts_with('(')
                    || t.starts_with('（')
                    || t.starts_with('[')
                    || ('\u{2460}'..='\u{2473}').any(|ch| t.starts_with(ch))
            });

            let is_sub_item = {
                let t = text.trim_start();
                t.starts_with('(')
                    || t.starts_with('（')
                    || t.starts_with('[')
                    || ('\u{2460}'..='\u{2473}').any(|ch| t.starts_with(ch))
            };
            let cur_shaded_hdr = existing_cells
                .get(&(*col, row))
                .and_then(|s| s.as_ref())
                .is_some_and(|s| shaded_styles.contains(s));
            let adj_shaded_hdr = existing_cells
                .get(&(own_end_col + 1, row))
                .and_then(|s| s.as_ref())
                .is_some_and(|s| shaded_styles.contains(s));
            let has_empty_unmerged_slot = merges.is_empty()
                && own_end_col + 1 < next_label_col
                && !(cur_shaded_hdr && adj_shaded_hdr)
                && existing_cells.contains_key(&(own_end_col + 1, row))
                && !cell_texts.contains_key(&(own_end_col + 1, row));

            // Open-world left-hand group header (e.g. "6 旅券", "7 在留カード", "Passport", "Driver Licence",
            // "Spouse", "Bank Account") followed by sub-items on the same row without its own input box.
            if !is_sub_item
                && next_label_text.is_some()
                && unit_cells.is_empty()
                && !has_empty_merge_before_next
                && !has_empty_unmerged_slot
                && (next_is_sub_item
                    || own_end_col + 1 == next_label_col
                        && match_and_resolve_label(text, sheet_section.as_deref(), profile)
                            .is_none())
            {
                parent_prefix = Some(text.clone());
                continue;
            }
            let mut combined_label = if let Some(ref p) = parent_prefix {
                if is_sub_item
                    || match_and_resolve_label(text, sheet_section.as_deref(), profile).is_none()
                {
                    format!("{p} {text}")
                } else {
                    text.clone()
                }
            } else {
                text.clone()
            };

            for dc in 0..=2 {
                if let Some(sub) = cell_texts.get(&(col + dc, row + 1)) {
                    if !matches!(sub.as_str(), "Year" | "Month" | "Day" | "Male/Female") {
                        combined_label = format!("{combined_label} / {sub}");
                        break;
                    }
                }
            }

            let effective_section = match (&sheet_section, &parent_prefix) {
                (Some(s), Some(p)) => Some(format!("{s} {p}")),
                (Some(s), None) => Some(s.clone()),
                (None, Some(p)) => Some(p.clone()),
                (None, None) => None,
            };

            let Some((attr, owner, val)) =
                match_and_resolve_label(&combined_label, effective_section.as_deref(), profile)
            else {
                continue;
            };

            // Case A: Split Year / Month / Day cells on the same row (e.g. 2 生年月日 [V12:Y13] 年 [AB12:AC13] 月 [AF12:AG13] 日)
            if !unit_cells.is_empty() && (attr.contains("date") || attr.contains("expiry")) {
                let parts: Vec<&str> = val.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).collect();
                if parts.len() >= 3 {
                    attr_rows.insert(attr.clone(), row);
                    for (u_col, u_kind) in &unit_cells {
                        let part_val = match *u_kind {
                            "年" => parts[0],
                            "月" => parts[1],
                            "日" => parts[2],
                            _ => continue,
                        };
                        if let Some(mg) = merges
                            .iter()
                            .filter(|m| {
                                m.start_row == row
                                    && m.start_col > *col
                                    && m.end_col < *u_col
                                    && !cell_texts.contains_key(&(m.start_col, m.start_row))
                                    && !replacements.contains_key(&m.anchor_ref)
                            })
                            .max_by_key(|m| m.end_col)
                        {
                            replacements.insert(mg.anchor_ref.clone(), part_val.to_string());
                            filled.push(FileFilledEntry {
                                target: format!("{sheet_name}:{}", mg.anchor_ref),
                                label: format!("{combined_label} ({u_kind})"),
                                attribute: attr.clone(),
                                owner: owner.clone(),
                                value: part_val.to_string(),
                            });
                        }
                    }
                    continue;
                }
            }

            // One field printed in a Japanese row and its English twin below: the first row wins.
            if attr_rows.get(&attr) == Some(&row.saturating_sub(1)) {
                continue;
            }

            // Case B: Empty merged input range on the same row between col and next_label_col
            if let Some(mg) = merges
                .iter()
                .filter(|m| {
                    (m.start_row == row || m.start_row == row + 1)
                        && m.start_col > *col
                        && (m.start_col < next_label_col
                            || (option_boundary && m.start_col == next_label_col))
                        && !cell_texts.contains_key(&(m.start_col, m.start_row))
                        && !replacements.contains_key(&m.anchor_ref)
                })
                .min_by_key(|m| (m.start_row, m.start_col))
            {
                attr_rows.insert(attr.clone(), row);
                let chosen = choose_validated_option(&mg.anchor_ref, &val, &list_validations);
                replacements.insert(mg.anchor_ref.clone(), chosen.clone());
                filled.push(FileFilledEntry {
                    target: format!("{sheet_name}:{}", mg.anchor_ref),
                    label: combined_label,
                    attribute: attr,
                    owner,
                    value: chosen,
                });
                continue;
            }

            // Case C: Unmerged sheet — adjacent empty cell (col + 1, row). On a sheet laid out with
            // merged boxes a blank cell after the row's last label is whitespace, not an input.
            // Skip if both (col, row) and (col + 1, row) share a shaded fill (overflowing label strip).
            let adj_col = col + 1;
            let cur_shaded = existing_cells
                .get(&(*col, row))
                .and_then(|s| s.as_ref())
                .is_some_and(|s| shaded_styles.contains(s));
            let adj_shaded = existing_cells
                .get(&(adj_col, row))
                .and_then(|s| s.as_ref())
                .is_some_and(|s| shaded_styles.contains(s));
            if !(cur_shaded && adj_shaded)
                && (next_label_col != u32::MAX || merges.is_empty())
                && adj_col < next_label_col
                && !cell_texts.contains_key(&(adj_col, row))
            {
                let adj_ref = format!("{}{}", index_to_col(adj_col), row);
                if !replacements.contains_key(&adj_ref) && existing_cells.contains_key(&(adj_col, row)) {
                    attr_rows.insert(attr.clone(), row);
                    let chosen = choose_validated_option(&adj_ref, &val, &list_validations);
                    replacements.insert(adj_ref.clone(), chosen.clone());
                    filled.push(FileFilledEntry {
                        target: format!("{sheet_name}:{adj_ref}"),
                        label: combined_label,
                        attribute: attr,
                        owner,
                        value: chosen,
                    });
                }
            }
        }
    }

    if replacements.is_empty() {
        return (xml.to_string(), cell_texts);
    }

    // Rewrite target <c r="REF" .../> cells with inlineStr values while preserving style s="..."
    let updated = XL_CELL_RE
        .replace_all(xml, |caps: &regex::Captures<'_>| {
            let full = caps.get(0).map(|m| m.as_str()).unwrap_or("");
            let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let Some(r_cap) = XL_REF_ATTR_RE.captures(attrs) else {
                return full.to_string();
            };
            let cell_ref = format!(
                "{}{}",
                r_cap.get(1).map(|m| m.as_str()).unwrap_or(""),
                r_cap.get(2).map(|m| m.as_str()).unwrap_or("")
            );
            let Some(val) = replacements.get(&cell_ref) else {
                return full.to_string();
            };
            let style_attr = XL_STYLE_ATTR_RE
                .captures(attrs)
                .and_then(|c| c.get(1))
                .map(|m| format!(" s=\"{}\"", m.as_str()))
                .unwrap_or_default();
            let escaped = xml_escape(val);
            format!("<c r=\"{cell_ref}\"{style_attr} t=\"inlineStr\"><is><t>{escaped}</t></is></c>")
        })
        .into_owned();
    (updated, cell_texts)
}

fn choose_validated_option(
    cell_ref: &str,
    candidate_val: &str,
    list_validations: &HashMap<String, Vec<String>>,
) -> String {
    let Some(options) = list_validations.get(cell_ref) else {
        return candidate_val.to_string();
    };
    let trimmed = candidate_val.trim();
    if trimmed.is_empty() {
        return candidate_val.to_string();
    }
    for opt in options {
        if opt.trim().eq_ignore_ascii_case(trimmed) {
            return opt.clone();
        }
    }
    if let Some(country_info) = crate::normalize::lookup_country(trimmed) {
        for opt in options {
            if lookup_country_option(opt)
                .is_some_and(|opt_country| opt_country.alpha2 == country_info.alpha2)
            {
                return opt.clone();
            }
        }
    }
    if let Some(canon_sex) = normalize_sex(trimmed) {
        for opt in options {
            let o = opt.trim();
            if !matches!(o, "1" | "2") && normalize_sex(o) == Some(canon_sex) {
                return opt.clone();
            }
        }
    }
    let lower = trimmed.to_lowercase();
    for opt in options {
        for seg in opt.split(['|', '/', '—', '–']) {
            if seg.trim().to_lowercase() == lower {
                return opt.clone();
            }
        }
    }
    candidate_val.to_string()
}

// ============================================================================
// Korean Office (.hwpx) XML Filling
// ============================================================================

static HWPX_TBL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:tbl\b[^>]*>.*?</hp:tbl>").expect("valid regex"));
static HWPX_TR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:tr\b[^>]*>.*?</hp:tr>").expect("valid regex"));
static HWPX_TC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:tc\b[^>]*>.*?</hp:tc>").expect("valid regex"));
static HWPX_T_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<hp:t(?:\s[^>]*)?>(.*?)</hp:t>").expect("valid regex"));
static HWPX_T_SELF_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"<hp:t(?:\s[^/>]*)?/>").expect("valid regex"));

fn extract_hwpx_text(fragment: &str) -> String {
    let mut out = String::new();
    for cap in HWPX_T_RE.captures_iter(fragment) {
        if let Some(m) = cap.get(1) {
            out.push_str(&xml_unescape(m.as_str()));
        }
    }
    out.trim().to_string()
}

fn inject_hwpx_tc_text(tc_xml: &str, value: &str) -> String {
    let escaped = xml_escape(value);
    if let Some(m) = HWPX_T_RE.find(tc_xml) {
        let mut out = String::with_capacity(tc_xml.len() + escaped.len());
        out.push_str(&tc_xml[..m.start()]);
        out.push_str(&format!("<hp:t>{escaped}</hp:t>"));
        out.push_str(&tc_xml[m.end()..]);
        out
    } else if let Some(m) = HWPX_T_SELF_RE.find(tc_xml) {
        let mut out = String::with_capacity(tc_xml.len() + escaped.len() + 8);
        out.push_str(&tc_xml[..m.start()]);
        out.push_str(&format!("<hp:t>{escaped}</hp:t>"));
        out.push_str(&tc_xml[m.end()..]);
        out
    } else if let Some(pos) = tc_xml.find("</hp:run>") {
        let mut out = String::with_capacity(tc_xml.len() + escaped.len() + 14);
        out.push_str(&tc_xml[..pos]);
        out.push_str(&format!("<hp:t>{escaped}</hp:t>"));
        out.push_str(&tc_xml[pos..]);
        out
    } else if let Some(pos) = tc_xml.find("</hp:p>") {
        let mut out = String::with_capacity(tc_xml.len() + escaped.len() + 30);
        out.push_str(&tc_xml[..pos]);
        out.push_str(&format!("<hp:run><hp:t>{escaped}</hp:t></hp:run>"));
        out.push_str(&tc_xml[pos..]);
        out
    } else {
        tc_xml.to_string()
    }
}

fn fill_hwpx_table_xml(
    section_name: &str,
    tbl_idx: usize,
    tbl_xml: &str,
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> String {
    let row_matches: Vec<(usize, usize, String)> = HWPX_TR_RE
        .find_iter(tbl_xml)
        .map(|m| (m.start(), m.end(), m.as_str().to_string()))
        .collect();
    let row_cells: Vec<Vec<(usize, usize, String, String)>> = row_matches
        .iter()
        .map(|(_, _, row_xml)| {
            HWPX_TC_RE
                .find_iter(row_xml)
                .map(|cm| {
                    let tc_str = cm.as_str().to_string();
                    let text = extract_hwpx_text(&tc_str);
                    (cm.start(), cm.end(), tc_str, text)
                })
                .collect()
        })
        .collect();

    let mut cell_replacements: HashMap<(usize, usize), String> = HashMap::new();

    for r_idx in 0..row_cells.len() {
        let n_cols = row_cells[r_idx].len();
        let mut c_idx = 0;
        while c_idx < n_cols {
            let label_text = row_cells[r_idx][c_idx].3.clone();
            if !label_text.is_empty() {
                let mut empty_run = 0;
                while c_idx + 1 + empty_run < n_cols
                    && row_cells[r_idx][c_idx + 1 + empty_run].3.is_empty()
                    && !cell_replacements.contains_key(&(r_idx, c_idx + 1 + empty_run))
                {
                    empty_run += 1;
                }
                if empty_run >= 1 {
                    if let Some((attr, owner, val)) =
                        match_and_resolve_label(&label_text, None, profile)
                    {
                        if empty_run >= 4 {
                            let chars: Vec<char> =
                                val.chars().filter(|c| !c.is_whitespace()).collect();
                            for (i, ch) in chars.iter().take(empty_run).enumerate() {
                                let target_c = c_idx + 1 + i;
                                let orig_tc = &row_cells[r_idx][target_c].2;
                                cell_replacements.insert(
                                    (r_idx, target_c),
                                    inject_hwpx_tc_text(orig_tc, &ch.to_string()),
                                );
                            }
                        } else {
                            let target_c = c_idx + 1;
                            let orig_tc = &row_cells[r_idx][target_c].2;
                            cell_replacements
                                .insert((r_idx, target_c), inject_hwpx_tc_text(orig_tc, &val));
                        }
                        filled.push(FileFilledEntry {
                            target: format!("{section_name}:tbl{tbl_idx}:r{r_idx}c{}", c_idx + 1),
                            label: label_text,
                            attribute: attr,
                            owner,
                            value: val,
                        });
                        c_idx += 1 + empty_run;
                        continue;
                    }
                }

                if r_idx + 1 < row_cells.len()
                    && c_idx < row_cells[r_idx + 1].len()
                    && row_cells[r_idx + 1][c_idx].3.is_empty()
                    && !cell_replacements.contains_key(&(r_idx + 1, c_idx))
                {
                    let section_hint = if c_idx > 0 {
                        Some(row_cells[r_idx][0].3.as_str())
                    } else {
                        None
                    };
                    if let Some((attr, owner, val)) =
                        match_and_resolve_label(&label_text, section_hint, profile)
                    {
                        let orig_tc = &row_cells[r_idx + 1][c_idx].2;
                        cell_replacements
                            .insert((r_idx + 1, c_idx), inject_hwpx_tc_text(orig_tc, &val));
                        filled.push(FileFilledEntry {
                            target: format!("{section_name}:tbl{tbl_idx}:r{}c{c_idx}", r_idx + 1),
                            label: label_text,
                            attribute: attr,
                            owner,
                            value: val,
                        });
                    }
                }
            }
            c_idx += 1;
        }
    }

    if cell_replacements.is_empty() {
        return tbl_xml.to_string();
    }

    let mut rebuilt = String::with_capacity(tbl_xml.len() + 256);
    let mut last_pos = 0;
    for (r_idx, (r_start, r_end, r_xml)) in row_matches.iter().enumerate() {
        rebuilt.push_str(&tbl_xml[last_pos..*r_start]);
        let mut row_out = String::with_capacity(r_xml.len());
        let mut cell_last = 0;
        for (c_idx, (c_start, c_end, c_xml, _)) in row_cells[r_idx].iter().enumerate() {
            row_out.push_str(&r_xml[cell_last..*c_start]);
            if let Some(rep) = cell_replacements.get(&(r_idx, c_idx)) {
                row_out.push_str(rep);
            } else {
                row_out.push_str(c_xml);
            }
            cell_last = *c_end;
        }
        row_out.push_str(&r_xml[cell_last..]);
        rebuilt.push_str(&row_out);
        last_pos = *r_end;
    }
    rebuilt.push_str(&tbl_xml[last_pos..]);
    rebuilt
}

/// Fills a Korean `.hwpx` package in memory, bounding writes strictly to adjacent `<hp:tc>` table
/// cells so values never bleed into unrelated empty `<hp:t>` tags elsewhere in the document.
pub fn fill_hwpx_bytes(
    hwpx_bytes: &[u8],
    profile: &BTreeMap<String, String>,
) -> Result<(Vec<u8>, FileFillReport), FileFillError> {
    let mut entries = read_zip_entries(hwpx_bytes)?;
    let mut filled = Vec::new();
    let mut enriched = profile.clone();
    derive_companion_details(&mut enriched);

    for entry in &mut entries {
        if !entry.name.starts_with("Contents/section") || !entry.name.ends_with(".xml") {
            continue;
        }
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        let section_name = entry.name.clone();
        let mut out = String::with_capacity(xml.len() + 256);
        let mut last = 0usize;
        for (tbl_idx, m) in HWPX_TBL_RE.find_iter(&xml).enumerate() {
            out.push_str(&xml[last..m.start()]);
            out.push_str(&fill_hwpx_table_xml(
                &section_name,
                tbl_idx,
                m.as_str(),
                &enriched,
                &mut filled,
            ));
            last = m.end();
        }
        out.push_str(&xml[last..]);
        entry.data = out.into_bytes();
    }

    let out_bytes = write_zip_entries(&entries)?;
    Ok((
        out_bytes,
        FileFillReport {
            format: "hwpx".to_string(),
            filled_count: filled.len(),
            entries: filled,
        },
    ))
}

// ============================================================================
// PDF Filling (AcroForm, XFA Hybrid, Dynamic XFA datasets, Flat PDF FreeText)
// ============================================================================

/// Fills a file on disk (`.pdf`, `.docx`, `.xlsx`, `.hwpx`, `.doc`, `.xls`, `.rtf`)
/// and writes the filled copy to `output_path`.
#[cfg(not(target_arch = "wasm32"))]
pub fn fill_file_on_disk(
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    profile: &BTreeMap<String, String>,
) -> Result<FileFillReport, FileFillError> {
    let ext = input_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "docx" => {
            let bytes = std::fs::read(input_path).map_err(|_| FileFillError::InvalidZipArchive)?;
            let (out, report) = fill_docx_bytes(&bytes, profile)?;
            std::fs::write(output_path, out).map_err(|_| FileFillError::InvalidZipArchive)?;
            Ok(report)
        }
        "xlsx" => {
            let bytes = std::fs::read(input_path).map_err(|_| FileFillError::InvalidZipArchive)?;
            let (out, report) = fill_xlsx_bytes(&bytes, profile)?;
            std::fs::write(output_path, out).map_err(|_| FileFillError::InvalidZipArchive)?;
            Ok(report)
        }
        "hwpx" => {
            let bytes = std::fs::read(input_path).map_err(|_| FileFillError::InvalidZipArchive)?;
            let (out, report) = fill_hwpx_bytes(&bytes, profile)?;
            std::fs::write(output_path, out).map_err(|_| FileFillError::InvalidZipArchive)?;
            Ok(report)
        }
        "pdf" => fill_pdf_on_disk(input_path, output_path, profile),
        "doc" | "xls" | "rtf" => fill_legacy_office_on_disk(input_path, output_path, &ext, profile),
        _ => Err(FileFillError::UnsupportedFileFormat),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn fill_legacy_office_on_disk(
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    ext: &str,
    profile: &BTreeMap<String, String>,
) -> Result<FileFillReport, FileFillError> {
    let target_ext = if ext == "xls" { "xlsx" } else { "docx" };
    let tmp_dir = std::env::temp_dir().join(format!("vowkey-office-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp_dir);

    let soffice = if std::path::Path::new("/opt/homebrew/bin/soffice").exists() {
        "/opt/homebrew/bin/soffice"
    } else {
        "soffice"
    };

    let status = std::process::Command::new(soffice)
        .args([
            "--headless",
            "--convert-to",
            target_ext,
            "--outdir",
            &tmp_dir.to_string_lossy(),
            &input_path.to_string_lossy(),
        ])
        .status()
        .map_err(|_| FileFillError::UnsupportedFileFormat)?;

    if !status.success() {
        return Err(FileFillError::UnsupportedFileFormat);
    }

    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("converted");
    let converted_path = tmp_dir.join(format!("{stem}.{target_ext}"));
    let filled_modern_path = tmp_dir.join(format!("{stem}-filled.{target_ext}"));
    let mut report = fill_file_on_disk(&converted_path, &filled_modern_path, profile)?;
    report.format = format!("{ext}->{target_ext}");

    let out_ext = output_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if out_ext == target_ext {
        std::fs::copy(&filled_modern_path, output_path)
            .map_err(|_| FileFillError::UnsupportedFileFormat)?;
    } else {
        let back_status = std::process::Command::new(soffice)
            .args([
                "--headless",
                "--convert-to",
                ext,
                "--outdir",
                &tmp_dir.to_string_lossy(),
                &filled_modern_path.to_string_lossy(),
            ])
            .status()
            .map_err(|_| FileFillError::UnsupportedFileFormat)?;
        if back_status.success() {
            let re_converted = tmp_dir.join(format!("{stem}-filled.{ext}"));
            let _ = std::fs::copy(&re_converted, output_path);
        } else {
            let _ = std::fs::copy(&filled_modern_path, output_path);
        }
    }
    let _ = std::fs::remove_dir_all(&tmp_dir);
    Ok(report)
}

#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Deserialize)]
struct ExtractedPdfCandidate {
    target: String,
    id: Option<String>,
    name: Option<String>,
    label: Option<String>,
    section_label: Option<String>,
    max_length: Option<usize>,
    is_checkbox: bool,
    export_values: Vec<String>,
}

#[cfg(not(target_arch = "wasm32"))]
fn pdf_option_matches_value(option_or_clue: &str, attribute: &str, value: &str) -> bool {
    let opt = option_or_clue.trim();
    let val = value.trim();
    if opt.is_empty() || val.is_empty() {
        return false;
    }
    if opt.eq_ignore_ascii_case(val) {
        return true;
    }
    if matches!(attribute, "person.sex" | "sex" | "personal.sex") {
        if let Some(canon_val) = normalize_sex(val) {
            if !matches!(opt, "1" | "2") && normalize_sex(opt) == Some(canon_val) {
                return true;
            }
            let lower = opt.to_lowercase();
            let has_male = lower.contains("male") && !lower.contains("female")
                || lower.contains("männlich")
                || opt.contains('男');
            let has_female = lower.contains("female")
                || lower.contains("weiblich")
                || opt.contains('女');
            if has_male != has_female {
                return (canon_val == "male" && has_male) || (canon_val == "female" && has_female);
            }
        }
        return false;
    }
    if let Some(val_country) = crate::normalize::lookup_country(val) {
        if lookup_country_option(opt).is_some_and(|c| c.alpha2 == val_country.alpha2) {
            return true;
        }
    }
    let val_lower = val.to_lowercase();
    let opt_lower = opt.to_lowercase();
    if matches!(attribute, "person.marital_status" | "marital_status") {
        let groups: &[&[&str]] = &[
            &["single", "unmarried", "never married", "独身", "未婚", "미혼", "độc thân", "ledig"],
            &["married", "既婚", "有配偶", "기혼", "kết hôn", "verheiratet"],
            &["divorced", "離婚", "이혼", "ly hôn", "geschieden"],
            &["widowed", "widow", "widower", "死別", "사별", "góa", "verwitwet"],
        ];
        for g in groups {
            let v_in = g.iter().any(|k| val_lower.contains(k));
            let o_in = g.iter().any(|k| opt_lower.contains(k));
            if v_in || o_in {
                // On "Single or Married filing separately", do not match "Married" against "Single or Married filing separately".
                if o_in && v_in {
                    if g[0] == "married" && opt_lower.contains("single") && !val_lower.contains("separately") {
                        return false;
                    }
                    return true;
                }
                return false;
            }
        }
    }
    opt_lower
        .split(|c: char| !c.is_alphanumeric())
        .any(|tok| !tok.is_empty() && tok.len() >= 2 && tok == val_lower)
}

#[cfg(not(target_arch = "wasm32"))]
fn resolve_pdf_checkbox_value(
    cand: &ExtractedPdfCandidate,
    attribute: &str,
    value: &str,
) -> Option<String> {
    let is_generic_export = |s: &str| {
        matches!(
            s.trim().to_ascii_lowercase().as_str(),
            "yes" | "on" | "1" | "true" | "checked" | "x"
        )
    };
    if cand.export_values.len() >= 2 {
        for exp in &cand.export_values {
            if pdf_option_matches_value(exp, attribute, value) {
                return Some(exp.clone());
            }
        }
        return None;
    }
    if let Some(exp) = cand.export_values.first() {
        if !is_generic_export(exp) {
            return pdf_option_matches_value(exp, attribute, value).then(|| exp.clone());
        }
        let clue = format!(
            "{} {}",
            cand.label.as_deref().unwrap_or(""),
            cand.name.as_deref().unwrap_or("")
        );
        if pdf_option_matches_value(&clue, attribute, value)
            || matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "yes" | "checked"
            )
        {
            return Some(exp.clone());
        }
        return None;
    }
    // Dynamic XFA <checkButton> without /AP dictionary
    let clue = format!(
        "{} {}",
        cand.label.as_deref().unwrap_or(""),
        cand.name.as_deref().unwrap_or("")
    );
    if pdf_option_matches_value(&clue, attribute, value)
        || matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "true" | "yes" | "1"
        )
    {
        return Some("1".to_string());
    }
    None
}

#[cfg(not(target_arch = "wasm32"))]
fn profiles_from_flat_map(
    profile: &BTreeMap<String, String>,
) -> BTreeMap<String, BTreeMap<String, String>> {
    crate::matcher::profiles_from_flat_map(profile)
}

#[cfg(not(target_arch = "wasm32"))]
fn fill_pdf_on_disk(
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    profile: &BTreeMap<String, String>,
) -> Result<FileFillReport, FileFillError> {
    let profiles = profiles_from_flat_map(profile);
    fill_pdf_with_profiles_on_disk(input_path, output_path, &profiles)
}

/// Fills a PDF form on disk from a role-keyed map of profiles (`applicant`, `spouse`,
/// `dependent`, `employer`, `preparer`, etc.), leaving sections for absent roles untouched.
#[cfg(not(target_arch = "wasm32"))]
pub fn fill_pdf_with_profiles_on_disk(
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    profiles: &BTreeMap<String, BTreeMap<String, String>>,
) -> Result<FileFillReport, FileFillError> {
    let py_bin = std::env::var("VOWKEY_PYTHON").unwrap_or_else(|_| "python3".to_string());
    let extract_script = include_str!("pdf/extract.py");

    let output = std::process::Command::new(&py_bin)
        .args(["-c", extract_script, &input_path.to_string_lossy()])
        .output()
        .map_err(|_| FileFillError::PdfToolsMissing)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(
            if stderr.contains("No module named") || stderr.contains("cryptography") {
                FileFillError::PdfToolsMissing
            } else {
                FileFillError::UnsupportedFileFormat
            },
        );
    }

    #[derive(Deserialize)]
    struct ExtractedPayload {
        kind: String,
        candidates: Vec<ExtractedPdfCandidate>,
    }

    let payload: ExtractedPayload =
        serde_json::from_slice(&output.stdout).map_err(|_| FileFillError::UnsupportedFileFormat)?;

    if payload.kind == "pdf-flat" {
        return Err(FileFillError::FlatPdf);
    }

    let mut filled_entries = Vec::new();
    let mut write_map: HashMap<String, String> = HashMap::new();

    let inputs: Vec<FormFieldInput> = payload
        .candidates
        .iter()
        .map(|cand| FormFieldInput {
            id: cand.id.clone().unwrap_or_default(),
            name: cand.name.clone().unwrap_or_default(),
            label: cand.label.clone().unwrap_or_default(),
            input_type: if cand.is_checkbox { "checkbox" } else { "text" }.to_string(),
            section: cand.section_label.clone().unwrap_or_default(),
            max_length: cand.max_length.and_then(|limit| i32::try_from(limit).ok()).unwrap_or(0),
            options: if !cand.is_checkbox {
                cand.export_values.clone()
            } else {
                Vec::new()
            },
            ..FormFieldInput::default()
        })
        .collect();
    let filled_matches = fill_form_fields(&inputs, profiles, true);
    for (cand, matched) in payload.candidates.iter().zip(filled_matches) {
        if matched.attribute.is_empty() || matched.score <= 0 {
            continue;
        }
        let Some(mut val) = matched.value else {
            continue;
        };
        if cand.is_checkbox {
            let Some(btn_val) = resolve_pdf_checkbox_value(cand, &matched.attribute, &val) else {
                continue;
            };
            val = btn_val;
        } else if let Some(limit) = cand.max_length
            && limit > 0
        {
            val = val.chars().take(limit).collect();
        }
        if val.trim().is_empty() || write_map.contains_key(&cand.target) {
            continue;
        }
        write_map.insert(cand.target.clone(), val.clone());
        filled_entries.push(FileFilledEntry {
            target: cand.target.clone(),
            label: cand.label.clone().unwrap_or_default(),
            attribute: matched.attribute,
            owner: matched.owner,
            value: val,
        });
    }

    // Pass 2: Write the matched values back into the PDF according to its physics class!
    let write_json =
        serde_json::to_string(&write_map).map_err(|_| FileFillError::UnsupportedFileFormat)?;

    let apply_script = include_str!("pdf/apply.py");

    let apply_status = std::process::Command::new(&py_bin)
        .args([
            "-c",
            apply_script,
            &input_path.to_string_lossy(),
            &output_path.to_string_lossy(),
            &payload.kind,
            &write_json,
        ])
        .status()
        .map_err(|_| FileFillError::UnsupportedFileFormat)?;

    if !apply_status.success() {
        return Err(FileFillError::UnsupportedFileFormat);
    }

    Ok(FileFillReport {
        format: payload.kind,
        filled_count: filled_entries.len(),
        entries: filled_entries,
    })
}
