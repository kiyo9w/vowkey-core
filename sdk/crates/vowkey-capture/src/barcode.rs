//! Reads PDF417, QR and other barcodes on identity documents.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use vowkey_error::vowkey_error;

use crate::{aamva::AamvaCard, cccd::CccdCard};

/// Why a barcode could not be decoded from an image.
#[vowkey_error(flat)]
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BarcodeError {
    /// The bytes are not a supported image format.
    #[error("the image could not be decoded: {0}")]
    InvalidImage(String),
    /// No readable barcode was found in the image.
    #[error("no barcode could be read from the image: {0}")]
    NotFound(String),
}

/// What kind of document payload a barcode carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub enum DocumentBarcodePayload {
    /// A North American driver licence or ID card (AAMVA PDF417).
    Aamva(AamvaCard),
    /// A Vietnamese citizen identity card (CCCD QR).
    Cccd(CccdCard),
    /// Any other barcode text.
    Text(String),
}

/// A barcode decoded from an image, together with any document structure recognized inside it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct DecodedBarcode {
    /// The barcode symbology (such as `PDF_417` or `QR_CODE`).
    pub format: String,
    /// The raw decoded text.
    pub text: String,
    /// The parsed document payload when the text matches a known standard.
    pub payload: DocumentBarcodePayload,
}

/// The longest side one reader pass works on. A photographed document is far bigger than any
/// barcode on it needs, and `rxing`'s filtered reader multiplies its way out of range on those
/// sizes, so every pass here is a plain reader over a bounded copy.
const MAX_READER_SIDE: u32 = 2048;
/// Each pass after the first works on a copy this many times shorter.
const READER_SCALE: u32 = 3;
/// The shortest side worth another pass: below this, a code is bigger than the photo that holds it.
const MIN_READER_SIDE: u32 = 500;

/// Decodes a barcode from PNG or JPEG image bytes and parses its document payload.
pub fn decode_barcode(image_bytes: &[u8]) -> Result<DecodedBarcode, BarcodeError> {
    let dynamic = image::load_from_memory(image_bytes)
        .map_err(|err| BarcodeError::InvalidImage(err.to_string()))?;
    let mut luma = bounded(dynamic.into_luma8(), MAX_READER_SIDE);

    loop {
        let (width, height) = (luma.width(), luma.height());
        match rxing::helpers::detect_in_luma_slice(luma.as_raw(), width, height, None) {
            Ok(result) => return Ok(decoded(result)),
            Err(err) => {
                let longest = width.max(height);
                if longest <= MIN_READER_SIDE {
                    return Err(BarcodeError::NotFound(err.to_string()));
                }
                luma = bounded(luma, longest / READER_SCALE);
            }
        }
    }
}

/// The reader's answer as a decoded barcode.
fn decoded(result: rxing::RXingResult) -> DecodedBarcode {
    let text = result.getText().to_string();
    let format = result.getBarcodeFormat().to_string();
    let payload = classify_barcode_text(&text);
    DecodedBarcode {
        format,
        text,
        payload,
    }
}

/// A copy whose longest side is at most `side`, keeping the shape of the original.
fn bounded(luma: image::GrayImage, side: u32) -> image::GrayImage {
    let longest = luma.width().max(luma.height());
    if longest <= side {
        return luma;
    }
    let scale = f64::from(side) / f64::from(longest);
    let width = ((f64::from(luma.width()) * scale).round() as u32).max(1);
    let height = ((f64::from(luma.height()) * scale).round() as u32).max(1);
    image::imageops::resize(&luma, width, height, image::imageops::FilterType::Triangle)
}

/// Classifies a decoded barcode string into an AAMVA card, a Vietnamese CCCD card or plain text.
pub fn classify_barcode_text(text: &str) -> DocumentBarcodePayload {
    if let Ok(card) = AamvaCard::parse(text) {
        return DocumentBarcodePayload::Aamva(card);
    }
    if let Ok(card) = CccdCard::parse(text) {
        return DocumentBarcodePayload::Cccd(card);
    }
    DocumentBarcodePayload::Text(text.to_string())
}
