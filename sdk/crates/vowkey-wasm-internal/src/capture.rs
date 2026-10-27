use std::collections::BTreeMap;

use vowkey_capture::{
    aamva::{AamvaCard, AamvaError},
    barcode::{BarcodeError, DecodedBarcode},
    cccd::{CccdCard, CccdError},
    document::{CapturedDocument, extract_document_details},
    file_fill::{
        FileFillError, FileFillReport, fill_docx_bytes, fill_hwpx_bytes, fill_xlsx_bytes,
    },
    matcher::{FieldMatch, FormFieldInput, classify_field, fill_form_fields},
    mrz::{Mrz, MrzError},
    profile::{self, ProfileFields},
};

/// Reads the lines of a machine-readable zone read from a document, with the letters and digits
/// that OCR confuses corrected by position and by the check digits.
///
/// # Arguments
/// - `lines` - two lines of 36 or 44 characters, or three of 30
///
/// # Returns
/// - `Ok(Mrz)` with every field and every check digit; `Mrz.checks` says which digits pass
/// - `Err(MrzError)` if the lines are not one of the five layouts
#[vowkey_ffi::wasm_export]
pub fn read_mrz(lines: Vec<String>) -> Result<Mrz, MrzError> {
    Mrz::parse_ocr(&lines)
}

/// The machine-readable zones found in a page of text.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct MrzZones {
    /// Each zone as its lines, ready for `read_mrz`, in the order they appear on the page.
    pub zones: Vec<Vec<String>>,
}

/// Finds the machine-readable zones in text that OCR recognized from a page.
#[vowkey_ffi::wasm_export]
pub fn find_mrz(text: String) -> MrzZones {
    MrzZones {
        zones: vowkey_capture::mrz::find_mrz(&text),
    }
}

/// Reads an AAMVA PDF417 barcode payload from a North American driver licence or ID card.
#[vowkey_ffi::wasm_export]
pub fn read_aamva(raw: String) -> Result<AamvaCard, AamvaError> {
    AamvaCard::parse(&raw)
}

/// Reads a Vietnamese citizen identity card (CCCD / Căn cước) QR payload.
#[vowkey_ffi::wasm_export]
pub fn read_cccd(raw: String) -> Result<CccdCard, CccdError> {
    CccdCard::parse(&raw)
}

/// Decodes a PDF417 or QR barcode from PNG or JPEG image bytes and parses its document payload.
#[vowkey_ffi::wasm_export]
pub fn decode_document_barcode(image_bytes: Vec<u8>) -> Result<DecodedBarcode, BarcodeError> {
    vowkey_capture::barcode::decode_barcode(&image_bytes)
}

/// Extracts canonical profile details from document text, including MRZ, AAMVA, CCCD and
/// `label: value` pairs, with derived script and calendar companions. `current_year` places a
/// two-digit birth year in its century.
#[vowkey_ffi::wasm_export]
pub fn capture_document_text(text: String, current_year: u16) -> CapturedDocument {
    extract_document_details(&text, current_year)
}

/// Matches a single form field to its canonical attribute, Chromium type and owner role.
#[vowkey_ffi::wasm_export]
pub fn match_form_field(field: FormFieldInput) -> FieldMatch {
    classify_field(&field)
}

/// Profile detail map passed across the WebAssembly boundary.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct ProfileDetailsInput {
    /// Map of canonical profile attributes (`name.full`, `id.passport.number`, etc.) to values.
    pub details: BTreeMap<String, String>,
}

/// List of form fields and profile details passed to `fill_form_with_profile`.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FormFillRequest {
    /// Form fields collected from the page.
    pub fields: Vec<FormFieldInput>,
    /// Applicant profile details.
    pub applicant_details: BTreeMap<String, String>,
    /// False only for a passive scan. An explicit fill is never held back by form size.
    pub explicit_fill: bool,
}

/// Matches and fills a list of form fields from the supplied applicant profile details.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FormFillResult {
    /// The matched and formatted fields in the order they were given.
    pub matches: Vec<FieldMatch>,
}

/// Matches every field in a form and formats values from the supplied applicant profile details.
#[vowkey_ffi::wasm_export]
pub fn fill_form_with_profile(request: FormFillRequest) -> FormFillResult {
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), request.applicant_details);
    FormFillResult {
        matches: fill_form_fields(&request.fields, &profiles, request.explicit_fill),
    }
}

/// Filled office file bytes and summary report returned to WebAssembly callers.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct WasmFilledFile {
    /// Updated file bytes ready to download or save.
    pub bytes: Vec<u8>,
    /// Summary of filled cells or fields.
    pub report: FileFillReport,
}

/// Fills a Word `.docx` document in memory from the supplied profile details.
#[vowkey_ffi::wasm_export]
pub fn fill_docx_with_profile(
    docx_bytes: Vec<u8>,
    profile: ProfileDetailsInput,
) -> Result<WasmFilledFile, FileFillError> {
    let (bytes, report) = fill_docx_bytes(&docx_bytes, &profile.details)?;
    Ok(WasmFilledFile { bytes, report })
}

/// Fills an Excel `.xlsx` workbook in memory from the supplied profile details.
#[vowkey_ffi::wasm_export]
pub fn fill_xlsx_with_profile(
    xlsx_bytes: Vec<u8>,
    profile: ProfileDetailsInput,
) -> Result<WasmFilledFile, FileFillError> {
    let (bytes, report) = fill_xlsx_bytes(&xlsx_bytes, &profile.details)?;
    Ok(WasmFilledFile { bytes, report })
}

/// Fills a Korean `.hwpx` document in memory from the supplied profile details.
#[vowkey_ffi::wasm_export]
pub fn fill_hwpx_with_profile(
    hwpx_bytes: Vec<u8>,
    profile: ProfileDetailsInput,
) -> Result<WasmFilledFile, FileFillError> {
    let (bytes, report) = fill_hwpx_bytes(&hwpx_bytes, &profile.details)?;
    Ok(WasmFilledFile { bytes, report })
}

/// Every detail an Identity item holds, by canonical key: its own fields, then its custom fields,
/// with the details that follow from them.
#[vowkey_ffi::wasm_export]
pub fn profile_details(profile: ProfileFields) -> ProfileDetailsInput {
    ProfileDetailsInput {
        details: profile::profile_details(&profile),
    }
}

/// The details an Identity item holds, without the ones that follow from them.
#[vowkey_ffi::wasm_export]
pub fn profile_stored_details(profile: ProfileFields) -> ProfileDetailsInput {
    ProfileDetailsInput {
        details: profile::stored_details(&profile),
    }
}

/// The Identity item with `details` added: each as a custom field, and in the Identity fields
/// that have a home for it.
#[vowkey_ffi::wasm_export]
pub fn update_profile(profile: ProfileFields, details: ProfileDetailsInput) -> ProfileFields {
    profile::update_profile(&profile, &details.details)
}

/// What a person calls a detail, such as "Residence card number" for `id.residence_card.number`.
#[vowkey_ffi::wasm_export]
pub fn detail_label(key: String) -> String {
    profile::detail_label(&key)
}

/// Form fields and the profile whose details fill them.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct ProfileFillRequest {
    /// Form fields collected from the page.
    pub fields: Vec<FormFieldInput>,
    /// The profile to fill them from.
    pub profile: ProfileFields,
    /// False only for a passive scan. An explicit fill is never held back by form size.
    pub explicit_fill: bool,
}

/// Matches every field in a form and fills it from the profile, in the order the fields were given.
#[vowkey_ffi::wasm_export]
pub fn fill_fields_from_profile(request: ProfileFillRequest) -> FormFillResult {
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), profile::profile_details(&request.profile));
    FormFillResult {
        matches: fill_form_fields(&request.fields, &profiles, request.explicit_fill),
    }
}
