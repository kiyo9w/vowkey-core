//! Shared document recognition plans for native clients. Images and network authorization stay in
//! the client; only printed text and choice responses cross this boundary.

use std::collections::BTreeMap;

use vowkey_capture::{
    barcode::decode_barcode,
    decision::Plan,
    decision_form::{ChosenField, FormPlan},
    document::extract_document_details,
    file_fill::{fill_docx_bytes, fill_hwpx_bytes, fill_xlsx_bytes},
    form_layout::{OcrPieceBox, PlannedImageFillItem, detect_form_layout, snap_planned_fills},
    matcher::{FormFieldInput, fill_form_fields, fill_form_fields_chosen, profiles_from_flat_map},
    office::{classify_office, reading_from_office},
    profile,
};

use crate::error::{Error, Result};

fn serialize<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| Error::Conversion("Invalid capture result".into()))
}

fn plan(json: &str) -> Result<Plan> {
    serde_json::from_str(json).map_err(|_| Error::Conversion("Invalid capture plan".into()))
}

fn responses(json: &str) -> Result<Vec<serde_json::Value>> {
    serde_json::from_str(json).map_err(|_| Error::Conversion("Invalid capture answers".into()))
}

/// Creates the same two-round document recognition plan used by the WebAssembly client.
#[uniffi::export]
pub fn capture_decision_begin(reading_json: String, per_request: u32) -> Result<String> {
    let mut plan = Plan::from_reading_json(&reading_json)
        .map_err(|_| Error::Conversion("Invalid document reading".into()))?;
    plan.per_request = per_request as usize;
    serialize(&plan)
}

/// Returns value-bearing printed-piece requests, never an image or a vault object.
#[uniffi::export]
pub fn capture_decision_requests(plan_json: String, second_round: bool) -> Result<String> {
    let plan = plan(&plan_json)?;
    serialize(&if second_round { plan.second_requests() } else { plan.first_requests() })
}

/// Applies group choices before constructing the detail-choice round.
#[uniffi::export]
pub fn capture_decision_take_first_answers(
    plan_json: String,
    responses_json: String,
) -> Result<String> {
    let mut plan = plan(&plan_json)?;
    plan.take_first_answers(&responses(&responses_json)?);
    serialize(&plan)
}

/// Produces canonical details with printed-piece locators; the model never supplies their values.
#[uniffi::export]
pub fn capture_decision_finish(
    plan_json: String,
    responses_json: String,
    extra_text: String,
    current_year: u16,
) -> Result<String> {
    let mut plan = plan(&plan_json)?;
    if !extra_text.is_empty() {
        plan.text.push('\n');
        plan.text.push_str(&extra_text);
    }
    serialize(&plan.finish(&responses(&responses_json)?, current_year))
}

/// Reads machine-readable zones, barcodes and standard labeled details without a network call.
#[uniffi::export]
pub fn capture_document_text(text: String, current_year: u16) -> Result<String> {
    serialize(&extract_document_details(&text, current_year))
}

/// Creates a value-free plan for matching collected form labels to held detail descriptors.
#[uniffi::export]
pub fn capture_form_begin(request_json: String, per_request: u32) -> Result<String> {
    #[derive(serde::Deserialize)]
    struct Request {
        fields: Vec<FormFieldInput>,
        held: Vec<String>,
    }
    let request: Request = serde_json::from_str(&request_json)
        .map_err(|_| Error::Conversion("Invalid collected form".into()))?;
    let mut plan = FormPlan::new(&request.fields, &request.held);
    plan.per_request = per_request as usize;
    serialize(&plan)
}

/// Returns one round of value-free form questions.
#[uniffi::export]
pub fn capture_form_requests(plan_json: String, second_round: bool) -> Result<String> {
    let plan: FormPlan = serde_json::from_str(&plan_json)
        .map_err(|_| Error::Conversion("Invalid form plan".into()))?;
    serialize(&if second_round { plan.second_requests() } else { plan.first_requests() })
}

/// Applies first-round form choices before constructing the second round.
#[uniffi::export]
pub fn capture_form_take_first_answers(plan_json: String, responses_json: String) -> Result<String> {
    let mut plan: FormPlan = serde_json::from_str(&plan_json)
        .map_err(|_| Error::Conversion("Invalid form plan".into()))?;
    plan.take_first_answers(&responses(&responses_json)?);
    serialize(&plan)
}

/// Returns chosen detail descriptors, never saved values.
#[uniffi::export]
pub fn capture_form_choices(plan_json: String, responses_json: String) -> Result<String> {
    let plan: FormPlan = serde_json::from_str(&plan_json)
        .map_err(|_| Error::Conversion("Invalid form plan".into()))?;
    serialize(&plan.finish(&responses(&responses_json)?))
}

/// Matches and formats values inside the native vault owner, after profile authorization.
#[uniffi::export]
pub fn capture_fill_form(
    fields_json: String,
    profiles_json: String,
    choices_json: String,
    explicit_fill: bool,
) -> Result<String> {
    let fields: Vec<FormFieldInput> = serde_json::from_str(&fields_json)
        .map_err(|_| Error::Conversion("Invalid collected form".into()))?;
    let profiles: BTreeMap<String, BTreeMap<String, String>> = serde_json::from_str(&profiles_json)
        .map_err(|_| Error::Conversion("Invalid authorized profiles".into()))?;
    let choices: Vec<ChosenField> = serde_json::from_str(&choices_json)
        .map_err(|_| Error::Conversion("Invalid form choices".into()))?;
    serialize(&if choices.is_empty() {
        fill_form_fields(&fields, &profiles, explicit_fill)
    } else {
        fill_form_fields_chosen(&fields, &profiles, explicit_fill, &choices)
    })
}

/// Human-readable label for a canonical, role-prefixed, or `custom.<slug>` detail key.
#[uniffi::export]
pub fn capture_detail_label(key: String) -> String {
    profile::detail_label(&key)
}

/// Expands a flat map (`spouse.*`, `dependent.*`, `dependent.2.*`) into role-keyed maps.
#[uniffi::export]
pub fn capture_profiles_from_flat(profile_json: String) -> Result<String> {
    let flat: BTreeMap<String, String> = serde_json::from_str(&profile_json)
        .map_err(|_| Error::Conversion("Invalid flat profile".into()))?;
    serialize(&profiles_from_flat_map(&flat))
}

/// Decodes PDF417 (AAMVA) or QR (CCCD) barcodes from PNG/JPEG bytes on device.
#[uniffi::export]
pub fn capture_decode_barcode(image_bytes: Vec<u8>) -> Result<String> {
    let decoded =
        decode_barcode(&image_bytes).map_err(|e| Error::Conversion(e.to_string()))?;
    serialize(&decoded)
}

/// Classifies `.docx`, `.xlsx`, or `.hwpx` bytes as `"form"`, `"document"`, or `"ambiguous"`.
#[uniffi::export]
pub fn capture_classify_office(bytes: Vec<u8>, file_name: String) -> Result<String> {
    serialize(&classify_office(&bytes, &file_name))
}

/// Extracts layout pieces and plain text from `.docx`, `.xlsx`, or `.hwpx` bytes as JSON.
#[uniffi::export]
pub fn capture_extract_office(bytes: Vec<u8>, file_name: String) -> Result<String> {
    let Some(reading) = reading_from_office(&bytes, &file_name) else {
        return Err(Error::Conversion("Unsupported office document".into()));
    };
    let mut lines: Vec<String> = Vec::new();
    for page in &reading.pages {
        let mut current_row: Option<u32> = None;
        let mut row_tokens: Vec<&str> = Vec::new();
        for piece in &page.pieces {
            if let Some(r) = piece.row {
                if current_row == Some(r) {
                    row_tokens.push(piece.text.as_str());
                } else {
                    if !row_tokens.is_empty() {
                        lines.push(row_tokens.join("\t"));
                    }
                    current_row = Some(r);
                    row_tokens = vec![piece.text.as_str()];
                }
            } else {
                if !row_tokens.is_empty() {
                    lines.push(row_tokens.join("\t"));
                    row_tokens.clear();
                }
                current_row = None;
                lines.push(piece.text.clone());
            }
        }
        if !row_tokens.is_empty() {
            lines.push(row_tokens.join("\t"));
        }
    }
    serialize(&serde_json::json!({
        "text": lines.join("\n"),
        "pages": reading.pages,
    }))
}

/// Fills `.docx`, `.xlsx`, or `.hwpx` bytes in memory from a flat profile map, returning `{ bytesBase64, report }`
/// or raw bytes via `capture_fill_office_bytes`.
#[uniffi::export]
pub fn capture_fill_office_bytes(
    bytes: Vec<u8>,
    file_name: String,
    profile_json: String,
) -> Result<Vec<u8>> {
    let profile: BTreeMap<String, String> = serde_json::from_str(&profile_json)
        .map_err(|_| Error::Conversion("Invalid profile JSON".into()))?;
    let lower = file_name.to_ascii_lowercase();
    let (filled, _) = if lower.ends_with(".docx") {
        fill_docx_bytes(&bytes, &profile)
    } else if lower.ends_with(".xlsx") {
        fill_xlsx_bytes(&bytes, &profile)
    } else if lower.ends_with(".hwpx") {
        fill_hwpx_bytes(&bytes, &profile)
    } else {
        return Err(Error::Conversion("Unsupported office format".into()));
    }
    .map_err(|e| Error::Conversion(e.to_string()))?;
    Ok(filled)
}

/// Detects 2D visual writing slots, comb grids, multi-row tables, and checkboxes from 8-bit grayscale luma.
#[uniffi::export]
pub fn capture_detect_form_layout(
    luma: Vec<u8>,
    width: u32,
    height: u32,
    pieces_json: String,
    page: u32,
) -> Result<String> {
    let pieces: Vec<OcrPieceBox> = serde_json::from_str(&pieces_json)
        .map_err(|_| Error::Conversion("Invalid OCR pieces".into()))?;
    serialize(&detect_form_layout(&luma, width, height, &pieces, page))
}

/// Snaps `/v1/forms/fill-image` placements onto exact pixel contours, combs, cells, and baselines.
#[uniffi::export]
pub fn capture_snap_image_fill(
    luma: Vec<u8>,
    width: u32,
    height: u32,
    pieces_json: String,
    planned_json: String,
    page: u32,
) -> Result<String> {
    let pieces: Vec<OcrPieceBox> = serde_json::from_str(&pieces_json)
        .map_err(|_| Error::Conversion("Invalid OCR pieces".into()))?;
    let planned: Vec<PlannedImageFillItem> = serde_json::from_str(&planned_json)
        .map_err(|_| Error::Conversion("Invalid planned fills".into()))?;
    serialize(&snap_planned_fills(&luma, width, height, &pieces, &planned, page))
}
