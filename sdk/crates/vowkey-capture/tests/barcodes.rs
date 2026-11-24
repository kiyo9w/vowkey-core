//! Checks AAMVA PDF417, Vietnamese CCCD QR and `rxing` image barcode decoding against the
//! standard fixtures.

#![allow(clippy::unwrap_used)]

use std::{collections::BTreeMap, path::Path};

use serde::Deserialize;
use vowkey_capture::{
    aamva::AamvaCard,
    barcode::{BarcodeError, DocumentBarcodePayload, decode_barcode},
    cccd::{CccdCard, CccdError},
    mrz::Sex,
};

#[derive(Deserialize)]
struct AamvaSample {
    id: String,
    expect: BTreeMap<String, Option<String>>,
    png: String,
}

#[derive(Deserialize)]
struct CccdSample {
    id: String,
    payload: String,
    expect_valid: bool,
    fields: BTreeMap<String, serde_json::Value>,
    png: String,
}

fn sex_word(sex: Option<Sex>) -> &'static str {
    match sex {
        Some(Sex::Female) => "female",
        Some(Sex::Male) => "male",
        _ => "not specified",
    }
}

#[test]
fn reads_every_aamva_sample_and_decodes_pdf417_png() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/aamva");
    let samples: Vec<AamvaSample> =
        serde_json::from_str(&std::fs::read_to_string(dir.join("aamva-samples.json")).unwrap())
            .unwrap();

    for sample in samples {
        let bin_bytes = std::fs::read(dir.join(format!("{}.bin", sample.id))).unwrap();
        let raw = String::from_utf8(bin_bytes).unwrap();
        let card = AamvaCard::parse(&raw).unwrap();
        let details = card.details();

        assert_eq!(
            details.get("name.family").map(String::as_str),
            sample.expect["name.family"].as_deref(),
            "{}: name.family",
            sample.id
        );
        assert_eq!(
            details.get("name.given").map(String::as_str),
            sample.expect["name.given"].as_deref(),
            "{}: name.given",
            sample.id
        );
        assert_eq!(
            card.middle_names.as_deref(),
            sample.expect["name.middle"].as_deref(),
            "{}: name.middle",
            sample.id
        );
        assert_eq!(
            card.birth_date.as_deref(),
            sample.expect["birth.date"].as_deref(),
            "{}: birth.date",
            sample.id
        );
        assert_eq!(
            sex_word(card.sex),
            sample.expect["person.sex"].as_deref().unwrap(),
            "{}: person.sex",
            sample.id
        );
        assert_eq!(
            details.get("id.driver_license.number").map(String::as_str),
            sample.expect["id.driver_license.number"].as_deref(),
            "{}: id.driver_license.number",
            sample.id
        );
        assert_eq!(
            details.get("id.driver_license.expiry").map(String::as_str),
            sample.expect["id.driver_license.expiry"].as_deref(),
            "{}: id.driver_license.expiry",
            sample.id
        );
        assert_eq!(
            details.get("id.driver_license.issued").map(String::as_str),
            sample.expect["id.driver_license.issued"].as_deref(),
            "{}: id.driver_license.issued",
            sample.id
        );
        assert_eq!(
            details.get("address.street").map(String::as_str),
            sample.expect["address.street"].as_deref(),
            "{}: address.street",
            sample.id
        );
        assert_eq!(
            details.get("address.city").map(String::as_str),
            sample.expect["address.city"].as_deref(),
            "{}: address.city",
            sample.id
        );
        assert_eq!(
            details.get("address.prefecture").map(String::as_str),
            sample.expect["address.prefecture"].as_deref(),
            "{}: address.prefecture",
            sample.id
        );
        assert_eq!(
            details.get("address.postal").map(String::as_str),
            sample.expect["address.postal"].as_deref(),
            "{}: address.postal",
            sample.id
        );

        let png_bytes = std::fs::read(dir.join(&sample.png)).unwrap();
        let decoded = decode_barcode(&png_bytes).unwrap();
        assert_eq!(
            decoded.payload,
            DocumentBarcodePayload::Aamva(card),
            "{}: PDF417 PNG round-trip",
            sample.id
        );
    }
}

#[test]
fn reads_michigan_2023_calibrator_barcode() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/aamva");
    let raw = String::from_utf8(std::fs::read(dir.join("michigan-calibrator-2023.bin")).unwrap())
        .unwrap();
    let card = AamvaCard::parse(&raw).unwrap();
    assert_eq!(card.iin, "636032");
    assert_eq!(card.document_number, "S 000 123 456 789");
    assert_eq!(card.family_name, "SAMPLE");
    assert_eq!(card.given_name, "CONNOR");
    assert_eq!(card.middle_names.as_deref(), Some("M"));
    assert_eq!(card.birth_date.as_deref(), Some("1967-01-12"));
    assert_eq!(card.expiry_date.as_deref(), Some("2025-01-12"));
    assert_eq!(card.postal_code.as_deref(), Some("48864-1234"));
}

#[test]
fn reads_every_vietnamese_cccd_sample_and_decodes_qr_png() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cccd");
    let samples: Vec<CccdSample> =
        serde_json::from_str(&std::fs::read_to_string(dir.join("cccd-qr-samples.json")).unwrap())
            .unwrap();

    for sample in samples {
        let png_bytes = std::fs::read(dir.join(&sample.png)).unwrap();
        let decoded = decode_barcode(&png_bytes).unwrap();
        assert_eq!(decoded.text, sample.payload, "{}: QR raw text", sample.id);

        if sample.id == "neg-six-fields" {
            assert_eq!(
                CccdCard::parse(&sample.payload),
                Err(CccdError::TooFewFields)
            );
            continue;
        }

        let card = CccdCard::parse(&sample.payload).unwrap();
        assert_eq!(
            card.verified, sample.expect_valid,
            "{}: verified flag",
            sample.id
        );
        let details = card.details();
        assert_eq!(
            details.get("id.national.number").map(String::as_str),
            sample.fields["id.national.number"].as_str(),
            "{}: id.national.number",
            sample.id
        );
        assert_eq!(
            card.previous_id_number.as_deref(),
            sample.fields["id.national.previous_number"].as_str(),
            "{}: id.national.previous_number",
            sample.id
        );
        assert_eq!(
            details.get("name.full").map(String::as_str),
            sample.fields["name.full"].as_str(),
            "{}: name.full",
            sample.id
        );
        assert_eq!(
            details.get("birth.date").map(String::as_str),
            sample.fields["birth.date"].as_str(),
            "{}: birth.date",
            sample.id
        );
        assert_eq!(
            sex_word(Some(card.sex)),
            sample.fields["person.sex"].as_str().unwrap(),
            "{}: person.sex",
            sample.id
        );
        assert_eq!(
            details.get("address.full").map(String::as_str),
            sample.fields["address.full"].as_str(),
            "{}: address.full",
            sample.id
        );
        assert_eq!(
            details.get("id.national.issued").map(String::as_str),
            sample.fields["id.national.issued"].as_str(),
            "{}: id.national.issued",
            sample.id
        );
    }
}

#[test]
fn normalizes_decomposed_vietnamese_diacritics_to_nfc() {
    let decomposed = "001090012345|012345678|Nguye\u{0302}\u{0303}n Va\u{0306}n An|15031990|Nam|Ha\u{0300} No\u{0323}\u{0302}i|10062021";
    let card = CccdCard::parse(decomposed).unwrap();
    assert_eq!(card.full_name, "Nguyễn Văn An");
    assert_eq!(card.family_name, "Nguyễn");
    assert_eq!(card.middle_name.as_deref(), Some("Văn"));
    assert_eq!(card.given_name, "An");
    assert_eq!(card.full_address, "Hà Nội");
    assert!(card.verified);
}

/// A phone-camera-shaped grey photo, built pixel by pixel, with no barcode printed on it.
fn phone_photo(shade: impl Fn(u32, u32) -> u8) -> image::DynamicImage {
    let mut photo = image::GrayImage::new(4032, 3024);
    for (x, y, pixel) in photo.enumerate_pixels_mut() {
        *pixel = image::Luma([shade(x, y)]);
    }
    image::DynamicImage::ImageLuma8(photo)
}

fn png_bytes(image: &image::DynamicImage) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

#[test]
fn reports_not_found_for_a_large_photo_without_a_code() {
    // The size of a phone photo, which the reader's own filtering overflowed on: it must answer
    // that it found no barcode instead of taking the whole read down with it.
    let photo = phone_photo(|x, y| (((x / 13 + y / 7) % 23) + 220) as u8);

    let err = decode_barcode(&png_bytes(&photo)).unwrap_err();

    assert!(
        matches!(err, BarcodeError::NotFound(_)),
        "expected NotFound, got {err:?}"
    );
}

#[test]
fn decodes_a_qr_inside_a_phone_sized_photo() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cccd");
    let samples: Vec<CccdSample> =
        serde_json::from_str(&std::fs::read_to_string(dir.join("cccd-qr-samples.json")).unwrap())
            .unwrap();
    let sample = samples
        .iter()
        .find(|sample| sample.png == "cccd-2021-with-cmnd.png")
        .unwrap();
    let qr = image::load_from_memory(&std::fs::read(dir.join(&sample.png)).unwrap()).unwrap();
    let qr = image::imageops::resize(
        &qr.to_luma8(),
        qr.width() * 2,
        qr.height() * 2,
        image::imageops::FilterType::Nearest,
    );

    let mut photo = image::GrayImage::from_pixel(4032, 3024, image::Luma([255]));
    let left = i64::from((photo.width() - qr.width()) / 2);
    let top = i64::from((photo.height() - qr.height()) / 2);
    image::imageops::overlay(&mut photo, &qr, left, top);

    let decoded = decode_barcode(&png_bytes(&image::DynamicImage::ImageLuma8(photo))).unwrap();

    assert_eq!(
        decoded.text, sample.payload,
        "QR text in a phone-sized photo"
    );
    assert_eq!(
        decoded.payload,
        DocumentBarcodePayload::Cccd(CccdCard::parse(&sample.payload).unwrap())
    );
}
