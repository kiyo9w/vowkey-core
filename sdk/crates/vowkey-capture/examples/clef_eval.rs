//! Runs the document reader on a set of cases and scores what it finds against what each document
//! says. It runs the code the desktop app runs: the reader's pieces, Clef's two rounds of
//! questions, and the details they make; and the older keyword rules on the same files, for
//! comparison.
//!
//! ```text
//! VOWKEY_CLEF_KEY=... cargo run -p vowkey-capture --example clef_eval -- \
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
    clef::{Choice, Plan, Reading},
    document::extract_document_details,
    normalize::{fold, nationality, normalize_value, parse_amount, parse_date, sex},
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
    out: PathBuf,
}

fn options() -> Options {
    let mut args = std::env::args().skip(1);
    let mut cases = PathBuf::new();
    let mut o = Options {
        cases: PathBuf::new(),
        root: PathBuf::new(),
        endpoint: std::env::var("VOWKEY_CLEF_URL").unwrap_or_else(|_| "https://api.typesafe.ai/v1/systemone".to_string()),
        model: std::env::var("VOWKEY_CLEF_MODEL").unwrap_or_else(|_| "jev-1.14.0".to_string()),
        helper: std::env::var("VOWKEY_READ_HELPER").map(PathBuf::from).unwrap_or_else(|_| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../clients/apps/desktop/desktop_native/ocr/vowkey-read")
        }),
        cache: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/clef-cache"),
        split: None,
        filter: None,
        baseline: true,
        offline: false,
        explain: false,
        out: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/clef-eval/report.json"),
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--cases" => cases = PathBuf::from(args.next().unwrap_or_default()),
            "--split" => o.split = args.next(),
            "--filter" => o.filter = args.next(),
            "--no-baseline" => o.baseline = false,
            "--offline" => o.offline = true,
            "--explain" => o.explain = true,
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
    fold(&normalize_value(key, value)).chars().filter(|c| c.is_alphanumeric()).collect()
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
    let is_date = key == "birth.date" || key.ends_with(".date") || key.ends_with(".issued") || key.ends_with(".expiry") || key == "income.pay_date" || key == "income.pay_period";
    let alone = plan.candidates.iter().any(|c| {
        if is_date {
            return parse_date(&c.text).is_some_and(|iso| iso == want || (key == "income.pay_period" && iso.starts_with(want)));
        }
        if key.starts_with("income.") {
            return parse_amount(&c.text).is_some_and(|n| n == want);
        }
        match key {
            "person.sex" => sex(&c.text) == Some(want),
            "person.nationality" => c.text.chars().count() <= 24 && !c.text.chars().any(|ch| ch.is_ascii_digit()) && nationality(&c.text).as_deref() == Some(want),
            "birth.age" => c.text.chars().filter(char::is_ascii_digit).collect::<String>() == want,
            _ => canon(key, &c.text) == canon(key, want),
        }
    });
    if alone {
        return Found::Alone;
    }
    if matches!(key, "person.sex" | "person.nationality" | "birth.age") || is_date || key.starts_with("income.") {
        return Found::Absent;
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

/// POSTs a request to Clef, or reads the answer that an identical request got before.
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
    let key = std::env::var("VOWKEY_CLEF_KEY").map_err(|_| "VOWKEY_CLEF_KEY is not set".to_string())?;
    let config = std::env::temp_dir().join(format!("clef-eval-{}.curl", std::process::id()));
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
    let json = helper(o, &["--pieces"], file)?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

fn clef(o: &Options, plan: &mut Plan, year: u16) -> Result<(vowkey_capture::document::CapturedDocument, Vec<Value>), String> {
    let first: Result<Vec<Value>, String> = plan.first_requests().iter().map(|r| ask(o, r)).collect();
    plan.take_first_answers(&first?);
    let second: Result<Vec<Value>, String> = plan.second_requests().iter().map(|r| ask(o, r)).collect();
    let second = second?;
    Ok((plan.finish(&second, year), second))
}

/// A found value, or the one a general key stands for: a phone number the document does not call
/// mobile or home fills either.
fn got<'a>(found: &'a BTreeMap<String, String>, key: &str) -> Option<&'a String> {
    found.get(key).or_else(|| if key.starts_with("contact.phone.") { found.get("contact.phone") } else { None })
}

#[derive(Default)]
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
    fn line(&self) -> String {
        let t = self.total().max(1) as f32;
        format!(
            "right {:>4} ({:>5.1}%)  near {:>3}  wrong {:>3}  missing {:>3}  of {}",
            self.right,
            100.0 * self.right as f32 / t,
            self.near,
            self.wrong,
            self.missing,
            self.total()
        )
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
    let mut totals: BTreeMap<String, (Tally, Tally)> = BTreeMap::new();
    let mut all = (Tally::default(), Tally::default());

    for case in cases.iter().filter(|c| {
        o.split.as_ref().is_none_or(|s| &c.split == s) && o.filter.as_ref().is_none_or(|f| c.id.contains(f.as_str()) || c.file.contains(f.as_str()))
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
        let started = std::time::Instant::now();
        let (found, second) = match clef(&o, &mut plan, year) {
            Ok((d, second)) => (d.details, second),
            Err(e) => {
                println!("{:<46} CLEF FAILED {e}", case.id);
                continue;
            }
        };
        let took = started.elapsed().as_secs_f32();
        let rules = if o.baseline {
            let text = helper(&o, &[], &file).unwrap_or_default();
            extract_document_details(&text, year).details
        } else {
            BTreeMap::new()
        };

        let mut keys: Vec<(&String, &String)> = Vec::new();
        let mut inside: Vec<(&String, &String)> = Vec::new();
        for (key, want) in &case.expect {
            match found_in(key, want, &plan) {
                Found::Alone => keys.push((key, want)),
                Found::Inside => inside.push((key, want)),
                Found::Absent => {}
            }
        }
        let (mut clef_tally, mut rule_tally) = (Tally::default(), Tally::default());
        let mut misses = Vec::new();
        for (key, want) in &keys {
            let v = judge(key, got(&found, key), want);
            clef_tally.add(v);
            if v != Verdict::Right {
                misses.push(json!({ "key": key, "want": want, "got": got(&found, key), "verdict": format!("{v:?}") }));
            }
            rule_tally.add(judge(key, got(&rules, key), want));
        }
        let inner = inside.iter().filter(|(k, w)| judge(k, got(&found, k), w) == Verdict::Right).count();
        let extras: BTreeSet<&String> = found.keys().filter(|k| !case.expect.contains_key(*k)).collect();
        println!(
            "{:<40} clef {:>3}/{:<3}  rules {:>3}/{:<3}  inside {:>2}/{:<2}  {:>4.1}s  {} pieces",
            case.id,
            clef_tally.right,
            keys.len(),
            rule_tally.right,
            keys.len(),
            inner,
            inside.len(),
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
                "    {:<9} {:<34} want {:<30} got {}",
                m["verdict"].as_str().unwrap_or(""),
                m["key"].as_str().unwrap_or(""),
                m["want"].as_str().unwrap_or("").chars().take(30).collect::<String>(),
                m["got"].as_str().unwrap_or("-").chars().take(40).collect::<String>()
            );
        }
        for group in [case.language.clone(), case.doc_type.clone(), case.variant.clone(), format!("split:{}", case.split)] {
            if group.is_empty() {
                continue;
            }
            let entry = totals.entry(group).or_default();
            for (key, want) in &keys {
                entry.0.add(judge(key, got(&found, key), want));
                entry.1.add(judge(key, got(&rules, key), want));
            }
        }
        for (key, want) in &keys {
            all.0.add(judge(key, got(&found, key), want));
            all.1.add(judge(key, got(&rules, key), want));
        }
        report.push(json!({
            "id": case.id, "file": case.file, "language": case.language, "doc_type": case.doc_type,
            "split": case.split, "variant": case.variant, "pieces": plan.candidates.len(), "seconds": took,
            "kind": plan.kind, "clef": clef_tally.right, "rules": rule_tally.right, "checked": keys.len(),
            "misses": misses, "extras": extras, "inside": inside.len(), "inside_right": inner,
        }));
    }

    println!("\nTOTAL   clef  {}", all.0.line());
    if o.baseline {
        println!("        rules {}", all.1.line());
    }
    for (group, (clef, rules)) in &totals {
        println!("{group:<22} clef {}", clef.line());
        if o.baseline {
            println!("{:<22} rules {}", "", rules.line());
        }
    }
    if let Some(dir) = o.out.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&o.out, serde_json::to_string_pretty(&report).unwrap_or_default());
}
