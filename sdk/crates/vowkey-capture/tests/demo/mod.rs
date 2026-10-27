//! The Demo documents and forms the filling tests and the Decision example share: what the four
//! documents say, and the fields of the three Japanese forms with what each is filled with.
#![allow(dead_code)]

use std::collections::BTreeMap;

use vowkey_capture::{document::derive_companion_details, matcher::FormFieldInput};

/// What the four Demo documents say, as the vault keeps it: canonical keys and normalized values.
pub const DEMO_DETAILS: &[(&str, &str)] = &[
    ("id.residence_card.number", "AB12345678CD"),
    ("id.residence_card.issued", "2025-04-01"),
    ("name.full.latin", "NGUYEN THI LINH"),
    ("name.family.latin", "NGUYEN"),
    ("name.given.latin", "THI LINH"),
    ("name.full", "阮 氏玲"),
    ("name.family", "阮"),
    ("name.given", "氏玲"),
    ("name.full.kana", "グエン ティ リン"),
    ("name.family.kana", "グエン"),
    ("name.given.kana", "ティ リン"),
    ("birth.date", "1998-03-14"),
    ("person.nationality", "ベトナム"),
    ("person.sex", "女性"),
    ("address.postal", "169-0075"),
    ("address.full", "東京都新宿区高田馬場4-18-9 メゾン高田馬場302"),
    ("address.prefecture", "東京都"),
    ("address.city", "新宿区"),
    ("address.street", "高田馬場4-18-9"),
    ("address.building", "メゾン高田馬場302"),
    ("visa.status", "技術・人文知識・国際業務"),
    ("visa.period", "5年"),
    ("visa.expiry", "2030-04-01"),
    ("bank.name", "みずほ銀行"),
    ("bank.code", "0001"),
    ("bank.branch.name", "新宿支店"),
    ("bank.branch.name.kana", "シンジュク"),
    ("bank.branch.code", "210"),
    ("bank.account.type", "普通"),
    ("bank.account.number", "4821903"),
    ("bank.account.holder.kana", "グエン ティ リン"),
    ("bank.account.holder.kanji", "阮 氏玲"),
    ("bank.jp_post.symbol", "10180"),
    ("bank.jp_post.number", "48219031"),
    ("work.employer.name", "ツバメクラウド株式会社"),
    ("work.employer.name.kana", "ツバメクラウド"),
    ("work.employer.address", "東京都渋谷区神宮前5-52-2 青山オーバルビル14F"),
    ("work.employer.phone", "03-6418-5500"),
    ("work.employer.representative", "佐藤 健一"),
    ("work.title", "シニアソフトウェアエンジニア"),
    ("work.department", "プロダクト開発本部"),
    ("work.employee_id", "TC-0418"),
    ("work.employment_type", "正社員"),
    ("work.start.date", "2025-04-01"),
    ("income.annual", "6240000"),
    ("contact.phone.mobile", "080-3921-6640"),
    ("contact.email", "linh.nguyen@tsubame.jp"),
    ("education.school.name", "早稲田大学"),
    ("education.graduation.date", "2022-03"),
    ("emergency.name", "グエン ヴァン ミン"),
    ("emergency.name.kana", "グエン ヴァン ミン"),
    ("emergency.relation", "兄"),
    ("emergency.phone", "080-9182-3301"),
    ("emergency.address", "東京都中野区東中野3-8-12"),
    ("id.pension.number", "1948-204918"),
    ("id.employment_insurance.number", "4829-610384-2"),
    ("id.health_insurance.number", "2410-8831"),
    ("id.passport.number", "C9481023"),
    ("id.mynumber", "491820394814"),
    ("income.pay_period", "2026-09"),
    ("income.pay_date", "2026-09-25"),
    ("income.monthly.base", "420000"),
    ("income.monthly.overtime", "45000"),
    ("income.monthly.commute", "12400"),
    ("income.monthly.housing", "30000"),
    ("income.monthly.gross", "507400"),
    ("income.insurance.health", "24528"),
    ("income.insurance.pension", "44775"),
    ("income.insurance.employment", "2790"),
    ("income.insurance.total", "72093"),
    ("income.tax.income", "14820"),
    ("income.tax.resident", "21600"),
    ("income.monthly.net", "398887"),
];

pub fn demo_details() -> BTreeMap<String, String> {
    let mut details: BTreeMap<String, String> =
        DEMO_DETAILS.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect();
    derive_companion_details(&mut details);
    details
}

pub fn field(id: &str, name: &str, label: &str, section: &str, format: &str) -> FormFieldInput {
    FormFieldInput {
        id: id.to_string(),
        name: name.to_string(),
        label: label.to_string(),
        section: section.to_string(),
        format: format.to_string(),
        input_type: "text".to_string(),
        ..Default::default()
    }
}

/// The fields of the mizuho form.
pub fn mizuho_fields() -> Vec<FormFieldInput> {
    vec![
        field("applicant_name_kanji", "name_kanji", "お名前（漢字）", "本人情報", ""),
        field("applicant_name_kana", "name_kana", "フリガナ（全角カタカナ）", "本人情報", ""),
        field(
            "birth_date_wareki",
            "birth_wareki",
            "生年月日（和暦）",
            "本人情報",
            "和暦（昭和・平成・令和）でご記入ください",
        ),
        field("postal_code", "postal_code", "郵便番号", "本人情報", ""),
        field("address_full", "address_full", "現住所", "本人情報", ""),
        field("mobile_phone", "mobile_phone", "携帯電話番号", "本人情報", ""),
        field("bank_name", "bank_name", "金融機関名", "振込指定口座", ""),
        field("bank_code", "bank_code", "金融機関コード（4桁）", "振込指定口座", ""),
        field("branch_name", "branch_name", "支店名", "振込指定口座", ""),
        field("branch_code", "branch_code", "支店コード（3桁）", "振込指定口座", ""),
        field("account_type", "account_type", "預金種目", "振込指定口座", ""),
        field("account_number", "account_number", "口座番号（7桁）", "振込指定口座", ""),
        field(
            "account_holder_zengin",
            "account_holder_half_kana",
            "口座名義人（半角カタカナ）",
            "振込指定口座",
            "全銀システム規定により半角カタカナ（小文字は大文字変換）で入力",
        ),
        field("employer_name", "employer_name", "勤務先名称", "勤務先情報", ""),
        field("employee_id", "employee_id", "社員番号", "勤務先情報", ""),
        field("employer_phone", "employer_phone", "勤務先電話番号", "勤務先情報", ""),
    ]
}

/// What the mizuho form is filled with from the demo profile.
pub fn mizuho_expected() -> Vec<Option<&'static str>> {
    vec![
        Some("阮 氏玲"),
        Some("グエン ティ リン"),
        Some("平成10年3月14日"),
        Some("169-0075"),
        Some("東京都新宿区高田馬場4-18-9 メゾン高田馬場302"),
        Some("080-3921-6640"),
        Some("みずほ銀行"),
        Some("0001"),
        Some("新宿支店"),
        Some("210"),
        Some("普通"),
        Some("4821903"),
        Some("ｸﾞｴﾝ ﾃｲ ﾘﾝ"),
        Some("ツバメクラウド株式会社"),
        Some("TC-0418"),
        Some("03-6418-5500"),
    ]
}

/// The fields of the shinjuku form.
pub fn shinjuku_fields() -> Vec<FormFieldInput> {
    vec![
        field("romaji_name", "name_romaji", "氏名（ローマ字 / Name in Romaji）", "届出人（本人）", ""),
        field("kanji_name", "name_kanji", "氏名（漢字併記）", "届出人（本人）", ""),
        field("kana_name", "name_kana", "フリガナ（カタカナ）", "届出人（本人）", ""),
        field("nationality", "nationality", "国籍・地域", "届出人（本人）", ""),
        field("dob_iso", "birth_date", "生年月日（西暦）", "届出人（本人）", ""),
        field("gender", "gender", "性別", "届出人（本人）", ""),
        field("current_address", "address_full", "住居地（現住所）", "届出人（本人）", ""),
        field("visa_status", "visa_status", "在留資格", "在留カード情報", ""),
        field("visa_period", "visa_period", "在留期間", "在留カード情報", ""),
        field("visa_expiry", "visa_expiry", "在留期間満了日", "在留カード情報", ""),
        field("residence_card_no", "residence_card_number", "在留カード番号（12桁）", "在留カード情報", ""),
        field(
            "my_number_input",
            "my_number",
            "個人番号（マイナンバー 12桁）※自動入力禁止項目",
            "在留カード情報",
            "",
        ),
        field("emerg_name", "emergency_name", "緊急連絡先 氏名", "緊急連絡先", ""),
        field("emerg_relation", "emergency_relation", "続柄・関係", "緊急連絡先", ""),
        field("emerg_phone", "emergency_phone", "緊急連絡先 電話番号", "緊急連絡先", ""),
    ]
}

/// What the shinjuku form is filled with from the demo profile.
pub fn shinjuku_expected() -> Vec<Option<&'static str>> {
    vec![
        Some("NGUYEN THI LINH"),
        Some("阮 氏玲"),
        Some("グエン ティ リン"),
        Some("ベトナム"),
        Some("1998-03-14"),
        Some("女性"),
        Some("東京都新宿区高田馬場4-18-9 メゾン高田馬場302"),
        Some("技術・人文知識・国際業務"),
        Some("5年"),
        Some("2030-04-01"),
        Some("AB12345678CD"),
        Some("491820394814"),
        Some("グエン ヴァン ミン"),
        Some("兄"),
        Some("080-9182-3301"),
    ]
}

/// The fields of the tsubame form.
pub fn tsubame_fields() -> Vec<FormFieldInput> {
    vec![
        field("emp_name", "name_full", "氏名（漢字）", "社員基本情報", ""),
        field("emp_email", "email", "メールアドレス", "社員基本情報", ""),
        field("emp_dept", "department", "所属部署", "社員基本情報", ""),
        field("emp_title", "job_title", "役職・職種", "社員基本情報", ""),
        field("emp_gross_pay", "monthly_gross", "直近支給総額（月額）", "社員基本情報", ""),
        field("emp_net_pay", "monthly_net", "差引支給額（手取り）", "社員基本情報", ""),
        field(
            "motivation_note",
            "motivation_essay",
            "志望動機・自由記入欄（自動入力対象外）",
            "社員基本情報",
            "",
        ),
    ]
}

/// What the tsubame form is filled with from the demo profile.
pub fn tsubame_expected() -> Vec<Option<&'static str>> {
    vec![
        Some("阮 氏玲"),
        Some("linh.nguyen@tsubame.jp"),
        Some("プロダクト開発本部"),
        Some("シニアソフトウェアエンジニア"),
        Some("507400"),
        Some("398887"),
        None,
    ]
}

