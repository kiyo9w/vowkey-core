//! Chooses the detail each field of the corpus's forms asks for, by asking a Decision model, for
//! `scripts/score-corpus.py --decision`. Reads a JSON array of fields on standard input, each with
//! the `form` it belongs to, and prints a JSON array with the attribute and owner chosen for each,
//! in the same order. The profile is taken to hold every detail the vocabulary has.
#![allow(clippy::print_stdout, clippy::print_stderr, missing_docs)]

#[path = "support/mod.rs"]
mod support;

use std::{collections::BTreeMap, io::Read};

use serde_json::{Value, json};
use vowkey_capture::{decision_form::FormPlan, matcher::FormFieldInput, vocab::DETAILS};

fn main() {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let fields: Vec<FormFieldInput> = serde_json::from_str(&input).unwrap_or_default();
    let held: Vec<String> = DETAILS.iter().map(|d| d.key.to_string()).collect();
    let per_request: usize = std::env::var("VOWKEY_DECISION_BATCH").ok().and_then(|n| n.parse().ok()).unwrap_or(0);

    let mut forms: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (index, field) in fields.iter().enumerate() {
        forms.entry(field.form.clone()).or_default().push(index);
    }
    let mut answers = vec![json!({ "attribute": "", "owner": "applicant" }); fields.len()];
    for (form, indexes) in &forms {
        let inputs: Vec<FormFieldInput> = indexes
            .iter()
            .map(|&i| FormFieldInput { id: format!("f{i}"), name: String::new(), ..fields[i].clone() })
            .collect();
        let mut plan = FormPlan::new(&inputs, &held);
        plan.per_request = per_request;
        let first: Vec<Value> = plan.first_requests().iter().filter_map(|r| support::ask(r).ok()).collect();
        plan.take_first_answers(&first);
        let second: Vec<Value> = plan.second_requests().iter().filter_map(|r| support::ask(r).ok()).collect();
        for chosen in plan.finish(&second) {
            if let Some(index) = chosen.id.strip_prefix('f').and_then(|n| n.parse::<usize>().ok()) {
                answers[index] = json!({ "attribute": chosen.attribute, "owner": chosen.owner });
            }
        }
        eprintln!("{form}: {} fields", indexes.len());
    }
    println!("{}", Value::Array(answers));
}
