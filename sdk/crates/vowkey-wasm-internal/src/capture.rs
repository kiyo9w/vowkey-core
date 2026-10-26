use vowkey_capture::{
    aamva::{AamvaCard, AamvaError},
    barcode::{BarcodeError, DecodedBarcode},
    cccd::{CccdCard, CccdError},
    mrz::{Mrz, MrzError},
};

/// Reads the lines of a machine-readable zone read from a document, with the letters and digits
/// that OCR confuses corrected by position and by the check digits.
///
/// # Arguments
/// - `lines` - two lines of 36 or 44 characters, or three of 30
///
/// # Returns
/// - `Ok(Mrz)` with every field and every check digit; `Mrz.checks` says which digits pass
/// - `Err(MrzError)` if the lines are not one of the five layouts
#[vowkey_ffi::wasm_export]
pub fn read_mrz(lines: Vec<String>) -> Result<Mrz, MrzError> {
    Mrz::parse_ocr(&lines)
}

/// The machine-readable zones found in a page of text.
#[derive(serde::Serialize, serde::Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct MrzZones {
    /// Each zone as its lines, ready for `read_mrz`, in the order they appear on the page.
    pub zones: Vec<Vec<String>>,
}

/// Finds the machine-readable zones in text that OCR recognized from a page.
#[vowkey_ffi::wasm_export]
pub fn find_mrz(text: String) -> MrzZones {
    MrzZones {
        zones: vowkey_capture::mrz::find_mrz(&text),
    }
}

/// Reads an AAMVA PDF417 barcode payload from a North American driver licence or ID card.
#[vowkey_ffi::wasm_export]
pub fn read_aamva(raw: String) -> Result<AamvaCard, AamvaError> {
    AamvaCard::parse(&raw)
}

/// Reads a Vietnamese citizen identity card (CCCD / Căn cước) QR payload.
#[vowkey_ffi::wasm_export]
pub fn read_cccd(raw: String) -> Result<CccdCard, CccdError> {
    CccdCard::parse(&raw)
}

/// Decodes a PDF417 or QR barcode from PNG or JPEG image bytes and parses its document payload.
#[vowkey_ffi::wasm_export]
pub fn decode_document_barcode(image_bytes: Vec<u8>) -> Result<DecodedBarcode, BarcodeError> {
    vowkey_capture::barcode::decode_barcode(&image_bytes)
}
