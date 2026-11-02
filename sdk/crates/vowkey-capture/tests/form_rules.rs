//! Whole-form classification: a passive scan needs three distinct types, an explicit fill does
//! not, and a card or a repeated name starts its own section.

use std::collections::BTreeMap;

use vowkey_capture::matcher::{
    FormFieldInput, classify_form_fields, fill_form_fields, fill_form_fields_chosen,
};

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

fn boxed(label: &str, max_length: i32) -> FormFieldInput {
    FormFieldInput {
        max_length,
        ..field(label)
    }
}

fn linh() -> BTreeMap<String, BTreeMap<String, String>> {
    BTreeMap::from([(
        "applicant".into(),
        BTreeMap::from([
            ("address.postal".into(), "169-0075".into()),
            ("contact.phone".into(), "080-3921-6640".into()),
            ("birth.date".into(), "1998-03-14".into()),
        ]),
    )])
}

fn values(filled: &[vowkey_capture::matcher::FieldMatch]) -> Vec<&str> {
    filled.iter().map(|matched| matched.value.as_deref().unwrap_or("")).collect()
}

#[test]
fn a_postal_code_in_two_boxes_goes_in_at_its_hyphen() {
    let fields = [boxed("郵便番号", 3), boxed("郵便番号", 4)];
    assert_eq!(values(&fill_form_fields(&fields, &linh(), true)), ["169", "0075"]);
}

#[test]
fn a_phone_number_in_three_boxes_takes_one_group_each() {
    let fields = [boxed("Phone", 3), boxed("Phone", 4), boxed("Phone", 4)];
    assert_eq!(values(&fill_form_fields(&fields, &linh(), true)), ["080", "3921", "6640"]);
}

#[test]
fn a_birth_date_in_three_japanese_boxes_takes_the_era_year() {
    let fields = [boxed("生年月日", 2), boxed("生年月日", 2), boxed("生年月日", 2)];
    assert_eq!(values(&fill_form_fields(&fields, &linh(), true)), ["10", "03", "14"]);
}

#[test]
fn date_boxes_follow_the_order_their_labels_give() {
    let fields = [
        boxed("Date of birth (day)", 2),
        boxed("Date of birth (month)", 2),
        boxed("Date of birth (year)", 4),
    ];
    assert_eq!(values(&fill_form_fields(&fields, &linh(), true)), ["14", "03", "1998"]);
}

#[test]
fn a_missing_person_does_not_take_the_applicants_name() {
    let fields = [field("Spouse first name")];
    let profiles = BTreeMap::from([(
        "applicant".into(),
        BTreeMap::from([("name.given".into(), "Linh".into())]),
    )]);

    let filled = fill_form_fields(&fields, &profiles, true);

    assert_eq!(filled[0].owner, "spouse");
    assert_eq!(filled[0].value, None);
}

#[test]
fn a_missing_person_does_not_take_the_applicants_split_phone() {
    let fields: Vec<_> = [3, 4, 4]
        .into_iter()
        .map(|length| FormFieldInput {
            section: "Spouse".into(),
            ..boxed("Phone", length)
        })
        .collect();

    let filled = fill_form_fields_chosen(&fields, &linh(), true, &[]);

    assert!(filled.iter().all(|matched| matched.owner == "spouse"));
    assert_eq!(values(&filled), ["", "", ""]);
}

#[test]
fn adjacent_split_phones_for_different_people_keep_their_own_values() {
    let mut fields = Vec::with_capacity(6);
    for section in ["", "Spouse"] {
        for length in [3, 4, 4] {
            fields.push(FormFieldInput {
                section: section.into(),
                ..boxed("Phone", length)
            });
        }
    }
    let mut profiles = linh();
    profiles.insert("spouse".into(), BTreeMap::from([
        ("contact.phone".into(), "070-2715-4400".into()),
    ]));

    let filled = fill_form_fields_chosen(&fields, &profiles, true, &[]);

    assert_eq!(values(&filled), ["080", "3921", "6640", "070", "2715", "4400"]);
}

#[test]
fn daytime_contact_offering_mobile_or_work_stays_with_applicant_while_employer_section_takes_employer_phone() {
    let fields = [
        FormFieldInput {
            id: "daytime_contact_phone".into(),
            name: "daytime_phone".into(),
            label: "昼間連絡先電話番号（午前8時30分〜午後5時に連絡がとれる番号：携帯または勤務先）".into(),
            input_type: "tel".into(),
            autocomplete: "tel".into(),
            section: "昼間連絡先・本人選択事項".into(),
            ..Default::default()
        },
        FormFieldInput {
            id: "work_tel".into(),
            name: "tel".into(),
            label: "電話番号".into(),
            input_type: "tel".into(),
            section: "勤務先".into(),
            ..Default::default()
        },
    ];
    let profiles = BTreeMap::from([(
        "applicant".into(),
        BTreeMap::from([
            ("contact.phone".into(), "+81 90 1234 5678".into()),
            ("contact.phone.mobile".into(), "080-4129-8831".into()),
            ("work.employer.phone".into(), "03-6412-7700".into()),
        ]),
    )]);

    let filled = fill_form_fields(&fields, &profiles, true);

    assert_eq!(filled[0].owner, "applicant");
    assert_eq!(filled[0].value.as_deref(), Some("+81 90 1234 5678"));
    assert_eq!(filled[1].attribute, "work.employer.phone");
    assert_eq!(filled[1].value.as_deref(), Some("03-6412-7700"));
}
