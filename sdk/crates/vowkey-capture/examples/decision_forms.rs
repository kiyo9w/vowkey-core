//! Fills the three Demo forms from the demo details by asking a Decision model what each field asks
//! for, and compares what is written with what the forms should hold. Only the words that ask for
//! each field and the names of the details go to the model.
//!
//! ```text
//! VOWKEY_DECISION_KEY=... cargo run -p vowkey-capture --example decision_forms [-- --record]
//! ```
//! `--record` saves the choices to `tests/fixtures/decision/demo-form-choices.json`, which a test
//! fills the forms from without asking anything.
#![allow(clippy::print_stdout, clippy::print_stderr, missing_docs)]

#[path = "../tests/demo/mod.rs"]
mod demo;

use std::{
    collections::{BTreeMap, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};
use vowkey_capture::{
    decision_form::FormPlan,
    matcher::{FormFieldInput, fill_form_fields, fill_form_fields_chosen},
};

fn ask(body: &Value) -> Result<Value, String> {
    let endpoint =
        std::env::var("VOWKEY_DECISION_URL").unwrap_or_else(|_| "https://api.typesafe.ai/v1/systemone".to_string());
    let model = std::env::var("VOWKEY_DECISION_MODEL").unwrap_or_else(|_| "jev-1.14.0".to_string());
    let mut body = body.clone();
    if let Some(map) = body.as_object_mut() {
        map.insert("model".to_string(), json!(model));
    }
    let text = body.to_string();
    let mut hasher = DefaultHasher::new();
    format!("{endpoint}{text}").hash(&mut hasher);
    let cache = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/decision-cache");
    let cached = cache.join(format!("{:016x}.json", hasher.finish()));
    if let Ok(saved) = std::fs::read_to_string(&cached) {
        return serde_json::from_str(&saved).map_err(|e| e.to_string());
    }
    let key = std::env::var("VOWKEY_DECISION_KEY").map_err(|_| "VOWKEY_DECISION_KEY is not set".to_string())?;
    let config = std::env::temp_dir().join(format!("decision-forms-{}.curl", std::process::id()));
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&config)
            .map_err(|e| e.to_string())?;
        writeln!(file, "header = \"Authorization: Bearer {key}\"").map_err(|e| e.to_string())?;
    }
    let mut child = Command::new("curl")
        .args(["-sS", "--max-time", "120", "-K"])
        .arg(&config)
        .args(["-H", "Content-Type: application/json", "-w", "\n%{http_code}", "--data-binary", "@-", &endpoint])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&config);
    let out = String::from_utf8_lossy(&output.stdout).to_string();
    let (response, code) = out.rsplit_once('\n').unwrap_or((&out, ""));
    if code.trim() != "200" {
        return Err(format!("HTTP {} {}", code.trim(), response.chars().take(200).collect::<String>()));
    }
    let _ = std::fs::create_dir_all(&cache);
    let _ = std::fs::write(&cached, response);
    serde_json::from_str(response).map_err(|e| e.to_string())
}

fn main() {
    let record = std::env::args().any(|a| a == "--record");
    let details = demo::demo_details();
    let held: Vec<String> = details.keys().cloned().collect();
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), details);

    let forms: Vec<(&str, Vec<FormFieldInput>, Vec<Option<&str>>)> = vec![
        ("mizuho", demo::mizuho_fields(), demo::mizuho_expected()),
        ("shinjuku", demo::shinjuku_fields(), demo::shinjuku_expected()),
        ("tsubame", demo::tsubame_fields(), demo::tsubame_expected()),
    ];
    let (mut right, mut total, mut keyword_right) = (0, 0, 0);
    let mut recorded = serde_json::Map::new();
    for (name, fields, expected) in forms {
        let mut plan = FormPlan::new(&fields, &held);
        let first: Result<Vec<Value>, String> = plan.first_requests().iter().map(ask).collect();
        plan.take_first_answers(&first.unwrap_or_default());
        let second: Result<Vec<Value>, String> = plan.second_requests().iter().map(ask).collect();
        let chosen = plan.finish(&second.unwrap_or_default());
        let matches = fill_form_fields_chosen(&fields, &profiles, true, &chosen);
        let keyword = fill_form_fields(&fields, &profiles, true);
        println!("== {name}");
        for (i, field) in fields.iter().enumerate() {
            let got = matches[i].value.as_deref();
            let ok = got == expected[i];
            total += 1;
            right += usize::from(ok);
            keyword_right += usize::from(keyword[i].value.as_deref() == expected[i]);
            if !ok {
                println!(
                    "  {:<28} want {:<28} got {:<28} chose {} ({})",
                    field.label.chars().take(26).collect::<String>(),
                    format!("{:?}", expected[i]).chars().take(28).collect::<String>(),
                    format!("{got:?}").chars().take(28).collect::<String>(),
                    matches[i].attribute,
                    matches[i].owner
                );
            }
        }
        recorded.insert(name.to_string(), serde_json::to_value(&chosen).unwrap_or_default());
    }
    println!("\nDecision filled {right}/{total} as expected; the keyword engine {keyword_right}/{total}");
    if record {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/decision/demo-form-choices.json");
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = std::fs::write(&path, serde_json::to_string_pretty(&Value::Object(recorded)).unwrap_or_default());
        println!("recorded to {}", path.display());
    }
}
