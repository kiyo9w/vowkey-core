//! Reads the machine-readable zone from text that Apple's Vision framework recognized in photos of
//! passport data pages: spaces inside lines, fillers dropped or misread, and the rest of the page
//! around the zone.

use vowkey_capture::mrz::{Mrz, find_mrz};

/// The fixture name, the issuer, the document number, the family name, the birth and expiry dates.
const PASSPORTS: &[(&str, &str, &str, &str, &str, &str)] = &[
    ("nl-passport-2014", "NLD", "SPECI2014", "DE BRUIJN", "650310", "240309"),
    ("pl-passport", "POL", "ZS8000038", "SAMPLE", "830612", "160730"),
    ("no-passport-2020", "NOR", "CCC002251", "OESTENBYEN", "560423", "300415"),
    ("bh-passport-2023", "BHR", "B0000000", "EBRAHIM", "900128", "321216"),
    ("rs-passport-2009", "SRB", "000000000", "TEST", "680229", "221010"),
];

fn recognized(name: &str) -> String {
    let path = format!("{}/tests/fixtures/ocr/{name}.txt", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

#[test]
fn reads_and_verifies_the_zone_in_recognized_passport_pages() {
    for &(name, issuer, number, family, birth, expiry) in PASSPORTS {
        let text = recognized(name);
        let zone = find_mrz(&text)
            .into_iter()
            .next()
            .unwrap_or_else(|| panic!("{name}: no zone found in\n{text}"));
        let mrz = Mrz::parse_ocr(&zone).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(mrz.verified(), "{name}: a check digit fails: {:?}", mrz.checks);
        assert_eq!(mrz.issuer, issuer, "{name}");
        assert_eq!(mrz.document_number, number, "{name}");
        assert_eq!(mrz.family_name, family, "{name}");
        assert_eq!(mrz.birth_date.as_str(), birth, "{name}");
        assert_eq!(mrz.expiry_date.as_str(), expiry, "{name}");
    }
}
