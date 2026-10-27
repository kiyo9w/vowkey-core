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

use crate::matcher::{FormFieldInput, classify_form_fields, resolve_and_format_value};

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
struct ZipEntry {
    name: String,
    data: Vec<u8>,
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

fn read_zip_entries(bytes: &[u8]) -> Result<Vec<ZipEntry>, FileFillError> {
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

fn xml_unescape(input: &str) -> String {
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

fn inject_w_tc_text(tc_xml: &str, value: &str) -> String {
    let escaped = xml_escape(value);
    let run = format!("<w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r>");
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

fn match_and_resolve_label(
    label: &str,
    section_hint: Option<&str>,
    profile: &BTreeMap<String, String>,
) -> Option<(String, String, String)> {
    let clean = label.trim();
    if clean.is_empty() || clean.chars().count() > 180 {
        return None;
    }
    let field = FormFieldInput {
        label: clean.to_string(),
        input_type: "text".to_string(),
        section: section_hint.unwrap_or("").to_string(),
        ..FormFieldInput::default()
    };
    let matches = classify_form_fields(std::slice::from_ref(&field), true);
    let m = matches.into_iter().next()?;
    if m.attribute.is_empty() || m.score <= 0 {
        return None;
    }
    let formatted = resolve_and_format_value(&field, &m, profile)?;
    if formatted.trim().is_empty() {
        return None;
    }
    Some((m.attribute, m.owner, formatted))
}

/// Fills a `.docx` file in memory and returns the updated `.docx` bytes and report.
pub fn fill_docx_bytes(
    docx_bytes: &[u8],
    profile: &BTreeMap<String, String>,
) -> Result<(Vec<u8>, FileFillReport), FileFillError> {
    let mut entries = read_zip_entries(docx_bytes)?;
    let mut filled = Vec::new();

    for entry in &mut entries {
        if entry.name != "word/document.xml" {
            continue;
        }
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        let updated_xml = fill_word_document_xml(&xml, profile, &mut filled);
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
    // 1. Collect all table rows so we can fill both horizontal (Label | Empty) and
    //    vertical (Label row above Empty row) table layouts, plus multi-box character cells.
    let row_matches: Vec<(usize, usize, String)> = W_TR_RE
        .find_iter(xml)
        .map(|m| (m.start(), m.end(), m.as_str().to_string()))
        .collect();

    let mut row_cells: Vec<Vec<(usize, usize, String, String)>> = row_matches
        .iter()
        .map(|(_, _, row_xml)| {
            W_TC_RE
                .find_iter(row_xml)
                .map(|cm| {
                    let tc_str = cm.as_str().to_string();
                    let text = extract_w_text(&tc_str);
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
                // Check if following cells on the same row are empty
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
                            // Character-box run (e.g. UK NI Number, Account Number, Korean ARC)
                            let chars: Vec<char> =
                                val.chars().filter(|c| !c.is_whitespace()).collect();
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

                // Vertical header-above-empty-row check: if row r_idx+1 has the same number of
                // cells (or at least c_idx+1 cells) and cell (r_idx+1, c_idx) is empty.
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
                let escaped = xml_escape(&val);
                format!("{prefix}<w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r>{suffix}")
            } else {
                format!("{prefix}{existing}{suffix}")
            }
        })
        .into_owned();

    // 3. Text boxes (<w:txbxContent>) with a label and empty space/paragraph
    let mut txbx_idx = 0usize;
    W_TXBX_RE
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
                        let escaped = xml_escape(&format!(" {val}"));
                        if let Some(pos) = block.rfind("</w:p>") {
                            let mut out = String::with_capacity(block.len() + escaped.len() + 40);
                            out.push_str(&block[..pos]);
                            out.push_str(&format!(
                                "<w:r><w:t xml:space=\"preserve\">{escaped}</w:t></w:r>"
                            ));
                            out.push_str(&block[pos..]);
                            return out;
                        }
                    }
                }
            }
            block.to_string()
        })
        .into_owned()
}

// ============================================================================
// Excel (.xlsx) XML Filling: SharedStrings (<rPh> strip), MergeCells, List Validation
// ============================================================================

static XL_RPH_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<rPh\b[^>]*>.*?</rPh>").expect("valid regex"));
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
        }
    }

    let mut filled = Vec::new();
    for entry in &mut entries {
        if !entry.name.starts_with("xl/worksheets/sheet") || !entry.name.ends_with(".xml") {
            continue;
        }
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        let sheet_name = entry.name.clone();
        let updated = fill_worksheet_xml(&sheet_name, &xml, &shared_strings, profile, &mut filled);
        entry.data = updated.into_bytes();
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

fn fill_worksheet_xml(
    sheet_name: &str,
    xml: &str,
    shared_strings: &[String],
    profile: &BTreeMap<String, String>,
    filled: &mut Vec<FileFilledEntry>,
) -> String {
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
            let mut t = String::new();
            for tc in XL_T_RE.captures_iter(body) {
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

    for &row in &row_numbers {
        let Some(row_items) = rows_map.get(&row) else {
            continue;
        };
        let mut parent_prefix: Option<String> = None;

        for (idx, (col, text)) in row_items.iter().enumerate() {
            // Skip unit-only tokens like 年, 月, 日, ・, 男, 女
            if matches!(
                text.as_str(),
                "年" | "月" | "日" | "Year" | "Month" | "Day" | "・" | "男" | "女" | "Male/Female"
            ) {
                continue;
            }

            // Detect group headers like "6 旅券" followed by "(1)番号" on the same row
            if text.contains("旅券") && !text.contains("番号") && !text.contains("期限") {
                parent_prefix = Some(text.clone());
                continue;
            }

            // Combine with English sub-label on row+1 if present nearby
            let mut combined_label = if text.starts_with('(') {
                if let Some(ref p) = parent_prefix {
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

            // Find the next non-unit label column on this row
            let mut next_label_col = u32::MAX;
            let mut unit_cells = Vec::new();
            for (ncol, ntext) in row_items.iter().skip(idx + 1) {
                if matches!(ntext.as_str(), "年" | "月" | "日") {
                    unit_cells.push((*ncol, ntext.as_str()));
                } else if matches!(ntext.as_str(), "・" | "男" | "女") {
                    continue;
                } else {
                    next_label_col = *ncol;
                    break;
                }
            }

            let Some((attr, owner, val)) = match_and_resolve_label(&combined_label, None, profile)
            else {
                continue;
            };

            // Case A: Split Year / Month / Day cells on the same row (e.g. 2 生年月日 [V12:Y13] 年 [AB12:AC13] 月 [AF12:AG13] 日)
            if !unit_cells.is_empty() && (attr.contains("date") || attr.contains("expiry")) {
                let parts: Vec<&str> = val.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).collect();
                if parts.len() >= 3 {
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

            // Case B: Empty merged input range on the same row between col and next_label_col
            if let Some(mg) = merges
                .iter()
                .filter(|m| {
                    (m.start_row == row || m.start_row == row + 1)
                        && m.start_col > *col
                        && m.start_col < next_label_col
                        && !cell_texts.contains_key(&(m.start_col, m.start_row))
                        && !replacements.contains_key(&m.anchor_ref)
                })
                .min_by_key(|m| (m.start_row, m.start_col))
            {
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

            // Case C: Unmerged sheet — adjacent empty cell (col + 1, row)
            let adj_col = col + 1;
            if adj_col < next_label_col && !cell_texts.contains_key(&(adj_col, row)) {
                let adj_ref = format!("{}{}", index_to_col(adj_col), row);
                if !replacements.contains_key(&adj_ref) && existing_cells.contains_key(&(adj_col, row)) {
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
        return xml.to_string();
    }

    // Rewrite target <c r="REF" .../> cells with inlineStr values while preserving style s="..."
    XL_CELL_RE
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
        .into_owned()
}

fn choose_validated_option(
    cell_ref: &str,
    candidate_val: &str,
    list_validations: &HashMap<String, Vec<String>>,
) -> String {
    let Some(options) = list_validations.get(cell_ref) else {
        return candidate_val.to_string();
    };
    let lower = candidate_val.to_lowercase();
    for opt in options {
        if opt.eq_ignore_ascii_case(candidate_val)
            || lower.contains(&opt.to_lowercase())
            || opt.to_lowercase().contains(&lower)
        {
            return opt.clone();
        }
    }
    candidate_val.to_string()
}

// ============================================================================
// Korean Office (.hwpx) XML Filling
// ============================================================================

/// Fills a Korean `.hwpx` package in memory and returns the updated bytes and report.
pub fn fill_hwpx_bytes(
    hwpx_bytes: &[u8],
    profile: &BTreeMap<String, String>,
) -> Result<(Vec<u8>, FileFillReport), FileFillError> {
    let mut entries = read_zip_entries(hwpx_bytes)?;
    let mut filled = Vec::new();
    let hp_t_re = Regex::new(r"(?s)<hp:t>(.*?)</hp:t>").expect("valid regex");

    for entry in &mut entries {
        if !entry.name.starts_with("Contents/section") || !entry.name.ends_with(".xml") {
            continue;
        }
        let xml = String::from_utf8_lossy(&entry.data).into_owned();
        let mut pending_value: Option<(String, String, String, String)> = None;
        let updated = hp_t_re
            .replace_all(&xml, |caps: &regex::Captures<'_>| {
                let raw = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let text = xml_unescape(raw).trim().to_string();
                if text.is_empty() {
                    if let Some((label, attr, owner, val)) = pending_value.take() {
                        filled.push(FileFilledEntry {
                            target: format!("{}:hp:t", entry.name),
                            label,
                            attribute: attr,
                            owner,
                            value: val.clone(),
                        });
                        return format!("<hp:t>{}</hp:t>", xml_escape(&val));
                    }
                } else if let Some((attr, owner, val)) =
                    match_and_resolve_label(&text, None, profile)
                {
                    pending_value = Some((text, attr, owner, val));
                }
                caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string()
            })
            .into_owned();
        entry.data = updated.into_bytes();
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
fn fill_pdf_on_disk(
    input_path: &std::path::Path,
    output_path: &std::path::Path,
    profile: &BTreeMap<String, String>,
) -> Result<FileFillReport, FileFillError> {
    // Pass 1: Extract PDF kind & field/label candidates (handles AES-256 owner-encrypted PDFs,
    // AcroForm, XFA hybrid, Dynamic XFA templates, and Flat PDF positioned text spans).
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
            ..FormFieldInput::default()
        })
        .collect();
    let classified = classify_form_fields(&inputs, true);
    for (cand, (fc, matched)) in payload.candidates.iter().zip(inputs.iter().zip(classified)) {
        if matched.attribute.is_empty() || matched.score <= 0 {
            continue;
        }
        let Some(mut val) = resolve_and_format_value(&fc, &matched, profile) else {
            continue;
        };
        if let Some(limit) = cand.max_length {
            if limit > 0 {
                val = val.chars().take(limit).collect();
            }
        }
        if val.trim().is_empty() {
            continue;
        }
        if cand.is_checkbox && !cand.export_values.is_empty() {
            val = cand.export_values[0].clone();
        }
        if write_map.contains_key(&cand.target) {
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
