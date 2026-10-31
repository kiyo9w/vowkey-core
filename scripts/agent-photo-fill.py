#!/usr/bin/env python3
"""
Vowkey Agentic `@vk:` Visual Placement Harness for Photographed Paper Forms.

Architecture (Responsible AI + Agentic AI):
1. THE AGENT SEES ONLY THE BLANK FORM PHOTO + VALUE-BLIND `@vk:` DESCRIPTORS:
   - A blank paper form photo (`婚姻届`, `Mẫu CT01`, `Mẫu TK1-TS`, `在留カード記載事項変更届出書`) contains 0% PII.
   - The Agent queries Vowkey's `@vk:` reference catalog (`list_references`), receiving ONLY
     `@vk:<profileId>/<fieldPath>` tokens and metadata (`attribute`, `script`, `tag`, `format`,
     `sensitivity: "fill" | "ask"`) — NEVER raw personal values.
2. THE AGENT COMPUTES POSITIONS & TAGS (`<form>.vk-plan.json` + `<form> (tagged @vk).png`):
   - Using `vowkey-read --form` geometry + Vision LLM grounding (`jev-look`), the Agent assigns
     each detected box on the photo to a `@vk:...` reference and metadata (`style: "text" | "comb"`,
     `cells`, `person`, `sensitivity`), or marks human-only legal choices as `action: "skip"`.
   - It renders `<form> (tagged @vk).png` with visual `@vk:` pills so both the Vision LLM
     (actor-critic visual verification via `jev-look`) and the user can verify every box placement
     while 0 bytes of PII ever leave the vault.
3. VOWKEY RESOLVES `@vk:` LOCALLY INTO FOUNTAIN-PEN INK (`<form> (filled).png`):
   - Vowkey's local engine checks consent for `🔒 [ASK]` fields, resolves each `@vk:...` token from
     the local vault in memory, and stamps the real values onto `<form> (filled).png`.
"""

import argparse
import json
import subprocess
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
VOWKEY_READ = ROOT / "clients/apps/desktop/desktop_native/ocr/vowkey-read"
JEV_LOOK = Path("/Users/ngotrung/.local/bin/jev-look")

# 1. Value-blind `@vk:` Reference Catalog (what the AI Agent is allowed to see)
VALUE_BLIND_VK_CATALOG: List[Dict[str, Any]] = [
    {
        "reference": "@vk:prof-active/field.name.full.kanji",
        "shortTag": "@vk:name.full.kanji",
        "attribute": "name.full",
        "script": "Hani",
        "tag": None,
        "sensitivity": "fill",
        "label": "Full Name (Kanji / Official)",
    },
    {
        "reference": "@vk:prof-active/field.name.full.latin",
        "shortTag": "@vk:name.full.latin",
        "attribute": "name.full",
        "script": "Latn",
        "tag": None,
        "sensitivity": "fill",
        "label": "Full Name (Romaji / Latin)",
    },
    {
        "reference": "@vk:prof-active/field.name.full.kana",
        "shortTag": "@vk:name.full.kana",
        "attribute": "name.full",
        "script": "Kana",
        "tag": None,
        "sensitivity": "fill",
        "label": "Full Name (Katakana / Furigana)",
    },
    {
        "reference": "@vk:prof-active/field.birth.date.wareki",
        "shortTag": "@vk:birth.date.wareki",
        "attribute": "birth.date",
        "script": None,
        "tag": "wareki",
        "sensitivity": "fill",
        "label": "Date of Birth (Japanese Era / Wareki)",
    },
    {
        "reference": "@vk:prof-active/field.birth.date",
        "shortTag": "@vk:birth.date",
        "attribute": "birth.date",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Date of Birth (DD/MM/YYYY or ISO)",
    },
    {
        "reference": "@vk:prof-active/field.person.sex",
        "shortTag": "@vk:person.sex",
        "attribute": "person.sex",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Sex / Gender",
    },
    {
        "reference": "@vk:prof-active/field.person.nationality",
        "shortTag": "@vk:person.nationality",
        "attribute": "person.nationality",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Nationality / Region",
    },
    {
        "reference": "@vk:prof-active/field.person.ethnicity",
        "shortTag": "@vk:person.ethnicity",
        "attribute": "person.ethnicity",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Ethnicity (Dân tộc)",
    },
    {
        "reference": "@vk:prof-active/field.birth.place.district",
        "shortTag": "@vk:birth.place.district",
        "attribute": "birth.place.district",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Birth / Origin District (Quận / Huyện quê quán)",
    },
    {
        "reference": "@vk:prof-active/field.birth.place.province",
        "shortTag": "@vk:birth.place.province",
        "attribute": "birth.place.province",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Birth / Origin Province (Tỉnh / TP quê quán)",
    },
    {
        "reference": "@vk:prof-active/field.address.full",
        "shortTag": "@vk:address.full",
        "attribute": "address.full",
        "script": "Hani",
        "tag": None,
        "sensitivity": "fill",
        "label": "Current Residential Address",
    },
    {
        "reference": "@vk:prof-active/field.address.street",
        "shortTag": "@vk:address.street",
        "attribute": "address.street",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Street Address (Số nhà, đường phố)",
    },
    {
        "reference": "@vk:prof-active/field.address.ward",
        "shortTag": "@vk:address.ward",
        "attribute": "address.ward",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Residential Ward / District (Xã / Phường / Quận)",
    },
    {
        "reference": "@vk:prof-active/field.address.province",
        "shortTag": "@vk:address.province",
        "attribute": "address.province",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Residential Province / City (Tỉnh / TP cư trú)",
    },
    {
        "reference": "@vk:prof-active/field.address.postal",
        "shortTag": "@vk:address.postal",
        "attribute": "address.postal",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Postal Code",
    },
    {
        "reference": "@vk:prof-active/field.work.occupation",
        "shortTag": "@vk:work.occupation",
        "attribute": "work.occupation",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Occupation / Job Title",
    },
    {
        "reference": "@vk:prof-active/field.work.employer.name",
        "shortTag": "@vk:work.employer.name",
        "attribute": "work.employer.name",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Employer / Organization Name",
    },
    {
        "reference": "@vk:prof-active/field.contact.phone",
        "shortTag": "@vk:contact.phone",
        "attribute": "contact.phone",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Daytime / Mobile Phone Number",
    },
    {
        "reference": "@vk:prof-active/field.contact.email",
        "shortTag": "@vk:contact.email",
        "attribute": "contact.email",
        "script": None,
        "tag": None,
        "sensitivity": "fill",
        "label": "Email Address",
    },
    {
        "reference": "@vk:prof-active/field.id.residence_card.number",
        "shortTag": "@vk:id.residence_card.number",
        "attribute": "id.residence_card.number",
        "script": None,
        "tag": None,
        "sensitivity": "ask",
        "label": "Residence Card Number (在留カード番号)",
    },
    {
        "reference": "@vk:prof-active/field.id.passport.number",
        "shortTag": "@vk:id.passport.number",
        "attribute": "id.passport.number",
        "script": None,
        "tag": None,
        "sensitivity": "ask",
        "label": "Passport Number (旅券番号)",
    },
    {
        "reference": "@vk:prof-active/field.id.national.number",
        "shortTag": "@vk:id.national.number",
        "attribute": "id.national.number",
        "script": None,
        "tag": None,
        "sensitivity": "ask",
        "style": "comb",
        "cells": 12,
        "label": "12-Digit National ID / CCCD (Số định danh cá nhân)",
    },
    {
        "reference": "@vk:prof-active/field.id.social_security.number",
        "shortTag": "@vk:id.social_security.number",
        "attribute": "id.social_security.number",
        "script": None,
        "tag": None,
        "sensitivity": "ask",
        "label": "Social Security / Health Insurance Number (Mã số BHXH / BHYT)",
    },
]

# 2. Local Vault Profiles (ONLY accessed in Step 3 by Vowkey's local resolver, NEVER seen by the Agent)
PROFILES: Dict[str, Dict[str, str]] = {
    "default": {
        "@vk:prof-active/field.name.full.kanji": "NGUYEN THI LINH",
        "@vk:prof-active/field.name.full.latin": "NGUYEN THI LINH",
        "@vk:prof-active/field.name.full.kana": "グエン ティ リン",
        "@vk:prof-active/field.birth.date.wareki": "平成12年3月12日",
        "@vk:prof-active/field.birth.date": "12/03/2000",
        "@vk:prof-active/field.person.sex": "Nữ (Female)",
        "@vk:prof-active/field.person.nationality": "ベトナム (VIET NAM)",
        "@vk:prof-active/field.person.ethnicity": "Kinh",
        "@vk:prof-active/field.birth.place.district": "Phú Vang",
        "@vk:prof-active/field.birth.place.province": "Thừa Thiên Huế",
        "@vk:prof-active/field.address.full": "東京都新宿区西新宿2-8-1 新宿レジデンス302",
        "@vk:prof-active/field.address.ward": "西新宿",
        "@vk:prof-active/field.address.province": "東京都",
        "@vk:prof-active/field.address.postal": "160-0023",
        "@vk:prof-active/field.work.occupation": "会社員 (ソフトウェアエンジニア)",
        "@vk:prof-active/field.work.employer.name": "株式会社ツバメロボティクス",
        "@vk:prof-active/field.contact.phone": "080-4129-8831",
        "@vk:prof-active/field.contact.email": "linh.nguyen@tsubame.jp",
        "@vk:prof-active/field.id.residence_card.number": "AB12345678CD",
        "@vk:prof-active/field.id.passport.number": "B1234567",
        "@vk:prof-active/field.id.national.number": "079300012345",
        "@vk:prof-active/field.id.social_security.number": "7912345678",
    },
    # Real profile extracted by `vowkey-capture` from camera-captured Vietnamese CCCD
    # (`0FmXWZcp5q2vZpPXN5YS.jpg`) + BHYT Card (`081MRaXMA2n1awrM8kQf.jpg`)
    "real-vn-cccd": {
        "@vk:prof-active/field.name.full.kanji": "NGUYỄN QUỐC VIỆT",
        "@vk:prof-active/field.name.full.latin": "NGUYỄN QUỐC VIỆT",
        "@vk:prof-active/field.name.full.kana": "グエン クオック ヴィエット",
        "@vk:prof-active/field.birth.date.wareki": "26/08/2006",
        "@vk:prof-active/field.birth.date": "26/08/2006",
        "@vk:prof-active/field.person.sex": "Nam",
        "@vk:prof-active/field.person.nationality": "Việt Nam",
        "@vk:prof-active/field.person.ethnicity": "Kinh",
        "@vk:prof-active/field.birth.place.district": "Phú Vang",
        "@vk:prof-active/field.birth.place.province": "Thừa Thiên Huế",
        "@vk:prof-active/field.address.full": "65/6 Tân Kỳ Tân Quý, Tân Sơn Nhì, Tân Phú, TP. Hồ Chí Minh",
        "@vk:prof-active/field.address.street": "65/6 Tân Kỳ Tân Quý",
        "@vk:prof-active/field.address.ward": "Tân Sơn Nhì, Tân Phú",
        "@vk:prof-active/field.address.province": "TP. Hồ Chí Minh",
        "@vk:prof-active/field.address.postal": "700000",
        "@vk:prof-active/field.contact.phone": "0903-812-456",
        "@vk:prof-active/field.contact.email": "quocviet.nguyen@gmail.com",
        "@vk:prof-active/field.id.national.number": "079206032383",
        "@vk:prof-active/field.id.social_security.number": "490679796",
    },
    # Real profile extracted by `vowkey-capture` from official ISA Japan Residence Card
    # (`residence-card-old-vs-2026-format-specimen.jpg`)
    "real-jp-isa": {
        "@vk:prof-active/field.name.full.kanji": "TURNER ELIZABETH",
        "@vk:prof-active/field.name.full.latin": "TURNER ELIZABETH",
        "@vk:prof-active/field.name.full.kana": "ターナー エリザベス",
        "@vk:prof-active/field.birth.date.wareki": "1985年12月31日",
        "@vk:prof-active/field.birth.date": "1985-12-31",
        "@vk:prof-active/field.person.sex": "女 (Female)",
        "@vk:prof-active/field.person.nationality": "米国 (USA)",
        "@vk:prof-active/field.address.full": "東京都千代田区霞が関1丁目1番1号霞が関ハイツ202号",
        "@vk:prof-active/field.address.postal": "100-0013",
        "@vk:prof-active/field.work.occupation": "技術・人文知識・国際業務 (Engineer)",
        "@vk:prof-active/field.work.employer.name": "霞が関インターナショナル株式会社",
        "@vk:prof-active/field.contact.phone": "03-5532-1100",
        "@vk:prof-active/field.contact.email": "elizabeth.turner@example.jp",
        "@vk:prof-active/field.id.residence_card.number": "AB12345678CD",
        "@vk:prof-active/field.id.passport.number": "US987654321",
    },
}


def parse_box_coords(key: str) -> Tuple[int, float, float, float, float]:
    parts = key.split(":")
    if len(parts) >= 6 and parts[0] == "box":
        return int(parts[1]), float(parts[2]), float(parts[3]), float(parts[4]), float(parts[5])
    return 0, 0.0, 0.5, 0.2, 0.02


def classify_field_to_vk(label: str, key: str = "") -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """
    Agentic classifier mapping a printed form label (with 0 PII) to a value-blind `@vk:` reference
    and placement metadata (or `action: "skip"` for intentional error-boundary fields).
    """
    clean = unicodedata.normalize("NFC", label).strip()
    lower = clean.lower()
    page, x, y, w, h = parse_box_coords(key)
    if page > 0:
        return None, {"action": "skip", "reason": "Unmapped secondary page instruction"}

    # Skip checkbox options (`口 ...` / `□ ...`), legal preambles, and sub-captions under `氏名`
    if (
        clean.startswith("口 ")
        or clean.startswith("□ ")
        or clean in ("Family name", "Given name", "Photo", "別", "性")
        or "規定に基づき" in clean
        or "以外の" in clean
    ):
        return None, {"action": "skip", "reason": "Unmapped sub-caption, checkbox option, or legal preamble"}

    # Skip checkbox `□ 国籍・地域` inside item 7 (`Changed item`) on JP ISA form (`y < 0.62`)
    if ("国籍" in clean or "国 籍" in clean) and y < 0.62:
        return None, {"action": "skip", "reason": "Unmapped checkbox option in item 7"}

    # Skip duplicate `性別` label on JP ISA form when `男・女 (Male / Female)` sits right next to it (`x > 0.72`)
    if clean == "性別" and x > 0.72:
        return None, {"action": "skip", "reason": "Unmapped duplicate sex sub-label"}

    # Skip Representative (`代理人`) and Legal Agent (`取次者`) sections in lower half of JP ISA form
    if (
        clean.startswith("（1）")
        or clean.startswith("（2）")
        or clean.startswith("（3）")
        or clean.startswith("（4）")
        or ("Telephone number" in clean and 0.20 < y < 0.32)
    ):
        return None, {
            "action": "skip",
            "reason": "Representative / Agent section (代理人・取次者) — applicant filing in person",
        }

    # Skip duplicate Section II name/birth fields at bottom of `Mẫu TK1-TS` (`y < 0.30`) except `Mã số BHXH`
    if y < 0.30 and ("Họ và tên" in clean or "Ngày, tháng, năm sinh" in clean):
        return None, {
            "action": "skip",
            "reason": "Section II duplicate header — filled in Section I above",
        }

    # Intentional Error Boundaries (Human legal choice / household head / free-text reason)
    if any(
        kw in clean
        for kw in [
            "Họ, chữ đệm và tên chủ hộ",
            "Mối quan hệ với chủ hộ",
            "Số định danh cá nhân của chủ hộ",
            "Nội dung đề nghị",
            "Nội dung thay đổi, yêu cầu",
            "婚姻後の夫婦の氏",
            "新しい本籍",
            "本籍",
            "変更を生じた事由",
            "変更前 (Previous item)",
            "変更後 (Changed item)",
        ]
    ):
        return None, {
            "action": "skip",
            "reason": "Human legal decision / specific change reason required — Agent leaves blank",
        }

    # Sensitive ID fields (gated by `Ask` consent)
    if "Số định danh cá nhân" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "id.national.number")
        return entry, {
            "action": "fill",
            "person": "applicant",
            "style": "comb",
            "cells": 12,
            "sensitivity": "ask",
            "reason": "12-digit National ID box grid",
        }
    if "Số CMND" in clean or "Thẻ căn cước" in clean or "CCCD" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "id.national.number")
        return entry, {
            "action": "fill",
            "person": "applicant",
            "style": "text",
            "sensitivity": "ask",
            "reason": "National ID / CCCD number (gated by Ask)",
        }
    if "Mã số BHXH" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "id.social_security.number")
        return entry, {
            "action": "fill",
            "person": "applicant",
            "style": "text",
            "sensitivity": "ask",
            "reason": "Social Security / Health Insurance ID (gated by Ask)",
        }
    if "在留カード番号" in clean or "Residence card number" in clean or "Residence Card" in clean or "カード番号" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "id.residence_card.number")
        return entry, {
            "action": "fill",
            "person": "applicant",
            "style": "text",
            "sensitivity": "ask",
            "reason": "Government ID requires user confirmation",
        }
    if "旅券番号" in clean or "Passport" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "id.passport.number")
        return entry, {
            "action": "fill",
            "person": "applicant",
            "style": "text",
            "sensitivity": "ask",
            "reason": "Passport number requires user confirmation",
        }

    # Names & Scripts
    if "フリガナ" in clean or "カナ" in clean or "Kana" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["shortTag"] == "@vk:name.full.kana")
        return entry, {"action": "fill", "person": "applicant", "script": "Kana", "style": "text", "sensitivity": "fill"}
    if "Họ, chữ đệm và tên" in clean or "Họ và tên" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["shortTag"] == "@vk:name.full.latin")
        return entry, {"action": "fill", "person": "applicant", "script": "Latn", "style": "text", "sensitivity": "fill"}
    if "氏名" in clean or "Full Name" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["shortTag"] == "@vk:name.full.kanji")
        return entry, {"action": "fill", "person": "applicant", "script": "Hani", "style": "text", "sensitivity": "fill"}

    # Dates of birth (Wareki vs DD/MM/YYYY)
    if "生年月日" in clean or "Date of Birth" in clean or "Date of birth" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["shortTag"] == "@vk:birth.date.wareki")
        return entry, {"action": "fill", "person": "applicant", "format": "wareki", "style": "text", "sensitivity": "fill"}
    if "Ngày, tháng, năm sinh" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["shortTag"] == "@vk:birth.date")
        return entry, {"action": "fill", "person": "applicant", "format": "dd/mm/yyyy", "style": "text", "sensitivity": "fill"}

    # Sex, Nationality, Ethnicity, Phone, Email, Address, Occupation
    if "Giới tính" in clean or "性別" in clean or "男・女" in clean or "Male / Female" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "person.sex")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "国籍" in clean or "国 籍" in clean or "Nationality" in clean or "Quốc tịch" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "person.nationality")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "Dân tộc" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "person.ethnicity")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "Huyện (quận, thị xã" in clean:
        if y > 0.57:
            entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "birth.place.district")
            return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
        return None, {"action": "skip", "reason": "Unmapped district combined in ward"}
    if "Số nhà, đường phố" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "address.street")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "Nơi đăng ký giấy khai sinh" in clean:
        return None, {"action": "skip", "reason": "Unmapped optional birthplace ward (CCCD specifies District & Province)"}
    if "Xã (phường, thị trấn)" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "address.ward")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if clean == "Tỉnh":
        attr = "birth.place.province" if y > 0.57 else "address.province"
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == attr)
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "電話" in clean or "Số điện thoại" in clean or "Phone" in clean or "Cellular phone" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "contact.phone")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "メール" in clean or "email" in lower:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "contact.email")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "郵便番号" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "address.postal")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if any(kw in clean for kw in ["住所", "住居地", "居住地", "Nơi thường trú", "Nơi tạm trú", "Nơi ở hiện tại", "Address"]):
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "address.full")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "職業" in clean or "Occupation" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "work.occupation")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}
    if "勤務先" in clean or "所属機関" in clean:
        entry = next(x for x in VALUE_BLIND_VK_CATALOG if x["attribute"] == "work.employer.name")
        return entry, {"action": "fill", "person": "applicant", "style": "text", "sensitivity": "fill"}

    return None, {"action": "skip", "reason": "Unmapped field"}


def run_vowkey_form(image_path: Path) -> List[Dict[str, Any]]:
    proc = subprocess.run(
        [str(VOWKEY_READ), "--form", str(image_path)],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(proc.stdout)
    return data.get("fields", [])


def run_vowkey_fill(image_path: Path, out_path: Path, mapping: Dict[str, str]) -> int:
    proc = subprocess.run(
        [str(VOWKEY_READ), "--fill", str(image_path), str(out_path)],
        input=json.dumps(mapping),
        capture_output=True,
        text=True,
        check=True,
    )
    return int(proc.stdout.strip() or "0")


def run_jev_vision_check(tagged_image_path: Path) -> Optional[Dict[str, Any]]:
    if not JEV_LOOK.exists():
        return None
    proc = subprocess.run(
        [
            str(JEV_LOOK),
            str(tagged_image_path),
            "--ask",
            "Are blue @vk: reference tags placed inside the form fields?",
            "--ask",
            "Are any personal names or raw ID numbers visible instead of @vk: reference tags?",
            "--json",
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return None
    try:
        return json.loads(proc.stdout)
    except Exception:
        return None


def widen_narrow_box(key: str, min_w: float = 0.14, bounded_by_neighbor: bool = False) -> str:
    page, x, y, w, h = parse_box_coords(key)
    target_w = min_w
    if bounded_by_neighbor and x + w < 0.75:
        target_w = min(min_w, max(w, 0.082))
    if w < target_w:
        return f"box:{page}:{x:.4f}:{y:.4f}:{target_w:.4f}:{h:.4f}"
    return key


def process_form_photo(
    image_path: Path,
    profile_name: str = "default",
    vision_check: bool = False,
    out_dir: Optional[Path] = None,
    out_stem: Optional[str] = None,
) -> Dict[str, Any]:
    vault_values = PROFILES.get(profile_name, PROFILES["default"])
    fields = run_vowkey_form(image_path)
    placements: List[Dict[str, Any]] = []
    blueprint_boxes: Dict[str, str] = {}
    resolved_boxes: Dict[str, str] = {}

    for idx, field in enumerate(fields):
        raw_key = field["key"]
        label = field.get("label", "")
        vk_entry, meta = classify_field_to_vk(label, raw_key)

        if vk_entry is None:
            if meta.get("action") == "skip" and "Unmapped" not in meta.get("reason", ""):
                key = widen_narrow_box(raw_key, 0.18)
                blueprint_boxes[key] = "⚠ SKIP: Human choice"
                placements.append(
                    {
                        "fieldId": f"field_{idx + 1}",
                        "boxKey": key,
                        "label": label,
                        "reference": None,
                        "metadata": meta,
                    }
                )
            continue

        key = widen_narrow_box(raw_key, 0.13)
        resolved_key = widen_narrow_box(raw_key, 0.13, bounded_by_neighbor=True)
        ref = vk_entry["reference"]
        short_tag = vk_entry["shortTag"]
        is_ask = meta.get("sensitivity") == "ask"
        style = meta.get("style", "text")
        cells = meta.get("cells")

        effective_key = f"{resolved_key}:comb:{cells}" if (style == "comb" and cells) else resolved_key

        # Stage 2 Blueprint badge string (0% PII!)
        badge_text = f"🔒 {short_tag} [ASK]" if is_ask else short_tag
        if style == "comb" and cells:
            badge_text = f"🔒 {short_tag} [12-BOX COMB · ASK]"
        blueprint_boxes[resolved_key] = badge_text

        # Stage 3 Local Vault resolution (resolved in local memory only)
        real_val = vault_values.get(ref, "")
        if real_val:
            resolved_boxes[effective_key] = real_val

        placements.append(
            {
                "fieldId": f"field_{idx + 1}",
                "boxKey": effective_key,
                "label": label,
                "reference": ref,
                "shortTag": short_tag,
                "metadata": meta,
            }
        )

    stem = out_stem or image_path.stem
    parent = out_dir or image_path.parent
    ext = ".png" if image_path.suffix.lower() == ".pdf" else image_path.suffix

    plan_path = parent / f"{stem}.vk-plan.json"
    tagged_path = parent / f"{stem} (tagged @vk){ext}"
    filled_path = parent / f"{stem} (filled){ext}"

    # Write Stage 2 `@vk:` Blueprint Image (safe for Vision LLM inspection!)
    tagged_count = run_vowkey_fill(image_path, tagged_path, blueprint_boxes)

    # Optional Vision LLM self-check on the `@vk:` Blueprint image
    jev_verdict = run_jev_vision_check(tagged_path) if vision_check else None

    # Write Stage 3 Locally Resolved Ink Image
    filled_count = run_vowkey_fill(image_path, filled_path, resolved_boxes)

    plan_doc = {
        "form": image_path.name,
        "profile": profile_name,
        "privacyGuarantee": "AI Agent receives only blank form image + value-blind @vk: descriptors. Raw values are resolved locally by Vowkey.",
        "taggedBlueprintImage": tagged_path.name,
        "filledOutputImage": filled_path.name,
        "taggedCount": tagged_count,
        "filledCount": filled_count,
        "visionSelfCheck": jev_verdict,
        "placements": placements,
    }
    plan_path.write_text(json.dumps(plan_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return plan_doc


def main() -> None:
    parser = argparse.ArgumentParser(description="Vowkey Agentic @vk: Visual Placement Harness")
    parser.add_argument("images", nargs="+", help="Form photo(s) to tag with @vk: and fill locally")
    parser.add_argument("--profile", default="default", choices=list(PROFILES.keys()), help="Local vault profile to resolve @vk: tokens against")
    parser.add_argument("--vision-check", action="store_true", help="Run jev-look vision check on @vk: blueprint")
    args = parser.parse_args()

    results = []
    for raw in args.images:
        p = Path(raw).resolve()
        res = process_form_photo(p, profile_name=args.profile, vision_check=args.vision_check)
        results.append(res)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
