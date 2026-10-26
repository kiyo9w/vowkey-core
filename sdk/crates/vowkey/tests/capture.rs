//! Tests for `vowkey capture`

mod common;
use std::{io::Write, path::Path, process::Stdio};

use common::vowkey;

const PASSPORT: [&str; 2] = [
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
];

#[test]
fn reads_the_lines_it_is_given() {
    let output = vowkey()
        .args(["capture", "mrz"])
        .args(PASSPORT)
        .output()
        .expect("Failed to execute vowkey command");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let report: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON output");
    assert_eq!(report["verified"], true);
    assert_eq!(report["document_number"], "L898902C3");
    assert_eq!(report["family_name"], "ERIKSSON");
    assert_eq!(report["given_names"], "ANNA MARIA");
    assert_eq!(report["birth_date"], "740812");
}

#[test]
fn finds_the_zone_in_recognized_text_on_standard_input() {
    let mut child = vowkey()
        .args(["capture", "mrz"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to execute vowkey command");
    let text = format!(
        "PASSPORT\nERIKSSON ANNA MARIA\n{}\n{}\nSignature\n",
        PASSPORT[0], PASSPORT[1]
    );
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(text.as_bytes())
        .expect("write stdin");
    let output = child.wait_with_output().expect("output");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let report: serde_json::Value = serde_json::from_slice(&output.stdout).expect("JSON output");
    assert_eq!(report["verified"], true);
    assert_eq!(report["format"], "Td3");
}

#[test]
fn says_when_there_is_no_zone() {
    let mut child = vowkey()
        .args(["capture", "mrz"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Failed to execute vowkey command");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(b"Just a form\n")
        .expect("write stdin");
    let output = child.wait_with_output().expect("output");
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("No machine-readable zone"));
}

#[test]
fn reads_aamva_and_cccd_and_decodes_barcode_images() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../vowkey-capture/tests/fixtures");

    let aamva_out = vowkey()
        .args(["capture", "aamva"])
        .arg(fixtures.join("aamva/aamva-us-va-dl.bin"))
        .output()
        .expect("Failed to run vowkey capture aamva");
    assert!(
        aamva_out.status.success(),
        "{}",
        String::from_utf8_lossy(&aamva_out.stderr)
    );
    let aamva_json: serde_json::Value =
        serde_json::from_slice(&aamva_out.stdout).expect("AAMVA JSON");
    assert_eq!(aamva_json["document_number"], "T16700185");
    assert_eq!(aamva_json["family_name"], "RIVERA");

    let cccd_out = vowkey()
        .args([
            "capture",
            "cccd",
            "001090012345|012345678|Nguyễn Văn An|15031990|Nam|Số 12 Ngõ 34 Phố Ví Dụ, Phường Mẫu, Quận Thử, Hà Nội|10062021",
        ])
        .output()
        .expect("Failed to run vowkey capture cccd");
    assert!(
        cccd_out.status.success(),
        "{}",
        String::from_utf8_lossy(&cccd_out.stderr)
    );
    let cccd_json: serde_json::Value =
        serde_json::from_slice(&cccd_out.stdout).expect("CCCD JSON");
    assert_eq!(cccd_json["id_number"], "001090012345");
    assert_eq!(cccd_json["verified"], true);

    let barcode_out = vowkey()
        .args(["capture", "barcode"])
        .arg(fixtures.join("aamva/aamva-ca-on-dl.png"))
        .output()
        .expect("Failed to run vowkey capture barcode");
    assert!(
        barcode_out.status.success(),
        "{}",
        String::from_utf8_lossy(&barcode_out.stderr)
    );
    let barcode_json: serde_json::Value =
        serde_json::from_slice(&barcode_out.stdout).expect("Barcode JSON");
    assert_eq!(barcode_json["format"], "pdf 417");
    assert_eq!(
        barcode_json["payload"]["Aamva"]["document_number"],
        "T1670-01859-20718"
    );
}

#[test]
fn runs_command_with_injected_vk_references_and_masks_secret_stdout() {
    let tmp = std::env::temp_dir().join(format!("vowkey-run-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp);
    let env_file = tmp.join(".env");
    let secrets_file = tmp.join("secrets.json");

    std::fs::write(&env_file, "OPENAI_API_KEY=@vk:item-1/login.password\nPUBLIC_MODE=live\n")
        .expect("write .env");
    std::fs::write(
        &secrets_file,
        r#"{"@vk:item-1/login.password": "sk-secret-value-998877"}"#,
    )
    .expect("write secrets.json");

    let out = vowkey()
        .args([
            "run",
            "--env-file",
            &env_file.to_string_lossy(),
            "--secrets",
            &secrets_file.to_string_lossy(),
            "--",
            "sh",
            "-c",
            "printf 'mode=%s key=%s' \"$PUBLIC_MODE\" \"$OPENAI_API_KEY\"",
        ])
        .output()
        .expect("Failed to run vowkey run");

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&out.stdout).expect("RunReport JSON");
    assert_eq!(report["exit_code"], 0);
    let stdout_str = report["stdout"].as_str().unwrap_or("");
    assert!(stdout_str.contains("mode=live"));
    assert!(!stdout_str.contains("sk-secret-value-998877"));
    assert!(stdout_str.contains("<REDACTED_BY_VOWKEY>"));

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn fills_docx_form_via_vowkey_fill_subcommand() {
    let corpus_docx = Path::new("/Users/ngotrung/Documents/Projects/vowkey/eval/corpus/east-asia/kr-hikorea-application.docx");
    if !corpus_docx.exists() {
        return;
    }
    let tmp = std::env::temp_dir().join(format!("vowkey-fill-cli-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&tmp);
    let out_docx = tmp.join("filled-kr.docx");
    let profile_file = tmp.join("profile.json");
    std::fs::write(
        &profile_file,
        r#"{"name.family":"NGUYEN","name.given":"TRUNG","birth.date":"1994-11-08","passport.number":"C9482710","phone.mobile":"010-1234-5678","address.full":"1-2-3 Shinjuku, Tokyo"}"#,
    )
    .expect("write profile.json");

    let out = vowkey()
        .args([
            "fill",
            &corpus_docx.to_string_lossy(),
            "--out",
            &out_docx.to_string_lossy(),
            "--profile",
            &profile_file.to_string_lossy(),
        ])
        .output()
        .expect("Failed to run vowkey fill");

    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: serde_json::Value = serde_json::from_slice(&out.stdout).expect("FileFillReport JSON");
    assert_eq!(report["format"], "docx");
    assert!(report["filled_count"].as_u64().unwrap_or(0) >= 4);
    assert!(out_docx.exists());

    let _ = std::fs::remove_dir_all(&tmp);
}
