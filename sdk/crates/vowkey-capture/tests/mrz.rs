//! Runs the reader over the corpus's twenty machine-readable zones, which come with every field
//! and check digit worked out by an independent implementation.

use serde_json::Value;
use vowkey_capture::mrz::{Mrz, MrzError, MrzField, MrzFormat, find_mrz};

const SAMPLES: &str = include_str!("mrz-samples.json");

fn samples() -> Vec<Value> {
    serde_json::from_str(SAMPLES).expect("the fixture is JSON")
}

fn lines(sample: &Value) -> Vec<String> {
    sample["lines"]
        .as_array()
        .expect("lines")
        .iter()
        .map(|l| l.as_str().expect("a line").to_string())
        .collect()
}

fn field(mrz: &Mrz, key: &str) -> String {
    match key {
        "document_code" => mrz.document_code.clone(),
        "issuer" => mrz.issuer.clone(),
        "family_name" => mrz.family_name.clone(),
        "given_names" => mrz.given_names.clone(),
        "document_number" => mrz.document_number.clone(),
        "nationality" => mrz.nationality.clone(),
        "birth_date" => mrz.birth_date.as_str().to_string(),
        "sex" => mrz.sex.as_mrz_char().to_string(),
        "expiry_date" => mrz.expiry_date.as_str().to_string(),
        "personal_number" | "optional_data" | "optional_data_1" => mrz.optional_data.clone(),
        "optional_data_2" => mrz.optional_data_2.clone(),
        other => panic!("the fixture has a field the reader does not know: {other}"),
    }
}

fn check_key(field: MrzField) -> &'static str {
    match field {
        MrzField::DocumentNumber => "document_number",
        MrzField::BirthDate => "birth_date",
        MrzField::ExpiryDate => "expiry_date",
        MrzField::PersonalNumber => "personal_number",
        MrzField::Composite => "composite",
    }
}

fn format_name(format: MrzFormat) -> &'static str {
    match format {
        MrzFormat::Td1 => "TD1",
        MrzFormat::Td2 => "TD2",
        MrzFormat::Td3 => "TD3",
        MrzFormat::MrvA => "MRV-A",
        MrzFormat::MrvB => "MRV-B",
    }
}

#[test]
fn every_sample_reads_to_the_fields_the_corpus_lists() {
    let samples = samples();
    assert_eq!(samples.len(), 20);
    for sample in &samples {
        let id = sample["id"].as_str().unwrap();
        let mrz = Mrz::parse(&lines(sample)).unwrap_or_else(|e| panic!("{id}: {e}"));
        assert_eq!(
            format_name(mrz.format),
            sample["format"].as_str().unwrap(),
            "{id}: layout"
        );
        for (key, value) in sample["fields"].as_object().unwrap() {
            assert_eq!(field(&mrz, key), value.as_str().unwrap(), "{id}: {key}");
        }
    }
}

#[test]
fn every_check_digit_matches_the_corpus() {
    for sample in samples() {
        let id = sample["id"].as_str().unwrap();
        let mrz = Mrz::parse(&lines(&sample)).unwrap();
        let expected = sample["checks"].as_object().unwrap();
        assert_eq!(
            mrz.checks.len(),
            expected.len(),
            "{id}: the checks the layout has"
        );
        for check in &mrz.checks {
            let listed = &expected[check_key(check.field)];
            assert_eq!(
                check.data,
                listed["data"].as_str().unwrap(),
                "{id}: {:?} data",
                check.field
            );
            assert_eq!(
                check.printed.to_string(),
                listed["printed"].as_str().unwrap(),
                "{id}: {:?} printed",
                check.field
            );
            assert_eq!(
                check.expected.to_string(),
                listed["expected"].as_str().unwrap(),
                "{id}: {:?} expected",
                check.field
            );
            assert_eq!(
                check.ok,
                listed["ok"].as_bool().unwrap(),
                "{id}: {:?} ok",
                check.field
            );
        }
        assert_eq!(
            mrz.verified(),
            sample["expect_valid"].as_bool().unwrap(),
            "{id}: verified"
        );
    }
}

#[test]
fn a_changed_birth_date_fails_its_digit_and_the_composite() {
    let sample = samples()
        .into_iter()
        .find(|s| s["id"] == "neg-td3-dob-tampered")
        .unwrap();
    let mrz = Mrz::parse(&lines(&sample)).unwrap();
    let failed: Vec<MrzField> = mrz.failed_checks().map(|c| c.field).collect();
    assert_eq!(failed, [MrzField::BirthDate, MrzField::Composite]);
}

#[test]
fn ocr_that_reads_b_as_8_is_corrected_by_the_check_digit() {
    let broken = [
        "IDFRAX4RT8PFW46<<<<<<<<<<<<<<<",
        "9607136F3607123FRA<<<<<<<<<<<0",
        "MARTIN<<LEA<CLAIRE<<<<<<<<<<<<",
    ];
    assert!(!Mrz::parse(&broken).unwrap().verified());
    let fixed = Mrz::parse_ocr(&broken).unwrap();
    assert!(fixed.verified());
    assert_eq!(fixed.document_number, "X4RTBPFW4");
    assert_eq!(fixed.lines[0], "IDFRAX4RTBPFW46<<<<<<<<<<<<<<<");
}

#[test]
fn ocr_letters_in_digit_positions_and_digits_in_letter_positions_are_corrected_by_place() {
    // O for 0 in the birth date and expiry, 5 for S and 0 for O in the names and states.
    let read = [
        "P<UT0ERIKSS0N<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
        "L898902C36UT07408I22F12O4159ZE184226B<<<<<10",
    ];
    let mrz = Mrz::parse_ocr(&read).unwrap();
    assert!(mrz.verified(), "{:?}", mrz.checks);
    assert_eq!(mrz.issuer, "UTO");
    assert_eq!(mrz.family_name, "ERIKSSON");
    assert_eq!(mrz.birth_date.as_str(), "740812");
    assert_eq!(mrz.expiry_date.as_str(), "120415");
}

#[test]
fn ocr_text_with_spacing_lowercase_and_short_lines_still_reads() {
    let read = [
        "p<uto eriksson<<anna<maria<<<<<<<<<<<<<<<<<<<",
        "L898902C36 UTO 7408122F1204159 ZE184226B<<<<<10",
    ];
    assert!(Mrz::parse_ocr(&read).unwrap().verified());
    let short = [
        "I<UTOD231458907<<<<<<<<<<<<<<<",
        "7408122F1204159UTO<<<<<<<<<<<6",
        "ERIKSSON<<ANNA<MARIA<<<<<<<<",
    ];
    let mrz = Mrz::parse_ocr(&short).unwrap();
    assert_eq!(mrz.given_names, "ANNA MARIA");
    assert!(mrz.verified());
}

#[test]
fn the_zone_is_found_in_a_page_of_recognized_text() {
    let page = "REPUBLIC OF UTOPIA\nPASSPORT\nERIKSSON ANNA MARIA\n\
                P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\n\
                L898902C36UTO7408122F1204159ZE184226B<<<<<10\n\
                Signature of the holder\n";
    let found = find_mrz(page);
    assert_eq!(found.len(), 1);
    assert!(Mrz::parse_ocr(&found[0]).unwrap().verified());
    assert!(find_mrz("No machine-readable zone here\nJust a form").is_empty());
}

#[test]
fn dates_resolve_to_a_century_and_keep_what_is_unknown() {
    let samples = samples();
    let eriksson = Mrz::parse(&lines(
        samples
            .iter()
            .find(|s| s["id"] == "icao-td3-eriksson")
            .unwrap(),
    ))
    .unwrap();
    assert_eq!(eriksson.birth_date.resolve_birth(2026).iso(), "1974-08-12");
    assert_eq!(eriksson.expiry_date.resolve_expiry().iso(), "2012-04-15");

    let taylor = Mrz::parse(&lines(
        samples
            .iter()
            .find(|s| s["id"] == "gen-td3-sex-unspecified")
            .unwrap(),
    ))
    .unwrap();
    assert_eq!(taylor.birth_date.resolve_birth(2026).iso(), "2000-02-29");

    let hassan = Mrz::parse(&lines(
        samples
            .iter()
            .find(|s| s["id"] == "gen-td3-unknown-birth-day")
            .unwrap(),
    ))
    .unwrap();
    assert_eq!(hassan.birth_date.resolve_birth(2026).iso(), "1985-01");
}

#[test]
fn other_text_is_refused_with_a_reason() {
    assert_eq!(Mrz::parse(&["P<UTO"]), Err(MrzError::UnknownLayout));
    let with_space = [
        "P<UTOERIKSSON<<ANNA MARIA<<<<<<<<<<<<<<<<<<",
        "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
    ];
    assert_eq!(
        Mrz::parse(&with_space),
        Err(MrzError::InvalidCharacter {
            line: 1,
            found: ' '
        })
    );
}
