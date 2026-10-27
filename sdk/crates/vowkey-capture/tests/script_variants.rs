//! A profile keeps a name in each script it is written in, and a field takes the one its words
//! are written in.

use std::collections::BTreeMap;

use vowkey_capture::matcher::{FormFieldInput, fill_form_fields};

fn field(label: &str, autocomplete: &str) -> FormFieldInput {
    FormFieldInput {
        label: label.to_string(),
        autocomplete: autocomplete.to_string(),
        input_type: "text".to_string(),
        ..Default::default()
    }
}

#[test]
fn a_field_takes_the_spelling_in_the_script_of_its_label() {
    let details: BTreeMap<String, String> = [
        ("name.given", "氏玲"),
        ("name.given.latin", "THI LINH"),
        ("name.family", "阮"),
        ("name.family.latin", "NGUYEN"),
        ("name.full", "阮 氏玲"),
        ("name.full.latin", "NGUYEN THI LINH"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    let profiles = BTreeMap::from([("applicant".to_string(), details)]);

    let fields = [
        field("First name", "given-name"),
        field("Last name", "family-name"),
        field("Full name", "name"),
        field("名（漢字）", ""),
        field("お名前（漢字）", ""),
    ];
    let values: Vec<Option<String>> = fill_form_fields(&fields, &profiles, true)
        .into_iter()
        .map(|m| m.value)
        .collect();

    assert_eq!(
        values,
        vec![
            Some("THI LINH".to_string()),
            Some("NGUYEN".to_string()),
            Some("NGUYEN THI LINH".to_string()),
            Some("氏玲".to_string()),
            Some("阮 氏玲".to_string()),
        ]
    );
}

#[test]
fn address_label_wins_over_components_listed_in_placeholder() {
    let fields = [FormFieldInput {
        label: "現住所".into(),
        placeholder: "都道府県・市区町村・番地・建物名".into(),
        input_type: "text".into(),
        ..Default::default()
    }];
    let profiles = BTreeMap::from([("applicant".into(), BTreeMap::from([
        ("address.full".into(), "東京都新宿区高田馬場4-18-9 メゾン高田馬場302".into()),
        ("address.prefecture".into(), "東京都".into()),
    ]))]);
    let result = fill_form_fields(&fields, &profiles, true);
    assert_eq!(result[0].attribute, "address.full");
    assert_eq!(result[0].value.as_deref(), Some("東京都新宿区高田馬場4-18-9 メゾン高田馬場302"));
}
