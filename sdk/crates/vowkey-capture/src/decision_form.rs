//! Chooses which saved detail each field of a form asks for, and whose it is, by asking a Decision
//! model about the words that ask for it.
//!
//! The model is given the form's fields, each with its label and what stands near it, and the
//! details the profile holds. It chooses a group of details and an owner (the applicant, a spouse,
//! an employer), then one detail of the group, or none. Only labels, section headings and the
//! names of details go to the model; the values stay where they are, and the engine writes them,
//! in the format each field asks for. A field that asks about someone the profile does not hold is
//! left empty rather than filled with the applicant's detail.

use std::collections::BTreeMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    decision::Choice,
    matcher::FormFieldInput,
    vocab::{self, GROUPS},
};

/// Fields in one request. A request holds the form once and the questions after it.
const FIELDS_PER_REQUEST: usize = 25;

/// Whose detail a field asks for, in the roles the filling engine knows.
const OWNERS: &[(&str, &str)] = &[
    ("applicant", "The person filling the form, whose details these are: the applicant, you, the holder, the employee, the customer."),
    ("spouse", "The applicant's husband, wife or partner."),
    ("dependent", "A child or another dependent family member of the applicant."),
    ("employer", "The employer, company or organisation the applicant works for."),
    ("landlord", "A landlord, lessor or owner of a property the applicant uses."),
    ("household_head", "The head of the household, who may be another person."),
    ("preparer", "A person who prepares or submits the form for the applicant: an agent, a representative, a tax preparer."),
    ("guarantor", "A guarantor, a reference or an emergency contact."),
    ("other", "Any other person or organisation the form asks about."),
];

const NONE: &str = "The field asks for none of the person's details: a question about something else, a choice or declaration, a signature, today's date, a code, or a free comment.";

/// A field of a form as the model sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FieldAsk {
    /// The name the questions use for the field.
    pub id: String,
    /// The words that ask for it.
    pub text: String,
    /// What stands near it: its section, the format it asks for, a placeholder.
    pub near: Vec<String>,
    /// What kind of control it is.
    pub kind: String,
}

/// What Decision chose for a field: the detail and whose it is. An empty attribute leaves the field
/// alone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct ChosenField {
    /// The field's id.
    pub id: String,
    /// The canonical detail key, or empty for none.
    pub attribute: String,
    /// The role it is for: `applicant`, `spouse`, `employer` and so on.
    pub owner: String,
}

/// A form being read: its fields, the details the profile holds, and what has been answered.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FormPlan {
    /// The fields to ask about.
    pub fields: Vec<FieldAsk>,
    /// The keys of the details the profile holds.
    pub held: Vec<String>,
    /// The group each field asks for, once asked.
    pub groups: BTreeMap<String, Choice>,
    /// Whose detail each field asks for, once asked.
    pub owners: BTreeMap<String, Choice>,
    /// How many fields go in one request, or 0 for the usual number.
    #[serde(default)]
    pub per_request: usize,
}

/// Names that say nothing about a field, such as `Text12` or `Check Box3`.
static OPAQUE_NAME: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$")
        .expect("a valid pattern")
});

fn clip(text: &str, length: usize) -> String {
    text.chars().take(length).collect::<String>().trim().to_string()
}

/// Stable question key for each field in a form, falling back to an index key when `id` is empty
/// or repeated across controls.
pub fn choice_ids_for(fields: &[FormFieldInput]) -> Vec<String> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for field in fields {
        let trimmed = field.id.trim();
        if !trimmed.is_empty() {
            *counts.entry(trimmed).or_insert(0) += 1;
        }
    }
    fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            let trimmed = field.id.trim();
            if !trimmed.is_empty() && counts.get(trimmed).copied().unwrap_or(0) == 1 {
                trimmed.to_string()
            } else {
                format!("__vk_f_{index}")
            }
        })
        .collect()
}

impl FormPlan {
    /// The fields of a form worth asking about, with the keys of the details a profile holds.
    pub fn new(fields: &[FormFieldInput], held: &[String]) -> FormPlan {
        let choice_ids = choice_ids_for(fields);
        let asked: Vec<FieldAsk> = fields
            .iter()
            .zip(choice_ids)
            .filter(|(f, _)| {
                !f.op_ignore
                    && !matches!(
                        f.input_type.as_str(),
                        "hidden" | "password" | "submit" | "button" | "reset" | "image" | "file" | "checkbox" | "radio"
                    )
            })
            .filter_map(|(f, choice_id)| {
                let text = [&f.label, &f.placeholder]
                    .into_iter()
                    .map(|t| t.trim())
                    .find(|t| !t.is_empty())
                    .map_or_else(
                        || if OPAQUE_NAME.is_match(f.name.trim()) { String::new() } else { f.name.trim().to_string() },
                        str::to_string,
                    );
                if text.is_empty() {
                    return None;
                }
                let mut near: Vec<String> = [&f.section, &f.format, &f.placeholder]
                    .into_iter()
                    .map(|t| clip(t, 70))
                    .filter(|t| !t.is_empty() && *t != text)
                    .collect();
                near.dedup();
                Some(FieldAsk { id: choice_id, text: clip(&text, 90), near, kind: f.input_type.clone() })
            })
            .collect();
        let held = held.iter().filter(|k| vocab::knows(k)).cloned().collect();
        FormPlan { fields: asked, held, ..FormPlan::default() }
    }

    fn batch(&self) -> usize {
        if self.per_request == 0 { FIELDS_PER_REQUEST } else { self.per_request }
    }

    fn state(&self, with_groups: bool) -> Value {
        let fields: Vec<Value> = self
            .fields
            .iter()
            .map(|f| {
                let mut field = json!({ "id": f.id, "asks": f.text, "near": f.near, "control": f.kind });
                if with_groups {
                    if let (Some(group), Some(map)) = (self.groups.get(&f.id), field.as_object_mut()) {
                        map.insert("group".to_string(), json!(group.value));
                    }
                }
                field
            })
            .collect();
        json!({
            "about": "The fields of a form that a person is filling. Each field has the words that ask for it and what stands near it.",
            "fields": fields,
        })
    }

    /// The requests of the first round: which group of details each field asks for, and whose.
    pub fn first_requests(&self) -> Vec<Value> {
        let mut groups: serde_json::Map<String, Value> = GROUPS
            .iter()
            .filter(|g| g.id != "label")
            .map(|g| (g.id.to_string(), json!(g.about)))
            .collect();
        groups.insert("none".to_string(), json!(NONE));
        let owners: serde_json::Map<String, Value> =
            OWNERS.iter().map(|(id, about)| ((*id).to_string(), json!(about))).collect();
        let state = self.state(false);
        self.fields
            .chunks(self.batch())
            .map(|chunk| {
                let mut questions = serde_json::Map::new();
                for f in chunk {
                    questions.insert(
                        f.id.clone(),
                        json!({
                            "type": "choice",
                            "instructions": format!(
                                "What does field {} ask for? Decide from the words that ask for it and what stands near it. If it asks for none of the person's details, answer none.",
                                f.id
                            ),
                            "criteria": groups,
                        }),
                    );
                    questions.insert(
                        format!("owner:{}", f.id),
                        json!({
                            "type": "choice",
                            "instructions": format!(
                                "Whose detail does field {} ask for? Decide from the words that ask for it and the section it is in. When the form does not say, it is the applicant's.",
                                f.id
                            ),
                            "criteria": owners,
                        }),
                    );
                }
                json!({ "state": state, "questions": questions })
            })
            .collect()
    }

    /// Takes in the answers of the first round.
    pub fn take_first_answers(&mut self, responses: &[Value]) {
        for response in responses {
            let Some(answers) = response.get("answers").and_then(Value::as_object) else {
                continue;
            };
            for (id, answer) in answers {
                let Some(choice) = read_choice(answer) else { continue };
                match id.strip_prefix("owner:") {
                    Some(field) => self.owners.insert(field.to_string(), choice),
                    None => self.groups.insert(id.clone(), choice),
                };
            }
        }
    }

    /// The requests of the second round: which held detail of its group each field asks for.
    pub fn second_requests(&self) -> Vec<Value> {
        let state = self.state(true);
        let mut asked: Vec<(&FieldAsk, serde_json::Map<String, Value>)> = Vec::new();
        for f in &self.fields {
            let Some(group) = self.groups.get(&f.id) else { continue };
            let mut options: serde_json::Map<String, Value> = vocab::details_of(&group.value)
                .filter(|d| self.held.iter().any(|k| k == d.key))
                .map(|d| (d.key.to_string(), json!(d.about)))
                .collect();
            if options.is_empty() {
                continue;
            }
            options.insert("none".to_string(), json!(NONE));
            asked.push((f, options));
        }
        asked
            .chunks(self.batch())
            .map(|chunk| {
                let mut questions = serde_json::Map::new();
                for (f, options) in chunk {
                    questions.insert(
                        f.id.clone(),
                        json!({
                            "type": "choice",
                            "instructions": format!(
                                "Which saved detail does field {} ask for? Decide from the words that ask for it and what stands near it. Answer none if none of the listed details is what it asks for.",
                                f.id
                            ),
                            "criteria": options,
                        }),
                    );
                }
                json!({ "state": state, "questions": questions })
            })
            .collect()
    }

    /// What was chosen for every field that was asked about. A field the model said asks for no
    /// detail, or for a detail the profile does not hold, comes back with no attribute.
    pub fn finish(&self, responses: &[Value]) -> Vec<ChosenField> {
        let mut details: BTreeMap<String, Choice> = BTreeMap::new();
        for response in responses {
            let Some(answers) = response.get("answers").and_then(Value::as_object) else { continue };
            for (id, answer) in answers {
                if let Some(choice) = read_choice(answer) {
                    details.insert(id.clone(), choice);
                }
            }
        }
        self.fields
            .iter()
            .filter(|f| self.groups.contains_key(&f.id))
            .map(|f| {
                let owner = self
                    .owners
                    .get(&f.id)
                    .map_or("applicant", |o| o.value.as_str())
                    .to_string();
                let attribute = details
                    .get(&f.id)
                    .filter(|c| c.value != "none" && self.held.contains(&c.value))
                    .map(|c| c.value.clone())
                    .unwrap_or_default();
                ChosenField { id: f.id.clone(), attribute, owner }
            })
            .collect()
    }
}

fn read_choice(answer: &Value) -> Option<Choice> {
    let value = answer.get("choice")?.as_str()?.to_string();
    let p = answer
        .get("probabilities")
        .and_then(|p| p.get(&value))
        .and_then(Value::as_f64)
        .unwrap_or(1.0) as f32;
    Some(Choice { value, p })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(id: &str, label: &str, section: &str) -> FormFieldInput {
        FormFieldInput {
            id: id.to_string(),
            name: id.to_string(),
            label: label.to_string(),
            section: section.to_string(),
            input_type: "text".to_string(),
            ..FormFieldInput::default()
        }
    }

    fn answer(choice: &str) -> Value {
        json!({ "type": "choice", "choice": choice, "probabilities": { choice: 0.95 } })
    }

    #[test]
    fn asks_about_text_fields_with_their_section_and_leaves_controls_alone() {
        let mut check = field("agree", "I agree", "");
        check.input_type = "checkbox".to_string();
        let mut secret = field("pw", "Password", "");
        secret.input_type = "password".to_string();
        let plan = FormPlan::new(
            &[field("f1", "口座名義人", "振込指定口座"), check, secret, field("f2", "", "")],
            &["bank.account.holder.kanji".to_string(), "not.in.the.list".to_string()],
        );
        assert_eq!(plan.fields.len(), 1);
        assert_eq!(plan.fields[0].near, ["振込指定口座"]);
        assert_eq!(plan.held, ["bank.account.holder.kanji"]);
    }

    #[test]
    fn a_form_is_asked_in_two_rounds_and_only_about_held_details() {
        let mut plan = FormPlan::new(
            &[
                field("f1", "口座名義人", "振込指定口座"),
                field("f2", "Họ tên chủ hộ", ""),
                field("f3", "Reason for applying", ""),
            ],
            &["bank.account.holder.kanji".to_string(), "name.full".to_string()],
        );
        let first = plan.first_requests();
        assert_eq!(first.len(), 1);
        let questions = first[0]["questions"].as_object().expect("questions");
        assert_eq!(questions.len(), 6);
        assert!(questions["owner:f2"]["criteria"].get("household_head").is_some());

        let mut answers = serde_json::Map::new();
        answers.insert("f1".into(), answer("bank"));
        answers.insert("owner:f1".into(), answer("applicant"));
        answers.insert("f2".into(), answer("name"));
        answers.insert("owner:f2".into(), answer("household_head"));
        answers.insert("f3".into(), answer("none"));
        answers.insert("owner:f3".into(), answer("applicant"));
        plan.take_first_answers(&[json!({ "answers": answers })]);

        let second = plan.second_requests();
        assert_eq!(second.len(), 1);
        let asked = second[0]["questions"].as_object().expect("questions");
        assert_eq!(asked.keys().cloned().collect::<Vec<_>>(), ["f1", "f2"]);
        assert_eq!(asked["f1"]["criteria"].as_object().map(|o| o.len()), Some(2), "one held detail and none");

        let mut answers = serde_json::Map::new();
        answers.insert("f1".into(), answer("bank.account.holder.kanji"));
        answers.insert("f2".into(), answer("name.full"));
        let chosen = plan.finish(&[json!({ "answers": answers })]);
        assert_eq!(
            chosen,
            [
                ChosenField { id: "f1".into(), attribute: "bank.account.holder.kanji".into(), owner: "applicant".into() },
                ChosenField { id: "f2".into(), attribute: "name.full".into(), owner: "household_head".into() },
                ChosenField { id: "f3".into(), attribute: String::new(), owner: "applicant".into() },
            ]
        );
    }
}
