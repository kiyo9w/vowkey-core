//! Runs the document reader on a set of cases and scores what it finds against what each document
//! says. It runs the code the desktop app runs: the reader's pieces, Decision's two rounds of
//! questions, and the details they make; and the older keyword rules on the same files, for
//! comparison.
//!
//! ```text
//! VOWKEY_DECISION_KEY=... cargo run -p vowkey-capture --example decision_eval -- \
//!     --cases ../vowkey/corpus/documents/eval/cases.json [--split held] [--filter vn] [--no-baseline]
//! ```
//!
//! Answers are cached by request, so a second run costs nothing and gives the same results.
//! `--offline` uses only the cache.
#![allow(clippy::print_stdout, clippy::print_stderr, clippy::string_slice, missing_docs)]

use std::{
    collections::{BTreeMap, BTreeSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;
use serde_json::{Value, json};
use vowkey_capture::{
    decision::{Choice, Plan, Reading},
    barcode::decode_barcode,
    document::extract_document_details,
    office::reading_from_office,
    normalize::{comparable, fold, nationality, parse_amount, parse_date, sex},
};

#[derive(Deserialize)]
struct Case {
    id: String,
    file: String,
    #[serde(default)]
    language: String,
    #[serde(default)]
    doc_type: String,
    #[serde(default = "dev")]
    split: String,
    #[serde(default)]
    variant: String,
    expect: BTreeMap<String, String>,
}

fn dev() -> String {
    "dev".to_string()
}

struct Options {
    cases: PathBuf,
    root: PathBuf,
    endpoint: String,
    model: String,
    helper: PathBuf,
    cache: PathBuf,
    split: Option<String>,
    filter: Option<String>,
    baseline: bool,
    offline: bool,
    explain: bool,
    per_request: usize,
    out: PathBuf,
}

fn options() -> Options {
    let mut args = std::env::args().skip(1);
    let mut cases = PathBuf::new();
    let mut o = Options {
        cases: PathBuf::new(),
        root: PathBuf::new(),
        endpoint: std::env::var("VOWKEY_DECISION_URL").unwrap_or_else(|_| "https://api.typesafe.ai/v1/systemone".to_string()),
        model: std::env::var("VOWKEY_DECISION_MODEL").unwrap_or_else(|_| "jev-1.14.0".to_string()),
        helper: std::env::var("VOWKEY_READ_HELPER").map(PathBuf::from).unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../clients/apps/desktop/desktop_native/ocr/vowkey-read")
        }),
        cache: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/decision-cache"),
        split: None,
        filter: None,
        baseline: true,
        offline: false,
        explain: false,
        per_request: 0,
        out: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/decision-eval/report.json"),
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cases" => cases = PathBuf::from(args.next().unwrap_or_default()),
            "--split" => o.split = args.next(),
            "--filter" => o.filter = args.next(),
            "--no-baseline" => o.baseline = false,
            "--offline" => o.offline = true,
            "--explain" => o.explain = true,
            "--per-request" => o.per_request = args.next().and_then(|n| n.parse().ok()).unwrap_or(0),
            "--endpoint" => o.endpoint = args.next().unwrap_or_default(),
            "--model" => o.model = args.next().unwrap_or_default(),
            "--out" => o.out = PathBuf::from(args.next().unwrap_or_default()),
            other => eprintln!("unknown option {other}"),
        }
    }
    o.root = cases.parent().map(Path::to_path_buf).unwrap_or_default();
    o.cases = cases;
    o
}

fn canon(key: &str, value: &str) -> String {
    fold(&comparable(key, value)).chars().filter(|c| c.is_alphanumeric()).collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Verdict {
    Right,
    Near,
    Wrong,
    Missing,
}

fn judge(key: &str, got: Option<&String>, want: &str) -> Verdict {
    let Some(got) = got else { return Verdict::Missing };
    let (g, w) = (canon(key, got), canon(key, want));
    if g == w {
        Verdict::Right
    } else if !g.is_empty() && !w.is_empty() && (g.contains(&w) || w.contains(&g)) {
        Verdict::Near
    } else {
        Verdict::Wrong
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Found {
    /// A piece of the reading is this value, alone.
    Alone,
    /// The value is part of a larger piece, so it takes splitting to get it.
    Inside,
    /// The reading does not hold it in any form.
    Absent,
}

fn found_in(key: &str, want: &str, plan: &Plan) -> Found {
    let is_date = key == "birth.date" || key.ends_with(".date") || key.ends_with(".issued") || key.ends_with(".expiry") || key == "income.pay_date";
    let is_amount = key.starts_with("income.") && !is_date && key != "income.pay_period";
    let wanted_amount = if is_amount { parse_amount(want) } else { None };
    let means = |text: &str| -> bool {
        if is_date {
            return parse_date(text).is_some_and(|iso| iso == want);
        }
        if is_amount {
            return wanted_amount.is_some() && parse_amount(text) == wanted_amount;
        }
        match key {
            "person.sex" => sex(text) == Some(want),
            "person.nationality" => text.chars().count() <= 24 && !text.chars().any(|ch| ch.is_ascii_digit()) && nationality(text).as_deref() == Some(want),
            "birth.age" => text.chars().filter(char::is_ascii_digit).collect::<String>() == want,
            _ => canon(key, text) == canon(key, want),
        }
    };
    if plan.candidates.iter().any(|c| means(&c.text)) {
        return Found::Alone;
    }
    // A date, an amount, a sex or a nationality printed with other words in one piece, such as the
    // current and year-to-date amounts of a payslip line, or a period that runs over two lines.
    let structured = is_date || is_amount || matches!(key, "person.sex" | "person.nationality" | "birth.age");
    if structured || key == "income.pay_period" {
        let first_date = (key == "income.pay_period").then(|| parse_date(want)).flatten();
        let inside = plan.text.lines().any(|line| {
            let words: Vec<&str> = line.split_whitespace().collect();
            (1..=3).any(|n| {
                words.windows(n).any(|w| {
                    let text = w.join(" ");
                    if let Some(first) = &first_date { parse_date(&text).as_ref() == Some(first) } else { means(&text) }
                })
            })
        });
        if structured || inside {
            return if inside { Found::Inside } else { Found::Absent };
        }
    }
    let needle = canon(key, want);
    if !needle.is_empty() && canon(key, &plan.text).contains(&needle) {
        Found::Inside
    } else {
        Found::Absent
    }
}

fn hash(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// POSTs a request to Decision, or reads the answer that an identical request got before.
fn ask(o: &Options, body: &Value) -> Result<Value, String> {
    let mut body = body.clone();
    if let Some(map) = body.as_object_mut() {
        map.insert("model".to_string(), json!(o.model));
    }
    let text = body.to_string();
    let cached = o.cache.join(format!("{}.json", hash(&format!("{}{text}", o.endpoint))));
    if let Ok(saved) = std::fs::read_to_string(&cached) {
        return serde_json::from_str(&saved).map_err(|e| e.to_string());
    }
    if o.offline {
        return Err("not in the cache".to_string());
    }
    let local = o.endpoint.starts_with("http://127.0.0.1") || o.endpoint.starts_with("http://localhost");
    let key = match std::env::var("VOWKEY_DECISION_KEY") {
        Ok(key) => key,
        Err(_) if local => String::new(),
        Err(_) => return Err("VOWKEY_DECISION_KEY is not set".to_string()),
    };
    let config = std::env::temp_dir().join(format!("decision-eval-{}.curl", std::process::id()));
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&config)
            .map_err(|e| e.to_string())?;
        if !key.is_empty() && !local {
            writeln!(file, "header = \"Authorization: Bearer {key}\"").map_err(|e| e.to_string())?;
        }
    }
    let mut last = String::new();
    for attempt in 0..4 {
        let mut child = Command::new("curl")
            .args(["-sS", "--max-time", "120", "-K"])
            .arg(&config)
            .args(["-H", "Content-Type: application/json", "-w", "\n%{http_code}", "--data-binary", "@-", &o.endpoint])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let out = String::from_utf8_lossy(&output.stdout).to_string();
        let (response, code) = out.rsplit_once('\n').unwrap_or((&out, ""));
        if code.trim() == "200" {
            let _ = std::fs::remove_file(&config);
            let _ = std::fs::create_dir_all(&o.cache);
            let _ = std::fs::write(&cached, response);
            return serde_json::from_str(response).map_err(|e| e.to_string());
        }
        last = format!("HTTP {} {}", code.trim(), response.chars().take(300).collect::<String>());
        if !matches!(code.trim(), "429" | "500" | "502" | "503" | "504" | "000") {
            break;
        }
        std::thread::sleep(std::time::Duration::from_secs(2 << attempt));
    }
    let _ = std::fs::remove_file(&config);
    Err(last)
}

fn helper(o: &Options, args: &[&str], file: &Path) -> Result<String, String> {
    let output = Command::new(&o.helper)
        .args(args)
        .arg(file)
        .output()
        .map_err(|e| format!("{}: {e}", o.helper.display()))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn reading_of(o: &Options, file: &Path) -> Result<Reading, String> {
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if matches!(ext.as_str(), "txt" | "md" | "csv") {
        let text = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
        return Ok(Reading::from_text(&text));
    }
    if matches!(ext.as_str(), "docx" | "xlsx") {
        let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
        return reading_from_office(&bytes, &ext).ok_or_else(|| "cannot read the office file".to_string());
    }
    let json = helper(o, &["--pieces"], file)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn decision(o: &Options, plan: &mut Plan, year: u16) -> Result<(vowkey_capture::document::CapturedDocument, Vec<Value>), String> {
    let first: Result<Vec<Value>, String> = plan.first_requests().iter().map(|r| ask(o, r)).collect();
    plan.take_first_answers(&first?);
    let second: Result<Vec<Value>, String> = plan.second_requests().iter().map(|r| ask(o, r)).collect();
    let second = second?;
    Ok((plan.finish(&second, year), second))
}

/// A found value, or the one a general key stands for: a phone number the document does not call
/// mobile or home fills either.
fn got<'a>(found: &'a BTreeMap<String, String>, key: &str) -> Option<&'a String> {
    found.get(key).or_else(|| match key {
        k if k.starts_with("contact.phone.") => found.get("contact.phone"),
        k if k.starts_with("name.") && k.ends_with(".latin") => found.get(k.trim_end_matches(".latin")),
        _ => None,
    })
}

#[derive(Default, Clone)]
struct Tally {
    right: usize,
    near: usize,
    wrong: usize,
    missing: usize,
}

impl Tally {
    fn add(&mut self, v: Verdict) {
        match v {
            Verdict::Right => self.right += 1,
            Verdict::Near => self.near += 1,
            Verdict::Wrong => self.wrong += 1,
            Verdict::Missing => self.missing += 1,
        }
    }
    fn total(&self) -> usize {
        self.right + self.near + self.wrong + self.missing
    }
}

/// What the reading held of the values a document says, and how many of each Decision or the rules got.
#[derive(Default, Clone)]
struct Score {
    /// Values a piece of the reading is, alone.
    alone: Tally,
    /// Values that are part of a larger piece.
    inside: Tally,
    /// Values the reading does not hold.
    absent: Tally,
}

impl Score {
    fn all_right(&self) -> usize {
        self.alone.right + self.inside.right + self.absent.right
    }
    fn all(&self) -> usize {
        self.alone.total() + self.inside.total() + self.absent.total()
    }
    fn line(&self) -> String {
        let pct = |a: usize, b: usize| 100.0 * a as f32 / b.max(1) as f32;
        format!(
            "tagged right {:>4}/{:<4} ({:>5.1}%)  wrong {:>3} near {:>3}  | inside {:>3}/{:<3}  not in reading {:>3} | all {:>4}/{:<4} ({:>5.1}%)",
            self.alone.right,
            self.alone.total(),
            pct(self.alone.right, self.alone.total()),
            self.alone.wrong,
            self.alone.near,
            self.inside.right,
            self.inside.total(),
            self.absent.total(),
            self.all_right(),
            self.all(),
            pct(self.all_right(), self.all())
        )
    }
    fn add(&mut self, found: Found, v: Verdict) {
        match found {
            Found::Alone => self.alone.add(v),
            Found::Inside => self.inside.add(v),
            Found::Absent => self.absent.add(v),
        }
    }
}

fn main() {
    let o = options();
    let cases: Vec<Case> = match std::fs::read_to_string(&o.cases)
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cannot read cases {}: {e}", o.cases.display());
            std::process::exit(2);
        }
    };
    let year = 2026;
    let mut report = Vec::new();
    let mut totals: BTreeMap<String, (Score, Score)> = BTreeMap::new();
    let mut all = (Score::default(), Score::default());

    for case in cases.iter().filter(|c| {
        o.split.as_ref().is_none_or(|s| &c.split == s)
            && o.filter.as_ref().is_none_or(|f| c.id.contains(f.as_str()) || c.file.contains(f.as_str()))
    }) {
        let file = o.root.join(&case.file);
        let reading = match reading_of(&o, &file) {
            Ok(r) => r,
            Err(e) => {
                println!("{:<46} READ FAILED {e}", case.id);
                continue;
            }
        };
        let mut plan = Plan::new(&reading);
        plan.per_request = o.per_request;
        let barcode = std::fs::read(&file).ok().and_then(|bytes| decode_barcode(&bytes).ok()).map(|b| b.text);
        if let Some(text) = &barcode {
            plan.text.push('\n');
            plan.text.push_str(text);
        }
        let started = std::time::Instant::now();
        let (found, second) = match decision(&o, &mut plan, year) {
            Ok((d, second)) => (d.details, second),
            Err(e) => {
                println!("{:<46} DECISION FAILED {e}", case.id);
                continue;
            }
        };
        let took = started.elapsed().as_secs_f32();
        let rules = if o.baseline {
            let text = helper(&o, &[], &file).unwrap_or_default() + "\n" + barcode.as_deref().unwrap_or("");
            extract_document_details(&text, year).details
        } else {
            BTreeMap::new()
        };

        let (mut decision_score, mut rule_score) = (Score::default(), Score::default());
        let mut misses = Vec::new();
        let mut expectations = Vec::new();
        for (key, want) in &case.expect {
            let kind = found_in(key, want, &plan);
            let v = judge(key, got(&found, key), want);
            decision_score.add(kind, v);
            rule_score.add(kind, judge(key, got(&rules, key), want));
            expectations.push(json!({ "key": key, "want": want, "reading": format!("{kind:?}"), "verdict": format!("{v:?}") }));
            if v != Verdict::Right {
                misses.push(json!({
                    "key": key, "want": want, "got": got(&found, key), "verdict": format!("{v:?}"),
                    "reading": format!("{kind:?}"),
                }));
            }
        }
        let extras: BTreeSet<&String> = found.keys().filter(|k| !case.expect.contains_key(*k)).collect();
        println!(
            "{:<40} decision {:>2}/{:<2} of {:<2} tagged (alone {:>2}, inside {:>2}, not read {:>2})  rules {:>2}  {:>4.1}s  {} pieces",
            case.id,
            decision_score.all_right(),
            decision_score.all(),
            case.expect.len(),
            decision_score.alone.total(),
            decision_score.inside.total(),
            decision_score.absent.total(),
            rule_score.all_right(),
            took,
            plan.candidates.len()
        );
        if o.explain {
            let mut keyed: BTreeMap<String, Choice> = BTreeMap::new();
            for response in &second {
                if let Some(answers) = response.get("answers").and_then(Value::as_object) {
                    for (id, a) in answers {
                        let value = a.get("choice").and_then(Value::as_str).unwrap_or("").to_string();
                        let p = a.get("probabilities").and_then(|p| p.get(&value)).and_then(Value::as_f64).unwrap_or(1.0) as f32;
                        keyed.insert(id.clone(), Choice { value, p });
                    }
                }
            }
            println!("    kind: {:?}", plan.kind);
            for c in &plan.candidates {
                let g = plan.groups.get(&c.id).map_or(String::new(), |g| format!("{} {:.2}", g.value, g.p));
                let k = keyed.get(&c.id).map_or(String::new(), |k| format!("{} {:.2}", k.value, k.p));
                println!(
                    "    {:<5} {:<14} {:<34} {:<30} | {}",
                    c.id,
                    g,
                    k,
                    c.text.chars().take(30).collect::<String>(),
                    c.near.first().map(|n| n.chars().take(34).collect::<String>()).unwrap_or_default()
                );
            }
        }
        for m in &misses {
            println!(
                "    {:<8} {:<9} {:<30} want {:<28} got {}",
                m["verdict"].as_str().unwrap_or(""),
                m["reading"].as_str().unwrap_or(""),
                m["key"].as_str().unwrap_or(""),
                m["want"].as_str().unwrap_or("").chars().take(28).collect::<String>(),
                m["got"].as_str().unwrap_or("-").chars().take(40).collect::<String>()
            );
        }
        for group in [case.language.clone(), case.doc_type.clone(), case.variant.clone(), format!("split:{}", case.split)] {
            if group.is_empty() {
                continue;
            }
            let entry = totals.entry(group).or_default();
            for (key, want) in &case.expect {
                let kind = found_in(key, want, &plan);
                entry.0.add(kind, judge(key, got(&found, key), want));
                entry.1.add(kind, judge(key, got(&rules, key), want));
            }
        }
        for (key, want) in &case.expect {
            let kind = found_in(key, want, &plan);
            all.0.add(kind, judge(key, got(&found, key), want));
            all.1.add(kind, judge(key, got(&rules, key), want));
        }
        report.push(json!({
            "id": case.id, "file": case.file, "language": case.language, "doc_type": case.doc_type,
            "split": case.split, "variant": case.variant, "pieces": plan.candidates.len(), "seconds": took,
            "kind": plan.kind, "decision": decision_score.all_right(), "rules": rule_score.all_right(), "keys": case.expect.len(),
            "misses": misses, "extras": extras, "expectations": expectations, "text": plan.text,
        }));
    }

    println!("\nTOTAL  decision  {}", all.0.line());
    if o.baseline {
        println!("       rules {}", all.1.line());
    }
    for (group, (decision, rules)) in &totals {
        println!("{group:<20} decision {}", decision.line());
        if o.baseline {
            println!("{:<20} rules {}", "", rules.line());
        }
    }
    if let Some(dir) = o.out.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&o.out, serde_json::to_string_pretty(&report).unwrap_or_default());
}
