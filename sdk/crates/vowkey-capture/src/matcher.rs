//! Matches form fields to canonical profile details and formats values for each field.
//!
//! Combines:
//! - Chromium's autocomplete precedence and field-type taxonomy;
//! - 1Password Brain's clue-scoring model (positive score required, `data-op-ignore` avoider,
//!   close-call marker on score-1 or tied clues);
//! - Dashlane's identity recipes (passport, driver licence, national ID, SSN / tax ID, split
//!   birth/issue/expiry dates);
//! - Multilingual label patterns across East Asia (`ja`, `ko`, `zh`), South and Southeast Asia
//!   (`vi`, `th`, `id`, `ms`, `tl`, `hi`), Europe (`de`, `fr`, `es`, `it`, `nl`, `pt`, `ru`, `pl`,
//!   `tr`) and the Americas.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Deserializer, Serialize};

use crate::{
    format::{
        kana_to_hepburn, parse_e164_phone, to_fullwidth_katakana, to_hiragana, to_wareki,
        to_zengin_halfwidth_kana,
    },
    normalize::{CountryInfo, fold, lookup_country, lookup_country_option},
};

fn deserialize_string_or_null<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

fn deserialize_vec_or_null<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Vec<String>>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Deserialize)]
struct RawChromiumRule {
    attribute: String,
    chrome_type: String,
    positive_pattern: String,
    negative_pattern: Option<String>,
    match_label: bool,
    match_name: bool,
}

struct CompiledChromiumRule {
    attribute: String,
    chrome_type: String,
    positive: Regex,
    negative: Option<Regex>,
    match_label: bool,
    match_name: bool,
}

static CHROMIUM_RULES: Lazy<Vec<CompiledChromiumRule>> = Lazy::new(|| {
    let raw: Vec<RawChromiumRule> =
        serde_json::from_str(include_str!("chromium_patterns.json")).unwrap_or_default();
    raw.into_iter()
        .filter_map(|r| {
            let positive = RegexBuilder::new(&r.positive_pattern)
                .case_insensitive(true)
                .build()
                .ok()?;
            let negative = r.negative_pattern.and_then(|neg| {
                RegexBuilder::new(&neg).case_insensitive(true).build().ok()
            });
            Some(CompiledChromiumRule {
                attribute: r.attribute,
                chrome_type: r.chrome_type,
                positive,
                negative,
                match_label: r.match_label,
                match_name: r.match_name,
            })
        })
        .collect()
});

/// One control read from a web form, PDF, Word table or spreadsheet.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FormFieldInput {
    /// Element `id` or widget identifier.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub id: String,
    /// Element `name` or `pdf_field` name.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub name: String,
    /// Visible label or nearby caption text.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub label: String,
    /// Placeholder or example text.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub placeholder: String,
    /// HTML `autocomplete` attribute, when present.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub autocomplete: String,
    /// Input control type (`text`, `email`, `tel`, `password`, `select-one`, `textarea`).
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub input_type: String,
    /// Enclosing section heading or `<fieldset>` legend.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub section: String,
    /// Format hint or instructions next to the field.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    #[serde(deserialize_with = "deserialize_string_or_null")]
    #[cfg_attr(feature = "wasm", tsify(type = "string"))]
    pub format: String,
    /// HTML `pattern`, when present.
    #[serde(default, deserialize_with = "deserialize_string_or_null")]
    pub pattern: String,
    /// HTML `maxlength`, or 0 when unset.
    #[serde(default)]
    pub max_length: i32,
    /// HTML `form` attribute, or empty when the control belongs to its ancestor form.
    #[serde(default, deserialize_with = "deserialize_string_or_null")]
    pub form: String,
    /// True when the control carries `data-op-ignore`.
    #[cfg_attr(not(feature = "wasm"), serde(default))]
    pub op_ignore: bool,
    /// Option values or labels for `<select>` and radio controls.
    #[serde(default, deserialize_with = "deserialize_vec_or_null")]
    pub options: Vec<String>,
}

/// The detail chosen for a form field, with its owner role, Chromium family and formatted value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct FieldMatch {
    /// Canonical Vowkey attribute (`name.full`, `id.passport.number`, `bank.code` and so on), or
    /// empty when the field should be left alone.
    pub attribute: String,
    /// Corresponding Chromium `FieldType` (`NAME_FULL`, `EMAIL_ADDRESS`, `UNKNOWN_TYPE`, etc.).
    pub chrome_type: String,
    /// Whose profile the field asks for (`applicant`, `spouse`, `dependent`, `employer`,
    /// `landlord`, `household_head`, `preparer`, `guarantor`).
    pub owner: String,
    /// Clue score (> 0 for a match).
    pub score: i32,
    /// Section this field was placed in. Fields that share a section are one identity, card or
    /// address; a different id is a different one.
    #[serde(default)]
    pub section_id: u32,
    /// Formatted value ready to write into the control, when a profile has the detail.
    pub value: Option<String>,
}

/// Matches a single field to its canonical attribute, Chromium type and owner role.
pub fn classify_field(field: &FormFieldInput) -> FieldMatch {
    if field.op_ignore || is_ignored_control(field) {
        let mut out = empty_match();
        if is_official_only(field) {
            out.owner = "official_only".to_string();
        }
        return out;
    }

    if let Some((owner, attribute)) = declared_field_binding(&field.name) {
        return FieldMatch {
            attribute: attribute.to_string(),
            chrome_type: "UNKNOWN_TYPE".to_string(),
            owner: owner.to_string(),
            score: 10,
            section_id: 0,
            value: None,
        };
    }

    let owner = infer_owner(field);

    if let Some((attr, chrome)) = match_autocomplete(&field.autocomplete) {
        let mut attribute = attr.to_string();
        if attribute == "work.employer.name" {
            let label_lower = collapse_cjk_spaces(&field.label.to_lowercase());
            let id_name = format!(
                "{} {}",
                semantic_identifier(&field.id),
                semantic_identifier(&field.name)
            )
            .to_lowercase();
            if let Some((school, _, _)) = match_clues(
                &format!("{label_lower} {id_name}"),
                &label_lower,
                &id_name,
                &field.input_type,
                &owner,
            ) && school == "education.school.name"
            {
                attribute = school.to_string();
            }
        }
        return FieldMatch {
            attribute,
            chrome_type: chrome.to_string(),
            owner,
            score: 10,
            section_id: 0,
            value: None,
        };
    }

    // Notice we do NOT include `field.format` in `combined` because format strings often say
    // "as shown on passport" on a name or birth-place field!
    let label_lower = collapse_cjk_spaces(&field.label.to_lowercase());
    let id_name = format!(
        "{} {}",
        semantic_identifier(&field.id),
        semantic_identifier(&field.name)
    )
    .to_lowercase();
    let combined = format!("{label_lower} {id_name}");
    let has_label = field.label.chars().any(char::is_alphabetic);
    let is_textarea = field.input_type.eq_ignore_ascii_case("textarea");

    if !is_textarea {
        if let Some((era_attr, score)) = classify_japanese_era_control(field, &combined) {
            return FieldMatch {
                attribute: era_attr,
                chrome_type: "UNKNOWN_TYPE".to_string(),
                owner,
                score,
                section_id: 0,
                value: None,
            };
        }
    }

    // 2. High-signal multilingual and document rules. A placeholder only names a field when the
    // page gave it no visible label; otherwise placeholder text is an example, format hint or note.
    if let Some((attr, chrome, score)) =
        match_clues(&combined, &label_lower, &id_name, &field.input_type, &owner)
            .or_else(|| {
                if has_label {
                    return None;
                }
                let placeholder = collapse_cjk_spaces(&field.placeholder.to_lowercase());
                match_clues(&placeholder, &placeholder, "", &field.input_type, &owner)
            })
            .filter(|(attr, _, _)| !is_textarea || is_multiline_attr(attr))
    {
        return FieldMatch {
            attribute: attr.to_string(),
            chrome_type: chrome.to_string(),
            owner,
            score,
            section_id: 0,
            value: None,
        };
    }

    // 3. Chromium's multi-language regex pattern table (with positive and negative patterns).
    if let Some((attr, chrome)) =
        match_chromium_patterns(field).filter(|(attr, _)| !is_textarea || is_multiline_attr(attr))
    {
        return FieldMatch {
            attribute: attr,
            chrome_type: chrome,
            owner,
            score: 4,
            section_id: 0,
            value: None,
        };
    }

    empty_match()
}

/// Value-free bindings shared by prepared web and PDF forms.
fn declared_field_binding(name: &str) -> Option<(&str, &str)> {
    let (owner, attribute) = name.strip_prefix("vowkey:")?.split_once(':')?;
    let attribute = if let Some((attribute, suffix)) = attribute.split_once('#') {
        if suffix.is_empty() || suffix.contains('#') {
            return None;
        }
        attribute
    } else {
        attribute
    };
    if !owner.as_bytes().first()?.is_ascii_lowercase()
        || !owner.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit()
            || matches!(byte, b'_' | b'.'))
        || !attribute.as_bytes().first()?.is_ascii_lowercase()
        || !attribute.contains('.')
        || !attribute.split('.').all(|part| !part.is_empty()
            && part.bytes().all(|byte| byte.is_ascii_lowercase()
                || byte.is_ascii_digit() || byte == b'_'))
    {
        return None;
    }
    Some((owner, attribute))
}

fn is_multiline_attr(attr: &str) -> bool {
    attr.starts_with("address.")
        || matches!(
            attr,
            "work.employer.address" | "emergency.address" | "work.job_description"
                | "bank.account.purpose" | "residence.change.request"
        )
}

/// Classifies every field of one or more forms.
///
/// `explicit_fill` is false for a passive scan: heuristic types are kept only when a form has
/// three distinct fillable types, with Chromium's small-form exceptions. An explicit fill keeps
/// every classified field. Explicit prepared bindings and `autocomplete` types are never removed.
pub fn classify_form_fields(fields: &[FormFieldInput], explicit_fill: bool) -> Vec<FieldMatch> {
    let mut matches: Vec<FieldMatch> = fields.iter().map(classify_field).collect();
    suppress_unanchored_cards(fields, &mut matches);
    let sections = assign_sections(fields, &matches);
    for (matched, section) in matches.iter_mut().zip(sections) {
        matched.section_id = section;
    }
    propagate_section_owners(fields, &mut matches);
    if !explicit_fill {
        suppress_small_forms(fields, &mut matches);
    }
    suppress_incomplete_entities(&mut matches);
    matches
}

/// Fills a form with the detail a Decision model chose for each field and whose it is. A field the
/// model was asked about takes its choice, or is left empty when it chose none; a field it was not
/// asked about keeps what the keyword engine matched. Prepared bindings and recognized
/// `autocomplete` hints still win. A field that asks about a person the profiles do not hold is
/// left empty rather than filled with the applicant's detail.
pub fn fill_form_fields_chosen(
    fields: &[FormFieldInput],
    profiles: &BTreeMap<String, BTreeMap<String, String>>,
    explicit_fill: bool,
    chosen: &[crate::decision_form::ChosenField],
) -> Vec<FieldMatch> {
    let choice_ids = crate::decision_form::choice_ids_for(fields);
    let by_id: BTreeMap<&str, &crate::decision_form::ChosenField> =
        chosen.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut matches = classify_form_fields(fields, explicit_fill);
    for ((field, choice_id), matched) in fields.iter().zip(choice_ids.iter()).zip(matches.iter_mut()) {
        if field.op_ignore
            || is_ignored_control(field)
            || declared_field_binding(&field.name).is_some()
            || match_autocomplete(&field.autocomplete).is_some()
        {
            continue;
        }
        if let Some(choice) = by_id.get(choice_id.as_str()).copied() {
            let lbl_lower = field.label.to_lowercase();
            let id_lower = format!("{} {}", field.name, field.id).to_lowercase();
            let mut chosen_attr = choice.attribute.clone();
            if chosen_attr == "name.given"
                && !has_any(&lbl_lower, &["first name", "first given", "first and middle"])
                && has_any(
                    &lbl_lower,
                    &["other given name", "middle name", "middle initial", "segundo nombre"],
                )
            {
                chosen_attr = "name.middle".to_string();
            } else if matches!(chosen_attr.as_str(), "address.full" | "address.street")
                && has_any(
                    &format!("{lbl_lower} {id_lower}"),
                    &["addressline2", "address_line_2", "addr2"],
                )
                && !has_any(&id_lower, &["addressline1", "address_line_1", "addr1"])
            {
                chosen_attr = "address.building".to_string();
            } else if matches!(
                chosen_attr.as_str(),
                "" | "address.full" | "address.prefecture" | "address.postal" | "address.state"
            ) && (choice.owner.is_empty() || choice.owner == "applicant")
                && has_any(
                    &lbl_lower,
                    &["city, state", "city/state", "cidade/estado", "cidade / estado"],
                )
                && !has_any(&lbl_lower, &["street", "number, street", "line 1", "home address"])
            {
                chosen_attr = "address.city".to_string();
            } else if chosen_attr == "work.employer.name"
                && has_any(
                    &lbl_lower,
                    &[
                        "fee",
                        "fees",
                        "tax borne",
                        "income tax",
                        "pension",
                        "provident",
                        "bonus",
                        "allowance",
                        "deduction",
                        "yes / no",
                        "yes/no",
                        "agm/egm",
                    ],
                )
                && !has_any(
                    &lbl_lower,
                    &["name of employer", "employer's name", "employer name", "company name"],
                )
            {
                chosen_attr.clear();
            } else if matches!(chosen_attr.as_str(), "address.street" | "address.full")
                && has_any(&id_lower, &["roadtype", "type_voie", "blockname", "bis_ter"])
            {
                chosen_attr.clear();
            } else if matches!(chosen_attr.as_str(), "address.street" | "address.full")
                && has_any(&id_lower, &["buildingnumber", "house_number", "hausnummer"])
            {
                chosen_attr = "address.house_number".to_string();
            } else if field.max_length > 0
                && field.max_length <= 2
                && matches!(
                    chosen_attr.as_str(),
                    "id.passport.number" | "id.national.number" | "id.residence_card.number"
                )
            {
                chosen_attr.clear();
            } else if matches!(
                chosen_attr.as_str(),
                "id.passport.number" | "id.national.number" | "id.residence_card.number"
            ) && is_person_name_label(&lbl_lower, &format!("{lbl_lower} {id_lower}"))
            {
                chosen_attr = "name.full".to_string();
            } else if chosen_attr == "id.passport.number"
                && has_any(
                    &lbl_lower,
                    &["有効期限", "満了日", "date of expiration", "expiry date", "expiration date"],
                )
                && !has_any(&lbl_lower, &["番号", "passport no", "passport number"])
            {
                chosen_attr = "id.passport.expiry".to_string();
            } else if has_any(
                &format!("{lbl_lower} {id_lower}"),
                &["個人番号", "マイナンバー", "my_number", "mynumber"],
            ) && chosen_attr != "id.mynumber"
            {
                chosen_attr = "id.mynumber".to_string();
            }

            let effective_owner = if choice.owner.is_empty() {
                if matched.owner == "employer" {
                    "employer".to_string()
                } else {
                    "applicant".to_string()
                }
            } else {
                choice.owner.clone()
            };

            if effective_owner == "employer" {
                chosen_attr = match chosen_attr.as_str() {
                    "contact.phone" | "contact.phone.mobile" | "contact.phone.home" => {
                        "work.employer.phone".to_string()
                    }
                    "address.full" | "address.street" => "work.employer.address".to_string(),
                    "address.postal" => "work.employer.postal".to_string(),
                    "name.full" | "name.full.kanji" | "name.full.latin" | "name.full.kana" => {
                        "work.employer.name".to_string()
                    }
                    "" if matched.attribute.starts_with("work.")
                        || matched.attribute.starts_with("income.")
                        || matched.attribute == "id.employer.ein" =>
                    {
                        matched.attribute.clone()
                    }
                    _ => chosen_attr,
                };
            }

            matched.attribute = chosen_attr;
            matched.owner = effective_owner;
            matched.score = if matched.attribute.is_empty() || matched.owner == "official_only" {
                0
            } else {
                8
            };
            matched.chrome_type = "UNKNOWN_TYPE".to_string();
        }
    }
    let enriched = enrich_profiles(profiles);
    harmonize_date_box_trios(fields, &mut matches);
    for (index, matched) in matches.iter_mut().enumerate() {
        if let Some(details) = resolve_role_profile(&enriched, &matched.owner, &matched.attribute) {
            matched.value = resolve_and_format_value(&fields[index], matched, details);
        }
    }
    deduplicate_paired_phone_slots(fields, &mut matches);
    split_across_boxes(fields, &mut matches, &enriched);
    suppress_truncated_short_boxes(fields, &mut matches);
    matches
}

/// Matches every field in a form and formats values from the supplied profiles (keyed by owner
/// role, with `"applicant"` as the default profile).
pub fn fill_form_fields(
    fields: &[FormFieldInput],
    profiles: &BTreeMap<String, BTreeMap<String, String>>,
    explicit_fill: bool,
) -> Vec<FieldMatch> {
    let enriched = enrich_profiles(profiles);
    let mut matches: Vec<FieldMatch> = classify_form_fields(fields, explicit_fill);
    harmonize_date_box_trios(fields, &mut matches);
    for (index, matched) in matches.iter_mut().enumerate() {
        if let Some(details) = resolve_role_profile(&enriched, &matched.owner, &matched.attribute) {
            matched.value = resolve_and_format_value(&fields[index], matched, details);
        }
    }
    deduplicate_paired_phone_slots(fields, &mut matches);
    split_across_boxes(fields, &mut matches, &enriched);
    suppress_truncated_short_boxes(fields, &mut matches);
    matches
}

/// When a form provides both a dedicated mobile-phone slot (`携帯電話番号` / `Mobile phone`) and a
/// landline/general phone slot (`電話番号` / `Home phone`) for the same person, and the profile only
/// holds one mobile number so both slots resolved to the exact same value, leave the landline slot
/// blank rather than writing the mobile number twice.
fn deduplicate_paired_phone_slots(fields: &[FormFieldInput], matches: &mut [FieldMatch]) {
    let mut mobile_values_by_owner: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for (idx, m) in matches.iter().enumerate() {
        if matches!(m.attribute.as_str(), "contact.phone.mobile" | "contact.phone_mobile")
            && let Some(val) = m.value.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty())
        {
            let digits: String = val.chars().filter(char::is_ascii_digit).collect();
            if digits.len() >= 7 {
                let form = fields.get(idx).map_or("", |f| f.form.as_str()).to_string();
                mobile_values_by_owner
                    .entry((form, m.owner.clone()))
                    .or_default()
                    .push(digits);
            }
        }
    }
    if mobile_values_by_owner.is_empty() {
        return;
    }
    for (idx, m) in matches.iter_mut().enumerate() {
        if matches!(
            m.attribute.as_str(),
            "contact.phone" | "contact.phone.home" | "contact.phone_landline" | "contact.phone_primary"
        ) && let Some(val) = m.value.as_ref()
        {
            let form = fields.get(idx).map_or("", |f| f.form.as_str()).to_string();
            if let Some(mobile_digits) = mobile_values_by_owner.get(&(form, m.owner.clone())) {
                let digits: String = val.chars().filter(char::is_ascii_digit).collect();
                if mobile_digits.contains(&digits) {
                    m.value = None;
                }
            }
        }
    }
}

/// Expands a flat profile map (including `spouse.*`, `dependent.*`, `dependent.2.*`,
/// `household_head.*`, `employer.*`, etc.) into role-keyed maps with companion details derived.
pub fn profiles_from_flat_map(
    profile: &BTreeMap<String, String>,
) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut enriched = profile.clone();
    crate::document::derive_companion_details(&mut enriched);
    let mut profiles: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    const ROLE_PREFIXES: &[&str] = &[
        "spouse",
        "dependent",
        "employer",
        "landlord",
        "household_head",
        "preparer",
        "guarantor",
    ];
    for (k, v) in &enriched {
        for &role in ROLE_PREFIXES {
            if let Some(sub_key) = k.strip_prefix(&format!("{role}.")) {
                let (target_role, clean_sub) = if let Some((idx, tail)) = sub_key.split_once('.')
                    && idx.bytes().all(|b| b.is_ascii_digit())
                {
                    (format!("{role}.{idx}"), tail)
                } else {
                    (role.to_string(), sub_key)
                };
                let role_entry = profiles.entry(target_role).or_default();
                role_entry.insert(clean_sub.to_string(), v.clone());
                if clean_sub == "name" && !role_entry.contains_key("name.full") {
                    role_entry.insert("name.full".to_string(), v.clone());
                }
                if clean_sub == "nationality" && !role_entry.contains_key("person.nationality") {
                    role_entry.insert("person.nationality".to_string(), v.clone());
                }
                if clean_sub == "sex" && !role_entry.contains_key("person.sex") {
                    role_entry.insert("person.sex".to_string(), v.clone());
                }
                if matches!(
                    clean_sub,
                    "relationship"
                        | "relation"
                        | "relation_to_household_head"
                        | "custom.relation_to_household_head"
                        | "custom.relationship"
                        | "custom.relation"
                ) {
                    role_entry
                        .entry("person.relationship".to_string())
                        .or_insert_with(|| v.clone());
                    role_entry
                        .entry("household_head.relation".to_string())
                        .or_insert_with(|| v.clone());
                }
            }
        }
    }
    for (role_name, role_map) in &mut profiles {
        if role_name == "spouse" && !role_map.contains_key("household_head.relation") {
            let inferred = match role_map.get("person.sex").and_then(|s| crate::normalize::sex(s)) {
                Some("female") => "妻",
                Some("male") => "夫",
                _ => "配偶者",
            };
            role_map
                .entry("person.relationship".to_string())
                .or_insert_with(|| inferred.to_string());
            role_map.insert("household_head.relation".to_string(), inferred.to_string());
        } else if role_name.starts_with("dependent")
            && !role_map.contains_key("household_head.relation")
        {
            let inferred = role_map
                .get("person.relationship")
                .cloned()
                .unwrap_or_else(|| "子".to_string());
            role_map
                .entry("person.relationship".to_string())
                .or_insert_with(|| inferred.clone());
            role_map.insert("household_head.relation".to_string(), inferred);
        }
        crate::document::derive_companion_details(role_map);
    }
    profiles.insert("applicant".to_string(), enriched);
    profiles
}

fn enrich_profiles(
    profiles: &BTreeMap<String, BTreeMap<String, String>>,
) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut out: BTreeMap<String, BTreeMap<String, String>> = profiles
        .iter()
        .map(|(role, details)| {
            let mut copy = details.clone();
            if let Some(n) = copy.get("name").cloned()
                && !copy.contains_key("name.full")
            {
                copy.insert("name.full".to_string(), n);
            }
            if let Some(nat) = copy.get("nationality").cloned()
                && !copy.contains_key("person.nationality")
            {
                copy.insert("person.nationality".to_string(), nat);
            }
            if let Some(sx) = copy.get("sex").cloned()
                && !copy.contains_key("person.sex")
            {
                copy.insert("person.sex".to_string(), sx);
            }
            if let Some(rel) = copy.get("relationship").cloned()
                && !copy.contains_key("person.relationship")
            {
                copy.insert("person.relationship".to_string(), rel);
            }
            crate::document::derive_companion_details(&mut copy);
            (role.clone(), copy)
        })
        .collect();
    // Auto-expand flat `spouse.*`, `dependent.2.*`, `household_head.*` keys from `"applicant"`
    // without overwriting any explicitly passed role profiles or keys.
    if let Some(app) = out.get("applicant").cloned() {
        for (role, map) in profiles_from_flat_map(&app) {
            if role == "applicant" {
                continue;
            }
            let target = out.entry(role).or_default();
            for (k, v) in map {
                target.entry(k).or_insert(v);
            }
        }
    }
    out
}

pub(crate) fn applicant_holds_role_detail(owner: &str, attr: &str) -> bool {
    if owner.is_empty() || owner == "applicant" {
        return true;
    }
    if owner == "official_only" {
        return false;
    }
    if attr == "spouse.name" {
        return owner == "spouse";
    }
    if attr.starts_with("family.") {
        return matches!(owner, "parent" | "family");
    }
    if attr.starts_with("emergency.") {
        return matches!(owner, "emergency" | "guarantor");
    }
    if attr.starts_with("work.") || attr.starts_with("income.") || attr == "id.employer.ein" {
        return owner == "employer";
    }
    false
}

fn resolve_role_profile<'a>(
    profiles: &'a BTreeMap<String, BTreeMap<String, String>>,
    owner: &str,
    attr: &str,
) -> Option<&'a BTreeMap<String, String>> {
    if attr.is_empty() || owner == "official_only" {
        return None;
    }
    if owner.is_empty() || owner == "applicant" {
        return profiles.get("applicant");
    }
    if owner == "child" {
        return profiles.get("child").or_else(|| profiles.get("dependent"));
    }
    if owner == "guardian_2" || owner == "parent_2" {
        return profiles.get(owner).or_else(|| profiles.get("spouse"));
    }
    if let Some(slot_str) = owner.strip_prefix("household_member.")
        && let Ok(slot_idx) = slot_str.parse::<usize>()
        && slot_idx >= 1
    {
        let mut member_roles: Vec<&str> = Vec::new();
        for candidate in [
            "spouse",
            "dependent",
            "dependent.2",
            "dependent.3",
            "dependent.4",
            "dependent.5",
        ] {
            if profiles.contains_key(candidate) {
                member_roles.push(candidate);
            }
        }
        let chosen_role = member_roles.get(slot_idx - 1).copied()?;
        return profiles.get(chosen_role);
    }
    profiles.get(owner).or_else(|| {
        let app = profiles.get("applicant")?;
        if applicant_holds_role_detail(owner, attr)
            || app.contains_key(&format!("{owner}.{attr}"))
        {
            Some(app)
        } else {
            None
        }
    })
}

fn is_date_attr_key(attr: &str) -> bool {
    attr.ends_with(".date")
        || attr.ends_with(".expiry")
        || attr.ends_with(".expiry_date")
        || attr.ends_with(".issued")
        || attr.ends_with(".issue_date")
        || matches!(attr, "work.start_date" | "work.end_date")
}

fn is_id_number_attr_key(attr: &str) -> bool {
    matches!(
        attr,
        "id.passport.number"
            | "passport.number"
            | "id.national.number"
            | "id.residence_card.number"
            | "id.driver_license.number"
            | "id.mynumber"
            | "id.ssn"
            | "tax.id"
            | "id.tax.de_steuer_id"
            | "id.card.number"
    )
}

fn is_iso_full_date_str(s: &str) -> bool {
    let mut p = s.trim().split('-');
    matches!(
        (p.next(), p.next(), p.next(), p.next()),
        (Some(y), Some(m), Some(d), None)
            if y.len() == 4
                && m.len() == 2
                && d.len() == 2
                && y.chars().all(|c| c.is_ascii_digit())
                && m.chars().all(|c| c.is_ascii_digit())
                && d.chars().all(|c| c.is_ascii_digit())
    )
}

fn era_base_date_for_context(ctx: &str) -> &'static str {
    let has_issue = has_any(ctx, &["交付", "発行", "issue"]);
    let has_expiry = has_any(ctx, &["有効期限", "満了", "expir"]);
    if has_any(ctx, &["旅券", "パスポート", "passport"]) {
        if has_expiry {
            return "id.passport.expiry";
        }
        return "id.passport.issued";
    }
    if has_any(ctx, &["免許", "driver", "license", "licence"]) {
        if has_expiry {
            return "id.driver_license.expiry";
        }
        return "id.driver_license.issued";
    }
    if has_any(ctx, &["在留", "residence_card", "visa"]) {
        if has_expiry {
            return "visa.expiry";
        }
        return "id.residence_card.issued";
    }
    if has_any(ctx, &["入社", "雇用開始", "start_date", "work.start"]) {
        return "work.start.date";
    }
    if has_any(ctx, &["卒業", "graduation"]) {
        return "education.graduation.date";
    }
    if has_expiry {
        return "id.card.expiry";
    }
    if has_issue {
        return "id.card.issued";
    }
    "birth.date"
}

fn classify_japanese_era_control(field: &FormFieldInput, combined: &str) -> Option<(String, i32)> {
    let era_options_count = field
        .options
        .iter()
        .filter(|opt| {
            ["明治", "大正", "昭和", "平成", "令和"]
                .iter()
                .any(|era| opt.contains(era))
        })
        .count();
    let asks_era_year = has_any(
        combined,
        &[
            "era_year",
            "erayear",
            "gengo_year",
            "wareki_year",
            "和暦年",
            "元号年",
            "年号年",
        ],
    );
    let asks_era_name = era_options_count >= 2
        || has_any(
            combined,
            &[
                "元号",
                "年号",
                "birth_era",
                "dob_era",
                "gengo",
                "wareki_era",
            ],
        );
    if !asks_era_year && !asks_era_name {
        return None;
    }
    let ctx = format!("{combined} {}", field.section.to_lowercase());
    let base = era_base_date_for_context(&ctx);
    let suffix = if asks_era_year { "era_year" } else { "era" };
    let key = if base == "birth.date" {
        format!("birth.{suffix}")
    } else {
        format!("{base}.{suffix}")
    };
    Some((key, 7))
}

fn canonical_date_family(attr: &str) -> Option<String> {
    if is_date_attr_key(attr) {
        return Some(attr.to_string());
    }
    match attr {
        "birth.year" | "birth.month" | "birth.day" | "birth.era_year" => {
            Some("birth.date".to_string())
        }
        other if other.ends_with(".era_year") => {
            Some(other.trim_end_matches(".era_year").to_string())
        }
        other if other.ends_with(".year") || other.ends_with(".month") || other.ends_with(".day") => {
            let prefix = other.rsplit_once('.').map(|(p, _)| p).unwrap_or(other);
            is_date_attr_key(prefix).then(|| prefix.to_string())
        }
        _ => None,
    }
}

/// Harmonizes 3-box date trios (`[2, 2, 4]`, `[4, 2, 2]`, `[2, 2, 2]`, or un-maxlengthed `<input
/// type="number">` / `<select>` / `<input type="text">` controls carrying unambiguous Year/Month/Day
/// unit clues) so every box of the trio shares one canonical date attribute for `split_across_boxes`.
fn harmonize_date_box_trios(fields: &[FormFieldInput], matches: &mut [FieldMatch]) {
    let text_indices: Vec<usize> = (0..fields.len())
        .filter(|&i| !(matches[i].attribute.is_empty() && fields[i].input_type == "checkbox"))
        .collect();
    if text_indices.len() < 3 {
        return;
    }
    let mut k = 0;
    while k + 2 < text_indices.len() {
        let i0 = text_indices[k];
        let i1 = text_indices[k + 1];
        let i2 = text_indices[k + 2];
        let lens = (fields[i0].max_length, fields[i1].max_length, fields[i2].max_length);
        let units = [
            crate::date_format::single_unit_char(&fields[i0]),
            crate::date_format::single_unit_char(&fields[i1]),
            crate::date_format::single_unit_char(&fields[i2]),
        ];
        let mut distinct_units: Vec<char> = units.iter().flatten().copied().collect();
        let unit_count = distinct_units.len();
        distinct_units.sort_unstable();
        distinct_units.dedup();
        let has_distinct_ymd = unit_count >= 2
            && distinct_units.len() == unit_count
            && [i0, i1, i2]
                .iter()
                .all(|&idx| fields[idx].max_length <= 4 || fields[idx].input_type == "select-one");
        let is_length_trio = matches!(lens, (2, 2, 4) | (4, 2, 2) | (2, 2, 2));
        let same_ctx = fields[i0].form == fields[i1].form
            && fields[i1].form == fields[i2].form
            && (fields[i0].section == fields[i1].section
                || fields[i0].section.is_empty()
                || fields[i1].section.is_empty())
            && (fields[i1].section == fields[i2].section
                || fields[i1].section.is_empty()
                || fields[i2].section.is_empty());
        if (is_length_trio || has_distinct_ymd) && same_ctx {
            let f0 = canonical_date_family(&matches[i0].attribute);
            let f1 = canonical_date_family(&matches[i1].attribute);
            let f2 = canonical_date_family(&matches[i2].attribute);
            if [(i0, &f0), (i1, &f1), (i2, &f2)]
                .iter()
                .any(|(idx, family)| !matches[*idx].attribute.is_empty() && family.is_none())
            {
                k += 1;
                continue;
            }
            let prev_era = if k > 0 {
                let prev = text_indices[k - 1];
                matches[prev]
                    .attribute
                    .strip_suffix(".era")
                    .map(|p| {
                        let base = if p == "birth" { "birth.date".to_string() } else { p.to_string() };
                        (base, matches[prev].owner.clone())
                    })
            } else {
                None
            };
            let majority = if let Some((ref d0, ref d1)) = f0.clone().zip(f1.clone())
                && d0 == d1
            {
                Some((d0.clone(), matches[i0].owner.clone()))
            } else if let Some((ref d0, ref d2)) = f0.clone().zip(f2.clone())
                && d0 == d2
            {
                Some((d0.clone(), matches[i0].owner.clone()))
            } else if let Some((ref d1, ref d2)) = f1.clone().zip(f2.clone())
                && d1 == d2
            {
                Some((d1.clone(), matches[i1].owner.clone()))
            } else if distinct_units.len() == 3 {
                prev_era
                    .or_else(|| f0.map(|d| (d, matches[i0].owner.clone())))
                    .or_else(|| {
                        let sec = format!(
                            "{} {} {}",
                            fields[i0].section, fields[i0].label, fields[i1].section
                        )
                        .to_lowercase();
                        if has_any(&sec, &["生年月日", "birth", "dob", "ngày sinh", "생년월일"]) {
                            Some(("birth.date".to_string(), matches[i0].owner.clone()))
                        } else {
                            None
                        }
                    })
            } else if has_distinct_ymd {
                prev_era
            } else {
                None
            };
            if let Some((attr, owner)) = majority {
                let resolved_owner = if owner.is_empty() {
                    infer_owner(&fields[i0])
                } else {
                    owner
                };
                for idx in [i0, i1, i2] {
                    matches[idx].attribute.clone_from(&attr);
                    matches[idx].owner.clone_from(&resolved_owner);
                    if matches[idx].score == 0 {
                        matches[idx].score = 6;
                    }
                }
                k += 3;
                continue;
            }
        }
        k += 1;
    }
}

/// Clears any unsplit ID number or full ISO date that would otherwise be truncated inside a
/// standalone `max_length <= 5` box (e.g. writing `C948` of `C9481023` or `20` of `2030-04-01`).
fn suppress_truncated_short_boxes(fields: &[FormFieldInput], matches: &mut [FieldMatch]) {
    for (field, matched) in fields.iter().zip(matches.iter_mut()) {
        if field.max_length <= 0 || field.max_length > 5 {
            continue;
        }
        let Some(val) = matched.value.as_deref() else {
            continue;
        };
        let max_len = field.max_length as usize;
        if val.chars().count() <= max_len {
            continue;
        }
        if is_id_number_attr_key(&matched.attribute)
            || (is_date_attr_key(&matched.attribute) && is_iso_full_date_str(val))
        {
            matched.value = None;
            matched.attribute.clear();
            matched.score = 0;
        }
    }
}

/// A value that does not fit one box goes across the run of adjacent boxes asking for the same
/// detail, the way Chrome fills a phone number or a postal code split into parts: at the value's own
/// separators when it has one part per box, otherwise by each box's length. A date goes in as year,
/// month and day, in the order the boxes' labels give, with an era year when the form is Japanese
/// and its year box is two characters long.
fn split_across_boxes(
    fields: &[FormFieldInput],
    matches: &mut [FieldMatch],
    profiles: &BTreeMap<String, BTreeMap<String, String>>,
) {
    let mut start = 0;
    while start < matches.len() {
        let attribute = matches[start].attribute.as_str();
        if attribute.is_empty() {
            start += 1;
            continue;
        }
        let mut group_indices = vec![start];
        let mut cursor = start + 1;
        while cursor < matches.len() {
            if matches[cursor].attribute.is_empty() && fields[cursor].input_type == "checkbox" {
                cursor += 1;
                continue;
            }
            let same_section = fields[cursor].section == fields[start].section
                || fields[cursor].section.is_empty()
                || fields[start].section.is_empty();
            if matches[cursor].attribute == attribute
                && fields[cursor].form == fields[start].form
                && matches[cursor].owner == matches[start].owner
                && same_section
            {
                group_indices.push(cursor);
                cursor += 1;
            } else {
                break;
            }
        }
        start = group_indices.last().copied().unwrap_or(start) + 1;
        if group_indices.len() < 2 {
            continue;
        }
        let all_have_max_length = group_indices.iter().all(|&idx| fields[idx].max_length > 0);
        let is_unbounded_date_trio = !all_have_max_length
            && group_indices.len() == 3
            && is_date_attr_key(attribute);
        let is_unbounded_phone_trio = !all_have_max_length
            && group_indices.len() == 3
            && is_phone_attr_key(attribute)
            && group_indices.iter().all(|&idx| {
                let id_n = format!("{} {}", fields[idx].name, fields[idx].id).to_ascii_lowercase();
                id_n.contains("1") || id_n.contains("2") || id_n.contains("3")
                    || id_n.contains("part")
                    || id_n.contains("area")
                    || id_n.contains("prefix")
                    || id_n.contains("line")
            });
        if !all_have_max_length && !is_unbounded_date_trio && !is_unbounded_phone_trio {
            continue;
        }
        let owner = matches[group_indices[0]].owner.as_str();
        let Some(raw) = resolve_role_profile(profiles, owner, attribute)
            .and_then(|details| lookup_raw_detail(attribute, owner, details))
        else {
            continue;
        };
        let preceded_by_era = group_indices[0] > 0
            && matches[group_indices[0] - 1].attribute.ends_with(".era");
        let boxes: Vec<FormFieldInput> = group_indices.iter().map(|&idx| fields[idx].clone()).collect();
        let parts = if is_unbounded_date_trio {
            date_parts(&boxes, raw, preceded_by_era, true)
        } else {
            date_parts(&boxes, raw, preceded_by_era, false)
                .or_else(|| split_parts(&boxes, attribute, raw))
        };
        if let Some(parts) = parts {
            for (idx, part) in group_indices.into_iter().zip(parts) {
                matches[idx].value = Some(part);
            }
        } else if all_have_max_length
            && (10..=80).contains(&boxes[0].max_length)
            && raw.trim().chars().count() <= boxes[0].max_length as usize
        {
            // Multi-row comb continuation boxes (e.g. 2x25-char Name/Address lines): when the value
            // already fits on line 1, leave continuation lines empty instead of repeating line 1.
            let first_label = boxes[0].label.trim();
            let is_continuation = boxes[1..].iter().all(|b| {
                let bl = b.label.trim();
                let bn = b.name.trim().to_ascii_lowercase();
                let clue = format!("{} {} {}", b.label, b.name, b.id).to_lowercase();
                let is_confirmation = has_any(
                    &clue,
                    &[
                        "confirm",
                        "確認",
                        "确认",
                        "확인",
                        "xác nhận",
                        "nhập lại",
                        "re-enter",
                        "reenter",
                        "retype",
                        "repeat",
                        "wiederholen",
                    ],
                );
                !is_confirmation
                    && (bl.is_empty()
                        || bl.eq_ignore_ascii_case(first_label)
                        || bn.starts_with("undefined"))
            });
            if is_continuation {
                for &idx in &group_indices[1..] {
                    matches[idx].value = None;
                }
            }
        }
    }
}

fn is_phone_attr_key(attr: &str) -> bool {
    matches!(
        attr,
        "contact.phone"
            | "contact.phone.mobile"
            | "contact.phone.home"
            | "contact.phone_landline"
            | "contact.phone_primary"
            | "contact.phone_mobile"
            | "work.employer.phone"
            | "emergency.phone"
    )
}

fn date_parts(
    boxes: &[FormFieldInput],
    raw: &str,
    preceded_by_era: bool,
    require_explicit_units: bool,
) -> Option<Vec<String>> {
    if boxes.len() != 3 {
        return None;
    }
    let mut pieces = raw.trim().split('-');
    let year: u16 = pieces.next()?.parse().ok()?;
    let month: u8 = pieces.next()?.parse().ok()?;
    let day: u8 = pieces.next()?.parse().ok()?;
    if pieces.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let japanese = boxes.iter().any(|field| field.label.chars().any(is_cjk_char));
    let wareki_mode = preceded_by_era || boxes.iter().any(crate::date_format::is_wareki);
    let place = |field: &FormFieldInput| -> Option<char> {
        if let Some(u) = crate::date_format::single_unit_char(field) {
            return Some(u);
        }
        let label = field.label.to_lowercase();
        let stripped = label
            .replace("生年月日", "")
            .replace("交付年月日", "")
            .replace("発行年月日", "")
            .replace("満了年月日", "")
            .replace("年月日", "");
        let has_d = stripped.ends_with('日')
            || has_any_word(&stripped, &["day", "dd", "tag", "dia", "día", "jour"]);
        let has_m = stripped.ends_with('月')
            || has_any_word(&stripped, &["month", "mm", "monat", "mes", "mois"]);
        let has_y = stripped.ends_with('年')
            || has_any_word(
                &stripped,
                &["year", "yyyy", "yy", "jahr", "año", "ano", "année"],
            );
        match (has_d, has_m, has_y) {
            (true, false, false) => Some('d'),
            (false, true, false) => Some('m'),
            (false, false, true) => Some('y'),
            _ => None,
        }
    };
    let mut named: Vec<Option<char>> = boxes.iter().map(place).collect();
    let known: Vec<char> = named.iter().flatten().copied().collect();
    let mut dedup_known = known.clone();
    dedup_known.sort_unstable();
    dedup_known.dedup();
    if known.len() == 2 && dedup_known.len() == 2 {
        if let Some(missing) = ['y', 'm', 'd'].into_iter().find(|c| !dedup_known.contains(c)) {
            for slot in &mut named {
                if slot.is_none() {
                    *slot = Some(missing);
                }
            }
        }
    }
    let mut order: Vec<char> = named.iter().flatten().copied().collect();
    order.sort_unstable();
    order.dedup();
    if require_explicit_units && order.len() != 3 {
        return None;
    }
    let order: Vec<char> = if order.len() == 3 {
        named.into_iter().flatten().collect()
    } else if boxes[0].max_length <= 2 && boxes[1].max_length <= 2 && boxes[2].max_length == 4 {
        let us_hint = boxes.iter().any(|b| {
            let l = format!("{} {} {}", b.label, b.placeholder, b.format).to_ascii_lowercase();
            l.contains("mm/dd") || l.contains("mm-dd") || l.contains("month/day")
        });
        if us_hint {
            vec!['m', 'd', 'y']
        } else {
            vec!['d', 'm', 'y']
        }
    } else {
        vec!['y', 'm', 'd']
    };
    Some(
        order
            .iter()
            .zip(boxes)
            .map(|(part, field)| {
                let default_val = match part {
                    'y' if wareki_mode => to_wareki(raw)
                        .map(|wareki| {
                            if field.max_length == 2 && japanese && field.input_type != "number" {
                                format!("{:02}", wareki.year)
                            } else {
                                wareki.year.to_string()
                            }
                        })
                        .unwrap_or_else(|| year.to_string()),
                    'y' if field.max_length == 2 && japanese => to_wareki(raw)
                        .map(|wareki| format!("{:02}", wareki.year))
                        .unwrap_or_else(|| format!("{:02}", year % 100)),
                    'y' if field.max_length == 2 => format!("{:02}", year % 100),
                    'y' => year.to_string(),
                    'm' => format!("{month:02}"),
                    _ => format!("{day:02}"),
                };
                if !field.options.is_empty() {
                    let attr_hint = match part {
                        'y' => "birth.year",
                        'm' => "birth.month",
                        _ => "birth.day",
                    };
                    resolve_select_option(field, attr_hint, &default_val, &default_val)
                        .unwrap_or(default_val)
                } else {
                    default_val
                }
            })
            .collect(),
    )
}

fn split_parts(boxes: &[FormFieldInput], attribute: &str, raw: &str) -> Option<Vec<String>> {
    let domestic_phone;
    let raw = if is_phone_attr_key(attribute)
        && let Some(parts) = parse_e164_phone(raw)
    {
        domestic_phone = parts.national_hyphenated();
        domestic_phone.as_str()
    } else {
        raw.trim()
    };
    // Never slice an ISO calendar date (`YYYY-MM-DD`) across 2 or 4+ boxes as arbitrary digit chunks.
    if boxes.len() != 3 {
        let mut iso = raw.split('-');
        if let (Some(y), Some(m), Some(d), None) = (iso.next(), iso.next(), iso.next(), iso.next()) {
            if y.len() == 4
                && m.len() == 2
                && d.len() == 2
                && y.chars().all(|c| c.is_ascii_digit())
                && m.chars().all(|c| c.is_ascii_digit())
                && d.chars().all(|c| c.is_ascii_digit())
            {
                return None;
            }
        }
    }
    let all_bounded = boxes.iter().all(|b| b.max_length > 0);
    if all_bounded {
        let first = boxes[0].max_length as usize;
        if raw.chars().count() <= first {
            return None;
        }
    }
    let groups: Vec<&str> = raw
        .split(|c: char| c == '-' || c == ' ' || c == '/' || c == '.' || c == 'ー' || c == '－')
        .filter(|group| !group.is_empty())
        .collect();
    if groups.len() == boxes.len()
        && (!all_bounded
            || groups
                .iter()
                .zip(boxes)
                .all(|(group, field)| group.chars().count() <= field.max_length as usize))
    {
        return Some(groups.into_iter().map(str::to_string).collect());
    }
    if !all_bounded {
        return None;
    }
    let mut rest: Vec<char> = groups.concat().chars().collect();
    let mut parts = Vec::with_capacity(boxes.len());
    for (index, field) in boxes.iter().enumerate() {
        let take = if index + 1 == boxes.len() {
            rest.len()
        } else {
            (field.max_length as usize).min(rest.len())
        };
        parts.push(rest.drain(..take).collect::<String>());
    }
    Some(parts)
}

/// Parsed `section-*` and `shipping`/`billing` tokens of an autocomplete attribute.
struct AutocompleteSection {
    name: String,
    mode: &'static str,
}

fn autocomplete_section(raw: &str) -> Option<AutocompleteSection> {
    let mut tokens: Vec<&str> = raw.split_whitespace().collect();
    while matches!(
        tokens.last().copied(),
        Some("webauthn" | "webidentity" | "email-verification-token")
    ) {
        tokens.pop();
    }
    if tokens.is_empty() {
        return None;
    }
    tokens.pop();
    if matches!(
        tokens.last().copied(),
        Some("home" | "work" | "mobile" | "fax" | "pager")
    ) {
        tokens.pop();
    }
    let mode = match tokens.last().copied() {
        Some("shipping") => {
            tokens.pop();
            "shipping"
        }
        Some("billing") => {
            tokens.pop();
            "billing"
        }
        _ => "",
    };
    let name = tokens
        .last()
        .filter(|token| token.starts_with("section-"))
        .map(|token| token["section-".len()..].to_string())
        .unwrap_or_default();
    if name.is_empty() && mode.is_empty() {
        None
    } else {
        Some(AutocompleteSection { name, mode })
    }
}
fn is_card_type(chrome: &str) -> bool {
    chrome.starts_with("CREDIT_CARD_")
}

struct CardParts {
    number: bool,
    month: bool,
    year: bool,
    date: bool,
    cvc: bool,
}

fn note_card(parts: &mut CardParts, chrome: &str) {
    match chrome {
        "CREDIT_CARD_NUMBER" => parts.number = true,
        "CREDIT_CARD_EXP_MONTH" => parts.month = true,
        "CREDIT_CARD_EXP_2_DIGIT_YEAR" | "CREDIT_CARD_EXP_4_DIGIT_YEAR" => parts.year = true,
        "CREDIT_CARD_EXP_DATE_2_DIGIT_YEAR" | "CREDIT_CARD_EXP_DATE_4_DIGIT_YEAR" => {
            parts.date = true
        }
        "CREDIT_CARD_VERIFICATION_CODE" => parts.cvc = true,
        _ => {}
    }
}

/// Chromium's `HasExpiration` is a combined date, or a month together with a year. A card is
/// kept when that expiration sits with a number or a CVC (`CreditCardFieldParser::Parse`).
fn card_anchored(parts: &CardParts) -> bool {
    let expiration = parts.date || (parts.month && parts.year);
    (parts.number || parts.cvc) && expiration
}

fn is_name_type(chrome: &str) -> bool {
    matches!(
        chrome,
        "NAME_FULL"
            | "NAME_FIRST"
            | "NAME_MIDDLE"
            | "NAME_LAST"
            | "NAME_HONORIFIC_PREFIX"
            | "ALTERNATIVE_FULL_NAME"
            | "ALTERNATIVE_FAMILY_NAME"
            | "ALTERNATIVE_GIVEN_NAME"
    )
}

fn is_address_type(chrome: &str) -> bool {
    chrome.starts_with("ADDRESS_HOME_")
}

fn is_phone_type(chrome: &str) -> bool {
    chrome.starts_with("PHONE_")
}

fn type_bit(chrome: &str) -> u16 {
    match chrome {
        "NAME_FULL" => 1,
        "NAME_FIRST" => 2,
        "NAME_MIDDLE" => 4,
        "NAME_LAST" => 8,
        "NAME_HONORIFIC_PREFIX" => 16,
        "ALTERNATIVE_FULL_NAME" => 32,
        "ALTERNATIVE_FAMILY_NAME" => 64,
        "ALTERNATIVE_GIVEN_NAME" => 128,
        "ADDRESS_HOME_LINE1" => 1,
        "ADDRESS_HOME_LINE2" => 2,
        "ADDRESS_HOME_CITY" => 4,
        "ADDRESS_HOME_STATE" => 8,
        "ADDRESS_HOME_ZIP" => 16,
        "ADDRESS_HOME_COUNTRY" => 32,
        _ => 0,
    }
}

/// Section ids follow Chromium's `AssignSections`: autocomplete `section-*` and shipping/billing
/// first, then every card field of a form in one section, then a new section wherever a name or
/// address type repeats.
fn assign_sections(fields: &[FormFieldInput], matches: &[FieldMatch]) -> Vec<u32> {
    let mut sections = vec![0u32; fields.len()];
    let autocomplete = autocomplete_ids(fields);
    for (index, id) in autocomplete.iter().enumerate() {
        if let Some(id) = id {
            sections[index] = *id;
        }
    }
    let mut next = autocomplete.iter().flatten().copied().max().unwrap_or(0) + 1;
    let mut forms: Vec<&str> = fields.iter().map(|field| field.form.as_str()).collect();
    forms.sort_unstable();
    forms.dedup();
    for form in forms {
        for (start, end, anchored) in card_groups(fields, matches, form, &autocomplete) {
            if !anchored {
                continue;
            }
            let id = next;
            next += 1;
            for grouped in start..end {
                if is_card_type(&matches[grouped].chrome_type) {
                    sections[grouped] = id;
                }
            }
        }

        let mut seen_names: u16 = 0;
        let mut seen_address: u16 = 0;
        let mut seen_applicant_core = false;
        let mut current = 0u32;
        let mut current_owner = "applicant";
        for index in 0..fields.len() {
            if fields[index].form != form || sections[index] != 0 {
                continue;
            }
            let chrome = matches[index].chrome_type.as_str();
            let explicit_owner = matches[index].owner.as_str();
            let person_role_change = explicit_owner != "applicant"
                && explicit_owner != "employer"
                && explicit_owner != current_owner;
            let employer_block_start = explicit_owner == "employer"
                && current_owner != "employer"
                && seen_applicant_core;
            let applicant_reset = explicit_owner == "applicant"
                && current_owner != "applicant"
                && field_explicitly_names_applicant(&fields[index]);

            if chrome == "UNKNOWN_TYPE" || is_phone_type(chrome) {
                if person_role_change || employer_block_start || applicant_reset {
                    current = next;
                    next += 1;
                    seen_names = 0;
                    seen_address = 0;
                    current_owner = if applicant_reset { "applicant" } else { explicit_owner };
                } else if current == 0 {
                    current = next;
                    next += 1;
                    current_owner = explicit_owner;
                }
                if current_owner == "applicant"
                    && matches[index].attribute.starts_with("birth.")
                {
                    seen_applicant_core = true;
                }
                sections[index] = current;
                continue;
            }
            let bit = type_bit(chrome);
            let repeats = if is_name_type(chrome) {
                seen_names & bit != 0
            } else if is_address_type(chrome) {
                seen_address & bit != 0
            } else {
                false
            };
            if repeats || person_role_change || employer_block_start || applicant_reset {
                current = next;
                next += 1;
                seen_names = 0;
                seen_address = 0;
                current_owner = if applicant_reset {
                    "applicant"
                } else if explicit_owner != "applicant" {
                    explicit_owner
                } else {
                    "applicant"
                };
            } else if current == 0 {
                current = next;
                next += 1;
                current_owner = explicit_owner;
            }
            if is_name_type(chrome) {
                seen_names |= bit;
            } else if is_address_type(chrome) {
                seen_address |= bit;
                if current_owner == "applicant" {
                    seen_applicant_core = true;
                }
            }
            sections[index] = current;
        }
    }
    sections
}

fn field_explicitly_names_applicant(field: &FormFieldInput) -> bool {
    let context = format!("{} {}", field.section, field.label).to_lowercase();
    has_any(
        &context,
        &[
            "申請人",
            "届出人",
            "本人",
            "applicant",
            "your ",
            "claimant",
            "taxpayer",
            "người khai",
            "người nộp",
            "antragsteller",
            "demandeur",
            "solicitante",
            "pemohon",
        ],
    ) && !has_any(
        &context,
        &[
            "配偶者",
            "spouse",
            "dependent",
            "child",
            "扶養",
            "代理人",
            "取次者",
            "representative",
            "employer",
            "勤務先",
            "世帯主",
            "landlord",
            "賃貸人",
        ],
    )
}

/// Propagates a section's non-applicant role (spouse, dependent, employer, landlord, household
/// head, preparer, guarantor) across subsequent fields in the same section when their own short
/// labels omit the role prefix (such as `Address` or `Telephone` under `Employer` or `Spouse`).
fn propagate_section_owners(fields: &[FormFieldInput], matches: &mut [FieldMatch]) {
    let autocomplete = autocomplete_ids(fields);
    let mut section_groups: BTreeMap<(&str, u32), Vec<usize>> = BTreeMap::new();
    for index in 0..fields.len() {
        if autocomplete[index].is_some() || matches[index].section_id == 0 {
            continue;
        }
        section_groups
            .entry((fields[index].form.as_str(), matches[index].section_id))
            .or_default()
            .push(index);
    }

    let mut forms_with_prior_applicant: BTreeMap<&str, bool> = BTreeMap::new();
    for ((form, _), indexes) in &section_groups {
        let had_applicant = forms_with_prior_applicant.get(form).copied().unwrap_or(false);
        let first_matched = indexes
            .iter()
            .copied()
            .find(|&i| !matches[i].attribute.is_empty());
        let Some(anchor) = first_matched else {
            continue;
        };
        let lead_owner = matches[anchor].owner.as_str();
        let can_propagate = if lead_owner == "applicant" {
            false
        } else if lead_owner == "employer" {
            let has_personal_only = indexes.iter().any(|&i| {
                let a = matches[i].attribute.as_str();
                a.starts_with("birth.") || a.starts_with("person.") || a.starts_with("id.passport.")
            });
            !has_personal_only && (had_applicant || matches[anchor].attribute.starts_with("work.employer"))
        } else {
            true
        };

        if can_propagate {
            let role = lead_owner.to_string();
            for &idx in indexes {
                if matches[idx].attribute.is_empty()
                    || matches[idx].score >= 10
                    || field_explicitly_names_applicant(&fields[idx])
                {
                    continue;
                }
                if matches[idx].owner == "applicant" {
                    matches[idx].owner.clone_from(&role);
                }
                if matches[idx].owner == "employer" {
                    match matches[idx].attribute.as_str() {
                        "contact.phone" | "contact.phone.mobile" | "contact.phone.home" => {
                            matches[idx].attribute = "work.employer.phone".to_string();
                        }
                        "address.full" | "address.street" => {
                            matches[idx].attribute = "work.employer.address".to_string();
                        }
                        "address.postal" => {
                            matches[idx].attribute = "work.employer.postal".to_string();
                        }
                        "name.full" => {
                            matches[idx].attribute = "work.employer.name".to_string();
                        }
                        _ => {}
                    }
                }
            }
        } else if indexes
            .iter()
            .any(|&i| !matches[i].attribute.is_empty() && matches[i].owner == "applicant")
        {
            forms_with_prior_applicant.insert(form, true);
        }
    }
}

fn autocomplete_ids(fields: &[FormFieldInput]) -> Vec<Option<u32>> {
    let mut ids = vec![None; fields.len()];
    let mut next = 1u32;
    let mut seen: BTreeMap<(String, String, String), u32> = BTreeMap::new();
    for (index, field) in fields.iter().enumerate() {
        let Some(parsed) = autocomplete_section(&field.autocomplete) else {
            continue;
        };
        let key = (field.form.clone(), parsed.name, parsed.mode.to_string());
        let id = *seen.entry(key).or_insert_with(|| {
            let id = next;
            next += 1;
            id
        });
        ids[index] = Some(id);
    }
    ids
}

/// Drops heuristic card fields that do not form a card Chromium would accept.
/// An explicit autocomplete type and a standalone CVC stay.
fn suppress_unanchored_cards(fields: &[FormFieldInput], matches: &mut [FieldMatch]) {
    let mut forms: Vec<&str> = fields.iter().map(|field| field.form.as_str()).collect();
    forms.sort_unstable();
    forms.dedup();
    let autocomplete = autocomplete_ids(fields);
    for form in forms {
        for (start, end, anchored) in card_groups(fields, matches, form, &autocomplete) {
            if anchored {
                continue;
            }
            for grouped in start..end {
                if is_card_type(&matches[grouped].chrome_type)
                    && matches[grouped].score < 10
                    && matches[grouped].chrome_type != "CREDIT_CARD_STANDALONE_VERIFICATION_CODE"
                {
                    matches[grouped] = empty_match();
                }
            }
        }
    }
}

/// Runs of consecutive card fields in one form, as `(start, end, anchored)`. A run ends at a
/// non-card field, an autocomplete section, or a second card number.
fn card_groups(
    fields: &[FormFieldInput],
    matches: &[FieldMatch],
    form: &str,
    autocomplete: &[Option<u32>],
) -> Vec<(usize, usize, bool)> {
    let mut groups = Vec::new();
    let mut start = usize::MAX;
    let mut parts = CardParts { number: false, month: false, year: false, date: false, cvc: false };
    let mut index = 0;
    while index <= fields.len() {
        let same = index < fields.len() && fields[index].form == form;
        let boundary = !same || autocomplete[index].is_some();
        let card = same && !boundary && is_card_type(&matches[index].chrome_type);
        let repeats = card && parts.number && matches[index].chrome_type == "CREDIT_CARD_NUMBER";
        if start != usize::MAX && (!card || repeats || boundary) {
            groups.push((start, index, card_anchored(&parts)));
            start = usize::MAX;
            parts = CardParts { number: false, month: false, year: false, date: false, cvc: false };
        }
        if card && !repeats {
            if start == usize::MAX {
                start = index;
            }
            note_card(&mut parts, &matches[index].chrome_type);
        }
        if repeats {
            continue;
        }
        index += 1;
    }
    groups
}

fn permitted_on_a_small_form(chrome: &str) -> bool {
    matches!(
        chrome,
        "CREDIT_CARD_STANDALONE_VERIFICATION_CODE"
            | "EMAIL_ADDRESS"
            | "EMAIL_OR_LOYALTY_MEMBERSHIP_ID"
            | "IBAN_VALUE"
            | "LOYALTY_MEMBERSHIP_ID"
            | "MERCHANT_PROMO_CODE"
            | "ONE_TIME_CODE"
            | "ADDRESS_HOME_ZIP"
    )
}

/// Drops heuristic types when a form has fewer than three distinct fillable types, unless the form
/// carries multiple Vowkey domain attributes (such as bank, visa, or identity-document fields).
/// Types from an explicit autocomplete attribute stay.
fn suppress_small_forms(fields: &[FormFieldInput], matches: &mut [FieldMatch]) {
    let mut forms: Vec<&str> = fields.iter().map(|field| field.form.as_str()).collect();
    forms.sort_unstable();
    forms.dedup();
    for form in forms {
        let indexes: Vec<usize> = (0..fields.len()).filter(|i| fields[*i].form == form).collect();
        let mut types: Vec<&str> = indexes
            .iter()
            .map(|index| matches[*index].chrome_type.as_str())
            .filter(|chrome| *chrome != "UNKNOWN_TYPE")
            .collect();
        types.sort_unstable();
        types.dedup();
        let mut domain_attrs: Vec<&str> = indexes
            .iter()
            .filter(|index| {
                matches[**index].chrome_type == "UNKNOWN_TYPE"
                    && !matches[**index].attribute.is_empty()
                    && !matches[**index].attribute.starts_with("form.")
                    && matches[**index].score >= 5
            })
            .map(|index| matches[*index].attribute.as_str())
            .collect();
        domain_attrs.sort_unstable();
        domain_attrs.dedup();
        if types.len() >= 3 || domain_attrs.len() >= 2 {
            continue;
        }
        for index in indexes {
            if matches[index].score >= 10
                || permitted_on_a_small_form(&matches[index].chrome_type)
            {
                continue;
            }
            let section_id = matches[index].section_id;
            matches[index] = empty_match();
            matches[index].section_id = section_id;
        }
    }
}

fn entity_of(attribute: &str) -> Option<&'static str> {
    if attribute.starts_with("id.passport.") || attribute.starts_with("passport.") {
        Some("passport")
    } else if attribute.starts_with("id.driver_license.")
        || attribute.starts_with("id.drivers_license.")
    {
        Some("license")
    } else if attribute.starts_with("id.national") || attribute.starts_with("id.residence_card.") {
        Some("national")
    } else {
        None
    }
}

fn satisfies_required(entity: &str, attributes: &[&str]) -> bool {
    let has = |suffix: &str| attributes.iter().any(|attribute| attribute.ends_with(suffix));
    match entity {
        "passport" => {
            has(".number")
                || has(".issued")
                || has(".issue_date")
                || has(".expiry")
                || has(".expiry_date")
        }
        _ => true,
    }
}

/// Drops a heuristic identity entity that has none of the attributes Chromium requires of it.
/// An explicit autocomplete attribute is not a heuristic and is left in place.
fn suppress_incomplete_entities(matches: &mut [FieldMatch]) {
    let mut groups: BTreeMap<(u32, &'static str), Vec<usize>> = BTreeMap::new();
    for (index, matched) in matches.iter().enumerate() {
        if matched.score >= 10 {
            continue;
        }
        if let Some(entity) = entity_of(&matched.attribute) {
            groups
                .entry((matched.section_id, entity))
                .or_default()
                .push(index);
        }
    }
    let incomplete: Vec<usize> = groups
        .into_iter()
        .filter(|((_, entity), indexes)| {
            let attributes: Vec<&str> = indexes
                .iter()
                .map(|index| matches[*index].attribute.as_str())
                .collect();
            !satisfies_required(entity, &attributes)
        })
        .flat_map(|(_, indexes)| indexes)
        .collect();
    for index in incomplete {
        let section_id = matches[index].section_id;
        matches[index] = empty_match();
        matches[index].section_id = section_id;
    }
}

fn empty_match() -> FieldMatch {
    FieldMatch {
        attribute: String::new(),
        chrome_type: "UNKNOWN_TYPE".to_string(),
        owner: "applicant".to_string(),
        score: 0,
        section_id: 0,
        value: None,
    }
}

fn is_ignored_control(field: &FormFieldInput) -> bool {
    let kind = field.input_type.to_ascii_lowercase();
    if matches!(
        kind.as_str(),
        "hidden" | "submit" | "button" | "reset" | "image" | "file"
    ) {
        return true;
    }
    // A captcha or an administrative "for official use only" box is left alone.
    let text = format!(
        "{} {} {} {}",
        field.label, field.name, field.id, field.placeholder
    )
    .to_lowercase();
    if text.contains("captcha") {
        return true;
    }
    is_official_only(field)
}

fn is_official_only(field: &FormFieldInput) -> bool {
    let admin_context = format!("{} {}", field.section, field.label).to_lowercase();
    has_any(
        &admin_context,
        &[
            "for official use",
            "official use only",
            "office use only",
            "agency use only",
            "do not write in this",
            "記入しないで",
            "官公署記入",
            "市区町村記入",
            "主管課記入",
            "役所記入",
            "施設記入",
            "保育ママ",
            "保育ﾏﾏ",
            "受付印",
            "処理欄",
        ],
    )
}

fn extract_row_index(section_lower: &str) -> Option<usize> {
    if let Some(pos) = section_lower.rfind('#') {
        let digits: String = section_lower[pos + 1..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(n) = digits.parse::<usize>()
            && (1..=12).contains(&n)
        {
            return Some(n);
        }
    }
    let circled = [('①', 1usize), ('②', 2), ('③', 3), ('④', 4), ('⑤', 5), ('⑥', 6)];
    for (ch, idx) in circled {
        let prefixes = ["児童", "お子様", "申請児", "家族", "世帯員"];
        if prefixes.iter().any(|p| section_lower.contains(&format!("{p}{ch}")) || section_lower.contains(&format!("{p}氏名{ch}"))) {
            return Some(idx);
        }
    }
    for n in 2..=6 {
        let needles = [
            format!("dependent {n}"),
            format!("dependent.{n}"),
            format!("child {n}"),
            format!("児童{n}"),
            format!("お子様{n}"),
            format!("{n}人目"),
            format!("con thứ {n}"),
        ];
        if needles.iter().any(|p| section_lower.contains(p)) {
            return Some(n);
        }
    }
    None
}

/// Infers whose profile a field asks for from its section and label.
pub fn infer_owner(field: &FormFieldInput) -> String {
    if is_official_only(field) {
        return "official_only".to_string();
    }
    let section_lower = field.section.to_lowercase();
    let context = format!("{} {} {}", field.section, field.label, semantic_identifier(&field.name))
        .to_lowercase();
    if let Some(row_idx) = extract_row_index(&section_lower) {
        if row_idx == 2 && has_any(&section_lower, &["保護者", "guardian", "parent"]) {
            return "spouse".to_string();
        }
        if has_any(&section_lower, &["認定申請児", "申込児童", "入園児童", "申請児"]) {
            return if row_idx == 1 {
                "dependent".to_string()
            } else {
                format!("dependent.{row_idx}")
            };
        }
        if has_any(
            &section_lower,
            &[
                "thành viên",
                "nhân khẩu",
                "đăng ký thường trú",
                "đăng ký tạm trú",
                "nội dung đề nghị",
                "同居家族",
                "世帯員",
                "在日親族",
                "household member",
                "family member",
            ],
        ) {
            return format!("household_member.{row_idx}");
        }
    }
    let field_own = format!("{} {} {}", field.label, field.name, field.id).to_lowercase();
    let section_lower = field.section.to_lowercase();
    let own_explicit_employer_phone = has_any(&field_own, &["勤務先電話", "勤務先連絡先", "職場電話"])
        || has_any_word(
            &field_own,
            &["employer_phone", "employer_tel", "work_phone", "work_tel", "company_phone"],
        );
    if own_explicit_employer_phone
        && !has_any(
            &field_own,
            &["配偶者", "spouse", "保証人", "guarantor", "緊急連絡先", "emergency", "携帯", "自宅", "mobile", "home"],
        )
        && !has_any(
            &section_lower,
            &["配偶者の勤務先", "spouse's employer", "spouse employer", "保証人の勤務先", "guarantor's employer"],
        )
    {
        return "employer".to_string();
    }
    if has_any(
        &context,
        &[
            "紧急联系人",
            "緊急連絡先",
            "emergency",
            "連帯保証人",
            "保証人",
            "guarantor",
            "bürge",
            "penjamin",
            "người bảo lãnh",
        ],
    ) {
        if has_any(&context, &["保証人", "guarantor", "bürge", "penjamin", "người bảo lãnh"]) {
            return "guarantor".to_string();
        }
        return "applicant".to_string();
    }
    if has_any(
        &context,
        &[
            "配偶者",
            "배우자",
            "spouse",
            "husband",
            "wife",
            "conjoint",
            "époux",
            "épouse",
            "ehegatte",
            "ehepartner",
            "lebenspartner",
            "cónyuge",
            "coniuge",
            "cônjuge",
            "suami",
            "isteri",
            "pasangan",
            "vợ/chồng",
            "họ tên vợ",
            "họ tên chồng",
            "คู่สมรส",
        ],
    ) && !has_any(&context, &["配偶者の有無", "marital"])
    {
        return "spouse".to_string();
    }
    if has_any(
        &context,
        &[
            "扶養親族",
            "被扶養者",
            "児童",
            "お子様",
            "子女",
            "자녀",
            "부양가족",
            "dependent",
            "child",
            "children",
            "anlage kind",
            "enfant",
            "hijo",
            "figlio",
            "người phụ thuộc",
            "họ tên con",
            "tanggungan",
            "anak",
            "บุตร",
        ],
    ) && !has_any(
        &context,
        &[
            "number of children",
            "number of dependents",
            "扶養親族の数",
            "outorgante",
            "segurado",
            "insured/",
            "applicant/",
            "titular",
        ],
    ) {
        if let Some(idx) = extract_row_index(&context)
            && idx >= 2
        {
            return format!("dependent.{idx}");
        }
        return "dependent".to_string();
    }
    if has_any(
        &context,
        &[
            "賃貸人",
            "貸主",
            "家主",
            "landlord",
            "lessor",
            "wohnungsgeber",
            "vermieter",
            "bailleur",
            "arrendador",
            "locatore",
            "임대인",
            "bên cho thuê",
            "chủ nhà",
        ],
    ) {
        return "landlord".to_string();
    }
    if has_any(
        &context,
        &[
            "世帯主",
            "세대주",
            "户主",
            "戶長",
            "household head",
            "head of household",
            "chủ hộ",
            "kepala keluarga",
            "เจ้าบ้าน",
        ],
    ) && !has_any(&context, &["続柄", "relationship", "hubungan", "quan hệ"])
    {
        return "household_head".to_string();
    }
    if has_any(
        &context,
        &[
            "作成者",
            "税理士",
            "社労士",
            "行政書士",
            "法定代理人",
            "代理人",
            "取次者",
            "申請取次",
            "대리인",
            "preparer",
            "attorney",
            "legal representative",
            "authorized representative",
            "authorised representative",
            "accredited representative",
            "mandataire",
            "bevollmächtigt",
            "gesetzlicher vertreter",
            "representante legal",
            "procurador",
            "outorgado",
            "apoderado",
            "người đại diện",
            "người được ủy quyền",
            "người khai thay",
        ],
    ) && !has_any(&context, &["代表者", "employer", "勤務先", "事業主"])
    {
        return "preparer".to_string();
    }
    let employer_clues = &[
        "勤務先",
        "雇用主",
        "事業主",
        "事業所",
        "支払者",
        "使用者",
        "所属機関",
        "受入機関",
        "근무처",
        "사업장",
        "고용주",
        "직장",
        "工作单位",
        "用人单位",
        "雇主",
        "employer",
        "arbeitgeber",
        "employeur",
        "empleador",
        "datore di lavoro",
        "werkgever",
        "majikan",
        "perusahaan",
        "đơn vị sử dụng lao động",
        "đơn vị công tác",
        "tên cơ quan",
        "นายจ้าง",
        "สถานที่ทำงาน",
    ];
    let label_and_name = format!("{} {}", field.label, field.name).to_lowercase();
    let employer_section =
        has_any(&section_lower, employer_clues) && !has_any(&section_lower, &["本人", "applicant"]);
    let employer_label = has_any(&label_and_name, employer_clues)
        && (own_explicit_employer_phone
            || !has_any(
                &label_and_name,
                &[
                    "本人",
                    "昼間",
                    "日中",
                    "携帯",
                    "自宅",
                    "daytime",
                    "mobile",
                    "home",
                ],
            ));
    if (employer_section || employer_label)
        && !has_any(&context, &["社員番号", "employee_id", "職種", "役職", "所属部署"])
    {
        return "employer".to_string();
    }
    "applicant".to_string()
}

fn match_autocomplete(raw: &str) -> Option<(&'static str, &'static str)> {
    let tokens: Vec<String> = raw
        .split_whitespace()
        .map(|t| t.trim().to_ascii_lowercase())
        .collect();
    let has_work = tokens.iter().any(|t| t == "work");
    let has_mobile = tokens.iter().any(|t| t == "mobile");
    let has_home = tokens.iter().any(|t| t == "home");
    for token in tokens.iter().rev() {
        let matched = match token.as_str() {
            "name" => ("name.full", "NAME_FULL"),
            "given-name" => ("name.given", "NAME_FIRST"),
            "additional-name" => ("name.middle", "NAME_MIDDLE"),
            "family-name" => ("name.family", "NAME_LAST"),
            "honorific-prefix" => ("name.prefix", "NAME_HONORIFIC_PREFIX"),
            "email" => ("contact.email", "EMAIL_ADDRESS"),
            "username" => ("login.username", "USERNAME"),
            "current-password" | "new-password" => ("login.password", "PASSWORD"),
            "organization-title" => ("work.title", "organization-title"),
            "organization" => ("work.employer.name", "COMPANY_NAME"),
            "street-address" | "address-line1" => ("address.street", "ADDRESS_HOME_LINE1"),
            "address-line2" | "address-line3" => ("address.building", "ADDRESS_HOME_LINE2"),
            "address-level2" => ("address.city", "ADDRESS_HOME_CITY"),
            "address-level1" => ("address.prefecture", "ADDRESS_HOME_STATE"),
            "postal-code" => ("address.postal", "ADDRESS_HOME_ZIP"),
            "country" | "country-name" => ("address.country", "ADDRESS_HOME_COUNTRY"),
            "cc-name" => ("card.holder", "CREDIT_CARD_NAME_FULL"),
            "cc-given-name" => ("card.holder.given", "CREDIT_CARD_NAME_FIRST"),
            "cc-family-name" => ("card.holder.family", "CREDIT_CARD_NAME_LAST"),
            "cc-number" => ("card.number", "CREDIT_CARD_NUMBER"),
            "cc-exp" => ("card.expiry", "CREDIT_CARD_EXP_DATE_4_DIGIT_YEAR"),
            "cc-exp-month" => ("card.expiry.month", "CREDIT_CARD_EXP_MONTH"),
            "cc-exp-year" => ("card.expiry.year", "CREDIT_CARD_EXP_4_DIGIT_YEAR"),
            "cc-csc" => ("card.cvv", "CREDIT_CARD_VERIFICATION_CODE"),
            "cc-type" => ("card.type", "CREDIT_CARD_TYPE"),
            "bday" => ("birth.date", "BIRTHDATE_DAY"),
            "bday-day" => ("birth.day", "BIRTHDATE_DAY"),
            "bday-month" => ("birth.month", "BIRTHDATE_MONTH"),
            "bday-year" => ("birth.year", "BIRTHDATE_YEAR"),
            "sex" => ("person.sex", "GENDER"),
            "tel" | "tel-national" | "tel-local" => {
                if has_work {
                    ("work.employer.phone", "PHONE_HOME_WHOLE_NUMBER")
                } else if has_mobile {
                    ("contact.phone.mobile", "PHONE_HOME_WHOLE_NUMBER")
                } else if has_home {
                    ("contact.phone.home", "PHONE_HOME_WHOLE_NUMBER")
                } else {
                    ("contact.phone", "PHONE_HOME_WHOLE_NUMBER")
                }
            }
            "tel-area-code" => ("contact.phone.area", "PHONE_HOME_CITY_CODE"),
            "tel-country-code" => ("contact.phone.country", "PHONE_HOME_COUNTRY_CODE"),
            _ => continue,
        };
        return Some(matched);
    }
    None
}

fn match_clues(
    combined: &str,
    label: &str,
    id_name: &str,
    input_type: &str,
    owner: &str,
) -> Option<(&'static str, &'static str, i32)> {
    // 1. Emergency contact fields
    if has_any(
        combined,
        &[
            "緊急連絡先",
            "紧急联系人",
            "비상연락처",
            "emergency",
            "emerg_",
            "khẩn cấp",
            "khan cap",
        ],
    ) {
        if has_any(
            combined,
            &[
                "電話",
                "phone",
                "tel",
                "連絡先電話",
                "sđt",
                "sdt",
                "điện thoại",
                "dien thoai",
                "연락처",
            ],
        ) {
            return Some(("emergency.phone", "PHONE_HOME_WHOLE_NUMBER", 6));
        }
        if has_any(
            combined,
            &[
                "続柄",
                "関係",
                "relation",
                "relationship",
                "quan hệ",
                "quan he",
                "관계",
            ],
        ) {
            return Some(("emergency.relation", "UNKNOWN_TYPE", 6));
        }
        if has_any(
            combined,
            &[
                "住所",
                "所在地",
                "address",
                "địa chỉ",
                "dia chi",
                "주소",
            ],
        ) {
            return Some(("emergency.address", "ADDRESS_HOME_LINE1", 6));
        }
        if has_any(
            combined,
            &[
                "氏名",
                "名前",
                "name",
                "emerg_name",
                "họ tên",
                "ho ten",
                "họ và tên",
                "người liên hệ",
                "nguoi lien he",
                "emergency contact",
                "성명",
                "이름",
            ],
        ) {
            return Some(("emergency.name", "NAME_FULL", 6));
        }
    }

    // 2. Credit card fields (checked early so `cardholder name` doesn't match `name`)
    if has_any(
        combined,
        &[
            "cardholder",
            "name on card",
            "cc_name",
            "card_name",
            "カード名義",
            "karteninhaber",
            "持卡人",
            "카드소유자",
            "titulaire de la carte",
            "titular de la tarjeta",
        ],
    ) {
        return Some(("card.holder", "CREDIT_CARD_NAME_FULL", 7));
    }
    if has_any(
        combined,
        &[
            "credit card",
            "card number",
            "card_number",
            "cc_number",
            "ccnum",
            "cardnumber",
            "カード番号",
            "kreditkartennummer",
            "kartennummer",
            "numéro de carte",
            "número de tarjeta",
            "信用卡",
            "银行卡号",
            "카드번호",
        ],
    ) && !has_any(combined, &["residence", "在留", "identity", "national", "保険"])
    {
        return Some(("card.number", "CREDIT_CARD_NUMBER", 7));
    }
    if has_any(
        combined,
        &[
            "card type",
            "card_type",
            "cc_type",
            "cctype",
            "credit card type",
            "カード種類",
            "kartentyp",
        ],
    ) {
        return Some(("card.type", "CREDIT_CARD_TYPE", 7));
    }
    if has_any(
        combined,
        &[
            "cvv",
            "cvc",
            "csc",
            "security code",
            "card verification",
            "セキュリティコード",
            "prüfziffer",
            "kartenprüfnummer",
        ],
    ) {
        return Some(("card.cvv", "CREDIT_CARD_VERIFICATION_CODE", 7));
    }
    if has_any(
        combined,
        &[
            "exp_year",
            "expyear",
            "ccyear",
            "expiration year",
            "expiry year",
            "gültig bis jahr",
            "有効期限（年）",
            "有効期限(年)",
        ],
    ) {
        return Some(("card.expiry.year", "CREDIT_CARD_EXP_4_DIGIT_YEAR", 7));
    }
    if has_any(
        combined,
        &[
            "exp_month",
            "expmonth",
            "ccmonth",
            "expiration month",
            "expiry month",
            "gültig bis monat",
            "有効期限（月）",
            "有効期限(月)",
        ],
    ) {
        return Some(("card.expiry.month", "CREDIT_CARD_EXP_MONTH", 7));
    }
    if has_any(
        combined,
        &[
            "expiration",
            "expiry",
            "exp date",
            "exp_date",
            "expires",
            "valid thru",
            "valid through",
            "gültig bis",
            "有効期限",
            "有效期",
        ],
    ) && !has_any(
        combined,
        &["passport", "旅券", "license", "licence", "免許", "visa", "在留", "保険"],
    ) {
        return Some(("card.expiry", "CREDIT_CARD_EXP_DATE_4_DIGIT_YEAR", 6));
    }

    // 3. Residence card & Visa fields
    if has_any(
        combined,
        &[
            "在留カード番号",
            "residence_card",
            "residence card no",
            "alien registration",
            "外国人登録",
            "외국인등록번호",
            "居留證",
        ],
    ) {
        return Some(("id.residence_card.number", "NATIONAL_ID_CARD_NUMBER", 6));
    }
    if has_any(
        combined,
        &[
            "在留資格",
            "visa_status",
            "status of residence",
            "visa type",
            "ビザ種類",
            "체류자격",
            "签证种类",
        ],
    ) {
        return Some(("visa.status", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "在留期間満了",
            "在留期間の満了",
            "visa_expiry",
            "expiration date of status",
            "period of stay expiry",
        ],
    ) {
        return Some(("visa.expiry", "UNKNOWN_TYPE", 6));
    }
    if has_any(combined, &["在留期間", "visa_period", "period of stay", "滞在期間", "逗留時間"]) {
        return Some(("visa.period", "UNKNOWN_TYPE", 6));
    }
    if has_any(combined, &["visa no", "visa number", "査証番号", "签证号码", "证件号码 visa"]) {
        return Some(("visa.number", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "就労制限の有無",
            "就労制限",
            "work_restriction",
            "work restriction",
            "restrictions on work",
        ],
    ) {
        return Some(("visa.work_restriction", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "資格外活動許可",
            "work_permission",
            "permission to engage in other activities",
        ],
    ) {
        return Some(("visa.work_permission", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "証明書番号",
            "届出番号",
            "certificate number",
            "certificate no",
            "số giấy khai sinh",
            "số đăng ký kết hôn",
        ],
    ) {
        return Some(("id.certificate.number", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "届出日",
            "届出年月日",
            "registration date",
            "date of registration",
            "ngày đăng ký",
        ],
    ) {
        return Some(("id.certificate.issued", "UNKNOWN_TYPE", 6));
    }

    // 4. Passport fields (skip when the label is asking for a person's name "as in passport")
    let is_name_in_passport = is_person_name_label(label, combined);
    if !is_name_in_passport
        && has_any(
            combined,
            &[
                "passport",
                "旅券",
                "パスポート",
                "护照",
                "護照",
                "여권",
                "hộ chiếu",
                "reisepass",
                "passeport",
                "pasaporte",
                "passaporto",
                "paspoort",
                "หนังสือเดินทาง",
                "paspor",
                "laissez-passer",
            ],
        )
    {
        if has_any(combined, &["nationality", "国籍"]) {
            return Some(("person.nationality", "PASSPORT_ISSUING_COUNTRY", 6));
        }
        if has_any(
            combined,
            &[
                "type",
                "種類",
                "種別",
                "种类",
                "loại",
                "tipo de pasaporte",
                "passport book",
                "passport card",
            ],
        ) {
            return Some(("id.passport.type", "UNKNOWN_TYPE", 5));
        }
        if has_any(
            combined,
            &[
                "expir",
                "満了",
                "有効期限",
                "有效期",
                "屆滿",
                "届满",
                "valid until",
                "date d'expiration",
                "ablauf",
                "vencimiento",
                "hết hạn",
            ],
        ) {
            return Some(("id.passport.expiry", "PASSPORT_EXPIRATION_DATE", 6));
        }
        if has_any(
            combined,
            &[
                "issue",
                "交付",
                "発行",
                "签发",
                "簽發",
                "발급",
                "cấp ngày",
                "ngày cấp",
                "ausstellung",
                "délivrance",
                "emisión",
            ],
        ) && !has_any(
            combined,
            &[
                "country", "state", "authority", "place", "国", "機関", "地", "机关", "nơi",
                "tempat", "negara", "behörde",
            ],
        ) {
            return Some(("id.passport.issued", "PASSPORT_ISSUE_DATE", 6));
        }
        if has_any(
            combined,
            &[
                "country",
                "state",
                "authority",
                "place",
                "発行国",
                "交付機関",
                "签发地",
                "簽發地",
                "签发机关",
                "簽發機關",
                "nơi cấp",
                "tempat",
                "negara dikeluarkan",
                "ausstellungsbehörde",
            ],
        ) {
            return Some(("id.passport.country", "PASSPORT_ISSUING_COUNTRY", 5));
        }
        return Some(("id.passport.number", "PASSPORT_NUMBER", 6));
    }

    // 4b. Unqualified document issue/expiry/authority fields inside passport/ID sections
    if !has_any(
        combined,
        &[
            "card", "cc", "credit", "visa", "在留", "license", "licence", "免許", "lease",
            "임대", "契約",
        ],
    ) {
        if has_any(
            combined,
            &[
                "date of expiry",
                "expiration date",
                "valid until",
                "有效期至",
                "屆滿日期",
                "届满日期",
                "ngày hết hạn",
                "có giá trị đến",
            ],
        ) {
            return Some(("id.passport.expiry", "PASSPORT_EXPIRATION_DATE", 5));
        }
        if has_any(
            combined,
            &[
                "date of issue",
                "issue date",
                "簽發日期",
                "签发日期",
                "交付年月日",
                "発行年月日",
                "ngày cấp",
                "ausstellungsdatum",
                "tarikh dikeluarkan",
            ],
        ) {
            return Some(("id.passport.issued", "PASSPORT_ISSUE_DATE", 5));
        }
        if has_any(
            combined,
            &[
                "place of issue",
                "issuing authority",
                "country of issue",
                "ausstellungsbehörde",
                "签发机关",
                "簽發機關",
                "签发地",
                "簽發地",
                "nơi cấp",
                "negara dikeluarkan",
            ],
        ) {
            return Some(("id.passport.country", "PASSPORT_ISSUING_COUNTRY", 5));
        }
    }

    // 5. Driver's licence fields
    if has_any(
        combined,
        &[
            "driver's license",
            "drivers license",
            "driver license",
            "driving license",
            "driver's licence",
            "drivers licence",
            "driver licence",
            "driving licence",
            "driver_license",
            "driver_licence",
            "license_number",
            "licence_number",
            "dl_number",
            "運転免許",
            "免許証番号",
            "führerschein",
            "permis de conduire",
            "licencia de conducir",
            "giấy phép lái xe",
            "bằng lái",
        ],
    ) {
        if has_any(combined, &["expir", "有効期限", "満了"]) {
            return Some(("id.driver_license.expiry", "DRIVERS_LICENSE_EXPIRATION_DATE", 6));
        }
        if has_any(combined, &["issue", "交付"]) {
            return Some(("id.driver_license.issued", "DRIVERS_LICENSE_ISSUE_DATE", 6));
        }
        return Some(("id.driver_license.number", "DRIVERS_LICENSE_NUMBER", 6));
    }

    // 6. Tax ID / SSN / My Number / National ID (using word-boundary checks for short acronyms)
    if has_any(
        combined,
        &[
            "個人番号",
            "マイナンバー",
            "my_number",
            "mynumber",
            "social security",
            "social insurance number",
            "tax_id",
            "tax id",
            "taxpayer identification",
            "steuer-id",
            "steueridentifikationsnummer",
            "steuernummer",
            "codice fiscale",
            "numéro fiscal",
            "mã số thuế",
            "npwp",
            "permanent account number",
            "employer identification number",
            "ird number",
            "法人番号",
            "corporation no",
        ],
    ) || has_any_word(
        combined,
        &["ssn", "tin", "tfn", "ein", "utr", "abn", "pan", "cpf", "cnpj", "nif", "ptin", "ird"],
    ) {
        if has_any(combined, &["個人番号", "マイナンバー", "my_number", "mynumber"]) {
            return Some(("id.mynumber", "NATIONAL_ID_CARD_NUMBER", 6));
        }
        return Some(("tax.id", "NATIONAL_ID_CARD_NUMBER", 6));
    }

    if !is_name_in_passport
        && (has_any(
            combined,
            &[
                "cccd",
                "cmnd",
                "căn cước",
                "can cuoc",
                "số định danh",
                "so dinh danh",
                "định danh cá nhân",
                "dinh danh ca nhan",
                "national id",
                "national_id",
                "identity card",
                "id card",
                "personalausweis",
                "carte nationale d'identité",
                "identidade",
                "documento de identidad",
                "curp",
                "aadhaar",
                "주민등록번호",
                "身份证",
                "身分證",
                "บัตรประจำตัวประชาชน",
                "kad pengenalan",
                "nomor induk kependudukan",
                "burgerservicenummer",
                "uscis",
                "a-number",
            ],
        ) || has_any_word(combined, &["dni", "nie", "nric", "fin", "nik", "bsn", "nino"]))
        && !has_any(label, &["daftar susunan anggota keluarga", "mother's name", "father's name"])
    {
        return Some(("id.national.number", "NATIONAL_ID_CARD_NUMBER", 6));
    }

    // 7. Social insurance / pension / health insurance numbers
    if has_any(combined, &["保険者番号", "insurer number", "insurer_number"]) {
        return Some(("id.health_insurance.insurer_number", "UNKNOWN_TYPE", 6));
    }
    if (has_any(combined, &["保険証記号", "health_insurance_symbol", "insurance symbol"])
        || (label.trim() == "記号" && has_any(combined, &["保険", "資格"])))
        && !has_any(combined, &["番号", "number", "保険証番号"])
    {
        return Some(("id.health_insurance.symbol", "UNKNOWN_TYPE", 6));
    }
    if (has_any(label, &["枝番"])
        && !has_any(label, &["記号", "保険証番号", "health insurance number"]))
        || has_any(id_name, &["health_insurance_branch", "insurance_branch", "edaban"])
    {
        return Some(("id.health_insurance.branch", "UNKNOWN_TYPE", 6));
    }
    if has_any(combined, &["保険証有効期限", "資格確認書有効期限", "health_insurance_expiry"]) {
        return Some(("id.health_insurance.expiry", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "基礎年金番号",
            "年金番号",
            "雇用保険被保険者番号",
            "健康保険証",
            "健康保険記号",
            "健康保険番号",
            "保険証番号",
            "記号・番号",
            "被保険者番号",
            "被保険者整理番号",
            "事業所番号",
            "health insurance number",
            "health_insurance_number",
            "health insurance no",
            "bảo hiểm y tế",
            "số thẻ bhyt",
            "pension number",
            "sozialversicherungsnummer",
            "versicherungsnummer",
            "rentenversicherung",
            "sécurité sociale",
            "national insurance",
            "bhxh",
            "bảo hiểm xã hội",
            "sss number",
            "sss no",
            "philhealth",
            "pag-ibig",
            "kwsp",
            "epf",
        ],
    ) {
        if has_any(combined, &["雇用保険", "employment_insurance"]) {
            return Some(("id.employment_insurance.number", "UNKNOWN_TYPE", 6));
        }
        if has_any(
            combined,
            &[
                "健康保険",
                "保険証",
                "記号・番号",
                "health_insurance",
                "health insurance",
                "bảo hiểm y tế",
                "bhyt",
                "krankenkasse",
                "philhealth",
            ],
        ) {
            return Some(("id.health_insurance.number", "UNKNOWN_TYPE", 6));
        }
        return Some(("id.pension.number", "UNKNOWN_TYPE", 6));
    }

    // 8. Banking & Zengin fields
    if has_any(
        combined,
        &[
            "口座開設の目的",
            "口座開設目的",
            "口座の利用目的",
            "bank_account_purpose",
            "account_purpose",
            "account purpose",
            "purpose of the account",
            "mục đích mở tài khoản",
            "계좌 개설 목적",
            "계좌개설목적",
            "계좌 이용 목적",
            "계좌이용목적",
        ],
    ) {
        return Some(("bank.account.purpose", "UNKNOWN_TYPE", 8));
    }
    if has_any(combined, &["예금주", "계좌명의", "계좌 명의"]) {
        return Some(("bank.account.holder", "NAME_FULL", 8));
    }
    if has_any(
        combined,
        &[
            "口座名義",
            "account_holder",
            "account holder",
            "kontoinhaber",
            "titulaire du compte",
            "chủ tài khoản",
        ],
    ) {
        if has_any(combined, &["半角", "zengin", "half_kana", "全銀"]) {
            return Some(("bank.account.holder.zengin", "UNKNOWN_TYPE", 7));
        }
        if has_any(combined, &["カナ", "フリガナ", "kana"]) {
            return Some(("bank.account.holder.kana", "UNKNOWN_TYPE", 6));
        }
        return Some(("bank.account.holder.kanji", "NAME_FULL", 6));
    }
    if has_any(
        combined,
        &[
            "金融機関コード",
            "銀行コード",
            "bank_code",
            "routing number",
            "aba routing",
            "sort code",
            "bankleitzahl",
        ],
    ) || has_any_word(combined, &["blz"])
    {
        return Some(("bank.code", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "金融機関名",
            "銀行名",
            "bank_name",
            "name of bank",
            "bank name",
            "kreditinstitut",
            "tên ngân hàng",
        ],
    ) && !has_any(combined, &["口座番号", "コード", "支店"])
    {
        return Some(("bank.name", "UNKNOWN_TYPE", 6));
    }
    if has_any(combined, &["支店コード", "店番", "branch_code", "branch no", "branch number"]) {
        return Some(("bank.branch.code", "UNKNOWN_TYPE", 6));
    }
    if has_any(combined, &["支店名", "branch_name", "branch name", "chi nhánh"]) {
        return Some(("bank.branch.name", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "預金種目",
            "預金種類",
            "account_type",
            "account type",
            "種目",
            "checking / savings",
            "type of depositor account",
        ],
    ) {
        return Some(("bank.account.type", "UNKNOWN_TYPE", 6));
    }
    if has_any_word(combined, &["iban"]) || combined.contains("iban") {
        return Some(("bank.iban", "IBAN_VALUE", 7));
    }
    if has_any_word(combined, &["bic", "swift"]) {
        return Some(("bank.bic", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "口座番号",
            "記号番号",
            "account_number",
            "account number",
            "account no",
            "kontonummer",
            "số tài khoản",
            "nombor akaun bank",
        ],
    ) {
        return Some(("bank.account.number", "UNKNOWN_TYPE", 6));
    }

    if has_any(
        combined,
        &[
            "差引残高",
            "現在残高",
            "口座残高",
            "account_balance",
            "account balance",
            "closing balance",
            "số dư tài khoản",
        ],
    ) {
        return Some(("bank.account.balance", "UNKNOWN_TYPE", 6));
    }

    // 9. Income / payslip / finance amounts
    if has_any(
        combined,
        &[
            "控除合計",
            "総控除額",
            "控除額合計",
            "total_deductions",
            "total deductions",
            "tổng khấu trừ",
        ],
    ) {
        return Some(("income.deductions.total", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "総支給額",
            "支給総額",
            "monthly_gross",
            "gross pay",
            "gross salary",
            "bruttolohn",
            "bruttogehalt",
            "tổng thu nhập",
        ],
    ) {
        return Some(("income.monthly.gross", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "差引支給額",
            "手取り",
            "monthly_net",
            "net pay",
            "net salary",
            "nettolohn",
            "thực lĩnh",
        ],
    ) {
        return Some(("income.monthly.net", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "基本給",
            "base salary",
            "base pay",
            "grundgehalt",
            "lương cơ bản",
            "monthly rate of fixed income",
        ],
    ) {
        return Some(("income.monthly.base", "UNKNOWN_TYPE", 6));
    }
    if has_any(combined, &["賞与", "ボーナス", "annual bonus", "thưởng"]) {
        return Some(("income.bonus", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "源泉徴収税額",
            "源泉所得税",
            "withholding tax",
            "income tax withheld",
            "lohnsteuer",
            "thuế tncn",
        ],
    ) {
        return Some(("income.tax.income", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "年収",
            "年間収入",
            "支払金額",
            "収入金額",
            "所得金額",
            "所得の見積額",
            "給与所得",
            "소득금액",
            "annual_income",
            "annual income",
            "annual salary",
            "yearly income",
            "total income",
            "adjusted gross income",
            "taxable income",
            "jahresgehalt",
            "thu nhập năm",
        ],
    ) && !has_any(
        combined,
        &[
            "家賃",
            "敷金",
            "礼金",
            "送金",
            "월세",
            "보증금",
            "차임",
            "rent",
            "deposit",
            "remittance",
        ],
    ) {
        return Some(("income.annual", "UNKNOWN_TYPE", 5));
    }

    // 10. Employment & company fields
    if has_any(
        combined,
        &[
            "社員番号",
            "従業員番号",
            "employee_id",
            "employee id",
            "employee number",
            "personalnummer",
            "mã nhân viên",
        ],
    ) {
        return Some(("work.employee_id", "UNKNOWN_TYPE", 6));
    }
    let school_field = has_any(
        combined,
        &[
            "学校",
            "在学",
            "在籍",
            "学籍",
            "学部",
            "学科",
            "専攻",
            "school",
            "university",
            "college",
            "faculty",
            "campus",
            "student",
            "học",
            "trường",
            "khoa",
            "sinh viên",
            "학교",
            "학부",
            "학과",
            "학번",
            "학생",
        ],
    ) && !has_any(
        combined,
        &[
            "勤務先",
            "所属部署",
            "社員",
            "従業員",
            "employer",
            "employee",
            "company",
            "職場",
            "緊急",
            "emergency",
            "本人",
            "自宅",
            "携帯",
            "mobile",
            "personal",
            "công ty",
            "nhân viên",
        ],
    );
    if school_field
        && (has_any(
            combined,
            &["学部", "学科", "専攻", "faculty", "ngành", "학부", "학과", "전공"],
        ) || has_any_word(label, &["khoa"]))
    {
        return Some(("education.faculty", "UNKNOWN_TYPE", 8));
    }
    if school_field
        && has_any(
            combined,
            &[
                "学籍番号",
                "学生番号",
                "学生証番号",
                "student id",
                "student number",
                "student no",
                "matriculation",
                "mã số sinh viên",
                "mã sinh viên",
                "학번",
            ],
        )
    {
        return Some(("education.student_id", "UNKNOWN_TYPE", 8));
    }
    if school_field
        && has_any(
            combined,
            &[
                "電話",
                "phone",
                "telephone",
                "tel",
                "điện thoại",
                "전화",
            ],
        )
        && !has_any(combined, &["本人", "携帯", "自宅", "mobile", "personal", "emergency", "緊急"])
    {
        return Some(("education.school.phone", "PHONE_HOME_WHOLE_NUMBER", 8));
    }
    if has_any(
        combined,
        &[
            "所属部署",
            "部署",
            "department",
            "emp_dept",
            "abteilung",
            "phòng ban",
        ],
    ) {
        return Some(("work.department", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "役職",
            "職種",
            "職業",
            "job_title",
            "job title",
            "emp_title",
            "occupation",
            "position",
            "beruf",
            "profession",
            "profissão",
            "profesión",
            "chức vụ",
            "nghề nghiệp",
            "직업",
            "pekerjaan",
            "jawatan",
        ],
    ) {
        return Some(("work.title", "organization-title", 6));
    }
    if has_any(combined, &["勤務先電話", "employer_phone", "work phone", "会社電話"]) {
        return Some(("work.employer.phone", "PHONE_HOME_WHOLE_NUMBER", 6));
    }
    if (has_any(
        combined,
        &[
            "学校名",
            "最終学歴",
            "出身校",
            "大学名",
            "高校名",
            "school name",
            "name of school",
            "school_name",
            "university name",
            "name of university",
            "college name",
            "hochschule",
            "universität",
            "tên trường",
            "trường học",
            "학교명",
            "출신학교",
            "대학교",
        ],
    ) || has_any_word(
        label,
        &["school", "university", "college", "universidad", "université", "trường"],
    )) && !has_any(
        combined,
        &[
            "勤務先",
            "employer",
            "company",
            "会社",
            "address",
            "street",
            "住所",
            "所在地",
            "địa chỉ",
            "주소",
            "phone",
            "telephone",
            "tel",
            "電話",
            "전화",
            "email",
            "graduation",
            "卒業",
            "degree",
            "学位",
        ],
    ) {
        return Some(("education.school.name", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "学年",
            "年次",
            "school grade",
            "year level",
            "grade level",
            "khối lớp",
        ],
    ) {
        return Some(("education.grade", "UNKNOWN_TYPE", 6));
    }
    if (has_any(
        combined,
        &[
            "勤務先名称",
            "勤務先名",
            "会社名",
            "employer_name",
            "employer name",
            "name of employer",
            "name of your employer",
            "place of employment: name",
            "company name",
            "firmenname",
            "arbeitgeber",
            "employeur",
            "tên công ty",
            "đơn vị công tác",
            "근무처",
            "직장명",
            "nama majikan",
            "nama kementerian",
        ],
    ) || has_any_word(label, &["company", "organization", "organisation", "employer", "firma"]))
        && !has_any(
            label,
            &[
                "address",
                "street",
                "住所",
                "所在地",
                "alamat",
                "địa chỉ",
                "주소",
                "anschrift",
                "adresse",
                "dirección",
                "phone",
                "telephone",
                "tel",
                "電話",
                "전화",
                "email",
                "e-mail",
                "contact person",
                "tax ref",
                "uen",
                "ein",
                "fee",
                "fees",
                "contribution",
                "pension",
                "provident",
                "bonus",
                "allowance",
                "deduction",
            ],
        )
    {
        return Some(("work.employer.name", "COMPANY_NAME", 6));
    }

    // 11. Contact: email & phone
    if input_type == "email"
        || has_any(
            combined,
            &[
                "メール",
                "e-mail",
                "email",
                "courriel",
                "correo electrónico",
                "thư điện tử",
                "이메일",
                "電子郵件",
                "电子邮箱",
            ],
        )
    {
        return Some(("contact.email", "EMAIL_ADDRESS", 6));
    }
    if has_any(combined, &["area code", "city code", "vorwahl", "市外局番"]) {
        return Some(("contact.phone.area", "PHONE_HOME_CITY_CODE", 6));
    }
    if has_any(
        combined,
        &[
            "phone country code",
            "telephone country code",
            "country calling code",
            "calling code",
            "dialing code",
            "dialling code",
            "dial code",
            "phone_country",
            "tel_country",
            "tel-country-code",
            "国番号",
            "国際電話国番号",
            "国際番号",
            "국가번호",
            "mã vùng quốc tế",
        ],
    ) || (has_any(combined, &["country code", "country_code", "mã quốc gia"])
        && (input_type == "tel"
            || has_any(
                combined,
                &["phone", "tel", "mobile", "calling", "dial", "電話", "전화", "điện thoại", "+"],
            )))
    {
        return Some(("contact.phone.country", "PHONE_HOME_COUNTRY_CODE", 7));
    }
    if input_type == "tel"
        || has_any(
            combined,
            &[
                "携帯",
                "電話",
                "电话",
                "電話號碼",
                "phone",
                "mobile",
                "telephone",
                "cell",
                "telefon",
                "téléphone",
                "teléfono",
                "điện thoại",
                "연락처",
                "전화번호",
                "no. telefon",
                "nomor telepon",
                "โทรศัพท์",
            ],
        )
        || has_any_word(label, &["tel", "fax"])
    {
        if owner == "employer" {
            return Some(("work.employer.phone", "PHONE_HOME_WHOLE_NUMBER", 6));
        }
        if has_any(combined, &["携帯", "mobile", "cell", "handy", "di động", "휴대전화"]) {
            return Some(("contact.phone.mobile", "PHONE_HOME_WHOLE_NUMBER", 6));
        }
        return Some(("contact.phone", "PHONE_HOME_WHOLE_NUMBER", 5));
    }

    // 12. Birth date & birth place (skip parent surname at birth and standalone age columns!)
    if !has_any(label, &["surname", "last name", "family name", "given name", "first name", "年齢", "満年齢"])
        && (has_any(
            combined,
            &[
                "生年月日",
                "出生日期",
                "出生年月日",
                "생년월일",
                "date of birth",
                "birth_date",
                "birthdate",
                "birth date",
                "birth_wareki",
                "geburtsdatum",
                "date de naissance",
                "fecha de nacimiento",
                "data di nascita",
                "geboortedatum",
                "ngày sinh",
                "ngày, tháng, năm sinh",
                "ngày tháng năm sinh",
                "năm sinh",
                "วันเกิด",
                "วันเดือนปีเกิด",
                "เกิดวันที่",
                "tanggal lahir",
                "tarikh lahir",
            ],
        ) || has_any_word(combined, &["dob"]))
    {
        if has_any(combined, &["和暦", "wareki", "昭和・平成・令和"]) {
            return Some(("birth.date.wareki", "BIRTHDATE_DAY", 7));
        }
        return Some(("birth.date", "BIRTHDATE_DAY", 6));
    }
    if has_any(
        combined,
        &[
            "出生地",
            "出生国",
            "place of birth",
            "city of birth",
            "town/city of birth",
            "state/province of birth",
            "country of birth",
            "country/region of birth",
            "birthplace",
            "geburtsort",
            "geburtsland",
            "land der geburt",
            "lieu de naissance",
            "pays de naissance",
            "lugar de nacimiento",
            "país de nacimiento",
            "luogo di nascita",
            "geboorteplaats",
            "geboorteland",
            "nơi sinh",
            "tempat lahir",
        ],
    ) {
        if has_any(combined, &["country", "国", "geburtsland", "pays", "país"])
            && !has_any(combined, &["city", "town", "市", "lieu", "lugar", "ort"])
        {
            return Some(("birth.country", "UNKNOWN_TYPE", 6));
        }
        return Some(("birth.place", "UNKNOWN_TYPE", 6));
    }

    // 13. Nationality, Sex, Marital status, Relationship
    if has_any(
        combined,
        &[
            "国籍",
            "國籍",
            "nationality",
            "citizenship",
            "staatsangehörigkeit",
            "nationalité",
            "nacionalidad",
            "nacionalidade",
            "cittadinanza",
            "nationaliteit",
            "quốc tịch",
            "국적",
            "warganegara",
            "kewarganegaraan",
            "สัญชาติ",
        ],
    ) {
        return Some(("person.nationality", "PASSPORT_ISSUING_COUNTRY", 6));
    }
    if has_any(
        combined,
        &[
            "性別",
            "性别",
            "성별",
            "gender",
            "geschlecht",
            "sexe",
            "sexo",
            "sesso",
            "geslacht",
            "giới tính",
            "gioi tinh",
            "giói tính",
            "giói tinh",
            "jantina",
            "jenis kelamin",
            "เพศ",
        ],
    ) || has_any_word(combined, &["sex"])
    {
        return Some(("person.sex", "GENDER", 6));
    }
    if has_any(
        combined,
        &[
            "配偶者の有無",
            "婚姻",
            "marital status",
            "civil status",
            "familienstand",
            "état civil",
            "estado civil",
            "stato civile",
            "burgerlijke staat",
            "tình trạng hôn nhân",
            "status perkawinan",
            "taraf perkahwinan",
            "สถานภาพ",
        ],
    ) {
        return Some(("person.marital_status", "UNKNOWN_TYPE", 5));
    }
    if has_any(
        combined,
        &[
            "続柄",
            "関係",
            "relationship",
            "relation to",
            "quan hệ",
            "hubungan",
            "관계",
        ],
    ) {
        return Some(("person.relationship", "UNKNOWN_TYPE", 5));
    }

    // 14. Name fields (checked BEFORE address so `AddressDetails$textFirstName` matches `name.given`!)
    if has_any(
        combined,
        &[
            "mother's name",
            "mother's full name",
            "name of mother",
            "họ tên mẹ",
            "họ và tên mẹ",
            "母の氏名",
        ],
    ) {
        return Some(("family.mother.name", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "father's name",
            "father's full name",
            "name of father",
            "họ tên cha",
            "họ và tên cha",
            "họ tên bố",
            "父の氏名",
        ],
    ) {
        return Some(("family.father.name", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "guardian's name",
            "name of guardian",
            "legal guardian name",
            "họ tên người giám hộ",
        ],
    ) {
        return Some(("family.guardian.name", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "フリガナ",
            "ふりがな",
            "カタカナ",
            "かな",
            "kana",
            "furigana",
            "katakana",
            "hiragana",
        ],
    ) {
        if has_any(combined, &["姓", "氏", "family", "last"]) && !has_any(combined, &["氏名", "full"]) {
            return Some(("name.family.kana", "ALTERNATIVE_FAMILY_NAME", 6));
        }
        if (has_standalone_jp_given_name(combined) || has_any(combined, &["given", "first"]))
            && !has_any(combined, &["氏名", "お名前", "full"])
        {
            return Some(("name.given.kana", "ALTERNATIVE_GIVEN_NAME", 6));
        }
        return Some(("name.full.kana", "ALTERNATIVE_FULL_NAME", 6));
    }
    if has_any(
        combined,
        &[
            "ローマ字",
            "romaji",
            "name in english",
            "英文姓名",
            "姓名（英文）",
            "英文姓",
            "英文名",
            "姓 (英文)",
            "名 (英文)",
        ],
    ) {
        if has_any(combined, &["姓", "surname", "family", "last"]) && !has_any(combined, &["氏名", "full"]) {
            return Some(("name.family.latin", "NAME_LAST", 6));
        }
        if (has_standalone_jp_given_name(combined) || has_any(combined, &["英文名", "given", "first"]))
            && !has_any(combined, &["氏名", "姓名", "full"])
        {
            return Some(("name.given.latin", "NAME_FIRST", 6));
        }
        return Some(("name.full.latin", "NAME_FULL", 6));
    }
    if has_any(
        combined,
        &[
            "surname",
            "family name",
            "family_name",
            "last name",
            "last_name",
            "lastname",
            "lname",
            "maiden name",
            "maiden surname",
            "birth surname",
            "familienname",
            "nachname",
            "geburtsname",
            "nom de famille",
            "nom de naissance",
            "apellido",
            "cognome",
            "achternaam",
            "นามสกุล",
            "фамилия",
            "soyadı",
            "sobrenome",
            "apelido",
        ],
    ) || (has_any(label, &["姓", "氏"]) && !has_any(label, &["氏名", "姓名"]))
    {
        return Some(("name.family", "NAME_LAST", 6));
    }
    if !has_any(
        combined,
        &[
            "first name",
            "first_name",
            "firstname",
            "first and middle",
            "given and middle",
            "forename",
        ],
    ) && has_any(
        combined,
        &[
            "middle name",
            "middle_name",
            "middlename",
            "middle initial",
            "mname",
            "other given name",
            "other given names",
            "other name",
            "other names",
            "zweiter vorname",
            "отчество",
        ],
    ) {
        return Some(("name.middle", "NAME_MIDDLE", 6));
    }
    if has_any(
        combined,
        &[
            "given name",
            "given_name",
            "first name",
            "first_name",
            "firstname",
            "forename",
            "forenames",
            "fname",
            "vorname",
            "prénom",
            "prenom",
            "nombre de pila",
            "nombre(s)",
            "voornaam",
            "voornamen",
            "имя",
            "adı",
        ],
    ) || has_standalone_jp_given_name(label)
    {
        return Some(("name.given", "NAME_FIRST", 6));
    }
    if has_any(
        label,
        &[
            "氏名",
            "お名前",
            "名前",
            "姓名",
            "別名",
            "성명",
            "이름",
            "họ và tên",
            "họ tên",
            "họ, chữ đệm và tên",
            "họ, chữ đệm, tên",
            "họ chữ đệm và tên",
            "full name",
            "applicant_name",
            "emp_name",
            "your name",
            "nama penuh",
            "nama lengkap",
            "alias",
            "名称 / name",
        ],
    ) || label.trim().eq_ignore_ascii_case("nome")
        || has_any_word(id_name, &["name_full", "fullname", "full_name", "name_kanji"])
    {
        if owner == "employer" {
            return Some(("work.employer.name", "COMPANY_NAME", 5));
        }
        return Some(("name.full", "NAME_FULL", 6));
    }

    // 15. Specific Address subfields (postal, state/prefecture, city, building/line2, country)
    // Checked BEFORE general street/full address!
    if has_any(
        label,
        &[
            "郵便番号",
            "〒",
            "postal code",
            "postal_code",
            "postcode",
            "zip code",
            "zip",
            "postleitzahl",
            "plz",
            "code postal",
            "código postal",
            "cap",
            "우편번호",
            "poskod",
            "kode pos",
            "รหัสไปรษณีย์",
        ],
    ) || has_any_word(label, &["cep"])
        || has_any_word(id_name, &["zip", "zipcode", "postal", "postal_code", "postcode", "plz", "cep"])
    {
        if !has_any(
            label,
            &[
                "residence address",
                "full address",
                "present address",
                "office address",
                "mailing address",
                "postal address",
                "alamat surat-menyurat",
                "通訊地址",
                "city, state",
                "city/state",
            ],
        ) {
            return Some(("address.postal", "ADDRESS_HOME_ZIP", 6));
        }
    }
    if has_any(
        label,
        &[
            "都道府県",
            "prefecture",
            "province",
            "state",
            "bundesland",
            "département",
            "provincia",
            "tỉnh",
            "negeri",
            "provinsi",
        ],
    ) || has_any_word(id_name, &["state", "state_cd", "province", "prefecture"])
    {
        if !has_any(
            label,
            &[
                "residence address",
                "full address",
                "present address",
                "office address",
                "mailing address",
                "alamat surat-menyurat",
                "united states",
                "marital",
                "status",
                "birth",
                "city, state",
                "city/state",
                "cidade/estado",
                "cidade / estado",
            ],
        ) {
            return Some(("address.prefecture", "ADDRESS_HOME_STATE", 6));
        }
    }
    if has_any(
        label,
        &[
            "市区町村",
            "city",
            "municipality",
            "town",
            "suburb",
            "stadt",
            "wohnort",
            "ort",
            "ville",
            "commune",
            "ciudad",
            "cidade",
            "città",
            "comune",
            "woonplaats",
            "quận",
            "huyện",
            "phường",
            "xã",
            "bandar",
            "kota",
            "kabupaten",
            "kecamatan",
            "kelurahan",
            "barangay",
        ],
    ) || has_any_word(id_name, &["city", "town"])
    {
        if !has_any(
            label,
            &[
                "residence address",
                "full address",
                "present address",
                "office address",
                "mailing address",
                "alamat surat-menyurat",
                "birth",
                "geburt",
                "authority",
                "capacity",
                "ethnicity",
            ],
        ) {
            return Some(("address.city", "ADDRESS_HOME_CITY", 6));
        }
    }
    if has_any(
        label,
        &[
            "建物名",
            "部屋番号",
            "マンション",
            "アパート",
            "address line 2",
            "address 2",
            "street address 2",
            "adresszusatz",
            "complément d'adresse",
            "complemento",
            "apartment",
            "apt",
            "suite",
            "unit",
            "flat",
            "floor",
            "상세주소",
            "임차할부분",
            "current home address: number",
        ],
    ) || (has_any_word(
        id_name,
        &[
            "address2",
            "addressline2",
            "addr2",
            "line2",
            "address_line_2",
            "apt",
            "suite",
            "unit",
        ],
    ) && !label.contains("addr1"))
    {
        if !has_any(
            label,
            &[
                "residence address",
                "present address",
                "full address",
                "current address",
                "office address",
                "mailing address",
                "line 1",
                "住居地",
                "現住所",
                "住民登録",
                "現在の住所",
                "都道府県",
                "市区町村",
                "転入",
                "転出",
                "本国",
                "離日後の住所",
                "address after leaving",
            ],
        ) && !has_any_word(
            id_name,
            &["resident_address", "address_full", "current_address", "full_address"],
        ) {
            return Some(("address.building", "ADDRESS_HOME_LINE2", 6));
        }
    }
    if has_any(
        label,
        &[
            "country",
            "国名",
            "国家",
            "land:",
            "pays",
            "país",
            "paese",
            "quốc gia",
            "negara",
            "lugar de residencia",
        ],
    ) || label.trim().eq_ignore_ascii_case("land")
        || has_any_word(id_name, &["country", "ddlcountry"])
    {
        if !has_any(
            label,
            &[
                "residence address",
                "present address",
                "office address",
                "landmark",
                "birth",
                "geburt",
            ],
        ) {
            return Some(("address.country", "ADDRESS_HOME_COUNTRY", 6));
        }
    }
    if has_any(
        combined,
        &[
            "転出元住所",
            "従前の住所",
            "旧住所",
            "前住所",
            "previous address",
            "former address",
            "prior address",
            "nơi thường trú trước đây",
            "nơi ở trước đây",
        ],
    ) {
        return Some(("address.previous", "UNKNOWN_TYPE", 6));
    }
    if (has_any(
        combined,
        &[
            "quê quán",
            "nguyên quán",
            "que quan",
            "nguyen quan",
            "registered domicile",
        ],
    ) || has_any_word(id_name, &["registered_domicile", "ct01_domicile"]))
        && !has_any(
            combined,
            &["本籍", "honseki", "婚姻後", "新しい本籍", "選択", "judgement", "choice"],
        )
    {
        return Some(("address.registered_domicile", "UNKNOWN_TYPE", 6));
    }
    if has_any(
        combined,
        &[
            "現住所",
            "住居地",
            "住所",
            "所在地",
            "住址",
            "地址",
            "주소",
            "address_full",
            "current_address",
            "street address",
            "mailing address",
            "residential address",
            "residence address",
            "present address",
            "postal address",
            "address line 1",
            "address 1",
            "address",
            "anschrift",
            "straße",
            "adresse",
            "dirección",
            "domicilio",
            "endereço",
            "morada",
            "indirizzo",
            "adres",
            "địa chỉ",
            "nơi thường trú",
            "nơi ở hiện tại",
            "nơi cư trú",
            "alamat",
            "ที่อยู่",
            "rt/rt",
            "rw/rw",
        ],
    ) {
        if owner == "employer" {
            return Some(("work.employer.address", "ADDRESS_HOME_LINE1", 6));
        }
        if has_any(combined, &["町名", "番地", "street", "straße", "rue", "calle", "line1", "addr1"])
            && !has_any(combined, &["現住所", "住居地", "address_full", "current_address"])
        {
            return Some(("address.street", "ADDRESS_HOME_LINE1", 6));
        }
        return Some(("address.full", "ADDRESS_HOME_LINE1", 6));
    }

    // 16. Signatures & form dates
    if (has_any(
        combined,
        &[
            "署名",
            "サイン",
            "签字",
            "签名",
            "서명",
            "signature",
            "assinatura",
            "unterschrift",
            "handtekening",
            "chữ ký",
            "tandatangan",
        ],
    ) || has_any_word(combined, &["firma"]))
        && !has_any(combined, &["date", "日", "datum", "fecha"])
    {
        return Some(("form.signature", "UNKNOWN_TYPE", 5));
    }
    if has_any(
        combined,
        &[
            "年月日",
            "日付",
            "日期",
            "일자",
            "기간",
            "date",
            "datum",
            "fecha",
            "data",
            "ngày",
            "tarikh",
            "tanggal",
        ],
    ) {
        return Some(("form.date", "UNKNOWN_TYPE", 4));
    }

    // 17. Login username & password
    if input_type == "password"
        || has_any(
            combined,
            &[
                "password",
                "passwort",
                "mot de passe",
                "contraseña",
                "パスワード",
                "mật khẩu",
            ],
        )
    {
        return Some(("login.password", "PASSWORD", 6));
    }
    if has_any(
        combined,
        &[
            "username",
            "user_name",
            "user id",
            "login",
            "ユーザーid",
            "ログインid",
        ],
    ) {
        return Some(("login.username", "USERNAME", 5));
    }

    None
}

fn is_kanji_ideograph(c: char) -> bool {
    matches!(
        c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}' | '々' | '〆' | 'ヵ' | 'ヶ'
    )
}

/// Matches standalone Japanese `名` (given name) while excluding `<Kanji>名` and `名<Kanji>` compounds
/// (`施設名`, `在籍施設名`, `園名`, `会社名`, `学校名`, `病院名`, `氏名`, `姓名`, `名前`, `名称`, `名義`, etc.).
fn has_standalone_jp_given_name(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if c != '名' {
            continue;
        }
        let prev = i.checked_sub(1).and_then(|p| chars.get(p)).copied();
        let next = chars.get(i + 1).copied();
        if prev.is_some_and(is_kanji_ideograph) || next.is_some_and(is_kanji_ideograph) {
            continue;
        }
        return true;
    }
    false
}

fn match_chromium_patterns(field: &FormFieldInput) -> Option<(String, String)> {
    let label_text = if field.label.chars().any(char::is_alphabetic) {
        field.label.as_str()
    } else {
        field.placeholder.as_str()
    };
    let name_text = format!(
        "{} {}",
        semantic_identifier(&field.name),
        semantic_identifier(&field.id)
    );
    let all_lower = format!("{label_text} {name_text} {}", field.section).to_lowercase();
    let _has_cjk = label_text.chars().any(is_cjk_char);
    let has_card_context = has_any(
        &all_lower,
        &[
            "card",
            "cc",
            "credit",
            "debit",
            "cvv",
            "cvc",
            "csc",
            "カード",
            "クレジット",
            "信用卡",
            "银行卡",
            "銀行卡",
            "카드",
            "결제",
        ],
    );

    for rule in CHROMIUM_RULES.iter() {
        // Prevent CJK false positives (`学校名`, `名称`, `月給`, `所得`) from firing `CREDIT_CARD_*`
        // rules on non-payment government/onboarding forms.
        if rule.chrome_type.starts_with("CREDIT_CARD_")
            && !has_card_context
            && has_any(
                &all_lower,
                &[
                    "学校",
                    "school",
                    "所属機関",
                    "勤務先",
                    "名称",
                    "月給",
                    "週給",
                    "日給",
                    "所得",
                    "在留",
                    "居留",
                    "パスポート",
                    "旅券",
                    "护照",
                ],
            )
        {
            continue;
        }
        // Prevent US-1040 line references ("Add lines 1z, 2b...") from firing `ADDRESS_HOME_APT_NUM`.
        if rule.chrome_type == "ADDRESS_HOME_APT_NUM"
            && has_any(&all_lower, &["add lines", "subtract line", "income", "tax"])
        {
            continue;
        }
        if rule.chrome_type == "NAME_FIRST"
            && label_text.contains('名')
            && !has_standalone_jp_given_name(label_text)
        {
            continue;
        }
        let mut matched = false;
        if rule.match_label && !label_text.trim().is_empty() && rule.positive.is_match(&label_text) {
            let neg = rule
                .negative
                .as_ref()
                .is_some_and(|n| n.is_match(&label_text));
            if !neg {
                matched = true;
            }
        }
        if !matched
            && rule.match_name
            && !name_text.trim().is_empty()
            && rule.positive.is_match(&name_text)
        {
            let neg = rule
                .negative
                .as_ref()
                .is_some_and(|n| n.is_match(&name_text));
            if !neg {
                matched = true;
            }
        }
        if matched {
            return Some((rule.attribute.clone(), rule.chrome_type.clone()));
        }
    }
    None
}

fn semantic_identifier(identifier: &str) -> &str {
    if identifier.starts_with("box:") { "" } else { identifier }
}

/// Whether the words around a field are in Latin letters, with their accents.
fn is_written_in_latin(field: &FormFieldInput) -> bool {
    [&field.label, &field.placeholder, &field.name, &field.id]
        .iter()
        .all(|text| {
            text.chars()
                .all(|c| !c.is_alphabetic() || (c as u32) < 0x250 || (0x1E00..=0x1EFF).contains(&(c as u32)))
        })
}

fn is_latin_value(text: &str) -> bool {
    let mut has_alpha = false;
    for c in text.chars() {
        if c.is_alphabetic() {
            has_alpha = true;
            if (c as u32) >= 0x250 && !(0x1E00..=0x1EFF).contains(&(c as u32)) {
                return false;
            }
        }
    }
    has_alpha
}

fn is_cjk_char(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x30FF // Hiragana & Katakana
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xAC00..=0xD7AF // Hangul Syllables
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
    )
}

fn collapse_cjk_spaces(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if (c == ' ' || c == '\u{3000}') && !out.is_empty() {
            let prev = out.chars().last().unwrap_or(' ');
            let mut j = i + 1;
            while j < chars.len() && (chars[j] == ' ' || chars[j] == '\u{3000}') {
                j += 1;
            }
            if j < chars.len() && is_cjk_char(prev) && is_cjk_char(chars[j]) {
                i = j;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Looks up and formats the value for a matched field from a profile's detail map.
pub fn resolve_and_format_value(
    field: &FormFieldInput,
    matched: &FieldMatch,
    details: &BTreeMap<String, String>,
) -> Option<String> {
    let combined = format!(
        "{} {} {} {} {}",
        field.label, field.name, field.id, field.placeholder, field.format
    )
    .to_lowercase();

    let attr = matched.attribute.as_str();
    if attr.is_empty() || matched.owner == "official_only" {
        return None;
    }

    // Never substitute an emergency contact's relationship into a household-head relationship field.
    if matches!(attr, "emergency.relation" | "person.relationship")
        && has_any(&combined, &["chủ hộ", "世帯主", "세대주", "head of household", "kepala keluarga"])
        && !details.contains_key("household_head.relation")
    {
        return None;
    }

    if matched.owner != "applicant" && !matched.owner.is_empty() {
        let role_prefixed = format!("{}.{}", matched.owner, attr);
        if let Some(val) = details.get(&role_prefixed) {
            return Some(finish_value(field, attr, val));
        }
    }

    // A field written in Latin letters (or bilingual but explicitly asking for English/Romaji/passport
    // Latin script) takes the Latin spelling of a detail that has one.
    let explicit_latin_cue = has_any(
        &combined,
        &[
            "in english",
            "romaji",
            "ローマ字",
            "영문",
            "英文",
            "latin",
            "ascii",
            "as shown in passport",
            "as in passport",
        ],
    );
    let wants_latin = is_written_in_latin(field) || explicit_latin_cue;
    let hangul_attribute = match attr {
        "name.full" | "name.full.hangul" => "name.full.hangul",
        "name.family" | "name.family.hangul" => "name.family.hangul",
        "name.given" | "name.given.hangul" => "name.given.hangul",
        _ => "",
    };
    if !hangul_attribute.is_empty()
        && !explicit_latin_cue
        && has_any(&combined, &["한글", "hangul", "korean name", "한국어"])
    {
        return details.get(hangul_attribute).map(|value| finish_value(field, attr, value));
    }

    if let Some(stem) = attr
        .strip_prefix("name.")
        .and_then(|s| s.strip_suffix(".romaji"))
    {
        if let Some(explicit) = details
            .get(attr)
            .or_else(|| details.get(&format!("name.romaji.{stem}")))
        {
            return Some(finish_value(field, attr, explicit));
        }
        if let Some(kana) = details
            .get(&format!("name.{stem}.kana"))
            .or_else(|| details.get(&format!("name.{stem}.hiragana")))
        {
            let hepburn = kana_to_hepburn(kana);
            if !hepburn.is_empty() {
                return Some(finish_value(field, attr, &hepburn));
            }
        }
        if let Some(latin) = details.get(&format!("name.{stem}.latin")) {
            return Some(finish_value(field, attr, latin));
        }
        if let Some(base) = details.get(&format!("name.{stem}")) {
            return Some(finish_value(field, attr, base));
        }
        return None;
    }

    if let Some(stem) = attr
        .strip_prefix("name.")
        .and_then(|s| s.strip_suffix(".latin"))
    {
        if let Some(latin) = details.get(attr) {
            return Some(finish_value(field, attr, latin));
        }
        if let Some(romaji) = details
            .get(&format!("name.{stem}.romaji"))
            .or_else(|| details.get(&format!("name.romaji.{stem}")))
        {
            return Some(finish_value(field, attr, romaji));
        }
        if let Some(kana) = details
            .get(&format!("name.{stem}.kana"))
            .or_else(|| details.get(&format!("name.{stem}.hiragana")))
        {
            let hepburn = kana_to_hepburn(kana);
            if !hepburn.is_empty() {
                return Some(finish_value(field, attr, &hepburn));
            }
        }
        if let Some(base) = details
            .get(&format!("name.{stem}"))
            .filter(|v| !v.chars().any(is_cjk_char))
        {
            return Some(finish_value(field, attr, base));
        }
        return None;
    }

    if wants_latin {
        let base_is_latin = details.get(attr).is_some_and(|v| is_latin_value(v));
        if (!base_is_latin || explicit_latin_cue)
            && let Some(latin) = details.get(&format!("{attr}.latin"))
        {
            return Some(finish_value(field, attr, latin));
        }
        if matches!(attr, "name.full" | "name.family" | "name.given")
            && details
                .get(attr)
                .is_none_or(|v| v.chars().any(is_cjk_char))
        {
            if let Some(romaji) = details.get(&format!("{attr}.romaji")) {
                return Some(finish_value(field, attr, romaji));
            }
            if let Some(kana) = details
                .get(&format!("{attr}.kana"))
                .or_else(|| details.get(&format!("{attr}.hiragana")))
            {
                let hepburn = kana_to_hepburn(kana);
                if !hepburn.is_empty() {
                    return Some(finish_value(field, attr, &hepburn));
                }
            }
        }
    }

    if attr == "contact.phone.country" {
        let cc = details.get("contact.phone.country").cloned().or_else(|| {
            ["contact.phone", "contact.phone.mobile", "contact.phone.home"]
                .iter()
                .find_map(|k| details.get(*k).and_then(|v| parse_e164_phone(v)))
                .map(|p| p.country_code)
        })?;
        return format_phone_country_for_field(field, &cc);
    }

    if attr.ends_with(".era") {
        let base = if attr == "birth.era" {
            "birth.date"
        } else {
            attr.trim_end_matches(".era")
        };
        if let Some(iso) = lookup_raw_detail(base, &matched.owner, details)
            && let Some(wareki) = to_wareki(iso)
        {
            return format_era_name_for_field(field, &wareki);
        }
        if let Some(direct) = details.get(attr) {
            return Some(finish_value(field, attr, direct));
        }
        return None;
    }

    if attr.ends_with(".era_year") {
        let base = if attr == "birth.era_year" {
            "birth.date"
        } else {
            attr.trim_end_matches(".era_year")
        };
        if let Some(iso) = lookup_raw_detail(base, &matched.owner, details)
            && let Some(wareki) = to_wareki(iso)
        {
            return format_era_year_for_field(field, &wareki);
        }
        if let Some(direct) = details.get(attr) {
            return Some(finish_value(field, attr, direct));
        }
        return None;
    }

    if attr.ends_with(".wareki") || (is_date_attr_key(attr) && crate::date_format::is_wareki(field)) {
        if let Some(explicit_wareki) = details.get(attr).filter(|_| attr.ends_with(".wareki")) {
            return Some(explicit_wareki.clone());
        }
        let base = attr.strip_suffix(".wareki").unwrap_or(attr);
        if let Some(explicit_companion) = details.get(&format!("{base}.wareki"))
            && field.options.is_empty()
        {
            return Some(explicit_companion.clone());
        }
        if let Some(iso) = lookup_raw_detail(base, &matched.owner, details)
            && let Some(wareki) = to_wareki(iso)
        {
            let rendered = if has_any(&combined, &["r/h/s", "アルファベット"]) {
                match wareki.day {
                    Some(d) => format!("{}{}.{}.{}", wareki.era_code, wareki.year, wareki.month, d),
                    None => format!("{}{}.{}", wareki.era_code, wareki.year, wareki.month),
                }
            } else {
                wareki.format_kanji(true)
            };
            if !field.options.is_empty() {
                return resolve_select_option(field, base, iso, &rendered).or(Some(rendered));
            }
            return Some(rendered);
        }
    }

    if attr == "bank.account.holder.zengin"
        || (attr.starts_with("bank.account.holder")
            && has_any(&combined, &["半角", "zengin", "half_kana", "全銀"]))
    {
        if let Some(z) = details.get("bank.account.holder.zengin") {
            return Some(z.clone());
        }
        if let Some(kana) = details
            .get("bank.account.holder.kana")
            .or_else(|| details.get("name.full.kana"))
        {
            return Some(to_zengin_halfwidth_kana(kana));
        }
    }

    if (attr == "name.full.kana" || attr == "name.full.hiragana")
        && has_any(&combined, &["ふりがな", "hiragana", "ひらがな"])
    {
        if let Some(hira) = details.get("name.full.hiragana") {
            return Some(hira.clone());
        }
        if let Some(kana) = details.get("name.full.kana") {
            return Some(to_hiragana(kana));
        }
    }
    if attr == "name.full.kana" {
        if let Some(kana) = details.get("name.full.kana") {
            return Some(to_fullwidth_katakana(kana));
        }
    }

    if attr == "address.house_number" {
        if let Some(direct) = details.get("address.house_number") {
            return Some(finish_value(field, attr, direct));
        }
        if let Some(street) = details.get("address.street") {
            let first = street.split_whitespace().next().unwrap_or("");
            let last = street.split_whitespace().last().unwrap_or("");
            if !first.is_empty() && first.chars().any(|c| c.is_ascii_digit()) {
                return Some(first.to_string());
            }
            if !last.is_empty() && last.chars().all(|c| c.is_ascii_alphanumeric()) && last.chars().any(|c| c.is_ascii_digit()) {
                return Some(last.to_string());
            }
        }
        return None;
    }

    if matches!(attr, "address.city" | "address.full") {
        let lbl_lower = field.label.to_lowercase();
        if has_any(&lbl_lower, &["city, state", "city/state", "cidade/estado", "cidade / estado"])
            && !has_any(&lbl_lower, &["street", "number, street", "line 1", "home address"])
        {
            if let Some(city) = details.get("address.city") {
                let state = details
                    .get("address.prefecture")
                    .or_else(|| details.get("address.state"))
                    .or_else(|| details.get("address.province"));
                let zip = if has_any(&lbl_lower, &["zip", "postal", "cep"]) {
                    details.get("address.postal").or_else(|| details.get("address.postal_code"))
                } else {
                    None
                };
                let sep = if lbl_lower.contains('/') { "/" } else { ", " };
                let mut combined_cs = match state {
                    Some(st) if !st.trim().is_empty() => format!("{city}{sep}{st}"),
                    _ => city.clone(),
                };
                if let Some(z) = zip {
                    if !z.trim().is_empty() {
                        combined_cs.push(' ');
                        combined_cs.push_str(z.trim());
                    }
                }
                return Some(combined_cs);
            }
        }
    }

    if matches!(
        attr,
        "birth.day" | "birth.month" | "birth.year" | "card.expiry.month" | "card.expiry.year"
    ) {
        if let Some((alias, value)) = date_part_value(attr, details) {
            return Some(finish_value(field, alias, value));
        }
    }

    if let Some(direct) = details.get(attr) {
        return Some(finish_value(field, attr, direct));
    }
    if let Some((alias, value)) = date_part_value(attr, details) {
        return Some(finish_value(field, alias, value));
    }

    for &key in fallback_keys_for(attr) {
        if let Some(val) = details.get(key) {
            return Some(finish_value(field, attr, val));
        }
    }
    None
}

/// Formats a single chosen or remembered detail key for a specific form control, deriving script,
/// calendar, phone and country companions before formatting.
pub fn format_detail_for_field(
    field: &FormFieldInput,
    detail_key: &str,
    details: &BTreeMap<String, String>,
) -> String {
    let trimmed_key = detail_key.trim();
    if trimmed_key.is_empty() {
        return String::new();
    }
    let canonical = crate::profile::canonical_key(trimmed_key);
    let mut enriched = details.clone();
    if canonical != trimmed_key
        && !enriched.contains_key(canonical)
        && let Some(raw) = enriched.get(trimmed_key).cloned()
    {
        enriched.insert(canonical.to_string(), raw);
    }
    crate::document::derive_companion_details(&mut enriched);
    let matched = FieldMatch {
        attribute: canonical.to_string(),
        chrome_type: String::new(),
        owner: "applicant".to_string(),
        score: 10,
        section_id: 0,
        value: None,
    };
    if let Some(formatted) = resolve_and_format_value(field, &matched, &enriched) {
        return formatted;
    }
    if let Some(direct) = enriched.get(trimmed_key) {
        return finish_value(field, canonical, direct);
    }
    String::new()
}

fn fallback_keys_for(attr: &str) -> &'static [&'static str] {
    match attr {
        "name.full.romaji" => &["name.romaji.full", "name.full.latin", "name.full"],
        "name.family.romaji" => &["name.romaji.family", "name.family.latin", "name.family"],
        "name.given.romaji" => &["name.romaji.given", "name.given.latin", "name.given"],
        "name.full.hiragana" => &["name.full.kana"],
        "contact.phone" | "contact.phone_landline" | "contact.phone_primary" => &[
            "contact.phone",
            "contact.phone.mobile",
            "contact.phone.home",
        ],
        "contact.phone.mobile" | "contact.phone_mobile" => &[
            "contact.phone.mobile",
            "contact.phone",
            "contact.phone.home",
        ],
        "address.full" | "address.japan.full" | "address.korea.full" => {
            &["address.full", "address.street"]
        }
        "address.street" | "address.street_and_number" => &["address.street", "address.full"],
        "address.prefecture" => &["address.state", "address.province"],
        "address.postal" | "address.postal_code" => &["address.postal", "address.postal_code"],
        "passport.number" | "id.passport.number" => &["id.passport.number", "passport.number"],
        "id.passport.expiry" | "passport.expiry" | "passport.expiry_date" | "id.passport.expiry_date" => &[
            "id.passport.expiry",
            "id.passport.expiry_date",
            "passport.expiry_date",
            "passport.expiry",
        ],
        "id.passport.issued" | "passport.issued" | "passport.issue_date" | "id.passport.issue_date" => &[
            "id.passport.issued",
            "id.passport.issue_date",
            "passport.issue_date",
            "passport.issued",
        ],
        "passport.nationality" | "person.nationality" | "nationality" | "nationality.current" => {
            &["person.nationality", "nationality", "passport.nationality"]
        }
        "personal.sex" | "person.sex" | "sex" => &["person.sex", "sex", "personal.sex"],
        "id.driver_license.number" => &["id.driver_license.number", "id.drivers_license.number"],
        "id.driver_license.expiry" | "id.drivers_license.expiry_date" => &[
            "id.driver_license.expiry",
            "id.drivers_license.expiry_date",
            "id.card.expiry",
        ],
        "id.card.expiry" => &[
            "id.card.expiry",
            "id.driver_license.expiry",
            "id.drivers_license.expiry_date",
        ],
        "id.driver_license.issued" | "id.drivers_license.issue_date" => &[
            "id.driver_license.issued",
            "id.drivers_license.issue_date",
            "id.card.issued",
        ],
        "id.card.issued" => &[
            "id.card.issued",
            "id.driver_license.issued",
            "id.drivers_license.issue_date",
        ],
        "id.national.number" => &["id.national.number", "id.national_id.number"],
        "id.residence_card.number" | "residence_card.arc_number" => {
            &["id.residence_card.number", "residence_card.arc_number"]
        }
        "tax.id" => &[
            "tax.id",
            "id.tax.number",
            "id.ssn",
            "id.mynumber",
            "id.tax.de_steuer_id",
        ],
        "id.tax.number" => &[
            "id.tax.number",
            "tax.id",
            "id.ssn",
            "id.mynumber",
            "id.tax.de_steuer_id",
        ],
        "ssn" | "id.ssn" => &[
            "id.ssn",
            "tax.id",
            "id.tax.number",
            "id.mynumber",
            "id.tax.de_steuer_id",
        ],
        "work.title" => &["work.title", "person.profession"],
        "person.profession" => &["person.profession", "work.title"],
        "work.employer.name" | "employer.name" | "employment.employer" => &[
            "work.employer.name",
            "employer.name",
            "employment.employer",
        ],
        _ => &[],
    }
}

fn lookup_raw_detail<'a>(
    attr: &str,
    owner: &str,
    details: &'a BTreeMap<String, String>,
) -> Option<&'a str> {
    if owner != "applicant" && !owner.is_empty() {
        if let Some(v) = details.get(&format!("{owner}.{attr}")) {
            return Some(v.as_str());
        }
    }
    if let Some(v) = details.get(attr) {
        return Some(v.as_str());
    }
    if let Some((_, v)) = date_part_value(attr, details) {
        return Some(v.as_str());
    }
    for &key in fallback_keys_for(attr) {
        if let Some(v) = details.get(key) {
            return Some(v.as_str());
        }
    }
    None
}

fn date_part_value<'a>(
    attr: &str,
    details: &'a BTreeMap<String, String>,
) -> Option<(&'static str, &'a String)> {
    let (alias, canonical) = match attr {
        "birth.day" => ("birth.date.day", "birth.date"),
        "birth.month" => ("birth.date.month", "birth.date"),
        "birth.year" => ("birth.date.year", "birth.date"),
        "card.expiry.month" => ("card.expiry.month", "card.expiry"),
        "card.expiry.year" => ("card.expiry.year", "card.expiry"),
        "id.passport.expiry" | "passport.expiry" => {
            ("id.passport.expiry_date", "id.passport.expiry_date")
        }
        "id.passport.issued" | "passport.issued" => {
            ("id.passport.issue_date", "id.passport.issue_date")
        }
        _ => return None,
    };
    details.get(canonical).map(|value| (alias, value))
}

fn finish_value(field: &FormFieldInput, attribute: &str, value: &str) -> String {
    let attribute = if attribute == "card.expiry" { "card.expiry_date" } else { attribute };
    let mut rendered = if let Some(formatted_date) =
        crate::date_format::format_date_value(field, attribute, value)
    {
        formatted_date
    } else if matches!(attribute, "person.sex" | "sex" | "personal.sex") {
        format_sex_for_field(field, value).unwrap_or_else(|| value.to_string())
    } else if matches!(
        attribute,
        "person.relationship"
            | "household_head.relation"
            | "emergency.relation"
            | "dependent.relation"
            | "spouse.relation"
            | "relationship"
            | "relation"
    ) {
        format_relationship_for_field(field, value).unwrap_or_else(|| value.to_string())
    } else if is_country_attr_key(attribute) {
        format_country_for_field(field, value).unwrap_or_else(|| value.to_string())
    } else if is_phone_attr_key(attribute) {
        format_phone_for_field(field, value).unwrap_or_else(|| value.to_string())
    } else {
        value.to_string()
    };

    if (attribute.starts_with("name.")
        || attribute.starts_with("card.holder")
        || attribute.starts_with("bank.account.holder"))
        && !rendered.chars().any(is_cjk_char)
    {
        let visible = visible_field_text(field).to_lowercase();
        if has_any(
            &visible,
            &[
                "block letters",
                "in capitals",
                "capital letters",
                "uppercase",
                "all caps",
                "大文字",
                "chữ in hoa",
                "en majuscules",
                "großbuchstaben",
                "mayúsculas",
            ],
        ) {
            rendered = rendered.to_uppercase();
        }
    }

    if !field.options.is_empty() {
        if let Some(chosen_opt) = resolve_select_option(field, attribute, value, &rendered) {
            return chosen_opt;
        }
    }
    rendered
}

fn is_country_attr_key(attribute: &str) -> bool {
    matches!(
        attribute,
        "person.nationality"
            | "nationality"
            | "nationality.current"
            | "passport.nationality"
            | "birth.country"
            | "address.country"
            | "id.passport.country"
    )
}

fn format_phone_for_field(field: &FormFieldInput, value: &str) -> Option<String> {
    let parts = parse_e164_phone(value)?;
    let visible = visible_field_text(field).to_lowercase();
    let ac = field.autocomplete.to_ascii_lowercase();
    let wants_digits_only = has_any(
        &visible,
        &[
            "ハイフンなし",
            "ハイフン無し",
            "数字のみ",
            "半角数字",
            "digits only",
            "without hyphen",
            "no hyphen",
        ],
    );
    if (10..=11).contains(&field.max_length) || wants_digits_only {
        return Some(parts.national_digits);
    }
    let hyphenated = parts.national_hyphenated();
    if (12..=13).contains(&field.max_length)
        && value.chars().count() > field.max_length as usize
        && hyphenated.len() <= field.max_length as usize
    {
        return Some(hyphenated);
    }
    if ac.contains("tel-national") || ac.contains("tel-local") {
        return Some(hyphenated);
    }
    None
}

fn format_phone_country_for_field(field: &FormFieldInput, cc_raw: &str) -> Option<String> {
    let trimmed = cc_raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let digits: String = trimmed.chars().filter(char::is_ascii_digit).collect();
    let with_plus = if digits.is_empty() {
        trimmed.to_string()
    } else {
        format!("+{digits}")
    };
    if !field.options.is_empty() {
        for opt in &field.options {
            for part in select_option_parts(opt) {
                if part == with_plus
                    || (!digits.is_empty() && (part == digits || part == format!("00{digits}")))
                {
                    return Some(select_option_return_value(opt));
                }
            }
        }
        if !digits.is_empty() {
            let needle = format!("+{digits}");
            for opt in &field.options {
                if let Some(pos) = opt.find(&needle) {
                    let after = opt[pos + needle.len()..].chars().next();
                    if !after.is_some_and(|c| c.is_ascii_digit()) {
                        return Some(select_option_return_value(opt));
                    }
                }
            }
        }
        return None;
    }
    if !digits.is_empty()
        && ((field.max_length > 0 && (field.max_length as usize) < with_plus.len())
            || field.input_type.eq_ignore_ascii_case("number"))
    {
        return Some(digits);
    }
    Some(with_plus)
}

fn select_option_parts(opt: &str) -> Vec<&str> {
    let trimmed = opt.trim();
    if !trimmed.contains(" | ")
        && let Some((v, l)) = trimmed.split_once('|')
    {
        let vt = v.trim();
        let lt = l.trim();
        if !vt.is_empty() && !lt.is_empty() {
            return vec![vt, lt];
        }
    }
    vec![trimmed]
}

fn select_option_return_value(opt: &str) -> String {
    let trimmed = opt.trim();
    if !trimmed.contains(" | ")
        && let Some((v, l)) = trimmed.split_once('|')
    {
        let vt = v.trim();
        let lt = l.trim();
        if !vt.is_empty() && !lt.is_empty() {
            return vt.to_string();
        }
    }
    opt.to_string()
}

fn format_era_name_for_field(
    field: &FormFieldInput,
    wareki: &crate::format::WarekiDate,
) -> Option<String> {
    let romaji_era = match wareki.era_code.as_str() {
        "R" => "Reiwa",
        "H" => "Heisei",
        "S" => "Showa",
        "T" => "Taisho",
        "M" => "Meiji",
        _ => "",
    };
    if !field.options.is_empty() {
        for opt in &field.options {
            for o in select_option_parts(opt) {
                if o == wareki.era_kanji
                    || o.eq_ignore_ascii_case(&wareki.era_code)
                    || (!romaji_era.is_empty() && o.eq_ignore_ascii_case(romaji_era))
                {
                    return Some(select_option_return_value(opt));
                }
            }
        }
        for opt in &field.options {
            if opt.contains(&wareki.era_kanji) {
                return Some(select_option_return_value(opt));
            }
        }
        return None;
    }
    if field.max_length == 1 || is_written_in_latin(field) {
        Some(wareki.era_code.clone())
    } else {
        Some(wareki.era_kanji.clone())
    }
}

fn format_era_year_for_field(
    field: &FormFieldInput,
    wareki: &crate::format::WarekiDate,
) -> Option<String> {
    let plain = wareki.year.to_string();
    let padded = format!("{:02}", wareki.year);
    if !field.options.is_empty() {
        for opt in &field.options {
            for o in select_option_parts(opt) {
                if o == plain
                    || o == padded
                    || o == format!("{plain}年")
                    || (wareki.year == 1 && (o == "元" || o == "元年"))
                {
                    return Some(select_option_return_value(opt));
                }
            }
        }
    }
    if field.max_length == 2
        && (field.placeholder.eq_ignore_ascii_case("yy") || field.placeholder == "00")
    {
        Some(padded)
    } else {
        Some(plain)
    }
}

fn visible_field_text(field: &FormFieldInput) -> String {
    if field.label.trim().is_empty() {
        format!("{} {} {} {}", field.name, field.id, field.placeholder, field.format)
    } else {
        format!("{} {} {}", field.label, field.placeholder, field.format)
    }
}

fn format_sex_for_field(field: &FormFieldInput, value: &str) -> Option<String> {
    let canonical = crate::normalize::sex(value)?;
    let is_female = canonical == "female";
    let visible = visible_field_text(field).to_lowercase();
    let visible_folded = crate::normalize::fold(&visible);
    let latin_field = is_written_in_latin(field);
    if (field.max_length == 1 && latin_field)
        || has_any(
            &visible,
            &["m=male", "f=female", "(m/f)", "(f/m)", "m / f", "f / m", "sex (m", "sex: m"],
        )
    {
        return Some(if is_female { "F" } else { "M" }.to_string());
    }
    if has_any(
        &visible_folded,
        &["gioi tinh", "gidi tinh", "phai", "nam/nu", "nam / nu"],
    ) {
        return Some(if is_female { "Nữ" } else { "Nam" }.to_string());
    }
    if has_any(&visible, &["geschlecht"]) && !visible.contains("sex") {
        return Some(if is_female { "weiblich" } else { "männlich" }.to_string());
    }
    if has_any(&visible, &["sexe"]) && !visible.contains("sex ") {
        return Some(if is_female { "Féminin" } else { "Masculin" }.to_string());
    }
    if has_any(&visible, &["성별"]) && !visible.contains("sex") {
        if matches!(value.trim(), "여" | "남" | "여성" | "남성") && field.max_length != 1 {
            return None;
        }
        return Some(if is_female { "여" } else { "남" }.to_string());
    }
    if (has_any(&visible, &["性別", "性别"]) || (visible.contains('男') && visible.contains('女')))
        && !visible.contains("in english")
    {
        if matches!(value.trim(), "女" | "男" | "女性" | "男性") && field.max_length != 1 {
            return None;
        }
        return Some(if is_female { "女" } else { "男" }.to_string());
    }
    let value_has_cjk = value.chars().any(is_cjk_char);
    let value_has_bilingual_parens = value.contains('(') || value.contains('（') || value.contains('/');
    if (latin_field
        || ((visible.contains("sex") || visible.contains("gender"))
            && !has_any(&visible, &["性別", "性别"])))
        && (value_has_cjk
            || value_has_bilingual_parens
            || !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "male" | "female" | "m" | "f" | "man" | "woman"
            ))
    {
        return Some(if is_female { "Female" } else { "Male" }.to_string());
    }
    None
}

fn format_relationship_for_field(field: &FormFieldInput, value: &str) -> Option<String> {
    let folded = crate::normalize::fold(value.trim());
    let role = match folded.as_str() {
        "世帯主" | "本人" | "chu ho" | "세대주" | "head of household" | "self" => "head",
        "妻" | "vo" | "아내" | "처" | "wife" => "wife",
        "夫" | "chong" | "남편" | "husband" => "husband",
        "配偶者" | "vo/chong" | "배우자" | "spouse" | "partner" => "spouse",
        "子" | "長男" | "長女" | "二男" | "二女" | "三男" | "三女" | "con" | "con de"
        | "자" | "자녀" | "child" | "son" | "daughter" => "child",
        "父" | "cha" | "bo" | "부" | "father" => "father",
        "母" | "me" | "모" | "mother" => "mother",
        _ => return None,
    };
    let visible = visible_field_text(field).to_lowercase();
    let visible_folded = crate::normalize::fold(&visible);
    if has_any(&visible_folded, &["quan he", "chu ho"]) {
        return Some(
            match role {
                "head" => "Chủ hộ",
                "wife" => "Vợ",
                "husband" => "Chồng",
                "spouse" => "Vợ/chồng",
                "child" => "Con",
                "father" => "Cha",
                "mother" => "Mẹ",
                _ => return None,
            }
            .to_string(),
        );
    }
    if has_any(&visible, &["続柄", "世帯主", "本人との関係"]) && !visible.contains("in english") {
        if value.chars().any(is_cjk_char) {
            return None;
        }
        return Some(
            match role {
                "head" => "世帯主",
                "wife" => "妻",
                "husband" => "夫",
                "spouse" => "配偶者",
                "child" => "子",
                "father" => "父",
                "mother" => "母",
                _ => return None,
            }
            .to_string(),
        );
    }
    if has_any(&visible, &["relationship", "relation"]) && !has_any(&visible, &["続柄", "関係", "quan hệ"]) {
        if value.is_ascii() {
            return None;
        }
        return Some(
            match role {
                "head" => "Head of household",
                "wife" => "Wife",
                "husband" => "Husband",
                "spouse" => "Spouse",
                "child" => "Child",
                "father" => "Father",
                "mother" => "Mother",
                _ => return None,
            }
            .to_string(),
        );
    }
    None
}

fn is_placeholder_option(opt: &str) -> bool {
    let t = opt.trim().to_lowercase();
    t.is_empty()
        || matches!(
            t.as_str(),
            "-" | "--" | "---" | "select" | "choose" | "選択" | "選択してください"
        )
        || t.starts_with("select ")
        || t.starts_with("choose ")
        || t.starts_with("please select")
}

fn resolve_country_option(
    options: &[String],
    want: &CountryInfo,
    raw_value: &str,
) -> Option<String> {
    let raw_trimmed = raw_value.trim();
    for opt in options {
        let o = opt.trim();
        if !is_placeholder_option(o)
            && select_option_parts(opt)
                .iter()
                .any(|p| p.eq_ignore_ascii_case(raw_trimmed))
        {
            return Some(select_option_return_value(opt));
        }
    }
    for opt in options {
        let o = opt.trim();
        if is_placeholder_option(o) {
            continue;
        }
        if let Some(opt_info) = lookup_country_option(o)
            && opt_info.alpha2 == want.alpha2
        {
            return Some(select_option_return_value(opt));
        }
    }
    None
}

fn resolve_select_option(
    field: &FormFieldInput,
    attribute: &str,
    raw_value: &str,
    rendered: &str,
) -> Option<String> {
    if field.options.is_empty() {
        return None;
    }
    if is_country_attr_key(attribute) {
        if let Some(info) = lookup_country(raw_value).or_else(|| lookup_country(rendered)) {
            return resolve_country_option(&field.options, info, raw_value);
        }
    }
    if matches!(attribute, "person.sex" | "sex" | "personal.sex") {
        if let Some(want_sex) = crate::normalize::sex(raw_value).or_else(|| crate::normalize::sex(rendered)) {
            for opt in &field.options {
                let o = opt.trim();
                if !is_placeholder_option(o)
                    && select_option_parts(opt)
                        .into_iter()
                        .any(|p| crate::normalize::sex(p) == Some(want_sex))
                {
                    return Some(select_option_return_value(opt));
                }
            }
            return None;
        }
    }

    for candidate in [rendered.trim(), raw_value.trim()] {
        if candidate.is_empty() {
            continue;
        }
        for opt in &field.options {
            let o = opt.trim();
            if !is_placeholder_option(o)
                && select_option_parts(opt)
                    .into_iter()
                    .any(|p| p.eq_ignore_ascii_case(candidate) || fold(p) == fold(candidate))
            {
                return Some(select_option_return_value(opt));
            }
        }
    }

    let is_numeric_date_unit = attribute.ends_with(".month")
        || attribute.ends_with(".day")
        || attribute.ends_with(".year")
        || attribute.ends_with(".era_year")
        || (is_date_attr_key(attribute) && crate::date_format::single_unit_char(field).is_some());
    if is_numeric_date_unit
        && let Ok(num) = rendered.trim().parse::<u32>()
    {
        for opt in &field.options {
            for p in select_option_parts(opt) {
                let stripped = p.trim_end_matches(['年', '月', '日', '일', '월', '년']).trim();
                if stripped.parse::<u32>() == Ok(num) {
                    return Some(select_option_return_value(opt));
                }
            }
        }
        let is_month = attribute.ends_with(".month")
            || crate::date_format::single_unit_char(field) == Some('m');
        if is_month && (1..=12).contains(&num) {
            let en_months = [
                "january", "february", "march", "april", "may", "june",
                "july", "august", "september", "october", "november", "december",
            ];
            let want_m = en_months[(num - 1) as usize];
            let want_m3 = &want_m[..3];
            for opt in &field.options {
                for p in select_option_parts(opt) {
                    let o_low = p.to_ascii_lowercase();
                    if o_low == want_m
                        || o_low == want_m3
                        || o_low.ends_with(&format!("- {want_m}"))
                        || o_low.ends_with(&format!(" {want_m}"))
                    {
                        return Some(select_option_return_value(opt));
                    }
                }
            }
        }
    }
    None
}

fn format_country_for_field(field: &FormFieldInput, value: &str) -> Option<String> {
    let info = lookup_country(value)?;
    if !field.options.is_empty() {
        return resolve_country_option(&field.options, info, value);
    }
    let visible = visible_field_text(field).to_lowercase();
    let latin_field = is_written_in_latin(field);
    if (field.max_length == 2 && latin_field)
        || has_any(&visible, &["alpha-2", "alpha2", "iso2", "2-letter", "2文字"])
    {
        return Some(info.alpha2.to_string());
    }
    if (field.max_length == 3 && latin_field)
        || has_any(&visible, &["alpha-3", "alpha3", "iso3", "3-letter", "3文字"])
    {
        return Some(info.alpha3.to_string());
    }
    if has_any(&visible, &["quốc tịch", "quốc gia", "nơi sinh", "nơi cấp"]) {
        return Some(info.vi.to_string());
    }
    let value_trimmed = value.trim();
    let value_has_cjk = value_trimmed.chars().any(is_cjk_char);
    let field_has_jp = visible
        .chars()
        .any(|c| matches!(c as u32, 0x3040..=0x30FF | 0x4E00..=0x9FFF))
        && !has_any(&visible, &["in english", "romaji"]);
    if field_has_jp {
        if value_has_cjk {
            return None;
        }
        return Some(info.ja.to_string());
    }
    let is_iso_alpha3 = value_trimmed.len() == 3
        && value_trimmed.chars().all(|c| c.is_ascii_alphabetic())
        && value_trimmed.eq_ignore_ascii_case(info.alpha3);
    if (value_has_cjk || is_iso_alpha3)
        && (latin_field
            || has_any(
                &visible,
                &[
                    "nationality",
                    "country",
                    "citizenship",
                    "국적",
                    "국가",
                    "nacionalidade",
                    "nationalité",
                    "staatsangehörigkeit",
                ],
            ))
    {
        if has_any(&visible, &["block letters", "in capitals", "uppercase"]) {
            return Some(info.en.to_ascii_uppercase());
        }
        return Some(info.en.to_string());
    }
    None
}

fn is_person_name_label(label: &str, combined: &str) -> bool {
    !has_any(
        combined,
        &[
            "passport no",
            "passport number",
            "passport #",
            "passport_no",
            "passport_number",
            "card no",
            "card number",
            "id no",
            "id number",
            "nric no",
            "nric/fin no",
            "旅券番号",
            "パスポート番号",
            "护照号",
            "護照號碼",
            "여권번호",
            "số hộ chiếu",
        ],
    ) && (has_any(
        label,
        &[
            "surname",
            "last name",
            "family name",
            "given name",
            "first name",
            "middle name",
            "full name",
            "name of employee",
            "name (full",
            "name as shown",
            "nombre",
            "apellido",
            "prénom",
            "vorname",
            "nachname",
            "familienname",
            "氏名",
            "姓名",
            "họ và tên",
            "họ tên",
            "성명",
            "이름",
        ],
    ) || label.trim().eq_ignore_ascii_case("nome"))
}

fn has_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn has_word_sequence(haystack: &str, word: &str) -> bool {
    let mut needle_tokens = word
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty());
    let Some(first) = needle_tokens.next() else {
        return false;
    };
    if needle_tokens.clone().next().is_none() {
        return haystack
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| !t.is_empty())
            .any(|t| t.eq_ignore_ascii_case(first));
    }
    let mut iter = haystack
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty());
    while let Some(tok) = iter.next() {
        if tok.eq_ignore_ascii_case(first) {
            let mut h_sub = iter.clone();
            let mut n_sub = needle_tokens.clone();
            let matched = loop {
                match n_sub.next() {
                    None => break true,
                    Some(nw) => match h_sub.next() {
                        Some(hw) if hw.eq_ignore_ascii_case(nw) => continue,
                        _ => break false,
                    },
                }
            };
            if matched {
                return true;
            }
        }
    }
    false
}

fn has_any_word(haystack: &str, words: &[&str]) -> bool {
    words.iter().any(|word| has_word_sequence(haystack, word))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decision_form::ChosenField;

    fn mk_field(id: &str, label: &str, section: &str) -> FormFieldInput {
        FormFieldInput {
            id: id.to_string(),
            name: id.to_string(),
            label: label.to_string(),
            input_type: "text".to_string(),
            section: section.to_string(),
            form: "f".to_string(),
            ..FormFieldInput::default()
        }
    }

    #[test]
    fn chosen_date_trio_preserves_adjacent_non_date_facts() {
        let fields = vec![
            mk_field("nationality", "Nationality / Region 国籍・地域", ""),
            mk_field("year", "Year YYYY 年", ""),
            mk_field("month", "Month MM 月", ""),
            mk_field("day", "Day DD 日", ""),
            mk_field("name", "Full name", ""),
        ];
        let profiles = BTreeMap::from([(
            "applicant".to_string(),
            BTreeMap::from([
                ("person.nationality".to_string(), "ベトナム".to_string()),
                ("birth.date".to_string(), "1989-04-17".to_string()),
                ("name.full".to_string(), "NGUYEN THI LINH".to_string()),
            ]),
        )]);
        let attributes = ["person.nationality", "birth.year", "birth.month", "birth.day", "name.full"];
        let chosen: Vec<_> = fields.iter().zip(attributes).map(|(field, attribute)| ChosenField {
            id: field.id.clone(),
            attribute: attribute.to_string(),
            owner: "applicant".to_string(),
        }).collect();
        let result = fill_form_fields_chosen(&fields, &profiles, true, &chosen);
        assert_eq!(result[0].attribute, "person.nationality");
        assert_eq!(
            result.iter().map(|field| field.value.as_deref()).collect::<Vec<_>>(),
            vec![Some("ベトナム"), Some("1989"), Some("04"), Some("17"), Some("NGUYEN THI LINH")],
        );
    }

    #[test]
    fn image_placement_keys_do_not_name_the_requested_detail() {
        let profiles = BTreeMap::from([(
            "applicant".to_string(),
            BTreeMap::from([
                ("contact.phone.mobile".to_string(), "080-4417-2290".to_string()),
                ("birth.date".to_string(), "1989-04-17".to_string()),
            ]),
        )]);
        let fields = vec![
            mk_field(
                "box:0:0.3725:0.5378:0.4780:0.0220:cell",
                "本籍 (Registered Domicile)",
                "",
            ),
            mk_field("box:0:0.2:0.5:0.4:0.03:cell", "Date of birth", ""),
            mk_field("box:0:0.2:0.4:0.4:0.03:cell", "Mobile phone", ""),
        ];
        let matches = fill_form_fields(&fields, &profiles, true);
        assert_eq!(matches[0].value, None);
        assert_eq!(matches[1].value.as_deref(), Some("1989-04-17"));
        assert_eq!(matches[2].value.as_deref(), Some("080-4417-2290"));
    }

    #[test]
    fn vietnamese_full_name_includes_family_middle_and_given_names() {
        for label in [
            "Họ, chữ đệm và tên khai sinh",
            "Họ, chữ đệm, tên người yêu cầu (CHỮ IN HOA)",
            "Họ chữ đệm và tên",
        ] {
            let field = mk_field("applicant_full_name", label, "");
            assert_eq!(classify_field(&field).attribute, "name.full");
        }
        assert!(has_any_word("applicant_full_name", &["full_name"]));
        assert!(has_any_word("shipping-address-line-2", &["address_line_2"]));
        assert!(!has_any_word("applicant_full_summary", &["full_name"]));
    }

    #[test]
    fn full_resident_address_and_health_insurance_and_work_phone_stay_whole() {
        let mut addr = mk_field(
            "resident_address",
            "住居地（住民登録している現住所・建物名・号室まで）",
            "",
        );
        assert_eq!(classify_field(&addr).attribute, "address.full");
        addr.id = "addr2".to_string();
        addr.name = "address_line_2".to_string();
        addr.label = "建物名・部屋番号".to_string();
        assert_eq!(classify_field(&addr).attribute, "address.building");

        let mut ins = mk_field(
            "insurance_number",
            "健康保険証 記号・番号（Health Insurance Number）",
            "",
        );
        ins.name = "health_insurance_number".to_string();
        ins.placeholder = "記号・番号・枝番".to_string();
        assert_eq!(classify_field(&ins).attribute, "id.health_insurance.number");

        let spouse = mk_field(
            "spouse_contact_name",
            "配偶者・ご家族氏名（Spouse Name）",
            "配偶者・家族連絡先",
        );
        let mut work_phone = mk_field(
            "work_phone",
            "日中連絡先（勤務先電話）",
            "配偶者・家族連絡先",
        );
        work_phone.name = "employer_phone".to_string();
        work_phone.input_type = "tel".to_string();
        let classified = classify_form_fields(&[spouse, work_phone], true);
        assert_eq!(classified[0].owner, "spouse");
        assert_eq!(classified[1].owner, "employer");
        assert_eq!(classified[1].attribute, "work.employer.phone");

        let dom = mk_field(
            "ct01_domicile",
            "11. Quê quán / Nguyên quán (Registered Domicile)",
            "",
        );
        assert_eq!(classify_field(&dom).attribute, "address.registered_domicile");
    }

    #[test]
    fn chosen_employer_fields_keep_work_and_income_and_mynumber_blocks_foreign_national_id() {
        let fields = vec![
            mk_field("employer_name", "勤務先名称（法人名）", "勤務先・雇用契約情報"),
            mk_field("department_name", "所属部署", "勤務先・雇用契約情報"),
            mk_field("employee_number", "社員番号（雇用契約番号）", "勤務先・雇用契約情報"),
            mk_field("contract_base_salary", "契約基本給（月額・円）", "勤務先・雇用契約情報"),
            mk_field("my_number_input", "個人番号（マイナンバー・12桁）", "本人直接入力欄"),
        ];
        let applicant = BTreeMap::from([
            ("name.full".to_string(), "TRAN MINH KHOA".to_string()),
            ("work.employer.name".to_string(), "株式会社カワセミ・システムズ".to_string()),
            ("work.department".to_string(), "開発本部 クラウド基盤課".to_string()),
            ("work.employee_id".to_string(), "K-20417".to_string()),
            ("income.monthly.base".to_string(), "360,000".to_string()),
            ("id.national.number".to_string(), "048089000417".to_string()),
        ]);
        let profiles = BTreeMap::from([("applicant".to_string(), applicant)]);
        let chosen = vec![
            ChosenField {
                id: "employer_name".to_string(),
                attribute: "name.full".to_string(),
                owner: "employer".to_string(),
            },
            ChosenField {
                id: "department_name".to_string(),
                attribute: String::new(),
                owner: "employer".to_string(),
            },
            ChosenField {
                id: "employee_number".to_string(),
                attribute: String::new(),
                owner: "employer".to_string(),
            },
            ChosenField {
                id: "contract_base_salary".to_string(),
                attribute: "income.monthly.base".to_string(),
                owner: "employer".to_string(),
            },
            ChosenField {
                id: "my_number_input".to_string(),
                attribute: "id.national.number".to_string(),
                owner: "applicant".to_string(),
            },
        ];

        let out = fill_form_fields_chosen(&fields, &profiles, true, &chosen);
        assert_eq!(out[0].value.as_deref(), Some("株式会社カワセミ・システムズ"));
        assert_eq!(out[1].value.as_deref(), Some("開発本部 クラウド基盤課"));
        assert_eq!(out[2].value.as_deref(), Some("K-20417"));
        assert_eq!(out[3].value.as_deref(), Some("360,000"));
        assert_eq!(out[4].attribute, "id.mynumber");
        assert_eq!(out[4].value, None);
    }

    #[test]
    fn school_faculty_student_number_and_telephone_fill_without_taking_other_facts() {
        let profiles = BTreeMap::from([(
            "applicant".to_string(),
            BTreeMap::from([
                ("education.faculty".to_string(), "国際学部 国際社会学科".to_string()),
                ("education.student_id".to_string(), "A25-0612".to_string()),
                ("education.school.phone".to_string(), "03-5286-4412".to_string()),
                ("education.school.name".to_string(), "私立青葉国際大学".to_string()),
                ("contact.phone".to_string(), "03-0000-1111".to_string()),
                ("contact.phone.mobile".to_string(), "090-1111-2222".to_string()),
                ("work.department".to_string(), "開発本部".to_string()),
                ("work.employee_id".to_string(), "K-20417".to_string()),
                ("work.employer.name".to_string(), "株式会社カワセミ".to_string()),
                ("work.employer.phone".to_string(), "03-6412-7700".to_string()),
                ("emergency.phone".to_string(), "080-9999-0000".to_string()),
                ("id.national.number".to_string(), "048089000417".to_string()),
                ("name.full".to_string(), "TRAN MINH KHOA".to_string()),
            ]),
        )]);
        let fields = vec![
            FormFieldInput {
                id: "school_name".into(),
                name: "school_name".into(),
                label: "学校名".into(),
                autocomplete: "organization".into(),
                input_type: "text".into(),
                section: "在学先".into(),
                ..FormFieldInput::default()
            },
            mk_field("faculty_name", "学部・学科", "在学先"),
            mk_field("student_id", "学籍番号", "在学先"),
            FormFieldInput {
                id: "school_phone".into(),
                name: "school_phone".into(),
                label: "学校電話番号".into(),
                input_type: "tel".into(),
                section: "在学先".into(),
                ..FormFieldInput::default()
            },
            mk_field("faculty", "Faculty", ""),
            mk_field("student_number", "Student number", ""),
            mk_field("school_telephone", "School telephone", ""),
            mk_field("khoa", "Khoa", ""),
            mk_field("mssv", "Mã sinh viên", ""),
            mk_field("school_tel", "Điện thoại trường", ""),
            mk_field("department_name", "所属部署", "勤務先"),
            mk_field("employee_number", "社員番号", "勤務先"),
            FormFieldInput {
                id: "employer_phone".into(),
                name: "employer_phone".into(),
                label: "勤務先電話".into(),
                input_type: "tel".into(),
                section: "勤務先".into(),
                ..FormFieldInput::default()
            },
            FormFieldInput {
                id: "mobile".into(),
                name: "mobile".into(),
                label: "携帯電話".into(),
                input_type: "tel".into(),
                ..FormFieldInput::default()
            },
            FormFieldInput {
                id: "emergency_phone".into(),
                name: "emergency_phone".into(),
                label: "緊急連絡先電話".into(),
                input_type: "tel".into(),
                section: "緊急連絡先".into(),
                ..FormFieldInput::default()
            },
            mk_field("national_id", "個人番号", ""),
            FormFieldInput {
                id: "applicant_khoa".into(),
                name: "full_name".into(),
                label: "Họ và tên".into(),
                placeholder: "Tran Minh Khoa".into(),
                input_type: "text".into(),
                ..FormFieldInput::default()
            },
            mk_field("spouse_student", "配偶者の学籍番号", "配偶者"),
            FormFieldInput {
                label: "学校名".into(),
                section: "官公署記入欄".into(),
                input_type: "text".into(),
                ..FormFieldInput::default()
            },
        ];
        let filled = fill_form_fields(&fields, &profiles, true);
        let got: Vec<_> = filled
            .iter()
            .map(|m| (m.attribute.as_str(), m.score, m.value.as_deref(), m.owner.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("education.school.name", 10, Some("私立青葉国際大学"), "applicant"),
                ("education.faculty", 8, Some("国際学部 国際社会学科"), "applicant"),
                ("education.student_id", 8, Some("A25-0612"), "applicant"),
                ("education.school.phone", 8, Some("03-5286-4412"), "applicant"),
                ("education.faculty", 8, Some("国際学部 国際社会学科"), "applicant"),
                ("education.student_id", 8, Some("A25-0612"), "applicant"),
                ("education.school.phone", 8, Some("03-5286-4412"), "applicant"),
                ("education.faculty", 8, Some("国際学部 国際社会学科"), "applicant"),
                ("education.student_id", 8, Some("A25-0612"), "applicant"),
                ("education.school.phone", 8, Some("03-5286-4412"), "applicant"),
                ("work.department", 6, Some("開発本部"), "applicant"),
                ("work.employee_id", 6, Some("K-20417"), "applicant"),
                ("work.employer.phone", 6, Some("03-6412-7700"), "employer"),
                ("contact.phone.mobile", 6, Some("090-1111-2222"), "applicant"),
                ("emergency.phone", 6, Some("080-9999-0000"), "applicant"),
                ("id.mynumber", 6, None, "applicant"),
                ("name.full", 6, Some("TRAN MINH KHOA"), "applicant"),
                ("education.student_id", 8, None, "spouse"),
                ("", 0, None, "official_only"),
            ]
        );
    }

    #[test]
    fn account_opening_purpose_uses_saved_intent_without_guessing_other_purposes() {
        let profiles = BTreeMap::from([(
            "applicant".to_string(),
            BTreeMap::from([(
                "bank.account.purpose".to_string(),
                "生活費の受取および学費の支払い".to_string(),
            )]),
        )]);
        let fields = [
            mk_field("purpose_ja", "口座開設の目的", ""),
            mk_field("purpose_en", "Purpose of the account", ""),
            mk_field("purpose_vi", "Mục đích mở tài khoản", ""),
            mk_field("travel_purpose", "渡航の目的", ""),
            mk_field("generic_purpose", "利用目的", ""),
        ];
        let filled = fill_form_fields(&fields, &profiles, true);
        for field in &filled[..3] {
            assert_eq!(field.attribute, "bank.account.purpose");
            assert_eq!(field.value.as_deref(), Some("生活費の受取および学費の支払い"));
        }
        assert_eq!(filled[3].value, None);
        assert_eq!(filled[4].value, None);
        let without_saved_intent = BTreeMap::from([("applicant".to_string(), BTreeMap::new())]);
        assert_eq!(fill_form_fields(&fields[..1], &without_saved_intent, true)[0].value, None);
    }

    #[test]
    fn declared_fields_use_current_role_values_and_respect_ignored_controls() {
        let mut profiles = BTreeMap::from([
            ("applicant".to_string(), BTreeMap::from([
                ("name.full".to_string(), "ANH NGUYEN".to_string()),
                ("address.line1".to_string(), "Seoul 24".to_string()),
                ("custom.saved_request".to_string(), "Student registration".to_string()),
                ("id.national.number".to_string(), "001092000001".to_string()),
            ])),
            ("spouse".to_string(), BTreeMap::from([
                ("name.full".to_string(), "THAO TRAN".to_string()),
            ])),
        ]);
        let mut fields = [
            mk_field("spouse", "Name", "Spouse"),
            mk_field("home", "Address", "Spouse"),
            mk_field("request", "Details", ""),
            mk_field("registration", "Registration", ""),
            mk_field("manual", "Name", ""),
            mk_field("hidden", "Name", ""),
            mk_field("official", "For official use only", ""),
            mk_field("absent_role", "Name", ""),
            mk_field("invalid", "Unrecognized fact", ""),
        ];
        let names = [
            "vowkey:spouse:name.full",
            "vowkey:applicant:address.line1#home",
            "vowkey:applicant:custom.saved_request",
            "vowkey:applicant:id.residence_card.number",
            "vowkey:applicant:name.full",
            "vowkey:applicant:name.full",
            "vowkey:applicant:name.full",
            "vowkey:guardian:name.full",
            "vowkey:applicant:custom.saved_request#",
        ];
        for (field, name) in fields.iter_mut().zip(names) {
            field.name = name.to_string();
        }
        fields[2].input_type = "textarea".to_string();
        fields[4].op_ignore = true;
        fields[5].input_type = "hidden".to_string();
        let choices: Vec<_> = fields.iter().map(|field| ChosenField {
            id: field.id.clone(),
            owner: "applicant".to_string(),
            attribute: "name.full".to_string(),
        }).collect();
        let filled = fill_form_fields_chosen(&fields[..8], &profiles, true, &choices);
        assert_eq!(
            filled.iter().map(|field| field.value.as_deref()).collect::<Vec<_>>(),
            vec![Some("THAO TRAN"), Some("Seoul 24"), Some("Student registration"),
                None, None, None, None, None],
        );
        assert_eq!(fill_form_fields(&fields[8..], &profiles, true)[0].value, None);
        assert_eq!(fill_form_fields(&fields[2..3], &profiles, false)[0].value.as_deref(),
            Some("Student registration"));
        let applicant = profiles.get_mut("applicant").unwrap();
        applicant.insert("address.line1".to_string(), "Busan 72".to_string());
        applicant.remove("custom.saved_request");
        let updated = fill_form_fields(&fields[..3], &profiles, true);
        assert_eq!(updated[1].value.as_deref(), Some("Busan 72"));
        assert_eq!(updated[2].value, None);
    }

    #[test]
    fn korean_fields_preserve_script_account_ownership_and_registration_type() {
        let mut profiles = BTreeMap::from([(
            "applicant".to_string(),
            BTreeMap::from([
                ("name.full".to_string(), "NGUYEN ANH".to_string()),
                ("name.full.hangul".to_string(), "응우옌 안".to_string()),
                ("bank.account.holder".to_string(), "TRAN THAO".to_string()),
                ("bank.account.purpose".to_string(), "생활비 수령".to_string()),
                ("id.residence_card.number".to_string(), "920810-6000001".to_string()),
                ("id.national.number".to_string(), "001092000001".to_string()),
                ("id.passport.number".to_string(), "P1234567".to_string()),
            ]),
        )]);
        let mut fields = [
            mk_field("name_hangul", "성명(한글)", ""),
            mk_field("name_english", "성명(영문·여권표기)", ""),
            mk_field("account_holder", "예금주(영문)", ""),
            mk_field("account_purpose", "계좌 개설 목적", ""),
            mk_field("registration_number", "외국인등록번호", ""),
        ];
        fields[3].input_type = "textarea".to_string();
        let filled = fill_form_fields(&fields, &profiles, true);
        assert_eq!(filled[0].value.as_deref(), Some("응우옌 안"));
        assert_eq!(filled[1].value.as_deref(), Some("NGUYEN ANH"));
        assert_eq!(filled[2].value.as_deref(), Some("TRAN THAO"));
        assert_eq!(filled[3].value.as_deref(), Some("생활비 수령"));
        assert_eq!(filled[4].value.as_deref(), Some("920810-6000001"));

        let applicant = profiles.get_mut("applicant").unwrap();
        applicant.remove("name.full.hangul");
        applicant.remove("bank.account.holder");
        applicant.remove("id.residence_card.number");
        let missing = fill_form_fields(&fields, &profiles, true);
        assert_eq!(missing[0].value, None, "A Latin name is not a Hangul spelling");
        assert_eq!(missing[2].value, None, "The applicant is not necessarily the account holder");
        assert_eq!(missing[4].value, None, "A foreign national ID is not a Korean registration number");
    }
}
