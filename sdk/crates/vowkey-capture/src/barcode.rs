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

/// Decodes a barcode from PNG or JPEG image bytes and parses its document payload.
pub fn decode_barcode(image_bytes: &[u8]) -> Result<DecodedBarcode, BarcodeError> {
    let dynamic = image::load_from_memory(image_bytes)
        .map_err(|err| BarcodeError::InvalidImage(err.to_string()))?;
    let luma = dynamic.into_luma8();
    let width = luma.width();
    let height = luma.height();
    let raw_luma = luma.into_raw();

    let result = rxing::helpers::detect_in_luma_filtered(raw_luma, width, height, None)
        .map_err(|err| BarcodeError::NotFound(err.to_string()))?;

    let text = result.getText().to_string();
    let format = result.getBarcodeFormat().to_string();
    let payload = classify_barcode_text(&text);

    Ok(DecodedBarcode {
        format,
        text,
        payload,
    })
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
