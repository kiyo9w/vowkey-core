//! Writes a value the way the vault keeps it: dates as ISO, amounts as plain numbers, sex as
//! `male` or `female`, and a nationality as its two-letter country code. Whatever the value is
//! not sure to be is kept as printed.

use icu_normalizer::DecomposingNormalizerBorrowed;

use crate::format::parse_japanese_date;

/// A detail's value as the vault keeps it, from the text printed on the document.
pub fn normalize_value(key: &str, raw: &str) -> String {
    let raw = collapse(raw);
    if raw.is_empty() {
        return raw;
    }
    if key == "income.pay_period" {
        return parse_date(&raw)
            .map(|iso| iso.chars().take(7).collect())
            .unwrap_or(raw);
    }
    if is_date_key(key) {
        return parse_date(&raw).or_else(|| parse_short_year(&raw, key == "birth.date")).unwrap_or(raw);
    }
    if key == "birth.age" {
        let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
        return if digits.is_empty() { raw } else { digits };
    }
    if key.starts_with("income.") {
        return parse_amount(&raw).unwrap_or(raw);
    }
    if key.starts_with("name.") || key.starts_with("emergency.name") || key == "spouse.name" || key.starts_with("family.") {
        return clean_name(&raw);
    }
    match key {
        "id.ssn.last4" => {
            let digits: String = raw.chars().filter(char::is_ascii_digit).collect();
            digits.get(digits.len().saturating_sub(4)..).map_or(raw.clone(), str::to_string)
        }
        "person.sex" => sex(&raw).map_or(raw, str::to_string),
        "person.nationality" => nationality(&raw).unwrap_or(raw),
        _ => raw,
    }
}

/// A name without the marks a scan leaves around it: field markers such as `[a]`, a triangle read
/// as a digit, a stray dash.
fn clean_name(raw: &str) -> String {
    let mut name = raw.trim();
    if name.starts_with('[') {
        let closing = name.char_indices().take(5).find(|(_, c)| *c == ']').map(|(i, _)| i + 1);
        name = name.get(closing.unwrap_or(1)..).unwrap_or(name).trim();
    }
    let edge = |c: char| c.is_ascii_digit() || matches!(c, '[' | ']' | '-' | '_' | '•' | '▲' | '|' | '*' | ',' | ';' | ':');
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
    let last = raw.rsplit('/').next().unwrap_or(raw);
    let word = fold(last.trim());
    if word.chars().count() <= 3 && word.chars().all(|c| c.is_alphabetic() || c == '/') && raw.contains(['/', 'I', 'l']) {
        match word.chars().last() {
            Some('f') => return Some("female"),
            Some('m') => return Some("male"),
            _ => {}
        }
    }
    let word = word.trim_matches(|c: char| !c.is_alphanumeric() && !('\u{3040}'..='\u{9fff}').contains(&c));
    match word {
        "m" | "male" | "man" | "masculin" | "masculino" | "maschio" | "manlijk" | "nam" | "mannlich" | "mannlich/m"
        | "男" | "남" | "男性" | "homme" | "hombre" | "uomo" | "mezczyzna" | "muz" | "mand" | "mann" | "h" | "v" => {
            Some("male")
        }
        "f" | "female" | "woman" | "feminin" | "femenino" | "femmina" | "vrouwelijk" | "nu" | "weiblich" | "w"
        | "女" | "여" | "女性" | "femme" | "mujer" | "donna" | "kobieta" | "zena" | "kvinde" | "kvinne" => {
            Some("female")
        }
        _ => None,
    }
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
        assert_eq!(normalize_value("name.given", "Helvetia4"), "Helvetia");
        assert_eq!(normalize_value("name.family", "[a]MUSTERMANN"), "MUSTERMANN");
    }

    #[test]
    fn a_value_keeps_its_print_when_it_is_not_sure() {
        assert_eq!(normalize_value("work.title", "  Kỹ sư   Chính "), "Kỹ sư Chính");
        assert_eq!(normalize_value("birth.date", "unknown"), "unknown");
        assert_eq!(normalize_value("income.pay_period", "2026-09"), "2026-09");
        assert_eq!(normalize_value("income.pay_date", "28/09/2026"), "2026-09-28");
    }
}
