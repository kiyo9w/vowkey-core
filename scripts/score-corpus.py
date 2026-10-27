#!/usr/bin/env python3
"""Score Vowkey's form matcher on the 72 expected-field files (1,765 fields) in corpus/.

Each field's printed label comes from the expected file, so this measures how well a label is
matched to a detail, not how well a label is found in a form or a value is written into a file.
Reports right, left empty, and wrong across all 72 forms (26 jurisdictions), per-region
breakdowns (east-asia, south-southeast-asia, americas-oceania, europe-middle-east), and how
often a field about someone other than the applicant was matched as the applicant's.
"""
from __future__ import annotations

import collections
import json
import os
from pathlib import Path
import re
import subprocess
import sys

CORE_ROOT = Path(__file__).resolve().parents[1]
CORPUS_ROOT = CORE_ROOT.parent / "vowkey" / "corpus"
REGIONS = ("east-asia", "south-southeast-asia", "americas-oceania", "europe-middle-east")


def parse_expected_yaml(path: Path) -> list[dict[str, str]]:
    fields: list[dict[str, str]] = []
    cur: dict[str, str] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        m_item = re.match(r"^\s*-\s*(\w+):\s*(.*)$", line)
        m_kv = re.match(r"^\s+(\w+):\s*(.*)$", line)
        if m_item:
            if cur and "attribute" in cur:
                fields.append(cur)
            cur = {m_item.group(1): m_item.group(2).strip().strip("'\"")}
        elif m_kv and cur is not None:
            cur[m_kv.group(1)] = m_kv.group(2).strip().strip("'\"")
    if cur and "attribute" in cur:
        fields.append(cur)
    return fields


def canonical_family(attr: str, owner: str = "applicant") -> str:
    if not attr:
        return "empty"
    a = attr.lower().strip()
    if a in ("employer.name", "company.name", "work.employer.name", "employer"):
        return "work.employer"
    if a in ("employer.phone", "work.employer.phone"):
        return "contact.phone"
    if a in ("employer.address", "work.employer.address"):
        return "address.street_or_full"
    for p in (
        "applicant.",
        "spouse.",
        "dependent.",
        "child.",
        "employer.",
        "company.",
        "landlord.",
        "lessor.",
        "lessee.",
        "tenant.",
        "household_head.",
        "preparer.",
        "guarantor.",
        "representative.",
        "agent.",
        "person.",
        "personal.",
        "holder.",
        "employee.",
        "taxpayer.",
        "patient.",
        "insured.",
        "beneficiary.",
        "petitioner.",
        "sponsor.",
        "father.",
        "mother.",
        "parent.",
    ):
        if a.startswith(p):
            a = a[len(p) :]
    tokens = set(re.split(r"[^a-z0-9]+", a))
    if "nationalit" in a or "citizenship" in a:
        return "person.nationality"
    if any(k in a for k in ("status_of_residence", "residence_status", "visa", "coe")):
        if "expir" in a or "period" in a or "valid" in a:
            return "visa.expiry_or_period"
        if "number" in a or "no" in tokens:
            return "visa.number"
        return "visa.status"
    if any(k in a for k in ("passport", "travel_document", "pass_no")):
        if any(k in a for k in ("expir", "valid_until")):
            return "passport.expiry"
        if any(k in a for k in ("issue", "issued")):
            return "passport.issued"
        if any(k in a for k in ("country", "state", "authority", "place")):
            return "passport.country"
        if "type" in a:
            return "passport.type"
        return "passport.number"
    if (
        any(
            k in a
            for k in (
                "residence_card",
                "arc_",
                "zairyu",
                "alien_reg",
                "ic_number",
                "aadhaar",
                "cccd",
                "cmnd",
                "national_id",
                "identity_card",
                "id_card",
                "citizen_id",
                "personal_id",
                "curp",
                "mynumber",
                "my_number",
                "id.national",
                "uscis",
                "a_number",
            )
        )
        or bool(tokens & {"nric", "fin", "nik", "dni", "nie", "rg", "bsn", "nino"})
        or a in ("id.number", "id.national_number", "id.national.number", "national_id")
    ):
        if "expir" in a:
            return "visa.expiry_or_period"
        if "issue" in a:
            return "id.issued"
        return "id.number"
    if any(k in a for k in ("driver", "license", "licence")):
        if "expir" in a:
            return "license.expiry"
        if "issue" in a:
            return "license.issued"
        return "license.number"
    if any(
        k in a
        for k in (
            "social_security",
            "social_insurance",
            "tax_id",
            "tax.id",
            "steuer",
            "npwp",
            "codice_fiscale",
            "corporate_number",
        )
    ) or bool(tokens & {"ssn", "sin", "tfn", "tin", "utr", "cpf", "cnpj", "ein", "fein", "abn", "ird", "nif", "trn", "pan", "ptin"}):
        return "tax.id"
    if any(
        k in a
        for k in (
            "pension",
            "health_insurance",
            "employment_insurance",
            "philhealth",
            "pagibig",
            "kwsp",
            "sozialversicherung",
            "krankenkasse",
            "numero_securite_sociale",
        )
    ) or bool(tokens & {"sss", "epf", "uan", "bhxh", "inss", "nir"}):
        return "insurance.number"
    if "permit" in a:
        if "expir" in a or "period" in a or "valid" in a:
            return "visa.expiry_or_period"
        if "number" in a or "no" in tokens:
            return "visa.number"
        return "visa.status"
    if (
        any(
            k in a
            for k in (
                "iban",
                "bic",
                "swift",
                "routing",
                "sort_code",
                "blz",
                "branch_code",
                "bank_code",
                "account_number",
                "account_no",
                "account.number",
                "bank.name",
                "bank_name",
                "branch_name",
                "branch.name",
                "account_holder",
                "account.holder",
                "account_type",
                "account.type",
                "jp_post",
                "account_details",
            )
        )
        or a.startswith("bank.")
    ):
        if "iban" in a:
            return "bank.iban"
        if "bic" in a or "swift" in a:
            return "bank.bic"
        if "branch" in a and ("code" in a or "no" in a or "num" in a):
            return "bank.branch_code"
        if "branch" in a:
            return "bank.branch_name"
        if "code" in a or "routing" in a or "blz" in a or "sort" in a:
            return "bank.code"
        if "holder" in a or "owner" in a or "name_on_account" in a:
            return "bank.holder"
        if "type" in a or "kind" in a:
            return "bank.account_type"
        if "name" in a or a == "bank":
            return "bank.name"
        return "bank.account_number"
    if ("birth" in a or "dob" in tokens or a.startswith("age")) and not any(
        k in a for k in ("name", "surname", "family", "given", "maiden")
    ):
        if "place" in a or "city" in a or "state" in a or "prefecture" in a:
            return "birth.place"
        if "country" in a:
            return "birth.country"
        if "age" in a:
            return "birth.age"
        return "birth.date"
    if any(k in a for k in ("sex", "gender")):
        return "person.sex"
    if "marital" in a or "civil_status" in a:
        return "person.marital_status"
    if "nationalit" in a or "citizenship" in a:
        return "person.nationality"
    if "email" in a or "e_mail" in a:
        return "contact.email"
    if any(k in a for k in ("phone", "mobile", "tel", "cell", "fax")):
        return "contact.phone"
    if any(k in a for k in ("postal", "zip", "plz", "postcode", "cep", "pin_code")) and "address_and_postal" not in a and "address.hong_kong.postal" not in a:
        return "address.postal"
    if any(
        k in a
        for k in ("prefecture", "province", "state", "region", "bundesland", "departement")
    ):
        return "address.state"
    if any(
        k in a
        for k in (
            "city",
            "municipality",
            "ward",
            "district",
            "town",
            "suburb",
            "commune",
            "ort",
            "wohnort",
            "kreis",
            "kabupaten",
            "kecamatan",
            "kelurahan",
            "amphoe",
            "tambon",
            "barangay",
        )
    ):
        return "address.city"
    if any(
        k in a
        for k in (
            "building",
            "apt",
            "unit",
            "flat",
            "suite",
            "room",
            "floor",
            "house_no",
            "street_number",
            "hausnummer",
        )
    ):
        return "address.unit"
    if any(
        k in a
        for k in (
            "address",
            "street",
            "residence",
            "domicile",
            "anschrift",
            "adresse",
            "direccion",
            "indirizzo",
        )
    ):
        if "country" in a:
            return "address.country"
        return "address.street_or_full"
    if "country" in a:
        return "address.country"
    if any(
        k in a
        for k in (
            "employer",
            "company",
            "organization",
            "organisation",
            "firm",
            "business_name",
            "workplace",
            "school",
            "university",
            "institution",
        )
    ):
        return "work.employer"
    if (
        any(
            k in a
            for k in (
                "name",
                "surname",
                "given",
                "family",
                "middle",
                "maiden",
                "furigana",
                "kana",
                "kanji",
                "romaji",
                "hanzi",
                "alias",
                "other_names",
            )
        )
        or a in ("full_name", "first_name", "last_name")
    ):
        if owner == "employer" and a in ("name", "name.full"):
            return "work.employer"
        if any(k in a for k in ("kana", "furigana", "katakana", "hiragana", "phonetic", "reading")):
            if "family" in a or "last" in a or "surname" in a:
                return "name.family.kana"
            if "given" in a or "first" in a:
                return "name.given.kana"
            return "name.full.kana"
        if any(
            k in a
            for k in (
                "family",
                "last",
                "surname",
                "birth_family",
                "maiden",
                "apellido",
                "nom_de_famille",
                "familienname",
                "nachname",
            )
        ):
            return "name.family"
        if any(k in a for k in ("given", "first", "vorname", "prenom", "nombre")):
            return "name.given"
        if "middle" in a:
            return "name.middle"
        return "name.full"
    if any(k in a for k in ("occupation", "job_title", "title", "position", "profession", "rank", "role")):
        return "work.title"
    if any(k in a for k in ("department", "division", "section", "unit")):
        return "work.department"
    if any(k in a for k in ("employee_id", "staff_id", "personnel_no")):
        return "work.employee_id"
    if any(
        k in a
        for k in (
            "income",
            "salary",
            "wage",
            "pay",
            "gross",
            "net",
            "bonus",
            "allowance",
            "deduction",
            "withholding",
            "amount",
            "rent",
            "deposit",
            "fee",
            "cost",
            "total",
            "tax_amount",
            "contribution",
            "benefit",
        )
    ):
        return "finance.amount"
    if any(k in a for k in ("signature", "sign_date", "declaration", "consent")):
        if "date" in a:
            return "form.date"
        return "form.signature"
    if "date" in a or "period" in a or "year" in a or "month" in a or "day" in a:
        return "form.date"
    if "relationship" in a or "relation" in a:
        return "person.relationship"
    return a


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


# Keys of the detail vocabulary that the corpus names differently, by the attribute the corpus would use.
VOCABULARY_AS_CORPUS = {
    "id.tax.number": "tax.id",
    "id.card.number": "id.number",
    "id.card.extra_number": "id.number",
    "id.card.issued": "id.issued",
    "id.card.expiry": "id.expiry",
    "id.passport.country": "passport.country",
    "birth.country": "birth.country",
}


def decision_predictions(batch_inputs: list[dict]) -> list[dict]:
    """The attribute and owner a Decision model chooses for each field. The key is VOWKEY_DECISION_KEY, or
    on a Mac the keychain item typesafe.ai.jev; answers are cached by request."""
    env = dict(os.environ)
    if not env.get("VOWKEY_DECISION_KEY") and sys.platform == "darwin":
        found = subprocess.run(
            ["security", "find-generic-password", "-s", "typesafe.ai.jev", "-w"], capture_output=True, text=True
        )
        env["VOWKEY_DECISION_KEY"] = found.stdout.strip()
    proc = subprocess.run(
        ["cargo", "run", "-q", "--manifest-path", str(CORE_ROOT / "sdk" / "Cargo.toml"), "-p", "vowkey-capture",
         "--example", "decision_corpus"],
        input=json.dumps(batch_inputs).encode("utf-8"),
        stdout=subprocess.PIPE,
        env=env,
        check=True,
    )
    return [
        {**p, "attribute": VOCABULARY_AS_CORPUS.get(p["attribute"], p["attribute"])} for p in json.loads(proc.stdout)
    ]


def main() -> None:
    use_decision = "--decision" in sys.argv[1:]
    vowkey_bin = None if use_decision else find_vowkey_binary()
    batch_inputs: list[dict] = []
    meta_rows: list[tuple[str, str, str, str, str]] = []
    forms_count = 0

    for region in REGIONS:
        for yaml_path in sorted((CORPUS_ROOT / region / "expected").glob("*.yaml")):
            forms_count += 1
            for row in parse_expected_yaml(yaml_path):
                label = row.get("label", "")
                pdf_field = row.get("pdf_field", "")
                fmt = row.get("format", "")
                owner = row.get("owner", "applicant")
                attr = row.get("attribute", "")
                want_fam = canonical_family(attr, owner)
                batch_inputs.append(
                    {
                        "id": pdf_field,
                        "name": pdf_field,
                        "label": label,
                        "placeholder": "",
                        "autocomplete": "",
                        "input_type": "text",
                        "section": "",
                        "form": f"{region}/{yaml_path.stem}",
                        "format": fmt,
                        "op_ignore": False,
                    }
                )
                meta_rows.append((region, yaml_path.stem, label, want_fam, owner))

    if use_decision:
        predictions = decision_predictions(batch_inputs)
    else:
        proc = subprocess.run(
            [str(vowkey_bin), "capture", "match"],
            input=json.dumps(batch_inputs).encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        predictions = json.loads(proc.stdout)

    right = 0
    empty = 0
    wrong = 0
    by_region: dict[str, list[int]] = {r: [0, 0, 0, 0] for r in REGIONS}
    other_person = 0
    other_person_as_applicant = 0

    for (region, _, _, want_fam, want_owner), pred in zip(meta_rows, predictions):
        if want_owner != "applicant":
            other_person += 1
            other_person_as_applicant += pred["owner"] == "applicant"
        got_fam = canonical_family(pred["attribute"], pred["owner"])
        by_region[region][0] += 1
        if got_fam == "empty":
            empty += 1
            by_region[region][2] += 1
        elif got_fam == want_fam:
            right += 1
            by_region[region][1] += 1
        else:
            wrong += 1
            by_region[region][3] += 1

    total = len(meta_rows)
    print(f"=== Vowkey corpus benchmark ({'Decision' if use_decision else 'keyword engine'}; 72 expected-field files, reported separately) ===")
    print(f"forms analysed: {forms_count}; total fields: {total}")
    print(
        f"right: {right}/{total} ({right / total:.1%}), "
        f"left empty: {empty}/{total} ({empty / total:.1%}), "
        f"wrong: {wrong}/{total} ({wrong / total:.1%})"
    )
    print(
        f"fields about someone else: {other_person}; matched as the applicant: "
        f"{other_person_as_applicant} ({other_person_as_applicant / max(other_person, 1):.0%})"
    )
    print("region                  fields  right  empty  wrong")
    for region in REGIONS:
        n, r, e, w = by_region[region]
        print(f"{region:<24}{n:>6}  {r / n:>4.0%}   {e / n:>4.0%}   {w / n:>4.0%}")


if __name__ == "__main__":
    main()
