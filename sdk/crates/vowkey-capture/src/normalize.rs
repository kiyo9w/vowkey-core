//! Writes a value the way the vault keeps it: dates as ISO and amounts as plain numbers. Whatever
//! the value is not sure to be is kept as printed, in the document's own words, which is what a
//! form in that language asks for. `comparable` is for telling whether two values are one.

use icu_normalizer::DecomposingNormalizerBorrowed;

use crate::format::parse_japanese_date;

fn strip_role_prefix(key: &str) -> &str {
    const ROLES: &[&str] = &[
        "spouse.",
        "dependent.",
        "household_head.",
        "employer.",
        "guarantor.",
        "preparer.",
        "landlord.",
        "child.",
        "father.",
        "mother.",
    ];
    for role in ROLES {
        if let Some(rest) = key.strip_prefix(role) {
            if let Some((idx, tail)) = rest.split_once('.')
                && idx.bytes().all(|b| b.is_ascii_digit())
            {
                return tail;
            }
            return rest;
        }
    }
    key
}

/// A detail's value as the vault keeps it, from the text printed on the document: dates as ISO,
/// amounts as plain numbers, and the rest as printed.
pub fn normalize_value(key: &str, raw: &str) -> String {
    let raw = collapse(raw);
    if raw.is_empty() {
        return raw;
    }
    let base_key = strip_role_prefix(key);
    if base_key == "income.pay_period" {
        return parse_date(&raw)
            .map(|iso| iso.chars().take(7).collect())
            .unwrap_or(raw);
    }
    if is_date_key(base_key) {
        return parse_date(&raw).or_else(|| parse_short_year(&raw, base_key == "birth.date")).unwrap_or(raw);
    }
    if base_key == "birth.age" {
        let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
        return if digits.is_empty() { raw } else { digits };
    }
    if base_key.starts_with("income.") || base_key == "bank.account.balance" {
        return parse_amount(&raw).unwrap_or(raw);
    }
    if base_key == "name"
        || base_key.starts_with("name.")
        || base_key.starts_with("emergency.name")
        || key == "spouse.name"
        || base_key.starts_with("family.")
    {
        let cleaned = clean_name(&raw);
        if base_key.ends_with(".kana") || base_key.ends_with(".hiragana") {
            return strip_kana_wrapper(&cleaned);
        }
        return cleaned;
    }
    match base_key {
        "id.ssn.last4" => {
            let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
            digits.get(digits.len().saturating_sub(4)..).map_or(raw.clone(), str::to_string)
        }
        k if k.ends_with(".kana") || k.ends_with(".hiragana") => strip_kana_wrapper(&raw),
        _ => raw,
    }
}

/// A value in the form two values are compared in, whichever way they were written: sex as `male`
/// or `female`, a nationality as its country code, the rest as the vault keeps it.
pub fn comparable(key: &str, raw: &str) -> String {
    let base_key = strip_role_prefix(key);
    match base_key {
        "person.sex" | "sex" => sex(raw).map_or_else(|| normalize_value(key, raw), str::to_string),
        "person.nationality" | "nationality" => nationality(raw).unwrap_or_else(|| normalize_value(key, raw)),
        "address.full" | "address.previous" | "work.employer.address" | "emergency.address" => {
            strip_postal_prefix(&normalize_value(key, raw))
        }
        _ => normalize_value(key, raw),
    }
}

fn strip_postal_prefix(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(rest) = trimmed.strip_prefix('〒') {
        let rest = rest.trim_start();
        let after_code = rest.trim_start_matches(|c: char| c.is_ascii_digit() || c == '-' || c == 'ー' || c == '−');
        if after_code.len() < rest.len() && (after_code.starts_with(' ') || !after_code.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())) {
            let stripped = after_code.trim_start();
            if !stripped.is_empty() {
                return stripped.to_string();
            }
        }
    }
    trimmed.to_string()
}

fn strip_kana_wrapper(raw: &str) -> String {
    let trimmed = raw.trim();
    let inner = trimmed
        .strip_prefix('(')
        .or_else(|| trimmed.strip_prefix('（'))
        .unwrap_or(trimmed);
    let inner = inner
        .strip_suffix(')')
        .or_else(|| inner.strip_suffix('）'))
        .unwrap_or(inner);
    inner.trim().to_string()
}

/// A name without the marks a scan leaves around it: field markers such as `[a]` or `［a］`, a
/// missing closing bracket (`［bGABLER`), a triangle read as a digit, or a stray dash.
fn clean_name(raw: &str) -> String {
    let mut name = raw.trim();
    while let Some(after_open) = name.strip_prefix('[').or_else(|| name.strip_prefix('［')) {
        let trimmed = after_open.trim_start();
        if let Some((idx, close_ch)) = trimmed
            .char_indices()
            .take(6)
            .find(|(_, c)| *c == ']' || *c == '］')
        {
            name = trimmed[idx + close_ch.len_utf8()..].trim_start();
            continue;
        }
        let mut chars = trimmed.chars();
        if let (Some(marker), Some(next)) = (chars.next(), chars.next())
            && marker.is_ascii_lowercase()
            && (next.is_whitespace() || next.is_uppercase())
        {
            name = trimmed[marker.len_utf8()..].trim_start();
            continue;
        }
        name = trimmed;
        break;
    }
    let edge = |c: char| {
        c.is_ascii_digit()
            || matches!(
                c,
                '[' | ']' | '［' | '］' | '-' | '_' | '•' | '▲' | '|' | '*' | ',' | ';' | ':'
            )
    };
    name.trim_matches(edge).trim().to_string()
}

fn is_date_key(key: &str) -> bool {
    key == "birth.date"
        || key.ends_with(".date")
        || key.ends_with(".issued")
        || key.ends_with(".expiry")
        || key == "income.pay_date"
}

fn collapse(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn ascii_digits(raw: &str) -> String {
    raw.chars()
        .map(|c| match c {
            '０'..='９' => char::from_u32(u32::from(c) - u32::from('０') + u32::from('0')).unwrap_or(c),
            _ => c,
        })
        .collect()
}

/// Lower case without accents, so `Août`, `AOUT` and `aout` are one word.
pub fn fold(word: &str) -> String {
    DecomposingNormalizerBorrowed::new_nfd()
        .normalize(word)
        .chars()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .flat_map(|c| match c {
            'đ' | 'Đ' => vec!['d'],
            'ø' | 'Ø' => vec!['o'],
            'ł' | 'Ł' => vec!['l'],
            'ß' => vec!['s', 's'],
            'æ' | 'Æ' => vec!['a', 'e'],
            other => other.to_lowercase().collect(),
        })
        .collect()
}

/// The month a word names, in the languages documents are printed in.
fn month_of(word: &str) -> Option<u32> {
    let word = fold(word);
    if word.starts_with("juin") {
        return Some(6);
    }
    if word.starts_with("juil") {
        return Some(7);
    }
    let head: String = word.chars().take(3).collect();
    Some(match head.as_str() {
        "jan" | "ene" | "gen" => 1,
        "feb" | "fev" => 2,
        "mar" | "mrt" => 3,
        "apr" | "avr" | "abr" => 4,
        "may" | "mai" | "mei" | "mag" => 5,
        "jun" | "giu" => 6,
        "jul" | "lug" => 7,
        "aug" | "aou" | "ago" => 8,
        "sep" | "set" => 9,
        "oct" | "okt" | "out" | "ott" => 10,
        "nov" => 11,
        "dec" | "dez" | "dic" => 12,
        _ => return None,
    })
}

fn valid(year: u32, month: u32, day: u32) -> bool {
    (1800..=2200).contains(&year) && (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// A date written in any common way, as ISO `YYYY-MM-DD`, or `YYYY-MM` when it has no day.
pub fn parse_date(raw: &str) -> Option<String> {
    let text = ascii_digits(raw);
    if text.contains('年') || ["令和", "平成", "昭和", "大正", "明治"].iter().any(|era| text.contains(era)) {
        return parse_japanese_date(&text);
    }

    let mut numbers: Vec<(String, usize)> = Vec::new();
    let mut month_word: Option<u32> = None;
    let mut digits = String::new();
    let mut word = String::new();
    for (position, ch) in text.chars().chain(std::iter::once(' ')).enumerate() {
        if ch.is_ascii_digit() {
            if !word.is_empty() {
                month_word = month_word.or_else(|| month_of(&word));
                word.clear();
            }
            digits.push(ch);
        } else {
            if !digits.is_empty() {
                numbers.push((std::mem::take(&mut digits), position));
            }
            if ch.is_alphabetic() {
                word.push(ch);
            } else if !word.is_empty() {
                month_word = month_word.or_else(|| month_of(&word));
                word.clear();
            }
        }
    }

    let value = |i: usize| numbers.get(i).and_then(|(n, _)| n.parse::<u32>().ok());
    let long = |i: usize| numbers.get(i).is_some_and(|(n, _)| n.len() == 4);
    let iso = |y: u32, m: u32, d: u32| valid(y, m, d).then(|| format!("{y:04}-{m:02}-{d:02}"));
    let iso_month = |y: u32, m: u32| valid(y, m, 1).then(|| format!("{y:04}-{m:02}"));

    if let Some(month) = month_word {
        return match numbers.len() {
            2 if long(1) => iso(value(1)?, month, value(0)?),
            2 if long(0) => iso(value(0)?, month, value(1)?),
            1 if long(0) => iso_month(value(0)?, month),
            _ => None,
        };
    }
    match numbers.len() {
        3 if long(0) => iso(value(0)?, value(1)?, value(2)?),
        3 if long(2) => {
            let (a, b, year) = (value(0)?, value(1)?, value(2)?);
            if a > 12 || b <= 12 {
                iso(year, b, a)
            } else {
                iso(year, a, b)
            }
        }
        2 if long(0) => iso_month(value(0)?, value(1)?),
        2 if long(1) => iso_month(value(1)?, value(0)?),
        _ => None,
    }
}

/// A date written with a two-digit year, such as `23 APR /APR 56` or `02.05.24`. A birth year is
/// read as the latest year that is not in the future; any other year is this century's.
fn parse_short_year(raw: &str, birth: bool) -> Option<String> {
    let text = ascii_digits(raw);
    let numbers: Vec<u32> = text
        .split(|c: char| !c.is_ascii_digit())
        .filter(|n| !n.is_empty() && n.len() <= 2)
        .filter_map(|n| n.parse().ok())
        .collect();
    let month_word = text.split(|c: char| !c.is_alphabetic()).filter(|w| !w.is_empty()).find_map(month_of);
    let (day, month, yy) = match (month_word, numbers.as_slice()) {
        (Some(month), [day, yy]) => (*day, month, *yy),
        (None, [day, month, yy]) => (*day, *month, *yy),
        _ => return None,
    };
    let year = if birth && yy > 26 { 1900 + yy } else { 2000 + yy };
    valid(year, month, day).then(|| format!("{year:04}-{month:02}-{day:02}"))
}

/// An amount as plain digits: `500万円` as `5000000`, `28.500.000 đ` as `28500000`.
pub fn parse_amount(raw: &str) -> Option<String> {
    let text = ascii_digits(raw);
    let mut total = 0.0_f64;
    let mut found = false;
    let units: [(&str, f64); 6] = [
        ("億", 1e8),
        ("万", 1e4),
        ("tỷ", 1e9),
        ("triệu", 1e6),
        ("nghìn", 1e3),
        ("ngàn", 1e3),
    ];
    let lower = text.to_lowercase();
    if let Some((unit, scale)) = units.iter().find(|(unit, _)| lower.contains(unit)) {
        let head: String = lower.split(unit).next().unwrap_or("").to_string();
        let number = plain_number(&head)?;
        let rest = lower.split(unit).nth(1).unwrap_or("");
        total = number * scale;
        if let Some(tail) = plain_number(rest).filter(|_| rest.trim_start().starts_with(|c: char| c.is_ascii_digit())) {
            total += tail;
        }
        found = true;
    }
    if !found {
        total = plain_number(&lower)?;
    }
    if total.fract() == 0.0 {
        Some(format!("{total:.0}"))
    } else {
        Some(format!("{total}"))
    }
}

/// The first number in some text, with its thousands separators and decimal point understood.
fn plain_number(text: &str) -> Option<f64> {
    let start = text.find(|c: char| c.is_ascii_digit())?;
    let tail: String = text
        .get(start..)?
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | ' ' | '\'' | '\u{a0}' | '\u{202f}'))
        .collect();
    let tail = tail.trim_end_matches(|c: char| !c.is_ascii_digit()).replace([' ', '\'', '\u{a0}', '\u{202f}'], "");
    let last_dot = tail.rfind('.');
    let last_comma = tail.rfind(',');
    let (decimal, thousands) = match (last_dot, last_comma) {
        (Some(d), Some(c)) if d > c => ('.', ','),
        (Some(_), Some(_)) => (',', '.'),
        (Some(_), None) => single_separator(&tail, '.'),
        (None, Some(_)) => single_separator(&tail, ','),
        (None, None) => ('.', ','),
    };
    let cleaned: String = tail
        .chars()
        .filter(|c| *c != thousands)
        .map(|c| if c == decimal { '.' } else { c })
        .collect();
    cleaned.parse().ok()
}

/// Whether a lone separator marks thousands or decimals: thousands when it repeats or leaves
/// exactly three digits after it.
fn single_separator(text: &str, separator: char) -> (char, char) {
    let other = if separator == '.' { ',' } else { '.' };
    let count = text.matches(separator).count();
    let after = text.rsplit(separator).next().map_or(0, str::len);
    if count > 1 || after == 3 {
        (other, separator)
    } else {
        (separator, other)
    }
}

/// `male` or `female` from how a document writes sex.
pub fn sex(raw: &str) -> Option<&'static str> {
    if let Some((head, tail)) = raw.trim().rsplit_once('(').or_else(|| raw.trim().rsplit_once('（')) {
        let inner = tail.trim_end_matches([')', '）']).trim();
        let a = sex(head.trim());
        let b = sex(inner);
        return match (a, b) {
            (Some(sa), Some(sb)) if sa == sb => Some(sa),
            (Some(_), Some(_)) => None,
            (Some(sa), None) => Some(sa),
            (None, Some(sb)) => Some(sb),
            (None, None) => None,
        };
    }
    if !raw.contains(['/', '・', ',', ';']) {
        let parts: Vec<&str> = raw.split_whitespace().collect();
        if parts.len() >= 2 && parts.len() <= 4 {
            let mut agreed: Option<&'static str> = None;
            let mut conflict = false;
            for part in parts {
                if let Some(s) = sex(part) {
                    if let Some(prev) = agreed {
                        if prev != s {
                            conflict = true;
                            break;
                        }
                    } else {
                        agreed = Some(s);
                    }
                }
            }
            if !conflict && agreed.is_some() {
                return agreed;
            }
        }
    }
    let last = raw.rsplit('/').next().unwrap_or(raw);
    let word = fold(last.trim());
    if word.chars().count() <= 3 && word.chars().all(|c| c.is_alphabetic() || c == '/') && raw.contains(['/', 'I', 'l']) {
        let first_word = fold(raw.split('/').next().unwrap_or("").trim());
        let first_sex = match first_word.as_str() {
            "m" | "male" | "nam" | "男" | "남" => Some("male"),
            "f" | "female" | "nu" | "女" | "여" => Some("female"),
            _ => None,
        };
        match word.chars().last() {
            Some('f') if first_sex != Some("male") => return Some("female"),
            Some('m') if first_sex != Some("female") => return Some("male"),
            _ => {}
        }
    }
    let word = word.trim_matches(|c: char| !c.is_alphanumeric() && !('\u{3040}'..='\u{9fff}').contains(&c));
    let matched = match word {
        "m" | "male" | "man" | "masculin" | "masculino" | "maschio" | "manlijk" | "nam" | "mannlich" | "mannlich/m"
        | "男" | "남" | "男性" | "homme" | "hombre" | "uomo" | "mezczyzna" | "muz" | "mand" | "mann" | "h" | "v" => {
            Some("male")
        }
        "f" | "female" | "woman" | "feminin" | "femenino" | "femmina" | "vrouwelijk" | "nu" | "weiblich" | "w"
        | "女" | "여" | "女性" | "femme" | "mujer" | "donna" | "kobieta" | "zena" | "kvinde" | "kvinne" => {
            Some("female")
        }
        _ => None,
    };
    if let Some(m) = matched
        && raw.contains('/')
    {
        let first_part = raw.split('/').next().unwrap_or("").trim();
        let first_folded = fold(first_part);
        let conflict = (m == "female" && matches!(first_folded.as_str(), "male" | "nam" | "男" | "남" | "m"))
            || (m == "male" && matches!(first_folded.as_str(), "female" | "nu" | "女" | "여" | "f"));
        if conflict {
            return None;
        }
    }
    matched
}

/// `male` or `female` as an owned string, for code that wants one.
pub fn sex_code(raw: &str) -> Option<String> {
    sex(raw).map(str::to_string)
}

/// Two-letter country code from a country, a nationality or a three-letter code.
pub fn nationality(raw: &str) -> Option<String> {
    let mut parts: Vec<&str> = raw.split('/').map(str::trim).filter(|p| !p.is_empty()).collect();
    parts.reverse();
    if parts.len() > 1 {
        return parts.into_iter().find_map(nationality);
    }
    let trimmed = raw.trim();
    if trimmed.chars().count() == 2 && trimmed.chars().all(|c| c.is_ascii_uppercase()) {
        return Some(trimmed.to_string());
    }
    let word = fold(trimmed);
    let word = word.trim_matches(|c: char| !c.is_alphanumeric());
    COUNTRIES.iter().find_map(|(code2, code3, names)| {
        let hit = word.eq_ignore_ascii_case(code3)
            || word.eq_ignore_ascii_case(code2)
            || names.split('|').any(|name| fold(name) == word || (name.chars().count() > 3 && word.starts_with(&fold(name))));
        hit.then(|| (*code2).to_string())
    })
}

/// Country codes and the names, nationalities and spellings documents print for them.
const COUNTRIES: &[(&str, &str, &str)] = &[
    ("JP", "JPN", "japan|japanese|japon|japonais|japanisch|日本|日本国|nhat ban|nihon|giappone|japones"),
    ("VN", "VNM", "viet nam|vietnam|vietnamese|viet|việt nam|việt|vietnamien|vietnamesisch|越南"),
    ("US", "USA", "united states|usa|american|states unis|etats unis|vereinigte staaten|estados unidos|america|us"),
    ("GB", "GBR", "united kingdom|british|britain|great britain|uk|royaume uni|gb"),
    ("DE", "DEU", "germany|german|deutsch|deutschland|deutsche|allemagne|allemand|alemania|germania|duitsland|d"),
    ("FR", "FRA", "france|french|francais|francaise|frankreich|francia|frankrijk"),
    ("IT", "ITA", "italy|italian|italiano|italiana|italia|italie|italien"),
    ("ES", "ESP", "spain|spanish|espana|espanola|espanol|espagne|spanien"),
    ("PT", "PRT", "portugal|portuguese|portugues|portuguesa|portugais"),
    ("NL", "NLD", "netherlands|dutch|nederland|nederlandse|nederlander|pays bas|niederlande|holland"),
    ("BE", "BEL", "belgium|belgian|belgique|belgie|belgien|belge"),
    ("CH", "CHE", "switzerland|swiss|suisse|schweiz|svizzera|svizra"),
    ("AT", "AUT", "austria|austrian|osterreich|autriche"),
    ("PL", "POL", "poland|polish|polska|polskie|pologne|polen|polnisch"),
    ("CZ", "CZE", "czech republic|czech|czechia|ceska|cesko"),
    ("SK", "SVK", "slovakia|slovak|slovensko|slovenska|slovenske"),
    ("HU", "HUN", "hungary|hungarian|magyar|magyarorszag"),
    ("RO", "ROU", "romania|romanian|romana|romania|roumaine"),
    ("BG", "BGR", "bulgaria|bulgarian"),
    ("HR", "HRV", "croatia|croatian|hrvatska|hrvatsko|croate"),
    ("RS", "SRB", "serbia|serbian|srbija|srpsko|srpsko|србија|serbe"),
    ("UA", "UKR", "ukraine|ukrainian|ukraina|україна|українка|український"),
    ("RU", "RUS", "russia|russian|rossiya|russie"),
    ("TR", "TUR", "turkey|turkish|turkiye|turc"),
    ("GR", "GRC", "greece|greek|hellas|ellada|grece"),
    ("SE", "SWE", "sweden|swedish|sverige|svensk"),
    ("NO", "NOR", "norway|norwegian|norge|norsk|norvege"),
    ("DK", "DNK", "denmark|danish|danmark|dansk"),
    ("FI", "FIN", "finland|finnish|suomi"),
    ("IS", "ISL", "iceland|icelandic|island|islenskt|islenskur"),
    ("IE", "IRL", "ireland|irish|eire"),
    ("LU", "LUX", "luxembourg|luxembourgish|letzebuerg|luxembourgeois"),
    ("CN", "CHN", "china|chinese|zhongguo|中国|中華人民共和国|chine|chinois|trung quoc"),
    ("TW", "TWN", "taiwan|taiwanese|臺灣|台湾"),
    ("HK", "HKG", "hong kong|hongkong|香港"),
    ("KR", "KOR", "korea|south korea|korean|대한민국|한국|republic of korea|coree"),
    ("IN", "IND", "india|indian|bharat|inde"),
    ("PH", "PHL", "philippines|filipino|pilipino|philippine"),
    ("TH", "THA", "thailand|thai|ไทย|thailande"),
    ("ID", "IDN", "indonesia|indonesian|indonesie"),
    ("MY", "MYS", "malaysia|malaysian|malaisie"),
    ("SG", "SGP", "singapore|singaporean|singapour"),
    ("AU", "AUS", "australia|australian|australie"),
    ("NZ", "NZL", "new zealand|nouvelle zelande"),
    ("CA", "CAN", "canada|canadian|canadien|kanada"),
    ("BR", "BRA", "brazil|brazilian|brasil|brasileira|bresil|brasileiro"),
    ("MX", "MEX", "mexico|mexican|mexicano|mexique"),
    ("AR", "ARG", "argentina|argentine|argentino"),
    ("CL", "CHL", "chile|chilean|chilena"),
    ("CO", "COL", "colombia|colombian|colombiana"),
    ("PE", "PER", "peru|peruvian|peruana"),
    ("GT", "GTM", "guatemala|guatemalan|guatemalteca|guatemalteco"),
    ("EG", "EGY", "egypt|egyptian|egypte"),
    ("SA", "SAU", "saudi arabia|saudi|arabie saoudite"),
    ("AE", "ARE", "united arab emirates|emirati|uae|emirats arabes unis"),
    ("BH", "BHR", "bahrain|bahraini|bahrein"),
    ("IL", "ISR", "israel|israeli"),
    ("ZA", "ZAF", "south africa|south african|afrique du sud"),
    ("NG", "NGA", "nigeria|nigerian"),
    ("KE", "KEN", "kenya|kenyan"),
    ("PK", "PAK", "pakistan|pakistani"),
    ("BD", "BGD", "bangladesh|bangladeshi"),
    ("LK", "LKA", "sri lanka|sri lankan"),
    ("NP", "NPL", "nepal|nepali|nepalese"),
    ("MM", "MMR", "myanmar|burmese|burma"),
    ("KH", "KHM", "cambodia|cambodian|campuchia"),
    ("LA", "LAO", "laos|lao|lao pdr"),
];

/// Canonical ISO-3166 country metadata and localized display names for form formatting and
/// `<select>` option resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CountryInfo {
    /// ISO 3166-1 alpha-2 code (e.g. `"VN"`, `"JP"`, `"US"`).
    pub alpha2: &'static str,
    /// ISO 3166-1 alpha-3 code (e.g. `"VNM"`, `"JPN"`, `"USA"`).
    pub alpha3: &'static str,
    /// Standard English country name.
    pub en: &'static str,
    /// Standard Japanese country name.
    pub ja: &'static str,
    /// Standard Vietnamese country name.
    pub vi: &'static str,
    /// Primary ITU-T calling code with `+` prefix.
    pub calling_code: &'static str,
    /// Additional pipe-separated names, demonyms, and localized spellings.
    pub aliases: &'static str,
}

const COUNTRY_CATALOG: &[CountryInfo] = &[
    CountryInfo { alpha2: "JP", alpha3: "JPN", en: "Japan", ja: "日本", vi: "Nhật Bản", calling_code: "+81", aliases: "japanese|日本国|にほん|ニホン|ニッポン|japon|japonais|japanisch|giappone|japones" },
    CountryInfo { alpha2: "VN", alpha3: "VNM", en: "Vietnam", ja: "ベトナム", vi: "Việt Nam", calling_code: "+84", aliases: "viet nam|vietnamese|社会主义共和国|socialist republic of vietnam|ヴィエトナム|越南|vietnamien|vietnamesisch" },
    CountryInfo { alpha2: "US", alpha3: "USA", en: "United States", ja: "アメリカ", vi: "Hoa Kỳ", calling_code: "+1", aliases: "united states of america|u.s.a.|u.s.|american|アメリカ合衆国|米国|mỹ|my|etats-unis|états-unis|vereinigte staaten|estados unidos" },
    CountryInfo { alpha2: "GB", alpha3: "GBR", en: "United Kingdom", ja: "イギリス", vi: "Vương quốc Anh", calling_code: "+44", aliases: "uk|u.k.|great britain|britain|british|england|英国|anh|royaume-uni|vereinigtes königreich|reino unido" },
    CountryInfo { alpha2: "KR", alpha3: "KOR", en: "South Korea", ja: "韓国", vi: "Hàn Quốc", calling_code: "+82", aliases: "korea|republic of korea|korean|大韓民国|대한민국|한국|coree du sud|corée du sud|südkorea" },
    CountryInfo { alpha2: "KP", alpha3: "PRK", en: "North Korea", ja: "北朝鮮", vi: "Triều Tiên", calling_code: "+850", aliases: "dprk|democratic people's republic of korea|朝鮮民主主義人民共和国|조선민주주의인민공화국" },
    CountryInfo { alpha2: "CN", alpha3: "CHN", en: "China", ja: "中国", vi: "Trung Quốc", calling_code: "+86", aliases: "people's republic of china|prc|chinese|中華人民共和国|中华人民共和国|zhongguo|chine|chinois" },
    CountryInfo { alpha2: "TW", alpha3: "TWN", en: "Taiwan", ja: "台湾", vi: "Đài Loan", calling_code: "+886", aliases: "taiwanese|republic of china|roc|臺灣|台灣|中華民国" },
    CountryInfo { alpha2: "HK", alpha3: "HKG", en: "Hong Kong", ja: "香港", vi: "Hồng Kông", calling_code: "+852", aliases: "hongkong|hong kong sar" },
    CountryInfo { alpha2: "MO", alpha3: "MAC", en: "Macau", ja: "マカオ", vi: "Ma Cao", calling_code: "+853", aliases: "macao|澳門" },
    CountryInfo { alpha2: "DE", alpha3: "DEU", en: "Germany", ja: "ドイツ", vi: "Đức", calling_code: "+49", aliases: "german|deutsch|deutschland|deutsche|联邦德国|allemagne|allemand|alemania|germania|duitsland|d" },
    CountryInfo { alpha2: "FR", alpha3: "FRA", en: "France", ja: "フランス", vi: "Pháp", calling_code: "+33", aliases: "french|français|francais|française|francaise|frankreich|francia|frankrijk" },
    CountryInfo { alpha2: "ES", alpha3: "ESP", en: "Spain", ja: "スペイン", vi: "Tây Ban Nha", calling_code: "+34", aliases: "spanish|españa|espana|español|espanol|española|espagne|spanien" },
    CountryInfo { alpha2: "IT", alpha3: "ITA", en: "Italy", ja: "イタリア", vi: "Ý", calling_code: "+39", aliases: "italian|italia|italiano|italiana|italie|italien" },
    CountryInfo { alpha2: "PT", alpha3: "PRT", en: "Portugal", ja: "ポルトガル", vi: "Bồ Đào Nha", calling_code: "+351", aliases: "portuguese|português|portugues|portuguesa|portugais" },
    CountryInfo { alpha2: "NL", alpha3: "NLD", en: "Netherlands", ja: "オランダ", vi: "Hà Lan", calling_code: "+31", aliases: "the netherlands|dutch|nederland|nederlandse|holland|pays-bas|niederlande" },
    CountryInfo { alpha2: "BE", alpha3: "BEL", en: "Belgium", ja: "ベルギー", vi: "Bỉ", calling_code: "+32", aliases: "belgian|belgique|belgië|belgie|belgien|belge" },
    CountryInfo { alpha2: "CH", alpha3: "CHE", en: "Switzerland", ja: "スイス", vi: "Thụy Sĩ", calling_code: "+41", aliases: "swiss|suisse|schweiz|svizzera|svizra" },
    CountryInfo { alpha2: "AT", alpha3: "AUT", en: "Austria", ja: "オーストリア", vi: "Áo", calling_code: "+43", aliases: "austrian|österreich|osterreich|autriche" },
    CountryInfo { alpha2: "LU", alpha3: "LUX", en: "Luxembourg", ja: "ルクセンブルク", vi: "Luxembourg", calling_code: "+352", aliases: "luxembourgish|lëtzebuerg|letzebuerg|luxembourgeois" },
    CountryInfo { alpha2: "IE", alpha3: "IRL", en: "Ireland", ja: "アイルランド", vi: "Ireland", calling_code: "+353", aliases: "irish|éire|eire|republic of ireland" },
    CountryInfo { alpha2: "SE", alpha3: "SWE", en: "Sweden", ja: "スウェーデン", vi: "Thụy Điển", calling_code: "+46", aliases: "swedish|sverige|svensk" },
    CountryInfo { alpha2: "NO", alpha3: "NOR", en: "Norway", ja: "ノルウェー", vi: "Na Uy", calling_code: "+47", aliases: "norwegian|norge|norsk|norvège|norvege" },
    CountryInfo { alpha2: "DK", alpha3: "DNK", en: "Denmark", ja: "デンマーク", vi: "Đan Mạch", calling_code: "+45", aliases: "danish|danmark|dansk" },
    CountryInfo { alpha2: "FI", alpha3: "FIN", en: "Finland", ja: "フィンランド", vi: "Phần Lan", calling_code: "+358", aliases: "finnish|suomi" },
    CountryInfo { alpha2: "IS", alpha3: "ISL", en: "Iceland", ja: "アイスランド", vi: "Iceland", calling_code: "+354", aliases: "icelandic|ísland|islenskt|islenskur" },
    CountryInfo { alpha2: "PL", alpha3: "POL", en: "Poland", ja: "ポーランド", vi: "Ba Lan", calling_code: "+48", aliases: "polish|polska|polskie|pologne|polen|polnisch" },
    CountryInfo { alpha2: "CZ", alpha3: "CZE", en: "Czechia", ja: "チェコ", vi: "Cộng hòa Séc", calling_code: "+420", aliases: "czech republic|czech|česko|cesko|česká republika|ceska" },
    CountryInfo { alpha2: "SK", alpha3: "SVK", en: "Slovakia", ja: "スロバキア", vi: "Slovakia", calling_code: "+421", aliases: "slovak|slovensko|slovenská|slovenska" },
    CountryInfo { alpha2: "HU", alpha3: "HUN", en: "Hungary", ja: "ハンガリー", vi: "Hungary", calling_code: "+36", aliases: "hungarian|magyar|magyarország|magyarorszag" },
    CountryInfo { alpha2: "RO", alpha3: "ROU", en: "Romania", ja: "ルーマニア", vi: "Romania", calling_code: "+40", aliases: "romanian|românia|romana|roumaine" },
    CountryInfo { alpha2: "BG", alpha3: "BGR", en: "Bulgaria", ja: "ブルガリア", vi: "Bulgaria", calling_code: "+359", aliases: "bulgarian|българия" },
    CountryInfo { alpha2: "HR", alpha3: "HRV", en: "Croatia", ja: "クロアチア", vi: "Croatia", calling_code: "+385", aliases: "croatian|hrvatska|hrvatsko|croate" },
    CountryInfo { alpha2: "SI", alpha3: "SVN", en: "Slovenia", ja: "スロベニア", vi: "Slovenia", calling_code: "+386", aliases: "slovenian|slovenija" },
    CountryInfo { alpha2: "RS", alpha3: "SRB", en: "Serbia", ja: "セルビア", vi: "Serbia", calling_code: "+381", aliases: "serbian|srbija|srpsko|србија|serbe" },
    CountryInfo { alpha2: "GR", alpha3: "GRC", en: "Greece", ja: "ギリシャ", vi: "Hy Lạp", calling_code: "+30", aliases: "greek|hellas|ellada|grèce|grece" },
    CountryInfo { alpha2: "TR", alpha3: "TUR", en: "Turkey", ja: "トルコ", vi: "Thổ Nhĩ Kỳ", calling_code: "+90", aliases: "türkiye|turkiye|turkish|turc" },
    CountryInfo { alpha2: "UA", alpha3: "UKR", en: "Ukraine", ja: "ウクライナ", vi: "Ukraina", calling_code: "+380", aliases: "ukrainian|ukraina|україна|українка|український" },
    CountryInfo { alpha2: "RU", alpha3: "RUS", en: "Russia", ja: "ロシア", vi: "Nga", calling_code: "+7", aliases: "russian|russian federation|rossiya|россия|russie" },
    CountryInfo { alpha2: "EE", alpha3: "EST", en: "Estonia", ja: "エストニア", vi: "Estonia", calling_code: "+372", aliases: "estonian|eesti" },
    CountryInfo { alpha2: "LV", alpha3: "LVA", en: "Latvia", ja: "ラトビア", vi: "Latvia", calling_code: "+371", aliases: "latvian|latvija" },
    CountryInfo { alpha2: "LT", alpha3: "LTU", en: "Lithuania", ja: "リトアニア", vi: "Litva", calling_code: "+370", aliases: "lithuanian|lietuva" },
    CountryInfo { alpha2: "CA", alpha3: "CAN", en: "Canada", ja: "カナダ", vi: "Canada", calling_code: "+1", aliases: "canadian|canadien|kanada" },
    CountryInfo { alpha2: "MX", alpha3: "MEX", en: "Mexico", ja: "メキシコ", vi: "Mexico", calling_code: "+52", aliases: "mexican|méxico|mexicano|mexique" },
    CountryInfo { alpha2: "BR", alpha3: "BRA", en: "Brazil", ja: "ブラジル", vi: "Brazil", calling_code: "+55", aliases: "brazilian|brasil|brasileiro|brasileira|brésil|bresil" },
    CountryInfo { alpha2: "AR", alpha3: "ARG", en: "Argentina", ja: "アルゼンチン", vi: "Argentina", calling_code: "+54", aliases: "argentine|argentinian|argentino" },
    CountryInfo { alpha2: "CL", alpha3: "CHL", en: "Chile", ja: "チリ", vi: "Chile", calling_code: "+56", aliases: "chilean|chilena|chileno" },
    CountryInfo { alpha2: "CO", alpha3: "COL", en: "Colombia", ja: "コロンビア", vi: "Colombia", calling_code: "+57", aliases: "colombian|colombiana|colombiano" },
    CountryInfo { alpha2: "PE", alpha3: "PER", en: "Peru", ja: "ペルー", vi: "Peru", calling_code: "+51", aliases: "peruvian|perú|peruana|peruano" },
    CountryInfo { alpha2: "VE", alpha3: "VEN", en: "Venezuela", ja: "ベネズエラ", vi: "Venezuela", calling_code: "+58", aliases: "venezuelan|venezolano|venezolana" },
    CountryInfo { alpha2: "GT", alpha3: "GTM", en: "Guatemala", ja: "グアテマラ", vi: "Guatemala", calling_code: "+502", aliases: "guatemalan|guatemalteca|guatemalteco" },
    CountryInfo { alpha2: "AU", alpha3: "AUS", en: "Australia", ja: "オーストラリア", vi: "Úc", calling_code: "+61", aliases: "australian|australie|豪州" },
    CountryInfo { alpha2: "NZ", alpha3: "NZL", en: "New Zealand", ja: "ニュージーランド", vi: "New Zealand", calling_code: "+64", aliases: "new zealander|kiwi|nouvelle-zélande|nouvelle zelande" },
    CountryInfo { alpha2: "SG", alpha3: "SGP", en: "Singapore", ja: "シンガポール", vi: "Singapore", calling_code: "+65", aliases: "singaporean|singapour|新加坡" },
    CountryInfo { alpha2: "MY", alpha3: "MYS", en: "Malaysia", ja: "マレーシア", vi: "Malaysia", calling_code: "+60", aliases: "malaysian|malaisie|马来西亚" },
    CountryInfo { alpha2: "ID", alpha3: "IDN", en: "Indonesia", ja: "インドネシア", vi: "Indonesia", calling_code: "+62", aliases: "indonesian|indonésie|indonesie" },
    CountryInfo { alpha2: "TH", alpha3: "THA", en: "Thailand", ja: "タイ", vi: "Thái Lan", calling_code: "+66", aliases: "thai|ประเทศไทย|ไทย|thaïlande|thailande" },
    CountryInfo { alpha2: "PH", alpha3: "PHL", en: "Philippines", ja: "フィリピン", vi: "Philippines", calling_code: "+63", aliases: "the philippines|filipino|pilipino|philippine" },
    CountryInfo { alpha2: "KH", alpha3: "KHM", en: "Cambodia", ja: "カンボジア", vi: "Campuchia", calling_code: "+855", aliases: "cambodian|kampuchea|cambodge" },
    CountryInfo { alpha2: "LA", alpha3: "LAO", en: "Laos", ja: "ラオス", vi: "Lào", calling_code: "+856", aliases: "lao|lao pdr" },
    CountryInfo { alpha2: "MM", alpha3: "MMR", en: "Myanmar", ja: "ミャンマー", vi: "Myanmar", calling_code: "+95", aliases: "burma|burmese|ビルマ" },
    CountryInfo { alpha2: "BN", alpha3: "BRN", en: "Brunei", ja: "ブルネイ", vi: "Brunei", calling_code: "+673", aliases: "bruneian|brunei darussalam" },
    CountryInfo { alpha2: "IN", alpha3: "IND", en: "India", ja: "インド", vi: "Ấn Độ", calling_code: "+91", aliases: "indian|bharat|inde|印度" },
    CountryInfo { alpha2: "PK", alpha3: "PAK", en: "Pakistan", ja: "パキスタン", vi: "Pakistan", calling_code: "+92", aliases: "pakistani" },
    CountryInfo { alpha2: "BD", alpha3: "BGD", en: "Bangladesh", ja: "バングラデシュ", vi: "Bangladesh", calling_code: "+880", aliases: "bangladeshi" },
    CountryInfo { alpha2: "LK", alpha3: "LKA", en: "Sri Lanka", ja: "スリランカ", vi: "Sri Lanka", calling_code: "+94", aliases: "sri lankan" },
    CountryInfo { alpha2: "NP", alpha3: "NPL", en: "Nepal", ja: "ネパール", vi: "Nepal", calling_code: "+977", aliases: "nepali|nepalese" },
    CountryInfo { alpha2: "MN", alpha3: "MNG", en: "Mongolia", ja: "モンゴル", vi: "Mông Cổ", calling_code: "+976", aliases: "mongolian" },
    CountryInfo { alpha2: "UZ", alpha3: "UZB", en: "Uzbekistan", ja: "ウズベキスタン", vi: "Uzbekistan", calling_code: "+998", aliases: "uzbek" },
    CountryInfo { alpha2: "KZ", alpha3: "KAZ", en: "Kazakhstan", ja: "カザフスタン", vi: "Kazakhstan", calling_code: "+7", aliases: "kazakh" },
    CountryInfo { alpha2: "AE", alpha3: "ARE", en: "United Arab Emirates", ja: "アラブ首長国連邦", vi: "UAE", calling_code: "+971", aliases: "uae|emirati|émirats arabes unis|emirats arabes unis" },
    CountryInfo { alpha2: "SA", alpha3: "SAU", en: "Saudi Arabia", ja: "サウジアラビア", vi: "Ả Rập Xê Út", calling_code: "+966", aliases: "saudi|arabie saoudite" },
    CountryInfo { alpha2: "QA", alpha3: "QAT", en: "Qatar", ja: "カタール", vi: "Qatar", calling_code: "+974", aliases: "qatari" },
    CountryInfo { alpha2: "BH", alpha3: "BHR", en: "Bahrain", ja: "バーレーン", vi: "Bahrain", calling_code: "+973", aliases: "bahraini|bahreïn|bahrein" },
    CountryInfo { alpha2: "IL", alpha3: "ISR", en: "Israel", ja: "イスラエル", vi: "Israel", calling_code: "+972", aliases: "israeli" },
    CountryInfo { alpha2: "IR", alpha3: "IRN", en: "Iran", ja: "イラン", vi: "Iran", calling_code: "+98", aliases: "iranian" },
    CountryInfo { alpha2: "EG", alpha3: "EGY", en: "Egypt", ja: "エジプト", vi: "Ai Cập", calling_code: "+20", aliases: "egyptian|égypte|egypte" },
    CountryInfo { alpha2: "MA", alpha3: "MAR", en: "Morocco", ja: "モロッコ", vi: "Ma-rốc", calling_code: "+212", aliases: "moroccan|maroc" },
    CountryInfo { alpha2: "ZA", alpha3: "ZAF", en: "South Africa", ja: "南アフリカ", vi: "Nam Phi", calling_code: "+27", aliases: "south african|afrique du sud" },
    CountryInfo { alpha2: "NG", alpha3: "NGA", en: "Nigeria", ja: "ナイジェリア", vi: "Nigeria", calling_code: "+234", aliases: "nigerian" },
    CountryInfo { alpha2: "KE", alpha3: "KEN", en: "Kenya", ja: "ケニア", vi: "Kenya", calling_code: "+254", aliases: "kenyan" },
];

/// Resolves an ISO-3166 alpha-2 code, alpha-3 code, or localized country/nationality name
/// (`"VNM"`, `"VN"`, `"Vietnam"`, `"ベトナム"`, `"Việt Nam"`, `"JPN"`, `"USA"`, etc.).
pub fn lookup_country(raw: &str) -> Option<&'static CountryInfo> {
    if let Some((head, tail)) = raw.trim().rsplit_once('(').or_else(|| raw.trim().rsplit_once('（')) {
        let inner = tail.trim_end_matches([')', '）']).trim();
        if let Some(found) = lookup_country(inner).or_else(|| lookup_country(head.trim())) {
            return Some(found);
        }
    }
    let mut slash_parts: Vec<&str> = raw.split('/').map(str::trim).filter(|p| !p.is_empty()).collect();
    if slash_parts.len() > 1 {
        slash_parts.reverse();
        return slash_parts.into_iter().find_map(lookup_country);
    }

    let trimmed = raw
        .trim()
        .trim_matches(|c: char| matches!(c, '(' | ')' | '（' | '）' | '[' | ']' | '"' | '\''));
    if trimmed.is_empty() {
        return None;
    }

    let folded = fold(trimmed);
    let folded_clean = folded.trim_matches(|c: char| !c.is_alphanumeric() && c != 'ー');

    for info in COUNTRY_CATALOG {
        if trimmed.eq_ignore_ascii_case(info.alpha2)
            || trimmed.eq_ignore_ascii_case(info.alpha3)
            || trimmed == info.ja
            || trimmed.eq_ignore_ascii_case(info.en)
            || trimmed.eq_ignore_ascii_case(info.vi)
            || folded_clean == fold(info.en)
            || folded_clean == fold(info.vi)
        {
            return Some(info);
        }
        for alias in info.aliases.split('|') {
            if trimmed.eq_ignore_ascii_case(alias) || (!folded_clean.is_empty() && folded_clean == fold(alias)) {
                return Some(info);
            }
        }
    }
    None
}

/// Resolves a `<select>` or dropdown option label/value to its canonical country without
/// substring false positives (so `"US"` never matches `"Australia"`).
pub fn lookup_country_option(option: &str) -> Option<&'static CountryInfo> {
    let trimmed = option.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(exact) = lookup_country(trimmed) {
        return Some(exact);
    }
    for sep in [" - ", " – ", ": ", " | ", "|"] {
        if trimmed.contains(sep) {
            for part in trimmed.split(sep) {
                if let Some(found) = lookup_country(part) {
                    return Some(found);
                }
            }
        }
    }
    if let Some((head, tail)) = trimmed.rsplit_once('(').or_else(|| trimmed.rsplit_once('（')) {
        let code = tail.trim_end_matches([')', '）']).trim();
        if let Some(found) = lookup_country(code).or_else(|| lookup_country(head)) {
            return Some(found);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_in_the_ways_documents_print_them() {
        for (raw, iso) in [
            ("12.08.1983", "1983-08-12"),
            ("30/12/2002", "2002-12-30"),
            ("2002-12-30", "2002-12-30"),
            ("12 AUG 1983", "1983-08-12"),
            ("12 AOÛT 1983", "1983-08-12"),
            ("12. Mär 1983", "1983-03-12"),
            ("Aug 12, 1983", "1983-08-12"),
            ("2026-09", "2026-09"),
            ("09/2026", "2026-09"),
            ("1994年11月8日", "1994-11-08"),
            ("令和5年4月1日", "2023-04-01"),
            ("ngày 30 tháng 12 năm 2002", "2002-12-30"),
            ("12/25/1990", "1990-12-25"),
        ] {
            let got = parse_date(raw);
            assert_eq!(got.as_deref(), Some(iso), "{raw}");
        }
        assert_eq!(parse_date("15/16/17"), None);
        assert_eq!(normalize_value("birth.date", "23 APR /APR 56"), "1956-04-23");
        assert_eq!(normalize_value("id.card.issued", "02.05.24"), "2024-05-02");
    }

    #[test]
    fn amounts_with_their_units_and_separators() {
        for (raw, plain) in [
            ("500万円", "5000000"),
            ("¥ 1,234,567", "1234567"),
            ("28.500.000 đ", "28500000"),
            ("€1.315,50", "1315.5"),
            ("$1,315.50", "1315.5"),
            ("600 triệu đồng", "600000000"),
            ("300,000円", "300000"),
            ("2 992 500", "2992500"),
        ] {
            assert_eq!(parse_amount(raw).as_deref(), Some(plain), "{raw}");
        }
    }

    #[test]
    fn sex_and_nationality_are_written_one_way() {
        assert_eq!(sex("Nam"), Some("male"));
        assert_eq!(sex("女"), Some("female"));
        assert_eq!(sex("F"), Some("female"));
        assert_eq!(nationality("DEUTSCH").as_deref(), Some("DE"));
        assert_eq!(nationality("Việt Nam").as_deref(), Some("VN"));
        assert_eq!(nationality("JPN").as_deref(), Some("JP"));
        assert_eq!(nationality("NLD").as_deref(), Some("NL"));
        assert_eq!(nationality("ФН/CHINESE").as_deref(), Some("CN"));
        assert_eq!(nationality("NORSK/ NORWEGIAN").as_deref(), Some("NO"));
        assert_eq!(sex("V/F"), Some("female"));
        assert_eq!(sex("M/M"), Some("male"));
        assert_eq!(sex("ZIF"), Some("female"));
        assert_eq!(sex("Nữ (Female)"), Some("female"));
        assert_eq!(sex("Nam (Male)"), Some("male"));
        assert_eq!(sex("Male/Female"), None);
        assert_eq!(lookup_country("Việt Nam (Vietnam)").map(|c| c.alpha2), Some("VN"));
        assert_eq!(normalize_value("bank.account.balance", "¥1,923,239"), "1923239");
        assert_eq!(normalize_value("dependent.2.birth.date", "12/06/2018"), "2018-06-12");
        assert_eq!(normalize_value("name.given", "Helvetia4"), "Helvetia");
        assert_eq!(normalize_value("name.family", "[a]MUSTERMANN"), "MUSTERMANN");
        assert_eq!(normalize_value("name.family", "［a］MUSTERMANN"), "MUSTERMANN");
        assert_eq!(normalize_value("name.birth", "［bGABLER"), "GABLER");
        assert_eq!(normalize_value("name.family", "[ a ] MUSTERMANN"), "MUSTERMANN");
    }

    #[test]
    fn a_value_keeps_its_print_when_it_is_not_sure() {
        assert_eq!(normalize_value("work.title", "  Kỹ sư   Chính "), "Kỹ sư Chính");
        assert_eq!(normalize_value("person.sex", "女性"), "女性");
        assert_eq!(comparable("person.sex", "女性"), "female");
        assert_eq!(comparable("person.nationality", "ベトナム"), "ベトナム");
        assert_eq!(comparable("person.nationality", "Deutsch"), "DE");
        assert_eq!(normalize_value("birth.date", "unknown"), "unknown");
        assert_eq!(normalize_value("income.pay_period", "2026-09"), "2026-09");
        assert_eq!(normalize_value("income.pay_date", "28/09/2026"), "2026-09-28");
    }
}
