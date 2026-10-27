#!/usr/bin/env python3
"""Score Vowkey's form matcher against Chrome's own output on Chromium's 184 heuristics fixtures.

The matcher carries Chrome's pattern table, so this says how faithfully Chrome's behavior was
ported for logins, addresses and cards. It does not say how forms people bring would come out.
Reports right (same family), left empty, and wrong (other family) across all 184 fixtures,
plus per-language breakdowns, and 1Password Brain's numbers on the same fixtures for reference.
"""
from __future__ import annotations

import collections
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys

CORE_ROOT = Path(__file__).resolve().parents[1]
REF_ROOT = CORE_ROOT.parent / "vowkey" / "references"
HEURISTICS_DIR = REF_ROOT / "oss/chromium-autofill/full/components/test/data/autofill/heuristics"
INPUT_DIR = HEURISTICS_DIR / "input"
OUTPUT_DIR = HEURISTICS_DIR / "output"
ONEPASSWORD_JSON = REF_ROOT / "rea/1password-brain/chromium-heuristics-results.json"


class FormControlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.by_key: dict[str, dict[str, str]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in ("input", "select", "textarea"):
            return
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        control_type = attr_map.get("type", "select-one" if tag == "select" else tag).lower()
        info = {
            "id": attr_map.get("id", ""),
            "name": attr_map.get("name", ""),
            "placeholder": attr_map.get("placeholder", ""),
            "autocomplete": attr_map.get("autocomplete", ""),
            "input_type": control_type,
        }
        for k in (info["id"], info["name"]):
            if k and k not in self.by_key:
                self.by_key[k] = info


def chrome_family(t: str) -> str:
    prefixes = [
        ("NAME_FIRST", "name-first"),
        ("NAME_MIDDLE", "name-middle"),
        ("NAME_LAST", "name-last"),
        ("NAME_FULL", "name-full"),
        ("ALTERNATIVE_FULL_NAME", "name-full"),
        ("ALTERNATIVE_GIVEN_NAME", "name-first"),
        ("ALTERNATIVE_FAMILY_NAME", "name-last"),
        ("NAME_HONORIFIC", "honorific"),
        ("COMPANY", "company"),
        ("PHONE_HOME_CITY_CODE", "tel-area"),
        ("PHONE_", "tel"),
        ("CREDIT_CARD_NAME", "cc-name"),
        ("CREDIT_CARD_EXP_MONTH", "cc-exp-month"),
        ("CREDIT_CARD_EXP_DATE", "cc-exp"),
        ("CREDIT_CARD_VERIFICATION", "cc-csc"),
        ("PASSPORT_NUMBER", "passport"),
        ("DRIVERS_LICENSE_NUMBER", "license"),
        ("NATIONAL_ID_CARD_NUMBER", "national-id"),
        ("IBAN_VALUE", "iban"),
    ]
    for prefix, family in prefixes:
        if t.startswith(prefix):
            return family
    exact = {
        "ADDRESS_HOME_LINE1": "addr1",
        "ADDRESS_HOME_STREET_ADDRESS": "addr1",
        "ADDRESS_HOME_STREET_NAME": "addr1",
        "ADDRESS_HOME_HOUSE_NUMBER": "addr1",
        "ADDRESS_HOME_STREET_LOCATION": "addr1",
        "ADDRESS_HOME_LINE2": "addr2",
        "ADDRESS_HOME_LINE3": "addr2",
        "ADDRESS_HOME_APT_NUM": "addr2",
        "ADDRESS_HOME_SUBPREMISE": "addr2",
        "ADDRESS_HOME_DEPENDENT_LOCALITY": "addr2",
        "ADDRESS_HOME_OVERFLOW": "addr2",
        "ADDRESS_HOME_CITY": "city",
        "ADDRESS_HOME_STATE": "state",
        "ADDRESS_HOME_ZIP": "zip",
        "ADDRESS_HOME_ZIP_PREFIX": "zip",
        "ADDRESS_HOME_ZIP_SUFFIX": "zip",
        "ADDRESS_HOME_COUNTRY": "country",
        "EMAIL_ADDRESS": "email",
        "CREDIT_CARD_NUMBER": "cc-number",
        "CREDIT_CARD_TYPE": "cc-type",
        "USERNAME": "username",
        "USERNAME_AND_EMAIL_ADDRESS": "username",
        "BIRTHDATE_DAY": "bday",
        "GENDER": "sex",
        "organization-title": "job-title",
        "UNKNOWN_TYPE": "unknown",
        "NO_SERVER_DATA": "unknown",
        "EMPTY_TYPE": "unknown",
    }
    if t in exact:
        return exact[t]
    if "EXP_" in t and "YEAR" in t:
        return "cc-exp-year"
    if "PASSWORD" in t:
        return "password"
    return "other:" + t


def find_vowkey_binary() -> Path:
    for profile in ("debug", "release"):
        candidate = CORE_ROOT / "sdk" / "target" / profile / "vowkey"
        if candidate.exists():
            return candidate
    subprocess.run(
        ["cargo", "build", "-p", "vowkey"],
        cwd=CORE_ROOT / "sdk",
        check=True,
    )
    return CORE_ROOT / "sdk" / "target" / "debug" / "vowkey"


def main() -> None:
    vowkey_bin = find_vowkey_binary()

    batch_inputs: list[dict] = []
    meta_rows: list[tuple[str, str, str]] = []
    forms_count = 0

    for out_path in sorted(OUTPUT_DIR.glob("*.out")):
        html_path = INPUT_DIR / out_path.with_suffix(".html").name
        parser = FormControlParser()
        if html_path.exists():
            parser.feed(html_path.read_text(encoding="utf-8", errors="replace"))

        forms_count += 1
        lang_match = re.match(r"\d+_(i18n_[a-z]+)", out_path.stem)
        language = lang_match.group(1) if lang_match else "site forms"

        for line in out_path.read_text(encoding="utf-8", errors="replace").splitlines():
            parts = [p.strip() for p in line.split("|")]
            if len(parts) < 3:
                continue
            expected_type, field_id, label = parts[0], parts[1], parts[2]
            section = parts[4] if len(parts) > 4 else ""
            want = chrome_family(expected_type)
            if want == "unknown" or want.startswith("other:"):
                continue
            html_info = parser.by_key.get(field_id, {})
            batch_inputs.append(
                {
                    "id": html_info.get("id") or field_id,
                    "name": html_info.get("name") or field_id,
                    "label": label,
                    "placeholder": html_info.get("placeholder", ""),
                    "autocomplete": html_info.get("autocomplete", ""),
                    "input_type": html_info.get("input_type", "text"),
                    "section": section,
                    "format": "",
                    "op_ignore": False,
                }
            )
            meta_rows.append((out_path.name, language, want))

    proc = subprocess.run(
        [str(vowkey_bin), "capture", "match"],
        input=json.dumps(batch_inputs).encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    predictions = json.loads(proc.stdout)

    total = collections.Counter()
    same = collections.Counter()
    empty = collections.Counter()
    other = collections.Counter()
    by_language: dict[str, list[int]] = collections.defaultdict(lambda: [0, 0])

    for (_, language, want), pred in zip(meta_rows, predictions):
        got = chrome_family(pred["chrome_type"])
        total[want] += 1
        by_language[language][0] += 1
        if got == want:
            same[want] += 1
            by_language[language][1] += 1
        elif got == "unknown":
            empty[want] += 1
        else:
            other[want] += 1

    n = sum(total.values())
    same_n = sum(same.values())
    empty_n = sum(empty.values())
    other_n = sum(other.values())

    print("=== Chromium 184 heuristics benchmark (Vowkey) ===")
    print(f"forms analysed: {forms_count}; fields Chrome fills: {n}")
    print(
        f"right: {same_n}/{n} ({same_n / n:.1%}), "
        f"left empty: {empty_n}/{n} ({empty_n / n:.1%}), "
        f"wrong: {other_n}/{n} ({other_n / n:.1%})"
    )
    print("language      fields  right")
    for language, (count, hits) in sorted(by_language.items(), key=lambda x: -x[1][0]):
        print(f"{language:<14}{count:>6}  {hits / count:.0%}")

    if ONEPASSWORD_JSON.exists():
        print("\n=== 1Password Brain on the same Chromium 184 fixtures ===")
        subprocess.run(
            [
                sys.executable,
                str(REF_ROOT / "tools/onepassword-brain/score.py"),
                str(ONEPASSWORD_JSON),
                str(OUTPUT_DIR),
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
