//! A profile is a person's details kept in one vault item. Bitwarden's Identity item holds the
//! details it has fields for, so its own filler and its screens keep working, and every detail
//! also lives in a custom field named by its canonical key, so nothing a document says is lost.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::document::derive_companion_details;

/// The fields of Bitwarden's Identity item. An empty string is a field with nothing in it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct IdentityFields {
    /// Title, such as Ms.
    pub title: String,
    /// First name.
    pub first_name: String,
    /// Middle name.
    pub middle_name: String,
    /// Last name.
    pub last_name: String,
    /// First address line.
    pub address1: String,
    /// Second address line.
    pub address2: String,
    /// Third address line.
    pub address3: String,
    /// City.
    pub city: String,
    /// State, province or prefecture.
    pub state: String,
    /// Postal code.
    pub postal_code: String,
    /// Country.
    pub country: String,
    /// Company.
    pub company: String,
    /// Email address.
    pub email: String,
    /// Phone number.
    pub phone: String,
    /// Social security number.
    pub ssn: String,
    /// Passport number.
    pub passport_number: String,
    /// Licence number.
    pub license_number: String,
}

/// An Identity item as a profile: its own fields and its text custom fields.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct ProfileFields {
    /// The Identity item's own fields.
    pub identity: IdentityFields,
    /// Custom fields by name, where a canonical detail key is the name of its field.
    pub custom: BTreeMap<String, String>,
}

/// Keys that two sources spell differently. The first spelling is the canonical one.
const ALIASES: &[(&str, &str)] = &[
    ("id.driver_license.number", "id.drivers_license.number"),
    ("id.driver_license.issued", "id.drivers_license.issue_date"),
    ("id.driver_license.expiry", "id.drivers_license.expiry_date"),
    ("address.prefecture", "address.state"),
    ("id.passport.number", "passport.number"),
    ("person.sex", "sex"),
];

/// The canonical spelling of a detail key.
pub fn canonical_key(key: &str) -> &str {
    ALIASES
        .iter()
        .find(|(_, alias)| *alias == key)
        .map_or(key, |(canonical, _)| canonical)
}

/// The Identity fields and the detail each holds. A field takes the Latin spelling of a name when
/// the document has one, because forms in any country take it.
fn native_details(identity: &IdentityFields) -> [(&'static str, &String); 17] {
    [
        ("name.prefix", &identity.title),
        ("name.given", &identity.first_name),
        ("name.middle", &identity.middle_name),
        ("name.family", &identity.last_name),
        ("address.street", &identity.address1),
        ("address.building", &identity.address2),
        ("address.line3", &identity.address3),
        ("address.city", &identity.city),
        ("address.prefecture", &identity.state),
        ("address.postal", &identity.postal_code),
        ("address.country", &identity.country),
        ("work.employer.name", &identity.company),
        ("contact.email", &identity.email),
        ("contact.phone", &identity.phone),
        ("id.ssn", &identity.ssn),
        ("id.passport.number", &identity.passport_number),
        ("id.driver_license.number", &identity.license_number),
    ]
}

/// The details a profile holds, by canonical key: the Identity fields first, then the custom
/// fields, which say more.
pub fn stored_details(profile: &ProfileFields) -> BTreeMap<String, String> {
    let mut details = BTreeMap::new();
    for (key, value) in native_details(&profile.identity) {
        if !value.trim().is_empty() {
            details.insert(key.to_string(), value.clone());
        }
    }
    for (name, value) in &profile.custom {
        if !value.trim().is_empty() {
            details.insert(canonical_key(name).to_string(), value.clone());
        }
    }
    details
}

/// Every detail a profile holds and every detail that follows from them, such as a birth date in
/// the Japanese era or a name in half-width kana: what a form can be filled from.
pub fn profile_details(profile: &ProfileFields) -> BTreeMap<String, String> {
    let mut details = stored_details(profile);
    derive_companion_details(&mut details);
    details
}

/// The profile with `details` added: each one is a custom field, and the Identity fields that
/// have a home for it hold it too. A newer value replaces the one it was read to replace.
pub fn update_profile(profile: &ProfileFields, details: &BTreeMap<String, String>) -> ProfileFields {
    let mut updated = profile.clone();
    for (key, value) in details {
        let value = value.trim();
        if !value.is_empty() {
            updated.custom.insert(canonical_key(key).to_string(), value.to_string());
        }
    }

    let all = stored_details(&updated);
    let pick = |keys: &[&str]| -> Option<String> {
        keys.iter().find_map(|key| all.get(*key).filter(|v| !v.is_empty()).cloned())
    };
    let identity = &mut updated.identity;
    let set = |field: &mut String, value: Option<String>| {
        if let Some(value) = value {
            *field = value;
        }
    };
    set(&mut identity.first_name, pick(&["name.given.latin", "name.given"]));
    set(&mut identity.middle_name, pick(&["name.middle"]));
    set(&mut identity.last_name, pick(&["name.family.latin", "name.family"]));
    set(&mut identity.address1, pick(&["address.street"]));
    set(&mut identity.address2, pick(&["address.building"]));
    set(&mut identity.city, pick(&["address.city"]));
    set(&mut identity.state, pick(&["address.prefecture"]));
    set(&mut identity.postal_code, pick(&["address.postal"]));
    set(&mut identity.country, pick(&["address.country"]));
    set(&mut identity.company, pick(&["work.employer.name"]));
    set(&mut identity.email, pick(&["contact.email"]));
    set(&mut identity.phone, pick(&["contact.phone.mobile", "contact.phone"]));
    set(&mut identity.ssn, pick(&["id.ssn"]));
    set(&mut identity.passport_number, pick(&["id.passport.number"]));
    set(&mut identity.license_number, pick(&["id.driver_license.number"]));
    updated
}

/// What a person calls a detail.
pub fn detail_label(key: &str) -> String {
    let key = canonical_key(key);
    if let Some((_, label)) = LABELS.iter().find(|(k, _)| *k == key) {
        return (*label).to_string();
    }
    // A key nobody named reads as its parts, `bank.branch.code` as "Bank branch code".
    let words = key.replace(['.', '_'], " ");
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => words,
    }
}

const LABELS: &[(&str, &str)] = &[
    ("name.full", "Full name"),
    ("name.full.latin", "Full name (Latin letters)"),
    ("name.full.romaji", "Full name (Romaji)"),
    ("name.full.kana", "Full name (kana)"),
    ("name.full.hiragana", "Full name (hiragana)"),
    ("name.full.zengin", "Full name (bank format)"),
    ("name.given", "Given name"),
    ("name.given.latin", "Given name (Latin letters)"),
    ("name.given.romaji", "Given name (Romaji)"),
    ("name.given.kana", "Given name (kana)"),
    ("name.given.hiragana", "Given name (hiragana)"),
    ("name.family", "Family name"),
    ("name.family.latin", "Family name (Latin letters)"),
    ("name.family.romaji", "Family name (Romaji)"),
    ("name.family.kana", "Family name (kana)"),
    ("name.family.hiragana", "Family name (hiragana)"),
    ("name.middle", "Middle name"),
    ("name.birth", "Birth name"),
    ("name.prefix", "Title"),
    ("birth.date", "Date of birth"),
    ("birth.date.wareki", "Date of birth (Japanese era)"),
    ("birth.year", "Birth year"),
    ("birth.month", "Birth month"),
    ("birth.day", "Birth day"),
    ("birth.era", "Birth era"),
    ("birth.era_year", "Birth era year"),
    ("birth.age", "Age"),
    ("birth.place", "Place of birth"),
    ("birth.country", "Country of birth"),
    ("person.sex", "Sex"),
    ("person.sex.code", "Sex (code)"),
    ("person.nationality", "Nationality"),
    ("person.nationality.code", "Nationality (code)"),
    ("person.marital_status", "Marital status"),
    ("person.profession", "Occupation"),
    ("person.religion", "Religion"),
    ("person.ethnicity", "Ethnicity"),
    ("person.blood_type", "Blood type"),
    ("contact.email", "Email"),
    ("contact.phone", "Phone"),
    ("contact.phone.mobile", "Mobile phone"),
    ("contact.phone.home", "Home phone"),
    ("contact.phone.country", "Phone country code"),
    ("address.full", "Address"),
    ("address.postal", "Postal code"),
    ("address.prefecture", "Prefecture or state"),
    ("address.city", "City"),
    ("address.street", "Street"),
    ("address.building", "Building"),
    ("address.country", "Country"),
    ("id.passport.number", "Passport number"),
    ("id.passport.issued", "Passport issued"),
    ("id.passport.country", "Passport issuing country"),
    ("id.passport.expiry", "Passport expiry"),
    ("id.national.number", "National ID number"),
    ("id.card.number", "Document number"),
    ("id.card.issued", "Document issued"),
    ("id.card.expiry", "Document expiry"),
    ("id.card.extra_number", "Card access number"),
    ("id.issuing_authority", "Issuing authority"),
    ("id.driver_license.number", "Driver's licence number"),
    ("id.driver_license.class", "Licence class"),
    ("id.driver_license.restrictions", "Licence restrictions"),
    ("id.residence_card.number", "Residence card number"),
    ("id.residence_card.issued", "Residence card issued"),
    ("id.ssn", "Social security number"),
    ("id.ssn.last4", "Social security number (last 4)"),
    ("id.mynumber", "My Number"),
    ("id.pension.number", "Pension number"),
    ("id.employment_insurance.number", "Employment insurance number"),
    ("id.health_insurance.number", "Health insurance number"),
    ("id.tax.de_steuer_id", "Tax ID (Steuer-ID)"),
    ("id.tax.number", "Tax number"),
    ("id.employer.ein", "Employer tax number"),
    ("visa.status", "Status of residence"),
    ("visa.period", "Period of stay"),
    ("visa.expiry", "Stay expires"),
    ("bank.name", "Bank"),
    ("bank.code", "Bank code"),
    ("bank.branch.name", "Branch"),
    ("bank.branch.name.kana", "Branch (kana)"),
    ("bank.branch.code", "Branch code"),
    ("bank.account.type", "Account type"),
    ("bank.account.number", "Account number"),
    ("bank.account.holder.kanji", "Account holder"),
    ("bank.account.holder.kana", "Account holder (kana)"),
    ("bank.account.holder.zengin", "Account holder (bank format)"),
    ("bank.iban", "IBAN"),
    ("bank.bic", "BIC / SWIFT"),
    ("bank.jp_post.symbol", "Japan Post symbol"),
    ("bank.jp_post.number", "Japan Post account number"),
    ("work.employer.name", "Employer"),
    ("work.employer.name.kana", "Employer (kana)"),
    ("work.employer.address", "Employer address"),
    ("work.employer.postal", "Employer postal code"),
    ("work.employer.phone", "Employer phone"),
    ("work.employer.representative", "Employer representative"),
    ("work.title", "Job title"),
    ("work.department", "Department"),
    ("work.employee_id", "Employee number"),
    ("work.employment_type", "Employment type"),
    ("work.start.date", "Start date"),
    ("work.hours", "Working hours"),
    ("work.job_description", "Job duties"),
    ("income.annual", "Annual income"),
    ("income.bonus", "Bonus"),
    ("income.monthly.base", "Monthly base pay"),
    ("income.monthly.overtime", "Overtime pay"),
    ("income.monthly.commute", "Commuting allowance"),
    ("income.monthly.housing", "Housing allowance"),
    ("income.monthly.gross", "Monthly pay before deductions"),
    ("income.monthly.net", "Monthly pay after deductions"),
    ("income.insurance.health", "Health insurance contribution"),
    ("income.insurance.pension", "Pension contribution"),
    ("income.insurance.employment", "Employment insurance contribution"),
    ("income.insurance.total", "Total insurance deductions"),
    ("income.tax.income", "Income tax withheld"),
    ("income.tax.resident", "Resident tax"),
    ("income.pay_date", "Pay date"),
    ("income.pay_period", "Pay period"),
    ("emergency.name", "Emergency contact"),
    ("emergency.name.kana", "Emergency contact (kana)"),
    ("emergency.relation", "Emergency contact relationship"),
    ("emergency.phone", "Emergency contact phone"),
    ("emergency.address", "Emergency contact address"),
    ("spouse.name", "Spouse"),
    ("family.father.name", "Father's name"),
    ("family.mother.name", "Mother's name"),
    ("education.school.name", "School"),
    ("education.degree", "Degree"),
    ("education.graduation.date", "Graduation"),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn details(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn captured_details_land_in_custom_fields_and_the_identity_fields_that_fit() {
        let captured = details(&[
            ("name.given.latin", "THI LINH"),
            ("name.family.latin", "NGUYEN"),
            ("name.given", "氏玲"),
            ("id.passport.number", "C9481023"),
            ("birth.date", "1998-03-14"),
            ("bank.code", "0001"),
        ]);
        let profile = update_profile(&ProfileFields::default(), &captured);
        assert_eq!(profile.identity.first_name, "THI LINH");
        assert_eq!(profile.identity.last_name, "NGUYEN");
        assert_eq!(profile.identity.passport_number, "C9481023");
        assert_eq!(profile.custom["name.given"], "氏玲");
        assert_eq!(profile.custom["bank.code"], "0001");
        assert_eq!(profile.custom["birth.date"], "1998-03-14");
    }

    #[test]
    fn a_profile_reads_back_as_the_details_it_was_given_plus_what_follows_from_them() {
        let captured = details(&[("birth.date", "1998-03-14"), ("name.full.kana", "グエン ティ リン")]);
        let profile = update_profile(&ProfileFields::default(), &captured);
        let read = profile_details(&profile);
        assert_eq!(read["birth.date"], "1998-03-14");
        assert_eq!(read["birth.date.wareki"], "平成10年3月14日");
        assert_eq!(read["name.full.hiragana"], "ぐえん てぃ りん");
    }

    #[test]
    fn a_newer_document_replaces_the_value_and_leaves_the_rest() {
        let first = update_profile(
            &ProfileFields::default(),
            &details(&[("address.postal", "160-0023"), ("contact.email", "a@example.com")]),
        );
        let second = update_profile(&first, &details(&[("address.postal", "169-0075")]));
        let read = profile_details(&second);
        assert_eq!(read["address.postal"], "169-0075");
        assert_eq!(read["contact.email"], "a@example.com");
        assert_eq!(second.identity.postal_code, "169-0075");
    }

    #[test]
    fn an_identity_item_typed_by_hand_gives_its_details_too() {
        let profile = ProfileFields {
            identity: IdentityFields {
                first_name: "Linh".into(),
                passport_number: "B1234567".into(),
                ..IdentityFields::default()
            },
            custom: BTreeMap::from([("id.drivers_license.number".to_string(), "D9999".to_string())]),
        };
        let read = profile_details(&profile);
        assert_eq!(read["name.given"], "Linh");
        assert_eq!(read["id.passport.number"], "B1234567");
        assert_eq!(read["id.driver_license.number"], "D9999");
    }

    #[test]
    fn a_label_is_words() {
        assert_eq!(detail_label("id.residence_card.number"), "Residence card number");
        assert_eq!(detail_label("id.national.number"), "National ID number");
        assert_eq!(detail_label("id.passport.issued"), "Passport issued");
        assert_eq!(detail_label("bank.something.new"), "Bank something new");
    }

    #[test]
    fn every_vocab_detail_has_a_human_label() {
        for detail in crate::vocab::DETAILS {
            assert!(
                LABELS.iter().any(|(k, _)| *k == detail.key),
                "missing human label in LABELS for vocab key: {}",
                detail.key
            );
        }
    }
}
