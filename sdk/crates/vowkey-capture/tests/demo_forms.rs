//! End-to-end capture and form-matching tests on the four Demo documents (`residence_card.pdf`,
//! `bank_passbook.pdf`, `employment_contract.pdf`, `payslip_2026_09.pdf`) and the three Demo
//! Japanese forms (`mizuho-bank.html`, `shinjuku-ward.html`, `tsubame-onboarding.html`).

#![allow(clippy::unwrap_used)]

use std::collections::BTreeMap;

use vowkey_capture::{
    document::extract_document_details,
    matcher::{FormFieldInput, fill_form_fields},
};

const DEMO_DOCUMENTS_TEXT: &str = "\
日本国政府 在留カード / RESIDENCE CARD
出入国在留管理庁交付（2026年様式対応）
交付年月日: 2025年04月01日 在留カード番号: AB12345678CD
氏名（ローマ字）: NGUYEN THI LINH 姓（ローマ字）: NGUYEN
名（ローマ字）: THI LINH 氏名（漢字）: 阮 氏玲
姓（漢字）: 阮 名（漢字）: 氏玲
氏名（フリガナ）: グエン ティ リン 姓（フリガナ）: グエン
名（フリガナ）: ティ リン 生年月日: 1998年03月14日
国籍・地域: ベトナム 性別: 女性
郵便番号: 169-0075 住居地: 東京都新宿区高田馬場4-18-9 メゾン高田馬場302
都道府県: 東京都 市区町村: 新宿区
町名・番地: 高田馬場4-18-9 建物名・部屋番号: メゾン高田馬場302
在留資格: 技術・人文知識・国際業務 在留期間: 5年
在留期間の満了日: 2030年04月01日 就労制限の有無: 就労制限なし
みずほ銀行 普通預金口座・振込先確認票
発行日: 2025年04月10日 金融機関名: みずほ銀行
金融機関コード: 0001 支店名: 新宿支店
支店名（カナ）: シンジュク 店番: 210
預金種目: 普通 口座番号: 4821903
口座名義（カナ）: グエン ティ リン 口座名義（漢字）: 阮 氏玲
ゆうちょ記号: 10180 ゆうちょ番号: 48219031
労働条件通知書 兼 雇用契約書
契約日: 2025年04月01日 入社年月日: 2025年04月01日
使用者名称: ツバメクラウド株式会社 会社名（フリガナ）: ツバメクラウド
事業場所在地: 東京都渋谷区神宮前5-52-2 青山オーバルビル14F 事業場電話番号: 03-6418-5500
代表者氏名: 佐藤 健一 労働者氏名: 阮 氏玲
職種・役職: シニアソフトウェアエンジニア 所属部署: プロダクト開発本部
想定年収: 6,240,000 携帯電話番号: 080-3921-6640
メールアドレス: linh.nguyen@tsubame.jp 最終学歴（学校名）: 早稲田大学
学部・学科: 基幹理工学部 情報理工学科 卒業年月: 2022年03月
緊急連絡先氏名: グエン ヴァン ミン 緊急連絡先フリガナ: グエン ヴァン ミン
緊急連絡先続柄: 兄 緊急連絡先電話: 080-9182-3301
緊急連絡先住所: 東京都中野区東中野3-8-12 基礎年金番号: 1948-204918
雇用保険被保険者番号: 4829-610384-2 健康保険記号・番号: 2410-8831
旅券番号: C9481023 個人番号: 491820394814
給与支払明細書（2026 年9月度）
対象年月: 2026年09月分 支給日: 2026年09月25日
会社名: ツバメクラウド株式会社 所属部署: プロダクト開発本部
社員番号: TC-0418 従業員氏名: 阮 氏玲
氏名（フリガナ）: グエン ティ リン 雇用形態: 正社員
基本給: 420,000 時間外手当: 45,000
通勤手当: 12,400 住宅手当: 30,000
総支給額: 507,400 健康保険料: 24,528
厚生年金保険料: 44,775 雇用保険料: 2,790
社会保険料合計: 72,093 源泉所得税: 14,820
住民税: 21,600 差引支給額: 398,887
";

fn field(id: &str, name: &str, label: &str, section: &str, format: &str) -> FormFieldInput {
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

#[test]
fn captures_demo_documents_and_fills_mizuho_shinjuku_and_tsubame_forms() {
    let captured = extract_document_details(DEMO_DOCUMENTS_TEXT);
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), captured.details);

    // 1. Mizuho Bank (みずほ銀行 口座振替・給与振込指定届): Zengin half-width kana + Wareki birth date
    let mizuho_fields = vec![
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
    ];

    let mizuho = fill_form_fields(&mizuho_fields, &profiles);
    let mizuho_vals: Vec<Option<&str>> = mizuho.iter().map(|m| m.value.as_deref()).collect();
    assert_eq!(
        mizuho_vals,
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
    );

    // 2. Shinjuku Ward Office (新宿区 住民異動届・在留カード記載事項確認票)
    let shinjuku_fields = vec![
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
    ];

    let shinjuku = fill_form_fields(&shinjuku_fields, &profiles);
    let shinjuku_vals: Vec<Option<&str>> = shinjuku.iter().map(|m| m.value.as_deref()).collect();
    assert_eq!(
        shinjuku_vals,
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
            None,
            Some("グエン ヴァン ミン"),
            Some("兄"),
            Some("080-9182-3301"),
        ]
    );

    // 3. Tsubame Cloud Onboarding (ツバメクラウド株式会社 入社手続・労務登録ポータル)
    let tsubame_fields = vec![
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
    ];

    let tsubame = fill_form_fields(&tsubame_fields, &profiles);
    let tsubame_vals: Vec<Option<&str>> = tsubame.iter().map(|m| m.value.as_deref()).collect();
    assert_eq!(
        tsubame_vals,
        vec![
            Some("阮 氏玲"),
            Some("linh.nguyen@tsubame.jp"),
            Some("プロダクト開発本部"),
            Some("シニアソフトウェアエンジニア"),
            Some("507400"),
            Some("398887"),
            None,
        ]
    );
}
