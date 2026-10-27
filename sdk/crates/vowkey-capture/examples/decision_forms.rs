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

#[path = "support/mod.rs"]
mod support;

use std::collections::BTreeMap;

use serde_json::Value;
use vowkey_capture::{
    decision_form::FormPlan,
    matcher::{FormFieldInput, fill_form_fields, fill_form_fields_chosen},
};

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
        let first: Result<Vec<Value>, String> = plan.first_requests().iter().map(support::ask).collect();
        plan.take_first_answers(&first.unwrap_or_default());
        let second: Result<Vec<Value>, String> = plan.second_requests().iter().map(support::ask).collect();
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
