//! The details a vault keeps, in the words Clef is asked about them. Each detail says what it is
//! and how documents in the languages Vowkey is used in name it, because a description that only
//! repeats the key tells a decision model nothing.

/// A family of details, the first thing Clef is asked about a piece of text.
pub struct Group {
    /// The group's name.
    pub id: &'static str,
    /// What belongs in it.
    pub about: &'static str,
}

/// One detail a vault keeps.
pub struct Detail {
    /// The group it belongs to.
    pub group: &'static str,
    /// The canonical key.
    pub key: &'static str,
    /// What it is, and how documents name it.
    pub about: &'static str,
}

/// Groups of details. `label` is for text that holds no detail of the person.
pub const GROUPS: &[Group] = &[
    Group { id: "name", about: "The person's own name, whole or in parts, in any script: 氏名, họ và tên, Name, Nachname, Vorname, nom, prénom, フリガナ." },
    Group { id: "person", about: "Birth date, age, sex, nationality or birthplace of the person: 生年月日, ngày sinh, giới tính, Geburtsdatum, Staatsangehörigkeit, nationalité." },
    Group { id: "id", about: "Numbers and dates of identity documents: passport, ID card, residence card, driving licence, tax id, social security, pension, insurance, My Number, visa status; their issue and expiry dates." },
    Group { id: "address", about: "A home address, whole or in parts, or its postal code: 住所, nơi cư trú, địa chỉ, Anschrift, adresse, 郵便番号." },
    Group { id: "contact", about: "A phone number or an email address of the person." },
    Group { id: "work", about: "Employment: the employer and its address, phone or representative, job title, department, employee id, contract type, start date, working hours." },
    Group { id: "income", about: "Money paid: salary, allowances, bonus, totals, insurance and tax deductions, net pay, pay date or pay period: 給与, lương, Gehalt, 源泉徴収, thu nhập." },
    Group { id: "bank", about: "Bank details: bank, branch, codes, account number and type, account holder, IBAN, BIC, 口座, tài khoản." },
    Group { id: "education", about: "School, degree and graduation date." },
    Group { id: "emergency", about: "An emergency contact or a family member's name, relation, phone or address; a spouse." },
    Group { id: "other", about: "A value about the person that none of the other groups hold." },
    Group { id: "label", about: "Only printed words that name something and give no value: a field label such as Họ và tên, 住所 or Date of birth; the name of a pay item or a column; a heading, instruction, legal text, logo, stamp, page number or empty placeholder." },
];

/// The details a vault keeps.
pub const DETAILS: &[Detail] = &[
    Detail { group: "name", key: "name.full", about: "The whole name of the person as printed, in the document's own script. 氏名, họ và tên, 성명, 姓名, ชื่อ-นามสกุล, Name, vollständiger Name, nom complet." },
    Detail { group: "name", key: "name.family", about: "The family name alone. 姓, họ, Familienname, Nachname, Surname, nom de famille, apellido." },
    Detail { group: "name", key: "name.given", about: "The given or first names alone. 名, tên, Vorname(n), Given names, prénom(s), nombre. Not the family name." },
    Detail { group: "name", key: "name.middle", about: "A middle name alone, such as the Vietnamese tên đệm." },
    Detail { group: "name", key: "name.birth", about: "The name the person was born with, apart from the current name: Geburtsname, nom de naissance, maiden name, 旧姓." },
    Detail { group: "name", key: "name.full.latin", about: "The whole name written in Latin letters beside a name in another script: ローマ字, Hepburn, name in capitals." },
    Detail { group: "name", key: "name.family.latin", about: "The family name alone in Latin letters when the document's main script is not Latin." },
    Detail { group: "name", key: "name.given.latin", about: "The given names alone in Latin letters when the document's main script is not Latin." },
    Detail { group: "name", key: "name.full.kana", about: "The whole name in katakana characters: フリガナ, カナ." },
    Detail { group: "name", key: "name.family.kana", about: "The family name alone in katakana." },
    Detail { group: "name", key: "name.given.kana", about: "The given name alone in katakana." },
    Detail { group: "name", key: "name.full.hiragana", about: "The whole name in hiragana characters: ふりがな." },
    Detail { group: "name", key: "name.family.hiragana", about: "The family name alone in hiragana." },
    Detail { group: "name", key: "name.given.hiragana", about: "The given name alone in hiragana." },
    Detail { group: "person", key: "birth.date", about: "Date of birth. 生年月日, ngày sinh, 생년월일, 出生日期, วันเกิด, Geburtsdatum, Geburtstag, date de naissance, fecha de nacimiento, data di nascita." },
    Detail { group: "person", key: "birth.age", about: "Age in years: 満31歳, tuổi, Alter, âge." },
    Detail { group: "person", key: "birth.place", about: "Place of birth: 出生地, nơi sinh, Geburtsort, lieu de naissance." },
    Detail { group: "person", key: "person.sex", about: "Sex or gender of the person: 性別, giới tính, 성별, 性别, เพศ, Geschlecht, sexe, sexo, M/F, 男, 女, Nam, Nữ." },
    Detail { group: "person", key: "person.nationality", about: "Nationality or country of citizenship: 国籍, quốc tịch, 국적, 国籍, สัญชาติ, Staatsangehörigkeit, nationalité, nacionalidad, DEUTSCH, French." },
    Detail { group: "person", key: "person.marital_status", about: "Marital status: 婚姻状況, tình trạng hôn nhân, Familienstand, état civil, 婚姻." },
    Detail { group: "person", key: "person.profession", about: "Occupation or profession of the person: 職業, nghề nghiệp, Beruf, profession, 职业." },
    Detail { group: "person", key: "person.religion", about: "Religion: 宗教, tôn giáo, Religion, Religionsgesellschaft, 宗教." },
    Detail { group: "person", key: "person.ethnicity", about: "Ethnicity or nation within the country: dân tộc, 民族, race." },
    Detail { group: "person", key: "person.blood_type", about: "Blood type: 血液型, nhóm máu, Blutgruppe, groupe sanguin." },
    Detail { group: "id", key: "id.passport.number", about: "Passport number: 旅券番号, số hộ chiếu, Passnummer, numéro de passeport." },
    Detail { group: "id", key: "id.passport.expiry", about: "Passport expiry date." },
    Detail { group: "id", key: "id.national.number", about: "The person's national identity number that stays the same for life: citizen ID (căn cước, CCCD), PESEL, CNP, OIB, Personalausweis personal number, kennitala, codice fiscale, 公民身份号码." },
    Detail { group: "id", key: "id.card.number", about: "The serial number of an identity card as an object: card number, document number, Seriennummer, numéro du document. Not the lifelong national number." },
    Detail { group: "id", key: "id.card.issued", about: "Issue date of an identity card or other identity document. 交付年月日, Ausstellungsdatum, date de délivrance, ngày cấp." },
    Detail { group: "id", key: "id.card.expiry", about: "Expiry date of an identity card or driving licence: gültig bis, date d'expiration, có giá trị đến, 有効期限." },
    Detail { group: "id", key: "id.card.extra_number", about: "A second number printed on a card besides its serial number: access number, CAN, Zugangsnummer, optional data number." },
    Detail { group: "id", key: "id.issuing_authority", about: "The authority that issued the document: 発行機関, cơ quan cấp, ausstellende Behörde, autorité, 签发机关, authority." },
    Detail { group: "id", key: "id.driver_license.class", about: "Licence classes or vehicle categories a driving licence allows: 免許の種類, hạng, Klasse, catégories, category A B C." },
    Detail { group: "id", key: "id.driver_license.restrictions", about: "Restrictions, conditions or endorsements on a driving licence: 条件等, hạn chế, Beschränkungen." },
    Detail { group: "id", key: "id.residence_card.number", about: "Residence card number: 在留カード番号 (two letters, eight digits, two letters)." },
    Detail { group: "id", key: "id.residence_card.issued", about: "Residence card issue date: 交付年月日." },
    Detail { group: "id", key: "visa.status", about: "Status of residence or visa type: 在留資格, visa category." },
    Detail { group: "id", key: "visa.period", about: "Period of stay allowed: 在留期間." },
    Detail { group: "id", key: "visa.expiry", about: "Date the period of stay ends: 在留期間の満了日." },
    Detail { group: "id", key: "id.mynumber", about: "My Number, the 12-digit Japanese individual number: 個人番号." },
    Detail { group: "id", key: "id.driver_license.number", about: "Driving licence number: 免許証番号, Führerscheinnummer, số giấy phép lái xe, permis de conduire n°." },
    Detail { group: "id", key: "id.ssn.last4", about: "Last four digits of a social security number." },
    Detail { group: "id", key: "id.pension.number", about: "Pension or social insurance number: 基礎年金番号, Sozialversicherungsnummer, SV-Nummer, số bảo hiểm xã hội." },
    Detail { group: "id", key: "id.employment_insurance.number", about: "Employment insurance number: 雇用保険被保険者番号." },
    Detail { group: "id", key: "id.health_insurance.number", about: "Health insurance number: 健康保険番号, số thẻ bảo hiểm y tế, Krankenversicherungsnummer." },
    Detail { group: "id", key: "id.tax.de_steuer_id", about: "German tax identification number: Steuer-ID, Steueridentifikationsnummer." },
    Detail { group: "id", key: "id.tax.number", about: "A personal tax number of any country: mã số thuế, TIN, Steuernummer. Not My Number." },
    Detail { group: "id", key: "id.employer.ein", about: "An employer's tax number: EIN, 法人番号, mã số thuế công ty." },
    Detail { group: "address", key: "address.full", about: "The whole home address in one value, possibly over several lines: 住所, 住居地, nơi cư trú, nơi thường trú, địa chỉ, 주소, 住址, ที่อยู่, Anschrift, Wohnort, adresse, domicilio. Not an employer's address." },
    Detail { group: "address", key: "address.postal", about: "Postal code alone: 郵便番号, mã bưu chính, PLZ, code postal, ZIP." },
    Detail { group: "address", key: "address.prefecture", about: "Prefecture, state, province or the top-level region of an address: 都道府県, tỉnh, thành phố trực thuộc, Bundesland, State." },
    Detail { group: "address", key: "address.city", about: "City, ward or municipality alone: 市区町村, quận, phường, Stadt, ville, City." },
    Detail { group: "address", key: "address.street", about: "Street and number alone: 町名・番地, đường, Straße, rue, Street." },
    Detail { group: "address", key: "address.building", about: "Building name, floor or room: 建物名, tòa nhà, Apartment, Gebäude." },
    Detail { group: "address", key: "address.country", about: "Country of an address." },
    Detail { group: "contact", key: "contact.phone.mobile", about: "Mobile phone number: 携帯電話, di động, Mobil, cell." },
    Detail { group: "contact", key: "contact.phone.home", about: "Home or landline phone number: 自宅電話, điện thoại nhà." },
    Detail { group: "contact", key: "contact.phone", about: "A phone number of the person that the document does not say is mobile or home." },
    Detail { group: "contact", key: "contact.email", about: "Email address of the person: メールアドレス, E-Mail." },
    Detail { group: "work", key: "work.employer.name", about: "Name of the employer or company that pays the person: 使用者名称, 会社名, công ty, đơn vị, Arbeitgeber, employeur." },
    Detail { group: "work", key: "work.employer.name.kana", about: "The employer's name in katakana." },
    Detail { group: "work", key: "work.employer.address", about: "Address of the employer or workplace: 事業場所在地, 勤務地, địa chỉ công ty." },
    Detail { group: "work", key: "work.employer.postal", about: "Postal code of the employer." },
    Detail { group: "work", key: "work.employer.phone", about: "Phone number of the employer: 事業場電話番号, ĐT công ty." },
    Detail { group: "work", key: "work.employer.representative", about: "Representative of the employer: 代表者氏名, đại diện, Geschäftsführer." },
    Detail { group: "work", key: "work.title", about: "Job title or position: 職種, 役職, chức vụ, Position, Stellenbezeichnung." },
    Detail { group: "work", key: "work.department", about: "Department of the employer: 所属部署, phòng ban, Abteilung." },
    Detail { group: "work", key: "work.employee_id", about: "Employee number: 社員番号, mã nhân viên, Personalnummer, Employee ID." },
    Detail { group: "work", key: "work.employment_type", about: "Kind of employment contract: 雇用形態, loại hợp đồng, permanent, fixed term, Vollzeit." },
    Detail { group: "work", key: "work.start.date", about: "Date employment starts: 入社年月日, ngày vào làm, Eintrittsdatum, start date." },
    Detail { group: "work", key: "work.hours", about: "Working hours per day or week: 所定労働時間, giờ làm việc." },
    Detail { group: "work", key: "work.job_description", about: "Description of the duties of the job: 業務内容." },
    Detail { group: "income", key: "income.annual", about: "Yearly income or salary before tax: 年収, 年間収入, thu nhập năm, Jahresgehalt, annual salary. Not a monthly amount, a bonus alone or a severance payment." },
    Detail { group: "income", key: "income.bonus", about: "Bonus or special payment: 賞与, ボーナス, thưởng, Bonus." },
    Detail { group: "income", key: "income.monthly.base", about: "Monthly base pay: 基本給, lương cơ bản, Grundgehalt, base salary." },
    Detail { group: "income", key: "income.monthly.overtime", about: "Overtime pay: 時間外手当, phụ cấp làm thêm giờ, Überstunden, overtime." },
    Detail { group: "income", key: "income.monthly.commute", about: "Commuting allowance: 通勤手当, phụ cấp đi lại, Fahrtkosten, commute." },
    Detail { group: "income", key: "income.monthly.housing", about: "Housing allowance: 住宅手当, phụ cấp nhà ở, housing." },
    Detail { group: "income", key: "income.monthly.gross", about: "Total pay for the month before deductions: 総支給額, tổng thu nhập, Bruttolohn, gross pay." },
    Detail { group: "income", key: "income.monthly.net", about: "Pay received after deductions: 差引支給額, thực lĩnh, Nettolohn, net pay, take-home." },
    Detail { group: "income", key: "income.insurance.health", about: "Health insurance contribution deducted: 健康保険料, BHYT, Krankenversicherung." },
    Detail { group: "income", key: "income.insurance.pension", about: "Pension or social insurance contribution deducted: 厚生年金保険料, BHXH, Rentenversicherung." },
    Detail { group: "income", key: "income.insurance.employment", about: "Employment or unemployment insurance deducted: 雇用保険料, BHTN, Arbeitslosenversicherung." },
    Detail { group: "income", key: "income.insurance.total", about: "Total of the insurance deductions: 社会保険料合計, tổng bảo hiểm bắt buộc." },
    Detail { group: "income", key: "income.tax.income", about: "Income tax deducted or withheld: 源泉所得税, thuế TNCN, Lohnsteuer, federal income tax." },
    Detail { group: "income", key: "income.tax.resident", about: "Resident or local tax deducted: 住民税." },
    Detail { group: "income", key: "income.pay_date", about: "Date the pay is paid: 支給日, ngày chi trả, Auszahlungstag." },
    Detail { group: "income", key: "income.pay_period", about: "Month or period the pay is for: 対象年月, kỳ lương, Abrechnungszeitraum." },
    Detail { group: "bank", key: "bank.name", about: "Name of the bank: 金融機関名, ngân hàng, Bank, banque." },
    Detail { group: "bank", key: "bank.code", about: "Bank code: 金融機関コード, BLZ, routing number, ABA, mã ngân hàng." },
    Detail { group: "bank", key: "bank.branch.name", about: "Name of the branch: 支店名, chi nhánh, Filiale." },
    Detail { group: "bank", key: "bank.branch.name.kana", about: "Name of the branch in katakana." },
    Detail { group: "bank", key: "bank.branch.code", about: "Branch code: 店番, 支店コード, mã chi nhánh." },
    Detail { group: "bank", key: "bank.account.type", about: "Kind of account: 預金種目, 普通, loại tài khoản, checking, savings." },
    Detail { group: "bank", key: "bank.account.number", about: "Account number: 口座番号, số tài khoản, Kontonummer." },
    Detail { group: "bank", key: "bank.account.holder.kanji", about: "Account holder's name in kanji or the document's script: 口座名義." },
    Detail { group: "bank", key: "bank.account.holder.kana", about: "Account holder's name in katakana: 口座名義（カナ）." },
    Detail { group: "bank", key: "bank.iban", about: "IBAN: two letters, two check digits, then the account." },
    Detail { group: "bank", key: "bank.bic", about: "BIC or SWIFT code of a bank." },
    Detail { group: "bank", key: "bank.jp_post.symbol", about: "Japan Post Bank symbol: ゆうちょ記号." },
    Detail { group: "bank", key: "bank.jp_post.number", about: "Japan Post Bank number: ゆうちょ番号." },
    Detail { group: "education", key: "education.school.name", about: "Name of a school or university: 学校名, trường, Hochschule." },
    Detail { group: "education", key: "education.degree", about: "Degree or qualification: 学位, bằng cấp, Abschluss." },
    Detail { group: "education", key: "education.graduation.date", about: "Graduation date: 卒業年月, tốt nghiệp." },
    Detail { group: "emergency", key: "emergency.name", about: "Name of an emergency contact: 緊急連絡先氏名." },
    Detail { group: "emergency", key: "emergency.name.kana", about: "Emergency contact's name in katakana." },
    Detail { group: "emergency", key: "emergency.relation", about: "Relation of the emergency contact to the person: 続柄, quan hệ." },
    Detail { group: "emergency", key: "emergency.phone", about: "Phone number of the emergency contact." },
    Detail { group: "emergency", key: "emergency.address", about: "Address of the emergency contact." },
    Detail { group: "emergency", key: "spouse.name", about: "Name of the person's spouse: 配偶者, vợ/chồng, Ehepartner." },
    Detail { group: "emergency", key: "family.father.name", about: "Name of the person's father: 父, họ tên cha, Vater, père." },
    Detail { group: "emergency", key: "family.mother.name", about: "Name of the person's mother: 母, họ tên mẹ, Mutter, mère." },
];

/// What kind of document it is, a hint that helps with what each piece of text means.
pub const KINDS: &[(&str, &str)] = &[
    ("passport", "A passport data page."),
    ("id_card", "A national identity card or citizen card."),
    ("residence_card", "A residence card or permit for a foreigner."),
    ("driver_licence", "A driving licence."),
    ("payslip", "A payslip, pay statement or salary notice."),
    ("tax_slip", "A tax withholding slip, tax return or tax certificate."),
    ("bank_document", "A bank statement, passbook or account confirmation."),
    ("employment_contract", "An employment contract or terms of employment."),
    ("resume", "A résumé, CV or personal history form."),
    ("form", "A blank or filled application form."),
    ("other", "Any other document."),
];

/// The details of one group.
pub fn details_of(group: &str) -> impl Iterator<Item = &'static Detail> + '_ {
    DETAILS.iter().filter(move |d| d.group == group)
}

/// Whether a key is one the vault has a description of.
pub fn knows(key: &str) -> bool {
    DETAILS.iter().any(|d| d.key == key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn every_detail_belongs_to_a_group_and_no_key_repeats() {
        let groups: HashSet<_> = GROUPS.iter().map(|g| g.id).collect();
        let mut keys = HashSet::new();
        for detail in DETAILS {
            assert!(groups.contains(detail.group), "{}", detail.key);
            assert!(keys.insert(detail.key), "{} repeats", detail.key);
        }
    }

    #[test]
    fn a_group_fits_one_question() {
        for group in GROUPS {
            assert!(details_of(group.id).count() <= 40, "{}", group.id);
        }
    }
}
