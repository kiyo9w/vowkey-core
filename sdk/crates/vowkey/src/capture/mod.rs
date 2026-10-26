//! `vowkey capture`: reads the facts printed on an identity document.

use std::{collections::BTreeMap, path::PathBuf};

use clap::{Args, Subcommand};
use serde::Serialize;
use vowkey_capture::{
    aamva::AamvaCard,
    barcode::decode_barcode,
    cccd::CccdCard,
    file_fill::fill_file_on_disk,
    matcher::{FormFieldInput, classify_field},
    mrz::{Mrz, find_mrz},
};

use crate::{
    client_state::{AnyState, BwCommand},
    render::{CommandOutput, CommandResult},
};

#[derive(Subcommand, Clone)]
pub enum CaptureCommands {
    #[command(about = "Read the machine-readable zone of a passport, ID card or visa.")]
    Mrz(MrzArgs),
    #[command(about = "Read an AAMVA PDF417 driver licence or ID card payload.")]
    Aamva(AamvaArgs),
    #[command(about = "Read a Vietnamese citizen identity card (CCCD / Căn cước) QR payload.")]
    Cccd(CccdArgs),
    #[command(about = "Decode a PDF417 or QR barcode from an image file.")]
    Barcode(BarcodeArgs),
    #[command(about = "Match a JSON array of form fields to canonical profile details.")]
    Match(MatchArgs),
    #[command(about = "Fill a PDF, Word (.docx), Excel (.xlsx) or Korean (.hwpx) form file.")]
    FillFile(FillFileArgs),
}

#[derive(Args, Clone)]
pub struct MrzArgs {
    /// The lines of the zone, exactly as printed. When none are given, the zone is found in the
    /// text on standard input, such as the output of OCR.
    lines: Vec<String>,
}

#[derive(Args, Clone)]
pub struct AamvaArgs {
    /// Path to a file holding the raw AAMVA payload. When omitted, reads from standard input.
    path: Option<PathBuf>,
}

#[derive(Args, Clone)]
pub struct CccdArgs {
    /// The pipe-separated QR payload. When omitted, reads from standard input.
    payload: Option<String>,
}

#[derive(Args, Clone)]
pub struct BarcodeArgs {
    /// Path to a PNG or JPEG image containing a document barcode.
    path: PathBuf,
}

#[derive(Args, Clone)]
pub struct MatchArgs {
    /// Path to a JSON file containing an array of FormFieldInput objects. Reads stdin when omitted.
    path: Option<PathBuf>,
}

#[derive(Args, Clone)]
pub struct FillFileArgs {
    /// Path to the blank form file (.pdf, .docx, .xlsx, .hwpx, .doc, .xls, .rtf).
    pub input: PathBuf,
    /// Path where the filled copy is written.
    #[arg(long, short = 'o')]
    pub out: PathBuf,
    /// Path to a JSON object mapping canonical profile attributes to values. Reads stdin when omitted.
    #[arg(long, short = 'p')]
    pub profile: Option<PathBuf>,
}

#[derive(Args, Clone)]
pub struct RunArgs {
    /// Optional `.env` file whose keys and `@vk:` references are injected into the child process.
    #[arg(long)]
    pub env_file: Option<PathBuf>,
    /// Optional JSON file mapping `@vk:` references or variable names to values.
    #[arg(long)]
    pub secrets: Option<PathBuf>,
    /// Mask resolved secret values in stdout and stderr.
    #[arg(long, default_value_t = true)]
    pub mask_output: bool,
    /// Command and arguments to execute with the injected environment.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true, required = true)]
    pub command: Vec<String>,
}

/// What `vowkey capture mrz` prints.
#[derive(Serialize)]
struct MrzReport {
    verified: bool,
    #[serde(flatten)]
    mrz: Mrz,
}

impl BwCommand for CaptureCommands {
    type Client = AnyState;

    async fn run(self, _: AnyState) -> CommandResult {
        match self {
            CaptureCommands::Mrz(args) => args.read(),
            CaptureCommands::Aamva(args) => args.read(),
            CaptureCommands::Cccd(args) => args.read(),
            CaptureCommands::Barcode(args) => args.read(),
            CaptureCommands::Match(args) => args.read(),
            CaptureCommands::FillFile(args) => args.read(),
        }
    }
}

impl MrzArgs {
    fn read(self) -> CommandResult {
        let lines = if self.lines.is_empty() {
            let text = std::io::read_to_string(std::io::stdin())?;
            find_mrz(&text)
                .into_iter()
                .next()
                .ok_or_else(|| {
                    color_eyre::eyre::eyre!("No machine-readable zone found in the text.")
                })?
        } else {
            self.lines
        };
        let mrz = Mrz::parse_ocr(&lines)?;
        Ok(CommandOutput::Object(Box::new(MrzReport {
            verified: mrz.verified(),
            mrz,
        })))
    }
}

impl AamvaArgs {
    fn read(self) -> CommandResult {
        let raw = match self.path {
            Some(path) => std::fs::read_to_string(path)?,
            None => std::io::read_to_string(std::io::stdin())?,
        };
        let card = AamvaCard::parse(&raw)?;
        Ok(CommandOutput::Object(Box::new(card)))
    }
}

impl CccdArgs {
    fn read(self) -> CommandResult {
        let raw = match self.payload {
            Some(payload) => payload,
            None => std::io::read_to_string(std::io::stdin())?,
        };
        let card = CccdCard::parse(&raw)?;
        Ok(CommandOutput::Object(Box::new(card)))
    }
}

impl BarcodeArgs {
    fn read(self) -> CommandResult {
        let bytes = std::fs::read(self.path)?;
        let decoded = decode_barcode(&bytes)?;
        Ok(CommandOutput::Object(Box::new(decoded)))
    }
}

impl MatchArgs {
    fn read(self) -> CommandResult {
        let raw = match self.path {
            Some(path) => std::fs::read_to_string(path)?,
            None => std::io::read_to_string(std::io::stdin())?,
        };
        let fields: Vec<FormFieldInput> = serde_json::from_str(&raw)?;
        let matches: Vec<_> = fields.iter().map(classify_field).collect();
        Ok(CommandOutput::Object(Box::new(matches)))
    }
}

impl FillFileArgs {
    pub fn read(self) -> CommandResult {
        let raw = match self.profile {
            Some(path) => std::fs::read_to_string(path)?,
            None => std::io::read_to_string(std::io::stdin())?,
        };
        let profile: BTreeMap<String, String> = serde_json::from_str(&raw)?;
        let report = fill_file_on_disk(&self.input, &self.out, &profile)?;
        Ok(CommandOutput::Object(Box::new(report)))
    }
}

#[derive(Serialize)]
struct RunReport {
    exit_code: i32,
    stdout: String,
    stderr: String,
    injected_keys: Vec<String>,
}

impl RunArgs {
    pub fn execute(self) -> CommandResult {
        let mut secrets_map: BTreeMap<String, String> = match self.secrets {
            Some(ref path) => {
                let raw = std::fs::read_to_string(path)?;
                serde_json::from_str(&raw)?
            }
            None => BTreeMap::new(),
        };

        let mut env_pairs: BTreeMap<String, String> = BTreeMap::new();
        let mut secret_values: Vec<String> = Vec::new();
        if let Some(ref env_path) = self.env_file {
            let content = std::fs::read_to_string(env_path)?;
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = trimmed.split_once('=') {
                    let key = k.trim().to_string();
                    let raw_val = v.trim().trim_matches('"').trim_matches('\'');
                    let resolved = if raw_val.starts_with("@vk:") {
                        let secret = secrets_map
                            .get(raw_val)
                            .or_else(|| secrets_map.get(&key))
                            .cloned()
                            .unwrap_or_else(|| raw_val.to_string());
                        if !secret.starts_with("@vk:") {
                            secret_values.push(secret.clone());
                        }
                        secret
                    } else {
                        raw_val.to_string()
                    };
                    env_pairs.insert(key, resolved);
                }
            }
        }
        for (k, v) in &secrets_map {
            if !v.starts_with("@vk:") {
                secret_values.push(v.clone());
            }
            if !k.starts_with("@vk:") && !env_pairs.contains_key(k) {
                env_pairs.insert(k.clone(), v.clone());
            }
        }

        let Some((program, args)) = self.command.split_first() else {
            return Err(color_eyre::eyre::eyre!("No command specified for `vowkey run`"));
        };

        let output = std::process::Command::new(program)
            .args(args)
            .envs(&env_pairs)
            .output()?;

        let mut stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let mut stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if self.mask_output {
            for val in &secret_values {
                if val.len() >= 4 && !val.starts_with("@vk:") {
                    stdout = stdout.replace(val, "<REDACTED_BY_VOWKEY>");
                    stderr = stderr.replace(val, "<REDACTED_BY_VOWKEY>");
                }
            }
        }
        let injected_keys = env_pairs.keys().cloned().collect();
        let exit_code = output.status.code().unwrap_or(1);
        secrets_map.clear();
        Ok(CommandOutput::Object(Box::new(RunReport {
            exit_code,
            stdout,
            stderr,
            injected_keys,
        })))
    }
}
