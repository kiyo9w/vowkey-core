//! `vowkey capture`: reads the facts printed on an identity document.

use std::path::PathBuf;

use clap::{Args, Subcommand};
use serde::Serialize;
use vowkey_capture::{
    aamva::AamvaCard,
    barcode::decode_barcode,
    cccd::CccdCard,
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
