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
use serde::{Deserialize, Serialize};

use crate::format::{to_fullwidth_katakana, to_hiragana, to_wareki, to_zengin_halfwidth_kana};

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
    pub id: String,
    /// Element `name` or `pdf_field` name.
    pub name: String,
    /// Visible label or nearby caption text.
    pub label: String,
    /// Placeholder or example text.
    pub placeholder: String,
    /// HTML `autocomplete` attribute, when present.
    pub autocomplete: String,
    /// Input control type (`text`, `email`, `tel`, `password`, `select-one`, `textarea`).
    pub input_type: String,
    /// Enclosing section heading or `<fieldset>` legend.
    pub section: String,
    /// Format hint or instructions next to the field.
    pub format: String,
    /// HTML `pattern`, when present.
    #[serde(default)]
    pub pattern: String,
    /// HTML `maxlength`, or 0 when unset.
    #[serde(default)]
    pub max_length: i32,
    /// HTML `form` attribute, or empty when the control belongs to its ancestor form.
    #[serde(default)]
    pub form: String,
    /// True when the control carries `data-op-ignore`.
    pub op_ignore: bool,
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
        return empty_match();
    }

    let owner = infer_owner(field);

    // 1. Recognized HTML autocomplete attribute wins first (Chromium precedence).
    if let Some((attr, chrome)) = match_autocomplete(&field.autocomplete) {
        return FieldMatch {
            attribute: attr.to_string(),
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
    let id_name = format!("{} {}", field.id, field.name).to_lowercase();
    let combined = format!("{label_lower} {id_name}");
    let has_label = field.label.chars().any(char::is_alphabetic);
    let is_textarea = field.input_type.eq_ignore_ascii_case("textarea");

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

fn is_multiline_attr(attr: &str) -> bool {
    attr.starts_with("address.")
        || matches!(
            attr,
            "work.employer.address" | "emergency.address" | "work.job_description"
        )
}

/// Classifies every field of one or more forms.
///
/// `explicit_fill` is false for a passive scan: heuristic types are kept only when a form has
/// three distinct fillable types, with Chromium's small-form exceptions. An explicit fill keeps
/// every classified field. An explicit `autocomplete` type is never removed.
pub fn classify_form_fields(fields: &[FormFieldInput], explicit_fill: bool) -> Vec<FieldMatch> {
    let mut matches: Vec<FieldMatch> = fields.iter().map(classify_field).collect();
    suppress_unanchored_cards(fields, &mut matches);
    let sections = assign_sections(fields, &matches);
    for (matched, section) in matches.iter_mut().zip(sections) {
        matched.section_id = section;
    }
    if !explicit_fill {
        suppress_small_forms(fields, &mut matches);
    }
    suppress_incomplete_entities(&mut matches);
    matches
}

/// Fills a form with the detail a Decision model chose for each field and whose it is. A field the
/// model was asked about takes its choice, or is left empty when it chose none; a field it was not
/// asked about keeps what the keyword engine matched. A recognized `autocomplete` hint still wins,
/// as in Chrome. A field that asks about a person the profiles do not hold is left empty rather
/// than filled with the applicant's detail.
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
    // A detail about a person is that person's; a detail of work, a contact, a bank account or an
    // income already says whose it is, whoever the field is about.
    const OF_A_PERSON: &[&str] = &["name.", "birth.", "person.", "id.", "visa.", "address.", "contact."];
    for ((field, choice_id), matched) in fields.iter().zip(choice_ids.iter()).zip(matches.iter_mut()) {
        if match_autocomplete(&field.autocomplete).is_some() || is_ignored_control(field) {
            continue;
        }
        if let Some(choice) = by_id.get(choice_id.as_str()).or_else(|| by_id.get(field.id.as_str())) {
            matched.attribute.clone_from(&choice.attribute);
            matched.owner = if OF_A_PERSON.iter().any(|prefix| choice.attribute.starts_with(prefix)) {
                choice.owner.clone()
            } else {
                "applicant".to_string()
            };
            matched.score = if choice.attribute.is_empty() { 0 } else { 8 };
            matched.chrome_type = "UNKNOWN_TYPE".to_string();
        }
    }
    for (index, matched) in matches.iter_mut().enumerate() {
        if matched.attribute.is_empty() {
            continue;
        }
        let own = matched.owner.is_empty() || matched.owner == "applicant";
        let profile = if own { profiles.get("applicant") } else { profiles.get(&matched.owner) };
        if let Some(details) = profile {
            matched.value = resolve_and_format_value(&fields[index], matched, details);
        }
    }
    split_across_boxes(fields, &mut matches, profiles);
    matches
}

/// Matches every field in a form and formats values from the supplied profiles (keyed by owner
/// role, with `"applicant"` as the default profile).
pub fn fill_form_fields(
    fields: &[FormFieldInput],
    profiles: &BTreeMap<String, BTreeMap<String, String>>,
    explicit_fill: bool,
) -> Vec<FieldMatch> {
    const OF_A_PERSON: &[&str] = &["name.", "birth.", "person.", "id.", "visa.", "address.", "contact."];
    let mut matches: Vec<FieldMatch> = classify_form_fields(fields, explicit_fill)
        .into_iter()
        .enumerate()
        .map(|(index, mut matched)| {
            if !matched.attribute.is_empty() {
                let profile = profiles.get(&matched.owner).or_else(|| {
                    (!OF_A_PERSON.iter().any(|p| matched.attribute.starts_with(p)))
                        .then(|| profiles.get("applicant"))
                        .flatten()
                });
                if let Some(details) = profile {
                    matched.value = resolve_and_format_value(&fields[index], &matched, details);
                }
            }
            matched
        })
        .collect();
    split_across_boxes(fields, &mut matches, profiles);
    matches
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
        let mut end = start + 1;
        while end < matches.len()
            && !attribute.is_empty()
            && matches[end].attribute == attribute
            && fields[end].form == fields[start].form
            && matches[end].owner == matches[start].owner
            && fields[end].section == fields[start].section
        {
            end += 1;
        }
        let run = start..end;
        start = end;
        if run.len() < 2 || fields[run.clone()].iter().any(|field| field.max_length <= 0) {
            continue;
        }
        let Some(raw) = profiles
            .get(&matches[run.start].owner)
            .and_then(|details| details.get(attribute))
        else {
            continue;
        };
        let boxes = &fields[run.clone()];
        let parts = date_parts(boxes, raw).or_else(|| split_parts(boxes, raw));
        if let Some(parts) = parts {
            for (matched, part) in matches[run].iter_mut().zip(parts) {
                matched.value = Some(part);
            }
        }
    }
}

fn date_parts(boxes: &[FormFieldInput], raw: &str) -> Option<Vec<String>> {
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
    let place = |field: &FormFieldInput| -> Option<char> {
        let label = field.label.to_lowercase();
        if label.ends_with('日') || has_any_word(&label, &["day", "dd", "tag", "dia", "día", "jour"]) {
            Some('d')
        } else if label.ends_with('月') || has_any_word(&label, &["month", "mm", "monat", "mes", "mois"]) {
            Some('m')
        } else if label.ends_with('年') || has_any_word(&label, &["year", "yyyy", "yy", "jahr", "año", "ano", "année"]) {
            Some('y')
        } else {
            None
        }
    };
    let named: Vec<Option<char>> = boxes.iter().map(place).collect();
    let mut order: Vec<char> = named.iter().flatten().copied().collect();
    order.sort_unstable();
    order.dedup();
    let order: Vec<char> = if order.len() == 3 {
        named.into_iter().flatten().collect()
    } else {
        vec!['y', 'm', 'd']
    };
    Some(
        order
            .iter()
            .zip(boxes)
            .map(|(part, field)| match part {
                'y' if field.max_length == 2 && japanese => to_wareki(raw)
                    .map(|wareki| format!("{:02}", wareki.year))
                    .unwrap_or_else(|| format!("{:02}", year % 100)),
                'y' if field.max_length == 2 => format!("{:02}", year % 100),
                'y' => year.to_string(),
                'm' => format!("{month:02}"),
                _ => format!("{day:02}"),
            })
            .collect(),
    )
}

fn split_parts(boxes: &[FormFieldInput], raw: &str) -> Option<Vec<String>> {
    let raw = raw.trim();
    let first = boxes[0].max_length as usize;
    if raw.chars().count() <= first {
        return None;
    }
    let groups: Vec<&str> = raw
        .split(|c: char| c == '-' || c == ' ' || c == '/' || c == '.' || c == 'ー' || c == '－')
        .filter(|group| !group.is_empty())
        .collect();
    if groups.len() == boxes.len()
        && groups
            .iter()
            .zip(boxes)
            .all(|(group, field)| group.chars().count() <= field.max_length as usize)
    {
        return Some(groups.into_iter().map(str::to_string).collect());
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
        let mut current = 0u32;
        for index in 0..fields.len() {
            if fields[index].form != form || sections[index] != 0 {
                continue;
            }
            let chrome = matches[index].chrome_type.as_str();
            if chrome == "UNKNOWN_TYPE" || is_phone_type(chrome) {
                if current == 0 {
                    current = next;
                    next += 1;
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
            if repeats {
                current = next;
                next += 1;
                seen_names = 0;
                seen_address = 0;
            } else if current == 0 {
                current = next;
                next += 1;
            }
            if is_name_type(chrome) {
                seen_names |= bit;
            } else if is_address_type(chrome) {
                seen_address |= bit;
            }
            sections[index] = current;
        }
    }
    sections
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
            if match_autocomplete(&fields[index].autocomplete).is_some()
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
    // A captcha is left alone. Words printed beside a field that ask for it not to be autofilled
    // do not stop a fill the person asked for: Chrome, 1Password and Bitwarden do not read them.
    let text = format!(
        "{} {} {} {}",
        field.label, field.name, field.id, field.placeholder
    )
    .to_lowercase();
    text.contains("captcha")
}

/// Infers whose profile a field asks for from its section and label.
pub fn infer_owner(field: &FormFieldInput) -> String {
    let context = format!("{} {} {}", field.section, field.label, field.name).to_lowercase();
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
        ],
    ) {
        if has_any(&context, &["保証人", "guarantor", "bürge"]) {
            return "guarantor".to_string();
        }
        return "applicant".to_string();
    }
    if has_any(
        &context,
        &[
            "配偶者",
            "spouse",
            "husband",
            "wife",
            "conjoint",
            "époux",
            "ehegatte",
            "cónyuge",
            "suami",
            "isteri",
        ],
    ) && !has_any(&context, &["配偶者の有無", "marital"])
    {
        return "spouse".to_string();
    }
    if has_any(
        &context,
        &[
            "扶養親族",
            "児童",
            "dependent",
            "child",
            "anlage kind",
            "enfant",
            "hijo",
            "người phụ thuộc",
            "tanggungan",
        ],
    ) {
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
            "임대인",
        ],
    ) {
        return "landlord".to_string();
    }
    if has_any(
        &context,
        &[
            "世帯主",
            "household head",
            "head of household",
            "chủ hộ",
            "kepala keluarga",
        ],
    ) && !has_any(&context, &["続柄", "relationship", "hubungan"])
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
            "preparer",
            "attorney",
        ],
    ) {
        return "preparer".to_string();
    }
    let employer_clues = &[
        "勤務先",
        "雇用主",
        "事業主",
        "支払者",
        "使用者",
        "所属機関",
        "受入機関",
        "employer",
        "arbeitgeber",
        "employeur",
        "empleador",
        "majikan",
        "đơn vị sử dụng lao động",
    ];
    let section_lower = field.section.to_lowercase();
    let label_and_name = format!("{} {}", field.label, field.name).to_lowercase();
    let employer_section =
        has_any(&section_lower, employer_clues) && !has_any(&section_lower, &["本人", "applicant"]);
    let employer_label = has_any(&label_and_name, employer_clues)
        && !has_any(
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
        );
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
    if has_any(combined, &["緊急連絡先", "紧急联系人", "emergency", "emerg_"]) {
        if has_any(combined, &["電話", "phone", "tel", "連絡先電話"]) {
            return Some(("emergency.phone", "PHONE_HOME_WHOLE_NUMBER", 6));
        }
        if has_any(combined, &["続柄", "関係", "relation", "relationship"]) {
            return Some(("emergency.relation", "UNKNOWN_TYPE", 6));
        }
        if has_any(combined, &["住所", "所在地", "address"]) {
            return Some(("emergency.address", "ADDRESS_HOME_LINE1", 6));
        }
        if has_any(combined, &["氏名", "名前", "name", "emerg_name"]) {
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

    // 4. Passport fields (skip when the label is asking for a person's name "as in passport")
    let is_name_in_passport = !has_any(
        combined,
        &[
            "passport no",
            "passport number",
            "passport #",
            "passport_no",
            "passport_number",
            "旅券番号",
            "パスポート番号",
            "护照号",
            "護照號碼",
            "여권번호",
            "số hộ chiếu",
        ],
    ) && has_any(
        label,
        &[
            "surname",
            "last name",
            "family name",
            "given name",
            "first name",
            "middle name",
            "full name",
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
        ],
    );
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
            "driver's licence",
            "driving licence",
            "driver_license",
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

    if (has_any(
        combined,
        &[
            "cccd",
            "cmnd",
            "căn cước",
            "số định danh",
            "national id",
            "national_id",
            "identity card",
            "id card",
            "personalausweis",
            "carte nationale d'identité",
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
    if has_any(
        combined,
        &[
            "基礎年金番号",
            "年金番号",
            "雇用保険被保険者番号",
            "健康保険記号",
            "被保険者番号",
            "被保険者整理番号",
            "事業所番号",
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
        if has_any(combined, &["健康保険", "health_insurance", "krankenkasse", "philhealth"]) {
            return Some(("id.health_insurance.number", "UNKNOWN_TYPE", 6));
        }
        return Some(("id.pension.number", "UNKNOWN_TYPE", 6));
    }

    // 8. Banking & Zengin fields
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

    // 9. Income / payslip / finance amounts
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
            "勤務先名称",
            "勤務先名",
            "会社名",
            "学校名",
            "name of school",
            "employer_name",
            "employer name",
            "name of employer",
            "name of your employer",
            "place of employment: name",
            "company name",
            "firma",
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
    ) || has_any_word(label, &["company", "organization", "organisation", "employer"]))
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
                "email",
                "e-mail",
                "contact person",
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

    // 12. Birth date & birth place (skip parent surname at birth!)
    if !has_any(label, &["surname", "last name", "family name", "given name", "first name"])
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
        if has_any(combined, &["名", "given", "first"]) && !has_any(combined, &["氏名", "お名前", "full"]) {
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
        if has_any(combined, &["名", "given", "first"]) && !has_any(combined, &["氏名", "姓名", "full"]) {
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
    ) || (label.contains("名") && !has_any(label, &["氏名", "姓名", "お名前", "名前", "名称", "会社名", "銀行名", "支店名", "建物名", "学校名", "署名", "名義", "別名", "税務署"]))
    {
        return Some(("name.given", "NAME_FIRST", 6));
    }
    if has_any(
        combined,
        &[
            "middle name",
            "middle_name",
            "middlename",
            "middle initial",
            "mname",
            "zweiter vorname",
            "отчество",
        ],
    ) {
        return Some(("name.middle", "NAME_MIDDLE", 6));
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
    ) || has_any_word(id_name, &["zip", "zipcode", "postal", "postal_code", "postcode", "plz"])
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
    ) || (has_any_word(id_name, &["address2", "addr2", "line2", "address_line_2", "apt", "suite", "unit"])
        && !label.contains("addr1"))
    {
        if !has_any(
            label,
            &[
                "residence address",
                "present address",
                "office address",
                "mailing address",
                "line 1",
                "離日後の住所",
                "address after leaving",
            ],
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
    if has_any(
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
            "firma",
            "handtekening",
            "chữ ký",
            "tandatangan",
        ],
    ) && !has_any(combined, &["date", "日", "datum", "fecha"])
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

fn match_chromium_patterns(field: &FormFieldInput) -> Option<(String, String)> {
    let label_text = if field.label.chars().any(char::is_alphabetic) {
        field.label.as_str()
    } else {
        field.placeholder.as_str()
    };
    let name_text = format!("{} {}", field.name, field.id);
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

/// Whether the words around a field are in Latin letters, with their accents.
fn is_written_in_latin(field: &FormFieldInput) -> bool {
    [&field.label, &field.placeholder, &field.name, &field.id]
        .iter()
        .all(|text| {
            text.chars()
                .all(|c| !c.is_alphabetic() || (c as u32) < 0x250 || (0x1E00..=0x1EFF).contains(&(c as u32)))
        })
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
    if attr.is_empty() {
        return None;
    }

    if matched.owner != "applicant" && !matched.owner.is_empty() {
        let role_prefixed = format!("{}.{}", matched.owner, attr);
        if let Some(val) = details.get(&role_prefixed) {
            return Some(finish_value(field, attr, val));
        }
    }

    // A field written in Latin letters takes the Latin spelling of a detail that has one, so a
    // profile read from Japanese documents still fills an English form with the passport's names.
    if is_written_in_latin(field) {
        if let Some(latin) = details.get(&format!("{attr}.latin")) {
            return Some(finish_value(field, attr, latin));
        }
    }

    if attr == "birth.date.wareki"
        || (attr == "birth.date" && has_any(&combined, &["和暦", "wareki", "昭和・平成・令和"]))
    {
        if let Some(w) = details.get("birth.date.wareki") {
            return Some(w.clone());
        }
        if let Some(iso) = details.get("birth.date") {
            if let Some(wareki) = to_wareki(iso) {
                return Some(wareki.format_kanji(true));
            }
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

    if let Some(direct) = details.get(attr) {
        return Some(finish_value(field, attr, direct));
    }
    if let Some((alias, value)) = date_part_value(attr, details) {
        return Some(finish_value(field, alias, value));
    }

    let fallback_keys: &[&str] = match attr {
        "name.full.romaji" => &["name.romaji.full", "name.full"],
        "name.family.romaji" => &["name.romaji.family", "name.family"],
        "name.given.romaji" => &["name.romaji.given", "name.given"],
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
        "passport.expiry_date" | "id.passport.expiry_date" => {
            &["id.passport.expiry_date", "passport.expiry_date"]
        }
        "passport.issue_date" | "id.passport.issue_date" => {
            &["id.passport.issue_date", "passport.issue_date"]
        }
        "passport.nationality" | "person.nationality" | "nationality" | "nationality.current" => {
            &["nationality", "person.nationality", "passport.nationality"]
        }
        "personal.sex" | "person.sex" | "sex" => &["sex", "person.sex", "personal.sex"],
        "id.driver_license.number" => &["id.drivers_license.number"],
        "id.national.number" | "id.residence_card.number" | "residence_card.arc_number" => &[
            "id.residence_card.number",
            "id.national.number",
            "id.national_id.number",
        ],
        "tax.id" | "ssn" | "id.ssn" => &["id.ssn", "tax.id", "id.mynumber", "id.tax.de_steuer_id"],
        "employer.name" | "employment.employer" => &["employer.name", "employment.employer"],
        _ => &[],
    };
    for &key in fallback_keys {
        if let Some(val) = details.get(key) {
            return Some(finish_value(field, attr, val));
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
    crate::date_format::format_date_value(field, attribute, value).unwrap_or_else(|| value.to_string())
}

fn has_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn has_any_word(haystack: &str, words: &[&str]) -> bool {
    let tokens: Vec<&str> = haystack
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();
    words
        .iter()
        .any(|w| tokens.iter().any(|t| t.eq_ignore_ascii_case(w)))
}
