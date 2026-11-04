use std::collections::BTreeMap;

use vowkey_capture::{
    decision_form::ChosenField,
    document::extract_document_details,
    matcher::{FormFieldInput, fill_form_fields_chosen},
    profile::{ProfileFields, profile_details, update_profile},
};

#[test]
fn captured_and_updated_details_fill_after_profile_serialization() {
    let samples: serde_json::Value =
        serde_json::from_str(include_str!("mrz-samples.json")).expect("MRZ corpus");
    let sample = samples
        .as_array()
        .expect("samples")
        .iter()
        .find(|sample| sample["id"] == "icao-td3-eriksson")
        .expect("ICAO example");
    let text = sample["lines"]
        .as_array()
        .expect("MRZ lines")
        .iter()
        .map(|line| line.as_str().expect("text"))
        .collect::<Vec<_>>()
        .join("\n");
    let captured = extract_document_details(&text, 2026);

    let mut saved = update_profile(
        &ProfileFields::default(),
        &BTreeMap::from([
            ("contact.email".into(), "anna@example.com".into()),
            ("travel.frequent_flyer.number".into(), "SK-0042".into()),
        ]),
    );
    let fields: Vec<_> = [
        ("passport", "Passport number"),
        ("birth", "Date of birth"),
        ("email", "Email address"),
        ("loyalty", "Membership number"),
        ("spouse", "Spouse's passport number"),
    ]
    .into_iter()
    .map(|(id, label)| FormFieldInput {
        id: id.into(),
        label: label.into(),
        input_type: "text".into(),
        ..Default::default()
    })
    .collect();
    let chosen = [
        ChosenField {
            id: "loyalty".into(),
            attribute: "travel.frequent_flyer.number".into(),
            owner: "applicant".into(),
        },
        ChosenField {
            id: "spouse".into(),
            attribute: "id.passport.number".into(),
            owner: "spouse".into(),
        },
    ];

    for (details, passport) in [
        (captured.details, "L898902C3"),
        (
            BTreeMap::from([("id.passport.number".into(), "N76543210".into())]),
            "N76543210",
        ),
    ] {
        saved = update_profile(&saved, &details);
        let wire = serde_json::to_string(&saved).expect("serialize profile");
        saved = serde_json::from_str(&wire).expect("reload profile");
        let profiles = BTreeMap::from([("applicant".into(), profile_details(&saved))]);
        let matches = fill_form_fields_chosen(&fields, &profiles, true, &chosen);
        let values: Vec<_> = matches
            .iter()
            .map(|matched| matched.value.as_deref())
            .collect();
        assert_eq!(
            values,
            [
                Some(passport),
                Some("1974-08-12"),
                Some("anna@example.com"),
                Some("SK-0042"),
                None,
            ]
        );
    }
}
