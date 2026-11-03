//! Integration tests for platform readiness across office reading/classification, chunked
//! Decision plans, multi-person role isolation, split numeric dates, Japanese eras, script/case
//! formatting, E.164 domestic phone splitting, ISO-3166 select options, and office/PDF file fill.

use std::{collections::BTreeMap, io::Read, process::Command};

use flate2::read::DeflateDecoder;
use vowkey_capture::{
    decision_form::{ChosenField, FormPlan},
    document::{derive_companion_details, extract_document_details},
    file_fill::{
        fill_docx_bytes, fill_hwpx_bytes, fill_pdf_with_profiles_on_disk, fill_xlsx_bytes,
    },
    matcher::{
        FormFieldInput, fill_form_fields, fill_form_fields_chosen, format_detail_for_field,
    },
    office::{classify_office, reading_from_office},
};

fn build_stored_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut cd = Vec::new();

    for &(name, data) in entries {
        let lfh_offset = out.len() as u32;
        let crc = crc32fast::hash(data);
        let size = data.len() as u32;
        let name_bytes = name.as_bytes();
        let name_len = name_bytes.len() as u16;

        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&name_len.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(data);

        cd.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        cd.extend_from_slice(&20u16.to_le_bytes());
        cd.extend_from_slice(&20u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&crc.to_le_bytes());
        cd.extend_from_slice(&size.to_le_bytes());
        cd.extend_from_slice(&size.to_le_bytes());
        cd.extend_from_slice(&name_len.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&0u32.to_le_bytes());
        cd.extend_from_slice(&lfh_offset.to_le_bytes());
        cd.extend_from_slice(name_bytes);
    }

    let cd_offset = out.len() as u32;
    let cd_size = cd.len() as u32;
    let count = entries.len() as u16;
    out.extend_from_slice(&cd);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

fn read_zip_entry_utf8(bytes: &[u8], target: &str) -> String {
    let eocd = (0..=bytes.len().saturating_sub(22))
        .rev()
        .find(|&i| bytes[i..i + 4] == 0x0605_4b50u32.to_le_bytes())
        .expect("eocd");
    let count = u16::from_le_bytes([bytes[eocd + 10], bytes[eocd + 11]]) as usize;
    let mut pos = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap()) as usize;
    for _ in 0..count {
        assert_eq!(&bytes[pos..pos + 4], &0x0201_4b50u32.to_le_bytes());
        let comp = u16::from_le_bytes([bytes[pos + 10], bytes[pos + 11]]);
        let comp_size = u32::from_le_bytes(bytes[pos + 20..pos + 24].try_into().unwrap()) as usize;
        let name_len = u16::from_le_bytes([bytes[pos + 28], bytes[pos + 29]]) as usize;
        let extra_len = u16::from_le_bytes([bytes[pos + 30], bytes[pos + 31]]) as usize;
        let comment_len = u16::from_le_bytes([bytes[pos + 32], bytes[pos + 33]]) as usize;
        let lfh = u32::from_le_bytes(bytes[pos + 42..pos + 46].try_into().unwrap()) as usize;
        let name = std::str::from_utf8(&bytes[pos + 46..pos + 46 + name_len]).expect("name utf8");
        if name == target {
            let lfh_name = u16::from_le_bytes([bytes[lfh + 26], bytes[lfh + 27]]) as usize;
            let lfh_extra = u16::from_le_bytes([bytes[lfh + 28], bytes[lfh + 29]]) as usize;
            let start = lfh + 30 + lfh_name + lfh_extra;
            let raw = &bytes[start..start + comp_size];
            let data = if comp == 0 {
                raw.to_vec()
            } else {
                let mut dec = DeflateDecoder::new(raw);
                let mut out = Vec::new();
                dec.read_to_end(&mut out).expect("deflate");
                out
            };
            return String::from_utf8(data).expect("utf8 xml");
        }
        pos += 46 + name_len + extra_len + comment_len;
    }
    panic!("missing zip entry {target}");
}

#[test]
fn office_reading_strips_excel_phonetic_furigana_reads_hwpx_and_classifies_forms_vs_documents() {
    let shared_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><r><t>氏名</t></r><rPh sb="0" eb="2"><t>シメイ</t></rPh></si>
  <si><r><t>山田 太郎</t></r><rPh sb="0" eb="2"><t>ヤマダ</t></rPh></si>
</sst>"#
        .as_bytes();
    let populated_sheet_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><r><t>生年月日</t></r><rPh sb="0" eb="4"><t>セイネンガッピ</t></rPh></is></c>
      <c r="B2" t="inlineStr"><is><t>1992-05-19</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Email</t></is></c>
      <c r="B3" t="inlineStr"><is><t>taro@example.jp</t></is></c>
    </row>
  </sheetData>
</worksheet>"#
        .as_bytes();
    let populated_xlsx = build_stored_zip(&[
        ("xl/sharedStrings.xml", shared_xml),
        ("xl/worksheets/sheet1.xml", populated_sheet_xml),
    ]);

    let reading = reading_from_office(&populated_xlsx, "roster.xlsx").expect("xlsx reading");
    let texts: Vec<&str> = reading.pages[0]
        .pieces
        .iter()
        .map(|p| p.text.as_str())
        .collect();
    assert!(texts.contains(&"氏名"), "got pieces: {texts:?}");
    assert!(texts.contains(&"山田 太郎"), "got pieces: {texts:?}");
    assert!(texts.contains(&"生年月日"), "got pieces: {texts:?}");
    assert!(
        texts
            .iter()
            .all(|t| !t.contains("シメイ") && !t.contains("セイネンガッピ")),
        "phonetic furigana leaked into reading pieces: {texts:?}"
    );

    let pop_class = classify_office(&populated_xlsx, "roster.xlsx");
    assert_eq!(pop_class.kind, "document", "{pop_class:?}");
    assert!(pop_class.populated_pairs >= 2, "{pop_class:?}");

    let form_sheet_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"/></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>生年月日</t></is></c><c r="B2"/></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>電話番号</t></is></c><c r="B3"/></row>
  </sheetData>
</worksheet>"#
        .as_bytes();
    let blank_xlsx = build_stored_zip(&[
        ("xl/sharedStrings.xml", shared_xml),
        ("xl/worksheets/sheet1.xml", form_sheet_xml),
    ]);
    let form_class = classify_office(&blank_xlsx, "application.xlsx");
    assert_eq!(form_class.kind, "form", "{form_class:?}");
    assert!(form_class.blank_slots >= 2, "{form_class:?}");

    let hwpx_section = r#"<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:tbl>
    <hp:tr>
      <hp:tc><hp:p><hp:t>성명</hp:t></hp:p></hp:tc>
      <hp:tc><hp:p><hp:t></hp:t></hp:p></hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc><hp:p><hp:t>여권번호</hp:t></hp:p></hp:tc>
      <hp:tc><hp:p><hp:t></hp:t></hp:p></hp:tc>
    </hp:tr>
  </hp:tbl>
</hs:sec>"#
        .as_bytes();
    let blank_hwpx = build_stored_zip(&[("Contents/section0.xml", hwpx_section)]);
    let hwpx_reading = reading_from_office(&blank_hwpx, "visa.hwpx").expect("hwpx reading");
    let hwpx_texts: Vec<&str> = hwpx_reading.pages[0]
        .pieces
        .iter()
        .map(|p| p.text.as_str())
        .collect();
    assert_eq!(hwpx_texts, vec!["성명", "여권번호"]);
    let hwpx_class = classify_office(&blank_hwpx, "visa.hwpx");
    assert_eq!(hwpx_class.kind, "form", "{hwpx_class:?}");
}

#[test]
fn chunked_decision_plans_preserve_global_field_ids_beyond_100_fields() {
    let mut fields = Vec::with_capacity(140);
    for idx in 0..140 {
        fields.push(FormFieldInput {
            id: if idx == 12 {
                "custom-passport-field".to_string()
            } else {
                String::new()
            },
            label: format!("Question {idx}"),
            input_type: "text".to_string(),
            ..FormFieldInput::default()
        });
    }
    let held = vec![
        "name.family".to_string(),
        "id.passport.number".to_string(),
        "contact.email".to_string(),
    ];

    let plan_chunk_0 = FormPlan::new_with_offset(&fields[0..100], &held, 0);
    let plan_chunk_1 = FormPlan::new_with_offset(&fields[100..140], &held, 100);

    let json_0: serde_json::Value =
        serde_json::to_value(&plan_chunk_0).expect("serialize chunk 0");
    let json_1: serde_json::Value =
        serde_json::to_value(&plan_chunk_1).expect("serialize chunk 1");
    let ids_0: Vec<&str> = json_0["fields"]
        .as_array()
        .expect("fields array")
        .iter()
        .filter_map(|f| f["id"].as_str())
        .collect();
    let ids_1: Vec<&str> = json_1["fields"]
        .as_array()
        .expect("fields array")
        .iter()
        .filter_map(|f| f["id"].as_str())
        .collect();

    assert_eq!(ids_0[0], "__vk_f_0");
    assert_eq!(ids_0[12], "custom-passport-field");
    assert_eq!(ids_1[0], "__vk_f_100");
    assert_eq!(ids_1[5], "__vk_f_105");

    let mut applicant = BTreeMap::new();
    applicant.insert("name.family".to_string(), "Yamada".to_string());
    applicant.insert("id.passport.number".to_string(), "TR9988776".to_string());
    applicant.insert("contact.email".to_string(), "taro@example.jp".to_string());
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), applicant);

    let choices = vec![
        ChosenField {
            id: "__vk_f_0".to_string(),
            attribute: "name.family".to_string(),
            owner: "applicant".to_string(),
        },
        ChosenField {
            id: "custom-passport-field".to_string(),
            attribute: "id.passport.number".to_string(),
            owner: "applicant".to_string(),
        },
        ChosenField {
            id: "__vk_f_105".to_string(),
            attribute: "contact.email".to_string(),
            owner: "applicant".to_string(),
        },
    ];

    let matches = fill_form_fields_chosen(&fields, &profiles, true, &choices);
    assert_eq!(matches[0].value.as_deref(), Some("Yamada"));
    assert_eq!(matches[12].value.as_deref(), Some("TR9988776"));
    assert_eq!(matches[105].value.as_deref(), Some("taro@example.jp"));
    assert_eq!(matches[5].value, None);
}

#[test]
fn multi_person_roles_and_pdf_checkbox_options_stay_isolated() {
    let mut applicant = BTreeMap::new();
    applicant.insert("name.full".to_string(), "Linh Thi Nguyen".to_string());
    applicant.insert("sex".to_string(), "Female".to_string());
    applicant.insert("id.passport.number".to_string(), "C8492011".to_string());

    let mut spouse = BTreeMap::new();
    spouse.insert("name.full".to_string(), "Kenji Sato".to_string());
    spouse.insert("id.passport.number".to_string(), "TK1122334".to_string());

    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), applicant);
    profiles.insert("spouse".to_string(), spouse);

    let web_fields = vec![
        FormFieldInput {
            id: "app_name".to_string(),
            label: "Applicant Full Name".to_string(),
            input_type: "text".to_string(),
            section: "Part 1 - Applicant".to_string(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            id: "sp_name".to_string(),
            label: "Full Name".to_string(),
            input_type: "text".to_string(),
            section: "Part 2 - Spouse Details".to_string(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            id: "dep_name".to_string(),
            label: "Child Full Name".to_string(),
            input_type: "text".to_string(),
            section: "Part 3 - Dependent Children".to_string(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            id: "off_code".to_string(),
            label: "Passport Number".to_string(),
            input_type: "text".to_string(),
            section: "For Official Use Only".to_string(),
            ..FormFieldInput::default()
        },
    ];
    let matches = fill_form_fields(&web_fields, &profiles, true);
    assert_eq!(matches[0].owner, "applicant");
    assert_eq!(matches[0].value.as_deref(), Some("Linh Thi Nguyen"));
    assert_eq!(matches[1].owner, "spouse");
    assert_eq!(matches[1].value.as_deref(), Some("Kenji Sato"));
    assert_eq!(matches[2].owner, "dependent");
    assert_eq!(
        matches[2].value, None,
        "missing dependent profile must not take applicant"
    );
    assert_eq!(matches[3].owner, "official_only");
    assert_eq!(
        matches[3].value, None,
        "official-only section must stay empty"
    );

    let tmp_dir = std::env::temp_dir().join(format!("vk_pdf_roles_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp_dir);
    let src_pdf = tmp_dir.join("input_roles.pdf");
    let dst_pdf = tmp_dir.join("output_roles.pdf");

    let build_pdf_py = r#"
import sys
from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject, BooleanObject, DictionaryObject, FloatObject, NameObject, TextStringObject
)

writer = PdfWriter()
page = writer.add_blank_page(width=595, height=842)
fields = ArrayObject()

def add_text_field(name, label, y):
    fld = DictionaryObject({
        NameObject("/FT"): NameObject("/Tx"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/T"): TextStringObject(name),
        NameObject("/TU"): TextStringObject(label),
        NameObject("/Rect"): ArrayObject([FloatObject(160), FloatObject(y), FloatObject(420), FloatObject(y + 18)]),
        NameObject("/V"): TextStringObject(""),
    })
    ref = writer._add_object(fld)
    page[NameObject("/Annots")] = page.get("/Annots", ArrayObject())
    page[NameObject("/Annots")].append(ref)
    fields.append(ref)

def add_checkbox(name, label, on_name, x, y):
    ap_n = DictionaryObject({
        NameObject(on_name): writer._add_object(DictionaryObject()),
        NameObject("/Off"): writer._add_object(DictionaryObject()),
    })
    fld = DictionaryObject({
        NameObject("/FT"): NameObject("/Btn"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/T"): TextStringObject(name),
        NameObject("/TU"): TextStringObject(label),
        NameObject("/Rect"): ArrayObject([FloatObject(x), FloatObject(y), FloatObject(x + 14), FloatObject(y + 14)]),
        NameObject("/V"): NameObject("/Off"),
        NameObject("/AS"): NameObject("/Off"),
        NameObject("/AP"): DictionaryObject({NameObject("/N"): ap_n}),
    })
    ref = writer._add_object(fld)
    page[NameObject("/Annots")] = page.get("/Annots", ArrayObject())
    page[NameObject("/Annots")].append(ref)
    fields.append(ref)

add_text_field("applicant_passport", "Applicant Passport Number", 740)
add_checkbox("sex_male", "Sex: Male", "/Yes", 160, 700)
add_checkbox("sex_female", "Sex: Female", "/Yes", 240, 700)
add_text_field("spouse_passport", "Spouse Passport Number", 640)
add_text_field("child_name", "Child Full Name", 580)

writer._root_object[NameObject("/AcroForm")] = writer._add_object(DictionaryObject({
    NameObject("/Fields"): fields,
    NameObject("/NeedAppearances"): BooleanObject(True),
}))
with open(sys.argv[1], "wb") as fh:
    writer.write(fh)
"#;

    let status = Command::new("python3")
        .arg("-c")
        .arg(build_pdf_py)
        .arg(&src_pdf)
        .status()
        .expect("python3 pypdf builder");
    assert!(status.success(), "failed to build synthetic AcroForm PDF");

    let report =
        fill_pdf_with_profiles_on_disk(&src_pdf, &dst_pdf, &profiles).expect("fill pdf with roles");
    assert!(report.filled_count >= 3, "report: {report:?}");

    let inspect_py = r#"
import json, sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
out = {}
for k, v in (reader.get_fields() or {}).items():
    out[k] = str(v.get("/V", ""))
print(json.dumps(out))
"#;
    let inspected = Command::new("python3")
        .arg("-c")
        .arg(inspect_py)
        .arg(&dst_pdf)
        .output()
        .expect("inspect filled pdf");
    let map: serde_json::Value =
        serde_json::from_slice(&inspected.stdout).expect("parse pdf field values");

    assert_eq!(map["applicant_passport"], "C8492011", "{map}");
    assert_eq!(map["spouse_passport"], "TK1122334", "{map}");
    assert_eq!(map["child_name"], "", "{map}");
    assert_eq!(
        map["sex_male"], "/Off",
        "Male checkbox must remain unchecked: {map}"
    );
    assert_eq!(
        map["sex_female"], "/Yes",
        "Female checkbox must be checked: {map}"
    );

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[test]
fn number_input_split_dates_and_non_birth_japanese_eras_format_accurately() {
    let mut details = BTreeMap::new();
    details.insert("birth.date".to_string(), "1995-08-14".to_string());
    details.insert("id.passport.issued".to_string(), "2022-04-10".to_string());
    details.insert(
        "id.driver_license.expiry".to_string(),
        "2027-09-01".to_string(),
    );
    derive_companion_details(&mut details);

    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), details.clone());

    let split_number_fields = vec![
        FormFieldInput {
            name: "dob_year".to_string(),
            label: "Date of Birth".to_string(),
            input_type: "number".to_string(),
            max_length: 0,
            ..FormFieldInput::default()
        },
        FormFieldInput {
            name: "dob_month".to_string(),
            label: "Date of Birth".to_string(),
            input_type: "number".to_string(),
            max_length: 0,
            ..FormFieldInput::default()
        },
        FormFieldInput {
            name: "dob_day".to_string(),
            label: "Date of Birth".to_string(),
            input_type: "number".to_string(),
            max_length: 0,
            ..FormFieldInput::default()
        },
    ];
    let split_matches = fill_form_fields(&split_number_fields, &profiles, true);
    assert_eq!(split_matches[0].value.as_deref(), Some("1995"));
    assert!(matches!(
        split_matches[1].value.as_deref(),
        Some("8" | "08")
    ));
    assert_eq!(split_matches[2].value.as_deref(), Some("14"));

    let era_select = FormFieldInput {
        name: "birth_gengo".to_string(),
        label: "生年月日（元号）".to_string(),
        input_type: "select-one".to_string(),
        options: vec![
            "1|昭和".to_string(),
            "2|平成".to_string(),
            "3|令和".to_string(),
        ],
        ..FormFieldInput::default()
    };
    let era_year_box = FormFieldInput {
        name: "birth_wareki_year".to_string(),
        label: "生年月日（和暦・年）".to_string(),
        input_type: "number".to_string(),
        max_length: 0,
        ..FormFieldInput::default()
    };
    assert_eq!(
        format_detail_for_field(&era_select, "birth.era", &details),
        "2"
    );
    assert_eq!(
        format_detail_for_field(&era_year_box, "birth.era_year", &details),
        "7"
    );

    let passport_wareki = vec![
        FormFieldInput {
            name: "passport_issue_y".to_string(),
            label: "旅券発行日（令和・年）".to_string(),
            input_type: "number".to_string(),
            max_length: 0,
            ..FormFieldInput::default()
        },
        FormFieldInput {
            name: "passport_issue_m".to_string(),
            label: "旅券発行日（月）".to_string(),
            input_type: "number".to_string(),
            max_length: 0,
            ..FormFieldInput::default()
        },
        FormFieldInput {
            name: "passport_issue_d".to_string(),
            label: "旅券発行日（日）".to_string(),
            input_type: "number".to_string(),
            max_length: 0,
            ..FormFieldInput::default()
        },
    ];
    let pw_matches = fill_form_fields(&passport_wareki, &profiles, true);
    assert_eq!(
        pw_matches[0].value.as_deref(),
        Some("4"),
        "2022-04-10 is Reiwa 4: {pw_matches:?}"
    );
    assert!(matches!(pw_matches[1].value.as_deref(), Some("4" | "04")));
    assert_eq!(pw_matches[2].value.as_deref(), Some("10"));

    let dl_wareki_full = FormFieldInput {
        name: "license_expiry".to_string(),
        label: "運転免許証有効期限（和暦）".to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    };
    let rendered_dl =
        format_detail_for_field(&dl_wareki_full, "id.driver_license.expiry", &details);
    assert!(
        rendered_dl.contains("令和") && rendered_dl.contains('9'),
        "expected Reiwa 9 for 2027-09-01, got {rendered_dl}"
    );
}

#[test]
fn names_mrz_title_case_three_part_kana_hepburn_and_vietnamese_split() {
    let mrz_text =
        "P<VNMNGUYEN<<THI<LINH<<<<<<<<<<<<<<<<<<<<<<<\nC8492011<0VNM9508148F3204106<<<<<<<<<<<<<<02";
    let captured = extract_document_details(mrz_text, 2026);
    assert_eq!(
        captured.details.get("name.family").map(String::as_str),
        Some("Nguyen")
    );
    assert_eq!(
        captured.details.get("name.given").map(String::as_str),
        Some("Thi Linh")
    );
    assert_eq!(
        captured.details.get("name.full").map(String::as_str),
        Some("Nguyen Thi Linh")
    );

    let normal_surname = FormFieldInput {
        label: "Family name".to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    };
    let block_surname = FormFieldInput {
        label: "Surname (IN BLOCK LETTERS)".to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    };
    assert_eq!(
        format_detail_for_field(&normal_surname, "name.family", &captured.details),
        "Nguyen"
    );
    assert_eq!(
        format_detail_for_field(&block_surname, "name.family", &captured.details),
        "NGUYEN"
    );

    let mut kana_three = BTreeMap::new();
    kana_three.insert("name.full.katakana".to_string(), "グエン ティ リン".to_string());
    derive_companion_details(&mut kana_three);
    assert_eq!(
        kana_three.get("name.family.katakana").map(String::as_str),
        Some("グエン")
    );
    assert_eq!(
        kana_three.get("name.given.katakana").map(String::as_str),
        Some("ティ リン")
    );

    let mut jp_kana = BTreeMap::new();
    jp_kana.insert("name.full.katakana".to_string(), "ヤマダ タロウ".to_string());
    derive_companion_details(&mut jp_kana);
    assert_eq!(
        jp_kana.get("name.full.romaji").map(String::as_str),
        Some("Yamada Taro")
    );
    assert_eq!(
        jp_kana.get("name.family.romaji").map(String::as_str),
        Some("Yamada")
    );
    assert_eq!(
        jp_kana.get("name.given.romaji").map(String::as_str),
        Some("Taro")
    );

    let romaji_field = FormFieldInput {
        label: "Name in Romaji (Passport Hepburn)".to_string(),
        input_type: "text".to_string(),
        ..FormFieldInput::default()
    };
    assert_eq!(
        format_detail_for_field(&romaji_field, "name.full", &jp_kana),
        "Yamada Taro"
    );

    let mut inoue = BTreeMap::new();
    inoue.insert("name.full.katakana".to_string(), "イノウエ ユウキ".to_string());
    derive_companion_details(&mut inoue);
    assert_eq!(
        inoue.get("name.full.romaji").map(String::as_str),
        Some("Inoue Yuki")
    );

    let mut vn_name = BTreeMap::new();
    vn_name.insert("name.full".to_string(), "Nguyễn Thị Linh".to_string());
    derive_companion_details(&mut vn_name);
    assert_eq!(vn_name.get("name.family").map(String::as_str), Some("Nguyễn"));
    assert_eq!(
        vn_name.get("name.given").map(String::as_str),
        Some("Thị Linh")
    );
}

#[test]
fn e164_phones_country_select_options_and_bidirectional_vocab_fallbacks() {
    let mut details = BTreeMap::new();
    details.insert("contact.phone".to_string(), "+819012345678".to_string());
    details.insert("person.nationality".to_string(), "Viet Nam".to_string());
    details.insert("address.country".to_string(), "US".to_string());
    details.insert("tax.id".to_string(), "987-65-4321".to_string());
    details.insert(
        "id.driver_license.expiry".to_string(),
        "2029-11-20".to_string(),
    );
    details.insert("work.title".to_string(), "Robotics Engineer".to_string());
    details.insert(
        "education.school.name".to_string(),
        "Hanoi University of Science and Technology".to_string(),
    );
    details.insert(
        "work.employer.name".to_string(),
        "Tsubame Robotics".to_string(),
    );
    derive_companion_details(&mut details);

    assert_eq!(
        details.get("contact.phone.country").map(String::as_str),
        Some("+81")
    );

    let mut vn_phone = BTreeMap::new();
    vn_phone.insert("contact.phone".to_string(), "+84912345678".to_string());
    derive_companion_details(&mut vn_phone);
    assert_eq!(
        vn_phone.get("contact.phone.country").map(String::as_str),
        Some("+84")
    );

    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), details.clone());

    let single_11 = FormFieldInput {
        name: "tel".to_string(),
        label: "電話番号（ハイフンなし）".to_string(),
        input_type: "tel".to_string(),
        max_length: 11,
        ..FormFieldInput::default()
    };
    assert_eq!(
        format_detail_for_field(&single_11, "contact.phone", &details),
        "09012345678"
    );

    let phone_boxes = vec![
        FormFieldInput {
            name: "tel1".to_string(),
            label: "電話番号".to_string(),
            input_type: "tel".to_string(),
            max_length: 3,
            ..FormFieldInput::default()
        },
        FormFieldInput {
            name: "tel2".to_string(),
            label: "電話番号".to_string(),
            input_type: "tel".to_string(),
            max_length: 4,
            ..FormFieldInput::default()
        },
        FormFieldInput {
            name: "tel3".to_string(),
            label: "電話番号".to_string(),
            input_type: "tel".to_string(),
            max_length: 4,
            ..FormFieldInput::default()
        },
    ];
    let box_matches = fill_form_fields(&phone_boxes, &profiles, true);
    assert_eq!(box_matches[0].value.as_deref(), Some("090"));
    assert_eq!(box_matches[1].value.as_deref(), Some("1234"));
    assert_eq!(box_matches[2].value.as_deref(), Some("5678"));

    let nat_alpha2_select = FormFieldInput {
        name: "nationality".to_string(),
        label: "Nationality".to_string(),
        input_type: "select-one".to_string(),
        options: vec![
            "JP|Japan".to_string(),
            "VN|Vietnam".to_string(),
            "US|United States".to_string(),
        ],
        ..FormFieldInput::default()
    };
    let nat_jp_select = FormFieldInput {
        name: "kokuseki".to_string(),
        label: "国籍".to_string(),
        input_type: "select-one".to_string(),
        options: vec![
            "日本".to_string(),
            "ベトナム".to_string(),
            "アメリカ合衆国".to_string(),
        ],
        ..FormFieldInput::default()
    };
    let country_us_select = FormFieldInput {
        name: "country".to_string(),
        label: "Country".to_string(),
        input_type: "select-one".to_string(),
        options: vec![
            "AU|Australia".to_string(),
            "AT|Austria".to_string(),
            "US|United States".to_string(),
        ],
        ..FormFieldInput::default()
    };
    assert_eq!(
        format_detail_for_field(&nat_alpha2_select, "person.nationality", &details),
        "VN"
    );
    assert_eq!(
        format_detail_for_field(&nat_jp_select, "person.nationality", &details),
        "ベトナム"
    );
    assert_eq!(
        format_detail_for_field(&country_us_select, "address.country", &details),
        "US",
        "US must never substring-match Australia or Austria"
    );

    let fallback_fields = vec![
        FormFieldInput {
            id: "tin".to_string(),
            label: "Tax Identification Number".to_string(),
            input_type: "text".to_string(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            id: "card_exp".to_string(),
            label: "ID Card Expiry Date".to_string(),
            input_type: "date".to_string(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            id: "occ".to_string(),
            label: "Occupation / Profession".to_string(),
            input_type: "text".to_string(),
            ..FormFieldInput::default()
        },
        FormFieldInput {
            id: "school".to_string(),
            label: "最終学歴・学校名".to_string(),
            input_type: "text".to_string(),
            ..FormFieldInput::default()
        },
    ];
    let fb_choices = vec![
        ChosenField {
            id: "tin".to_string(),
            attribute: "id.tax.number".to_string(),
            owner: "applicant".to_string(),
        },
        ChosenField {
            id: "card_exp".to_string(),
            attribute: "id.card.expiry".to_string(),
            owner: "applicant".to_string(),
        },
        ChosenField {
            id: "occ".to_string(),
            attribute: "person.profession".to_string(),
            owner: "applicant".to_string(),
        },
    ];
    let fb_matches = fill_form_fields_chosen(&fallback_fields, &profiles, true, &fb_choices);
    assert_eq!(fb_matches[0].value.as_deref(), Some("987-65-4321"));
    assert_eq!(fb_matches[1].value.as_deref(), Some("2029-11-20"));
    assert_eq!(fb_matches[2].value.as_deref(), Some("Robotics Engineer"));
    assert_eq!(fb_matches[3].attribute, "education.school.name");
    assert_eq!(
        fb_matches[3].value.as_deref(),
        Some("Hanoi University of Science and Technology")
    );
}

#[test]
fn office_file_fill_handles_docx_sdt_excel_open_world_groups_and_hwpx_cell_boundaries() {
    let mut profile = BTreeMap::new();
    profile.insert("name.full".to_string(), "Linh Thi Nguyen".to_string());
    profile.insert("address.country".to_string(), "US".to_string());
    profile.insert(
        "id.driver_license.number".to_string(),
        "DL-884422".to_string(),
    );
    profile.insert(
        "id.driver_license.expiry".to_string(),
        "2030-06-15".to_string(),
    );
    profile.insert("id.passport.number".to_string(), "C8492011".to_string());

    let docx_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Applicant Full Name</w:t></w:r></w:p></w:tc>
        <w:tc>
          <w:sdt>
            <w:sdtPr>
              <w:alias w:val="Applicant Full Name"/>
              <w:showingPlcHdr/>
              <w:text/>
            </w:sdtPr>
            <w:sdtContent>
              <w:p><w:r><w:t>Click or tap here to enter text.</w:t></w:r></w:p>
            </w:sdtContent>
          </w:sdt>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Country of Residence</w:t></w:r></w:p></w:tc>
        <w:tc>
          <w:sdt>
            <w:sdtPr>
              <w:alias w:val="Country"/>
              <w:showingPlcHdr/>
              <w:dropDownList>
                <w:listItem w:displayText="Australia" w:value="Australia"/>
                <w:listItem w:displayText="United States" w:value="United States"/>
              </w:dropDownList>
            </w:sdtPr>
            <w:sdtContent>
              <w:p><w:r><w:t>Choose an item.</w:t></w:r></w:p>
            </w:sdtContent>
          </w:sdt>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>"#
        .as_bytes();
    let docx_in = build_stored_zip(&[("word/document.xml", docx_xml)]);
    let (docx_out, docx_report) = fill_docx_bytes(&docx_in, &profile).expect("fill sdt docx");
    assert_eq!(docx_report.filled_count, 2, "{docx_report:?}");
    let filled_docx_xml = read_zip_entry_utf8(&docx_out, "word/document.xml");
    assert!(
        filled_docx_xml.contains("Linh Thi Nguyen"),
        "{filled_docx_xml}"
    );
    assert!(
        filled_docx_xml.contains("United States"),
        "{filled_docx_xml}"
    );
    assert!(
        !filled_docx_xml.contains("showingPlcHdr"),
        "{filled_docx_xml}"
    );
    assert!(
        !filled_docx_xml.contains("Click or tap here to enter text."),
        "{filled_docx_xml}"
    );

    let xlsx_sheet = r#"<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><r><t>Driver Licence</t></r><rPh sb="0" eb="6"><t>メンキョ</t></rPh></is></c>
      <c r="B1" t="inlineStr"><is><t>(1) Number</t></is></c>
      <c r="C1"/>
      <c r="D1" t="inlineStr"><is><t>(2) Expiry Date</t></is></c>
      <c r="E1"/>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Country</t></is></c>
      <c r="B2"/>
    </row>
  </sheetData>
  <dataValidations count="1">
    <dataValidation type="list" sqref="B2">
      <formula1>"Australia,Austria,United States"</formula1>
    </dataValidation>
  </dataValidations>
</worksheet>"#
        .as_bytes();
    let xlsx_in = build_stored_zip(&[("xl/worksheets/sheet1.xml", xlsx_sheet)]);
    let (xlsx_out, xlsx_report) = fill_xlsx_bytes(&xlsx_in, &profile).expect("fill open-world xlsx");
    assert!(xlsx_report.filled_count >= 3, "{xlsx_report:?}");
    let filled_xlsx_xml = read_zip_entry_utf8(&xlsx_out, "xl/worksheets/sheet1.xml");
    assert!(filled_xlsx_xml.contains("DL-884422"), "{filled_xlsx_xml}");
    assert!(filled_xlsx_xml.contains("2030-06-15"), "{filled_xlsx_xml}");
    assert!(
        filled_xlsx_xml.contains(">United States<"),
        "expected United States rather than Australia: {filled_xlsx_xml}"
    );

    let hwpx_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  <hp:tbl>
    <hp:tr>
      <hp:tc><hp:p><hp:t>여권번호</hp:t></hp:p></hp:tc>
      <hp:tc><hp:p><hp:t></hp:t></hp:p></hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc><hp:p><hp:t>비고 (메모)</hp:t></hp:p></hp:tc>
      <hp:tc><hp:p><hp:t></hp:t></hp:p></hp:tc>
    </hp:tr>
  </hp:tbl>
  <hp:p><hp:t></hp:t></hp:p>
</hs:sec>"#
        .as_bytes();
    let hwpx_in = build_stored_zip(&[("Contents/section0.xml", hwpx_xml)]);
    let (hwpx_out, hwpx_report) = fill_hwpx_bytes(&hwpx_in, &profile).expect("fill hwpx");
    assert_eq!(hwpx_report.filled_count, 1, "{hwpx_report:?}");
    let filled_hwpx_xml = read_zip_entry_utf8(&hwpx_out, "Contents/section0.xml");
    assert!(
        filled_hwpx_xml.contains("<hp:t>C8492011</hp:t>"),
        "{filled_hwpx_xml}"
    );
    assert!(
        filled_hwpx_xml.ends_with("<hp:p><hp:t></hp:t></hp:p>\n</hs:sec>"),
        "trailing paragraph outside table cell must stay untouched: {filled_hwpx_xml}"
    );
}
