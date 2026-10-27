//! Asking a Decision model from an example: the request goes to `VOWKEY_DECISION_URL` (Jev by
//! default) with the key in `VOWKEY_DECISION_KEY`, and the answer is cached by request in
//! `target/decision-cache`, so a second run costs nothing and gives the same answers.
#![allow(dead_code, clippy::print_stdout, clippy::print_stderr, missing_docs)]

use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    io::Write,
    process::{Command, Stdio},
};

use serde_json::{Value, json};

pub fn ask(body: &Value) -> Result<Value, String> {
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
