//! Form-matching tests from what the four Demo documents say (`residence_card.pdf`,
//! `bank_passbook.pdf`, `employment_contract.pdf`, `payslip_2026_09.pdf`) and the three Demo
//! Japanese forms (`mizuho-bank.html`, `shinjuku-ward.html`, `tsubame-onboarding.html`).

#![allow(clippy::unwrap_used)]

mod demo;

use std::collections::BTreeMap;

use vowkey_capture::matcher::fill_form_fields;

#[test]
fn fills_mizuho_shinjuku_and_tsubame_forms_from_the_demo_details() {
    let mut profiles = BTreeMap::new();
    profiles.insert("applicant".to_string(), demo::demo_details());

    // 1. Mizuho Bank (みずほ銀行 口座振替・給与振込指定届): Zengin half-width kana + Wareki birth date
    let mizuho = fill_form_fields(&demo::mizuho_fields(), &profiles, true);
    let values: Vec<Option<&str>> = mizuho.iter().map(|m| m.value.as_deref()).collect();
    assert_eq!(values, demo::mizuho_expected());

    // 2. Shinjuku Ward Office (新宿区 住民異動届・在留カード記載事項確認票)
    let shinjuku = fill_form_fields(&demo::shinjuku_fields(), &profiles, true);
    let values: Vec<Option<&str>> = shinjuku.iter().map(|m| m.value.as_deref()).collect();
    assert_eq!(values, demo::shinjuku_expected());

    // 3. Tsubame Cloud Onboarding (ツバメクラウド株式会社 入社手続・労務登録ポータル)
    let tsubame = fill_form_fields(&demo::tsubame_fields(), &profiles, true);
    let values: Vec<Option<&str>> = tsubame.iter().map(|m| m.value.as_deref()).collect();
    assert_eq!(values, demo::tsubame_expected());
}
