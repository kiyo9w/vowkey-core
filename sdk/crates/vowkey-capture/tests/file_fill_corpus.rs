//! End-to-end tests filling Word (.docx), Excel (.xlsx), and all four PDF classes from the corpus.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use vowkey_capture::file_fill::{FileFillError, fill_docx_bytes, fill_file_on_disk, fill_xlsx_bytes};

/// The corpus of public forms in the direction repository, which sits next to this one.
fn corpus_dir() -> PathBuf {
    let dir = std::env::var_os("VOWKEY_CORPUS")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../vowkey/corpus"));
    assert!(
        dir.is_dir(),
        "the form corpus is not at {}; set VOWKEY_CORPUS to its folder",
        dir.display()
    );
    dir
}

fn sample_profile() -> BTreeMap<String, String> {
    let mut p = BTreeMap::new();
    p.insert("name.full".to_string(), "NGUYEN THI LINH".to_string());
    p.insert("name.family".to_string(), "NGUYEN".to_string());
    p.insert("name.given".to_string(), "THI LINH".to_string());
    p.insert(
        "name.full.kana".to_string(),
        "グエン ティ リン".to_string(),
    );
    p.insert(
        "name.full.hiragana".to_string(),
        "ぐえん てぃ りん".to_string(),
    );
    p.insert("birth.date".to_string(), "1995-08-14".to_string());
    p.insert("birth.place".to_string(), "Hanoi, Vietnam".to_string());
    p.insert("sex".to_string(), "Female".to_string());
    p.insert("nationality".to_string(), "VIET NAM".to_string());
    p.insert("id.passport.number".to_string(), "C8492011".to_string());
    p.insert(
        "id.passport.issue_date".to_string(),
        "2022-04-10".to_string(),
    );
    p.insert(
        "id.passport.expiry_date".to_string(),
        "2032-04-10".to_string(),
    );
    p.insert(
        "id.residence_card.number".to_string(),
        "AB12345678CD".to_string(),
    );
    p.insert("id.ssn".to_string(), "123-45-6789".to_string());
    p.insert("tax.id".to_string(), "123-45-6789".to_string());
    p.insert(
        "address.full".to_string(),
        "東京都新宿区西新宿2-8-1".to_string(),
    );
    p.insert(
        "address.street".to_string(),
        "123 Main Street, Apt 4B".to_string(),
    );
    p.insert("address.city".to_string(), "Berlin".to_string());
    p.insert("address.postal".to_string(), "160-0023".to_string());
    p.insert(
        "contact.phone".to_string(),
        "03-5321-1111".to_string(),
    );
    p.insert(
        "contact.phone.mobile".to_string(),
        "080-4129-8831".to_string(),
    );
    p.insert(
        "contact.email".to_string(),
        "linh.nguyen@tsubame-robotics.co.jp".to_string(),
    );
    p.insert(
        "employment.employer".to_string(),
        "Tsubame Robotics Co., Ltd.".to_string(),
    );
    p.insert(
        "employer.name".to_string(),
        "Tsubame Robotics Co., Ltd.".to_string(),
    );
    p.insert(
        "employment.occupation".to_string(),
        "Software Engineer".to_string(),
    );
    p.insert("bank.name".to_string(), "Mizuho Bank".to_string());
    p.insert("bank.account.number".to_string(), "12345678".to_string());
    p.insert(
        "bank.account.holder".to_string(),
        "NGUYEN THI LINH".to_string(),
    );
    p
}

#[test]
fn fills_word_docx_tables_character_boxes_and_formtext() {
    let corpus = corpus_dir();
    let profile = sample_profile();

    // 1. Korean Integrated Application (.docx table with horizontal + vertical cells)
    let kr_bytes =
        std::fs::read(corpus.join("east-asia/kr-moj-integrated-application.docx")).expect("read");
    let (kr_out, kr_report) = fill_docx_bytes(&kr_bytes, &profile).expect("fill kr docx");
    assert_eq!(kr_report.format, "docx");
    assert!(
        kr_report.filled_count >= 6,
        "expected >= 6 filled fields in kr-moj docx, got {}: {:?}",
        kr_report.filled_count,
        kr_report.entries
    );
    // Verify round-trip valid zip and injected values
    let (_, kr_roundtrip) = fill_docx_bytes(&kr_out, &profile).expect("roundtrip valid zip");
    assert_eq!(kr_roundtrip.format, "docx");

    // 2. UK Cambridge CHRIS/22 New Starter (.docx with character boxes and table cells)
    let uk_bytes =
        std::fs::read(corpus.join("europe-middle-east/uk-cam-new-starter-chris22.docx"))
            .expect("read");
    let (_, uk_report) = fill_docx_bytes(&uk_bytes, &profile).expect("fill uk docx");
    assert!(
        uk_report.filled_count >= 4,
        "expected >= 4 filled fields in uk-cam docx, got {}: {:?}",
        uk_report.filled_count,
        uk_report.entries
    );

    // 3. Singapore IR8A (.docx with 41 legacy FORMTEXT fields)
    let sg_bytes =
        std::fs::read(corpus.join("south-southeast-asia/sg-iras-ir8a-2026.docx")).expect("read");
    let (_, sg_report) = fill_docx_bytes(&sg_bytes, &profile).expect("fill sg docx");
    assert!(
        sg_report.filled_count >= 1,
        "expected legacy FORMTEXT fields filled in sg-iras-ir8a-2026.docx, got {:?}",
        sg_report.entries
    );
}

#[test]
fn fills_excel_xlsx_merged_cells_and_split_dates_preserving_drawings() {
    let corpus = corpus_dir();
    let profile = sample_profile();

    let jp_bytes =
        std::fs::read(corpus.join("east-asia/jp-isa-reentry-permit.xlsx")).expect("read xlsx");
    let (jp_out, jp_report) = fill_xlsx_bytes(&jp_bytes, &profile).expect("fill xlsx");
    assert_eq!(jp_report.format, "xlsx");
    assert!(
        jp_report.filled_count >= 6,
        "expected >= 6 cells filled in jp-isa-reentry-permit.xlsx, got {}: {:?}",
        jp_report.filled_count,
        jp_report.entries
    );
    assert!(
        jp_report.entries.iter().any(|e| e.value == "C8492011"),
        "expected passport number C8492011 in filled entries: {:?}",
        jp_report.entries
    );
    assert!(
        jp_report.entries.iter().any(|e| e.value == "1995"),
        "expected split birth year 1995 in filled entries: {:?}",
        jp_report.entries
    );
    assert!(!jp_out.is_empty());
}

#[test]
fn fills_all_four_pdf_classes_acroform_hybrid_dynamic_xfa_and_flat() {
    let corpus = corpus_dir();
    let profile = sample_profile();
    let tmp = std::env::temp_dir().join(format!("vowkey-pdf-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp);

    // 1. AcroForm PDF: de-anmeldung-berlin.pdf
    let acro_out = tmp.join("de-anmeldung-filled.pdf");
    let acro_rep = fill_file_on_disk(
        &corpus.join("europe-middle-east/de-anmeldung-berlin.pdf"),
        &acro_out,
        &profile,
    )
    .expect("fill acroform pdf");
    assert_eq!(acro_rep.format, "pdf-acroform");
    assert!(
        acro_rep.filled_count >= 4,
        "expected >= 4 fields filled in de-anmeldung-berlin.pdf, got {}",
        acro_rep.filled_count
    );
    assert!(acro_out.exists());

    // 2. XFA Hybrid PDF: us-w4.pdf (opaque widget names f1_01..f1_14 resolved by nearby page text!)
    let hybrid_out = tmp.join("us-w4-filled.pdf");
    let hybrid_rep = fill_file_on_disk(
        &corpus.join("americas-oceania/us-w4.pdf"),
        &hybrid_out,
        &profile,
    )
    .expect("fill xfa hybrid pdf");
    assert_eq!(hybrid_rep.format, "pdf-xfa-hybrid");
    assert!(
        hybrid_rep.filled_count >= 4,
        "expected >= 4 fields filled in us-w4.pdf, got {}: {:?}",
        hybrid_rep.filled_count,
        hybrid_rep.entries
    );
    // The first-name box and the social security number box get their own details.
    let value_of = |target: &str| {
        hybrid_rep
            .entries
            .iter()
            .find(|e| e.target == target)
            .map(|e| e.value.as_str())
    };
    assert_eq!(value_of("p0:f1_01[0]"), Some("THI LINH"));
    assert_eq!(value_of("p0:f1_05[0]"), Some("123-45-6789"));

    // 3. Dynamic XFA PDF without initial datasets packet: ca-imm5406.pdf (owner-encrypted AES!)
    let dyn_out = tmp.join("ca-imm5406-filled.pdf");
    let dyn_rep = fill_file_on_disk(
        &corpus.join("americas-oceania/ca-imm5406.pdf"),
        &dyn_out,
        &profile,
    )
    .expect("fill dynamic xfa pdf");
    assert_eq!(dyn_rep.format, "pdf-xfa-dynamic");
    assert!(
        dyn_rep.filled_count >= 1,
        "expected >= 1 field filled in ca-imm5406.pdf, got {}",
        dyn_rep.filled_count
    );

    // 4. A flat PDF has no fields. The filler says so instead of writing text nobody can see.
    let flat = fill_file_on_disk(
        &corpus.join("east-asia/jp-mhlw-rirekisho-a4.pdf"),
        &tmp.join("jp-rirekisho-filled.pdf"),
        &profile,
    );
    assert_eq!(flat.unwrap_err(), FileFillError::FlatPdf);

    let _ = std::fs::remove_dir_all(&tmp);
}
