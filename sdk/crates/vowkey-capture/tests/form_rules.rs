//! Whole-form classification: a passive scan needs three distinct types, an explicit fill does
//! not, and a card or a repeated name starts its own section.

use std::collections::BTreeMap;

use vowkey_capture::matcher::{FormFieldInput, classify_form_fields, fill_form_fields};

fn field(label: &str) -> FormFieldInput {
    FormFieldInput {
        label: label.to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    }
}

fn labeled(form: &str, label: &str) -> FormFieldInput {
    FormFieldInput {
        form: form.to_string(),
        ..field(label)
    }
}

#[test]
fn a_passive_scan_drops_a_form_with_fewer_than_three_types() {
    let fields = [field("First name"), field("Last name")];
    let passive = classify_form_fields(&fields, false);
    assert!(passive.iter().all(|matched| matched.attribute.is_empty()));

    let explicit = classify_form_fields(&fields, true);
    assert_eq!(explicit[0].attribute, "name.given");
    assert_eq!(explicit[1].attribute, "name.family");
}

#[test]
fn an_explicit_autocomplete_survives_a_small_form() {
    let fields = [FormFieldInput {
        label: "First name".into(),
        autocomplete: "section-you given-name".into(),
        input_type: "text".into(),
        ..FormFieldInput::default()
    }];
    let passive = classify_form_fields(&fields, false);
    assert_eq!(passive[0].attribute, "name.given");
    assert_ne!(passive[0].section_id, 0);
}

#[test]
fn a_lone_email_is_filled_on_a_passive_scan() {
    let fields = [FormFieldInput {
        label: "Email".into(),
        input_type: "email".into(),
        ..FormFieldInput::default()
    }];
    let passive = classify_form_fields(&fields, false);
    assert_eq!(passive[0].attribute, "contact.email");
}

#[test]
fn separate_forms_do_not_share_a_card() {
    let fields = [
        labeled("pay", "Card number"),
        labeled("pay", "Expiration month"),
        labeled("pay", "Expiration year"),
        labeled("other", "Card number"),
        labeled("other", "CVC"),
    ];
    let matches = classify_form_fields(&fields, true);
    assert_eq!(matches[0].attribute, "card.number");
    assert!(matches[4].attribute.is_empty(), "a number and a CVC without an expiry are not a card");
    assert_ne!(matches[0].section_id, 0);
    assert_eq!(matches[0].section_id, matches[1].section_id);
    assert_eq!(matches[1].section_id, matches[2].section_id);
}

#[test]
fn a_card_number_or_an_expiry_alone_is_not_filled() {
    let number = classify_form_fields(&[field("Card number")], true);
    assert!(number[0].attribute.is_empty());
    let expiry = classify_form_fields(&[field("Expiration")], true);
    assert!(expiry[0].attribute.is_empty());
    let month = classify_form_fields(&[field("Expiration month")], true);
    assert!(month[0].attribute.is_empty());
}

#[test]
fn a_number_with_a_full_expiry_and_cvc_is_one_section() {
    let fields = [
        field("Name on card"),
        field("Card number"),
        field("Expiration month"),
        field("Expiration year"),
        field("CVC"),
    ];
    let matches = classify_form_fields(&fields, true);
    assert!(matches.iter().all(|matched| !matched.attribute.is_empty()));
    let section = matches[0].section_id;
    assert!(matches.iter().all(|matched| matched.section_id == section));
}

#[test]
fn an_explicit_card_number_is_kept_without_an_anchor() {
    let fields = [FormFieldInput {
        label: "Card number".into(),
        autocomplete: "cc-number".into(),
        input_type: "text".into(),
        ..FormFieldInput::default()
    }];
    let matches = classify_form_fields(&fields, true);
    assert_eq!(matches[0].attribute, "card.number");
}

#[test]
fn shipping_and_billing_are_different_sections() {
    let fields = [
        FormFieldInput {
            autocomplete: "shipping street-address".into(),
            input_type: "text".into(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            autocomplete: "billing street-address".into(),
            input_type: "text".into(),
            ..FormFieldInput::default()
        },
    ];
    let matches = classify_form_fields(&fields, true);
    assert_ne!(matches[0].section_id, matches[1].section_id);
}

#[test]
fn a_repeated_name_starts_another_section_and_does_not_count_as_three_types() {
    let fields = [field("First name"), field("Last name"), field("First name")];
    let matches = classify_form_fields(&fields, false);
    assert!(matches.iter().all(|matched| matched.attribute.is_empty()));

    let explicit = classify_form_fields(&fields, true);
    assert_eq!(explicit[0].section_id, explicit[1].section_id);
    assert_ne!(explicit[0].section_id, explicit[2].section_id);
}

#[test]
fn a_repeated_name_does_not_split_the_following_address() {
    let fields = [
        field("First name"),
        field("Street address"),
        field("First name"),
        field("Street address"),
    ];
    let matches = classify_form_fields(&fields, true);
    assert_eq!(matches[0].section_id, matches[1].section_id);
    assert_eq!(matches[2].section_id, matches[3].section_id);
    assert_ne!(matches[0].section_id, matches[2].section_id);
}

#[test]
fn a_passport_country_without_a_number_or_date_is_left_alone() {
    let fields = [field("Passport issuing country")];
    let matches = classify_form_fields(&fields, true);
    assert!(matches[0].attribute.is_empty());
}

#[test]
fn a_birth_day_takes_its_part_of_the_canonical_date() {
    let fields = [FormFieldInput {
        label: "Day".into(),
        autocomplete: "bday-day".into(),
        placeholder: "DD".into(),
        input_type: "text".into(),
        ..FormFieldInput::default()
    }];
    let profiles = BTreeMap::from([(
        "applicant".into(),
        BTreeMap::from([("birth.date".into(), "1998-03-14".into())]),
    )]);
    let filled = fill_form_fields(&fields, &profiles, true);
    assert_eq!(filled[0].attribute, "birth.day");
    assert_eq!(filled[0].value.as_deref(), Some("14"));
}
