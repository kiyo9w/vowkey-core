use std::collections::BTreeMap;

use vowkey_capture::{
    aamva::{AamvaCard, AamvaError},
    barcode::{BarcodeError, DecodedBarcode},
    cccd::{CccdCard, CccdError},
    decision::Plan,
    decision_form::{ChosenField, FormPlan},
    document::{CapturedDocument, extract_document_details},
    file_fill::{
        FileFillError, FileFillReport, fill_docx_bytes, fill_hwpx_bytes, fill_xlsx_bytes,
    },
    matcher::{
        FieldMatch, FormFieldInput, classify_field, fill_form_fields, fill_form_fields_chosen,
        format_detail_for_field as matcher_format_detail_for_field,
    },
    mrz::{Mrz, MrzError},
    office::{classify_office, reading_from_office},
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

/// Starts reading a document through Decision, the decision model that says what each printed piece of
/// it is. `reading_json` is what the reader prints for a file, each piece with its place on the page;
/// `per_request` is how many questions go in one request, or 0 for the usual number. Returns the plan to carry through the rounds that follow, as JSON.
#[vowkey_ffi::wasm_export]
pub fn decision_begin(reading_json: String, per_request: u32) -> String {
    Plan::from_reading_json(&reading_json)
        .ok()
        .map(|mut plan| {
            plan.per_request = per_request as usize;
            plan
        })
        .and_then(|plan| serde_json::to_string(&plan).ok())
        .unwrap_or_else(|| "{}".to_string())
}

/// The requests of one round of questions for Decision, as a JSON array: each is the body of a call to
/// Jev's `/v1/systemone`, without the model. The first round asks what group each piece belongs
/// to; the second, once `decision_take_first_answers` has the answers, asks which detail it holds.
#[vowkey_ffi::wasm_export]
pub fn decision_requests(plan_json: String, second_round: bool) -> String {
    let plan: Plan = serde_json::from_str(&plan_json).unwrap_or_default();
    let requests = if second_round { plan.second_requests() } else { plan.first_requests() };
    serde_json::to_string(&requests).unwrap_or_else(|_| "[]".to_string())
}

/// Takes in Decision's answers to the first round, a JSON array of responses, and returns the plan.
#[vowkey_ffi::wasm_export]
pub fn decision_take_first_answers(plan_json: String, responses_json: String) -> String {
    let mut plan: Plan = serde_json::from_str(&plan_json).unwrap_or_default();
    let responses: Vec<serde_json::Value> = serde_json::from_str(&responses_json).unwrap_or_default();
    plan.take_first_answers(&responses);
    serde_json::to_string(&plan).unwrap_or_else(|_| "{}".to_string())
}

/// The details a document gave: what its machine-readable zone and barcodes carry (`extra_text` is
/// the text of a barcode decoded from the file), then what Decision placed from the second round's
/// responses, a JSON array.
#[vowkey_ffi::wasm_export]
pub fn decision_finish(
    plan_json: String,
    responses_json: String,
    extra_text: String,
    current_year: u16,
) -> CapturedDocument {
    let mut plan: Plan = serde_json::from_str(&plan_json).unwrap_or_default();
    let responses: Vec<serde_json::Value> = serde_json::from_str(&responses_json).unwrap_or_default();
    if !extra_text.is_empty() {
        plan.text.push('\n');
        plan.text.push_str(&extra_text);
    }
    plan.finish(&responses, current_year)
}

fn normalize_field_json(field: &mut serde_json::Value) {
    let Some(obj) = field.as_object_mut() else {
        return;
    };
    for key in [
        "id",
        "name",
        "label",
        "placeholder",
        "autocomplete",
        "input_type",
        "section",
        "format",
    ] {
        match obj.get(key) {
            None | Some(serde_json::Value::Null) => {
                obj.insert(key.to_string(), serde_json::Value::String(String::new()));
            }
            _ => {}
        }
    }
    if matches!(obj.get("max_length"), None | Some(serde_json::Value::Null)) {
        obj.insert("max_length".to_string(), serde_json::json!(0));
    }
    if matches!(obj.get("op_ignore"), None | Some(serde_json::Value::Null)) {
        obj.insert("op_ignore".to_string(), serde_json::Value::Bool(false));
    }
    if matches!(obj.get("options"), None | Some(serde_json::Value::Null)) {
        obj.insert("options".to_string(), serde_json::json!([]));
    }
}

fn normalize_fields_in_object(root: &mut serde_json::Value) {
    if let Some(arr) = root.get_mut("fields").and_then(serde_json::Value::as_array_mut) {
        for item in arr {
            normalize_field_json(item);
        }
    }
}

fn col_index_to_letters(mut col: u32) -> String {
    let mut chars = Vec::new();
    loop {
        chars.push((b'A' + (col % 26) as u8) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    chars.into_iter().rev().collect()
}

/// Starts choosing the details a form asks for through a Decision model. `request_json` is
/// `{"fields": [...], "held": [...]}`: the form's fields and the keys of the details the profile
/// holds. Only labels and key names are asked about, never values. Returns the plan, as JSON.
#[vowkey_ffi::wasm_export]
pub fn decision_form_begin(request_json: String, per_request: u32) -> String {
    #[derive(serde::Deserialize)]
    struct Request {
        #[serde(default)]
        fields: Vec<FormFieldInput>,
        #[serde(default)]
        held: Vec<String>,
        #[serde(default)]
        offset: usize,
    }
    serde_json::from_str::<serde_json::Value>(&request_json)
        .ok()
        .and_then(|mut val| {
            normalize_fields_in_object(&mut val);
            serde_json::from_value::<Request>(val).ok()
        })
        .map(|r| {
            let mut plan = FormPlan::new_with_offset(&r.fields, &r.held, r.offset);
            plan.per_request = per_request as usize;
            plan
        })
        .and_then(|plan| serde_json::to_string(&plan).ok())
        .unwrap_or_else(|| "{}".to_string())
}

/// Extracts layout pieces and plain text from a `.docx`, `.xlsx` or `.hwpx` archive in memory,
/// returning a JSON reading compatible with `decision_begin` and `DocumentCaptureService`, or
/// `"{}"` when the bytes cannot be parsed as a supported office archive.
#[vowkey_ffi::wasm_export]
pub fn extract_office_pieces(bytes: Vec<u8>, file_name: String) -> String {
    let Some(reading) = reading_from_office(&bytes, &file_name) else {
        return "{}".to_string();
    };
    let page_count = reading.pages.len();
    let mut out_pages = Vec::with_capacity(page_count);
    let mut flat_pieces = Vec::new();
    let mut lines: Vec<String> = Vec::new();

    for page in &reading.pages {
        let mut page_pieces = Vec::with_capacity(page.pieces.len());
        let mut current_row: Option<u32> = None;
        let mut row_tokens: Vec<&str> = Vec::new();

        for piece in &page.pieces {
            let confidence = piece.confidence.unwrap_or(1.0);
            let locator = match (piece.row, piece.column) {
                (Some(r), Some(c)) => {
                    let mut loc = serde_json::json!({
                        "kind": "cell",
                        "page": page.index,
                        "row": r,
                        "column": c,
                    });
                    if page.sheet {
                        loc["a1"] = serde_json::Value::String(format!(
                            "{}{}",
                            col_index_to_letters(c),
                            r + 1
                        ));
                    }
                    Some(loc)
                }
                _ => None,
            };

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

            let mut piece_json = serde_json::json!({
                "text": piece.text,
                "x": piece.x,
                "y": piece.y,
                "w": piece.w,
                "h": piece.h,
                "confidence": confidence,
            });
            if let Some(r) = piece.row {
                piece_json["row"] = serde_json::json!(r);
            }
            if let Some(c) = piece.column {
                piece_json["column"] = serde_json::json!(c);
            }
            if let Some(ref loc) = locator {
                piece_json["locator"] = loc.clone();
            }

            let mut flat = piece_json.clone();
            flat["page"] = serde_json::json!(page.index);
            flat_pieces.push(flat);
            page_pieces.push(piece_json);
        }

        if !row_tokens.is_empty() {
            lines.push(row_tokens.join("\t"));
        }

        out_pages.push(serde_json::json!({
            "index": page.index,
            "aspect": page.aspect,
            "cells": page.cells,
            "sheet": page.sheet,
            "pieces": page_pieces,
        }));
    }

    serde_json::to_string(&serde_json::json!({
        "text": lines.join("\n"),
        "pageCount": page_count,
        "page_count": page_count,
        "pages": out_pages,
        "pieces": flat_pieces,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

/// Classifies a `.docx`, `.xlsx` or `.hwpx` archive as `"form"`, `"document"` or `"ambiguous"`,
/// returning JSON `{"kind": ..., "blankSlots": ..., "populatedPairs": ...}`.
#[vowkey_ffi::wasm_export]
pub fn classify_office_bytes(bytes: Vec<u8>, file_name: String) -> String {
    let classification = classify_office(&bytes, &file_name);
    serde_json::to_string(&classification).unwrap_or_else(|_| {
        r#"{"kind":"ambiguous","blankSlots":0,"populatedPairs":0}"#.to_string()
    })
}

/// The requests of one round of questions about a form, as a JSON array, as `decision_requests`.
#[vowkey_ffi::wasm_export]
pub fn decision_form_requests(plan_json: String, second_round: bool) -> String {
    let plan: FormPlan = serde_json::from_str(&plan_json).unwrap_or_default();
    let requests = if second_round { plan.second_requests() } else { plan.first_requests() };
    serde_json::to_string(&requests).unwrap_or_else(|_| "[]".to_string())
}

/// Takes in the model's answers to the first round about a form, and returns the plan.
#[vowkey_ffi::wasm_export]
pub fn decision_form_take_first_answers(plan_json: String, responses_json: String) -> String {
    let mut plan: FormPlan = serde_json::from_str(&plan_json).unwrap_or_default();
    let responses: Vec<serde_json::Value> = serde_json::from_str(&responses_json).unwrap_or_default();
    plan.take_first_answers(&responses);
    serde_json::to_string(&plan).unwrap_or_else(|_| "{}".to_string())
}

/// The detail and owner chosen for each field, from the second round's responses.
#[vowkey_ffi::wasm_export]
pub fn decision_form_choices(plan_json: String, responses_json: String) -> Vec<ChosenField> {
    let plan: FormPlan = serde_json::from_str(&plan_json).unwrap_or_default();
    let responses: Vec<serde_json::Value> = serde_json::from_str(&responses_json).unwrap_or_default();
    plan.finish(&responses)
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
    /// What a Decision model chose for fields, from `decision_form_choices`. A field with a choice
    /// takes it; the others are matched by keyword.
    #[serde(default)]
    pub choices: Vec<ChosenField>,
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
        matches: if request.choices.is_empty() {
            fill_form_fields(&request.fields, &profiles, request.explicit_fill)
        } else {
            fill_form_fields_chosen(&request.fields, &profiles, request.explicit_fill, &request.choices)
        },
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
    /// What a Decision model chose for fields, from `decision_form_choices`. A field with a choice
    /// takes it; the others are matched by keyword.
    #[serde(default)]
    pub choices: Vec<ChosenField>,
}

/// Matches every field in a form and fills it from the profile, in the order the fields were given.
#[vowkey_ffi::wasm_export]
pub fn fill_fields_from_profile(request: ProfileFillRequest) -> FormFillResult {
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), profile::profile_details(&request.profile));
    FormFillResult {
        matches: if request.choices.is_empty() {
            fill_form_fields(&request.fields, &profiles, request.explicit_fill)
        } else {
            fill_form_fields_chosen(&request.fields, &profiles, request.explicit_fill, &request.choices)
        },
    }
}

fn default_explicit_fill() -> bool {
    true
}

/// Form fields and role-keyed profile maps (`applicant`, `spouse`, `dependent`, `employer`,
/// `preparer`) passed to `fill_form_with_profiles`.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct MultiProfileFillRequest {
    /// Form fields collected from the page.
    #[serde(default)]
    pub fields: Vec<FormFieldInput>,
    /// Role-keyed profile detail maps.
    #[serde(default)]
    pub profiles: BTreeMap<String, BTreeMap<String, String>>,
    /// False only for a passive scan. Defaults to `true`.
    #[serde(default = "default_explicit_fill")]
    pub explicit_fill: bool,
    /// Optional Decision choices for fields.
    #[serde(default)]
    pub choices: Vec<ChosenField>,
}

/// Accepts either a `MultiProfileFillRequest` object/Map or a JSON string encoding it.
#[vowkey_ffi::wasm_record(input)]
#[cfg_attr(feature = "wasm", tsify(type = "MultiProfileFillRequest | string"))]
pub struct MultiProfileFillInput(pub MultiProfileFillRequest);

impl<'de> serde::Deserialize<'de> for MultiProfileFillInput {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct MultiProfileVisitor;

        impl<'de> serde::de::Visitor<'de> for MultiProfileVisitor {
            type Value = MultiProfileFillInput;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a MultiProfileFillRequest object or JSON string")
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                let req = serde_json::from_str::<serde_json::Value>(v)
                    .ok()
                    .and_then(|mut val| {
                        normalize_fields_in_object(&mut val);
                        serde_json::from_value::<MultiProfileFillRequest>(val).ok()
                    })
                    .unwrap_or(MultiProfileFillRequest {
                        fields: Vec::new(),
                        profiles: BTreeMap::new(),
                        explicit_fill: true,
                        choices: Vec::new(),
                    });
                Ok(MultiProfileFillInput(req))
            }

            fn visit_string<E>(self, v: String) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                self.visit_str(&v)
            }

            fn visit_map<M>(self, map: M) -> Result<Self::Value, M::Error>
            where
                M: serde::de::MapAccess<'de>,
            {
                let req = <MultiProfileFillRequest as serde::Deserialize>::deserialize(
                    serde::de::value::MapAccessDeserializer::new(map),
                )?;
                Ok(MultiProfileFillInput(req))
            }
        }

        deserializer.deserialize_any(MultiProfileVisitor)
    }
}

/// Matches every field in a form against role-keyed profile maps (`applicant`, `spouse`,
/// `dependent`, `employer`, `preparer`), accepting either a JSON string or a request object.
#[vowkey_ffi::wasm_export]
pub fn fill_form_with_profiles(request: MultiProfileFillInput) -> FormFillResult {
    let req = request.0;
    FormFillResult {
        matches: if req.choices.is_empty() {
            fill_form_fields(&req.fields, &req.profiles, req.explicit_fill)
        } else {
            fill_form_fields_chosen(&req.fields, &req.profiles, req.explicit_fill, &req.choices)
        },
    }
}

/// Object-argument form of `format_detail_for_field`.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FormatDetailRequest {
    /// Target form control metadata.
    pub field: FormFieldInput,
    /// Canonical detail key (`attribute` or `detail_key`).
    #[serde(alias = "detail_key")]
    pub attribute: String,
    /// Raw detail value when supplied directly.
    #[serde(default)]
    pub value: String,
    /// Optional profile details for companion lookups (`name.*.romaji`, country codes, etc.).
    #[serde(default)]
    pub details: BTreeMap<String, String>,
}

/// Accepts either a `FormFieldInput` (3-argument call) or a `FormatDetailRequest` (1-argument call).
#[derive(serde::Deserialize)]
#[serde(untagged)]
#[vowkey_ffi::wasm_record(input)]
#[cfg_attr(feature = "wasm", tsify(type = "FormFieldInput | FormatDetailRequest"))]
pub enum FormatDetailFieldArg {
    /// Single-object `{ field, attribute, value, details? }` call.
    Request(FormatDetailRequest),
    /// `(field, detail_key, details)` 3-argument call.
    Field(FormFieldInput),
}

/// Formats a canonical profile detail for a specific target form control (date pattern, Japanese
/// era `和暦`, `<select>` option value, domestic phone slice, script/case variant, or sex marker).
#[vowkey_ffi::wasm_export]
pub fn format_detail_for_field(
    field: FormatDetailFieldArg,
    detail_key: Option<String>,
    details: Option<ProfileDetailsInput>,
) -> String {
    match field {
        FormatDetailFieldArg::Request(req) => {
            let mut map = req.details;
            if !req.value.is_empty() && !req.attribute.is_empty() {
                map.entry(req.attribute.clone()).or_insert(req.value);
            }
            if let Some(extra) = details {
                for (k, v) in extra.details {
                    map.entry(k).or_insert(v);
                }
            }
            let key = detail_key.unwrap_or(req.attribute);
            matcher_format_detail_for_field(&req.field, &key, &map)
        }
        FormatDetailFieldArg::Field(input) => {
            let key = detail_key.unwrap_or_default();
            let map = details.map(|d| d.details).unwrap_or_default();
            matcher_format_detail_for_field(&input, &key, &map)
        }
    }
}
