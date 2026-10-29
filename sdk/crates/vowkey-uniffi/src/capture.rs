//! Shared document recognition plans for native clients. Images and network authorization stay in
//! the client; only printed text and choice responses cross this boundary.

use std::collections::BTreeMap;

use vowkey_capture::{
    decision_form::{ChosenField, FormPlan},
    matcher::{FormFieldInput, fill_form_fields, fill_form_fields_chosen},
};
use vowkey_capture::{decision::Plan, document::extract_document_details};

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
