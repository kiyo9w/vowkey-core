//! Formats profile details into the scripts, calendars and box layouts a form asks for:
//! Japanese eras (和暦), Buddhist Era, full-width and Zengin half-width katakana, hiragana, and
//! split dates, postal codes and phone numbers.

use serde::{Deserialize, Serialize};

/// A Japanese era date (和暦).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[vowkey_ffi::wasm_record]
pub struct WarekiDate {
    /// The kanji era name (`令和`, `平成`, `昭和`, `大正`, `明治`).
    pub era_kanji: String,
    /// The single-letter Latin era code (`R`, `H`, `S`, `T`, `M`).
    pub era_code: String,
    /// The year within the era (`1` for `元年`).
    pub year: u16,
    /// The month (`1` to `12`).
    pub month: u8,
    /// The day (`1` to `31`), when known.
    pub day: Option<u8>,
}

impl WarekiDate {
    /// Formats as `平成9年10月24日` (or `令和元年5月1日` when `year == 1` and `use_gannen` is true).
    pub fn format_kanji(&self, use_gannen: bool) -> String {
        let year_part = if self.year == 1 && use_gannen {
            "元".to_string()
        } else {
            self.year.to_string()
        };
        match self.day {
            Some(day) => format!("{}{}年{}月{}日", self.era_kanji, year_part, self.month, day),
            None => format!("{}{}年{}月", self.era_kanji, year_part, self.month),
        }
    }
}

/// Converts an ISO date (`YYYY-MM-DD` or `YYYY-MM`) to a Japanese era date (和暦).
pub fn to_wareki(iso_date: &str) -> Option<WarekiDate> {
    let mut parts = iso_date.trim().split('-');
    let year: u16 = parts.next()?.parse().ok()?;
    let month: u8 = parts.next()?.parse().ok()?;
    let day: Option<u8> = parts.next().and_then(|d| d.parse().ok());
    let day_for_cmp = day.unwrap_or(1);
    let ymd = (year, month, day_for_cmp);

    let (era_kanji, era_code, base_year) = if ymd >= (2019, 5, 1) {
        ("令和", "R", 2018)
    } else if ymd >= (1989, 1, 8) {
        ("平成", "H", 1988)
    } else if ymd >= (1926, 12, 25) {
        ("昭和", "S", 1925)
    } else if ymd >= (1912, 7, 30) {
        ("大正", "T", 1911)
    } else if ymd >= (1868, 1, 25) {
        ("明治", "M", 1867)
    } else {
        return None;
    };

    Some(WarekiDate {
        era_kanji: era_kanji.to_string(),
        era_code: era_code.to_string(),
        year: year - base_year,
        month,
        day,
    })
}

/// Parses a Japanese date (`令和5年4月1日`, `平成 6 年 11 月 8 日`, `1998年03月14日`) into ISO
/// `YYYY-MM-DD` or `YYYY-MM`.
pub fn parse_japanese_date(input: &str) -> Option<String> {
    let cleaned: String = input
        .chars()
        .map(|c| match c {
            '０'..='９' => char::from_u32(u32::from(c) - u32::from('０') + u32::from('0'))
                .unwrap_or(c),
            _ => c,
        })
        .collect();

    // Remove parenthesized Western year annotations like `(1994年)` so era parsing sees the month.
    let mut stripped = String::with_capacity(cleaned.len());
    let mut depth = 0_u32;
    for ch in cleaned.chars() {
        if ch == '(' || ch == '（' {
            depth += 1;
        } else if ch == ')' || ch == '）' {
            depth = depth.saturating_sub(1);
        } else if depth == 0 {
            stripped.push(ch);
        }
    }

    let era_base = if stripped.contains("令和") {
        Some(2018_u16)
    } else if stripped.contains("平成") {
        Some(1988_u16)
    } else if stripped.contains("昭和") {
        Some(1925_u16)
    } else if stripped.contains("大正") {
        Some(1911_u16)
    } else if stripped.contains("明治") {
        Some(1867_u16)
    } else {
        None
    };

    let mut numbers: Vec<u16> = Vec::new();
    let mut current = String::new();
    for ch in stripped.chars() {
        if ch == '元' && numbers.is_empty() && era_base.is_some() {
            numbers.push(1);
        } else if ch.is_ascii_digit() {
            current.push(ch);
        } else if !current.is_empty() {
            if let Ok(n) = current.parse::<u16>() {
                numbers.push(n);
            }
            current.clear();
        }
    }
    if !current.is_empty() {
        if let Ok(n) = current.parse::<u16>() {
            numbers.push(n);
        }
    }

    let raw_year = *numbers.first()?;
    let year = match era_base {
        Some(base) => base + raw_year,
        None if raw_year >= 1800 => raw_year,
        None => return None,
    };
    let month = *numbers.get(1)?;
    if !(1..=12).contains(&month) {
        return None;
    }
    if let Some(&day) = numbers.get(2) {
        if (1..=31).contains(&day) {
            return Some(format!("{year:04}-{month:02}-{day:02}"));
        }
    }
    Some(format!("{year:04}-{month:02}"))
}

/// Converts hiragana characters in `text` to full-width katakana.
pub fn to_fullwidth_katakana(text: &str) -> String {
    text.chars()
        .map(|c| {
            let code = u32::from(c);
            if (0x3041..=0x3096).contains(&code) {
                char::from_u32(code + 0x60).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

/// Converts full-width katakana characters in `text` to hiragana.
pub fn to_hiragana(text: &str) -> String {
    text.chars()
        .map(|c| {
            let code = u32::from(c);
            if (0x30A1..=0x30F6).contains(&code) {
                char::from_u32(code - 0x60).unwrap_or(c)
            } else {
                c
            }
        })
        .collect()
}

/// Converts Japanese kana to Zengin (全銀システム) half-width katakana, promoting small kana
/// (`ァィゥェォッャュョヮ` -> `ｱｲｳｴｵﾂﾔﾕﾖﾜ`) and decomposing dakuten/handakuten (`ガ` -> `ｶﾞ`).
pub fn to_zengin_halfwidth_kana(text: &str) -> String {
    let katakana = to_fullwidth_katakana(text);
    let mut out = String::with_capacity(katakana.len());
    for ch in katakana.chars() {
        let mapped = match ch {
            ' ' | '　' => " ",
            'ー' | '-' | '－' => "ｰ",
            '・' => "･",
            '（' | '(' => "(",
            '）' | ')' => ")",
            'ア' | 'ァ' => "ｱ",
            'イ' | 'ィ' => "ｲ",
            'ウ' | 'ゥ' => "ｳ",
            'エ' | 'ェ' => "ｴ",
            'オ' | 'ォ' => "ｵ",
            'カ' => "ｶ",
            'キ' => "ｷ",
            'ク' => "ｸ",
            'ケ' => "ｹ",
            'コ' => "ｺ",
            'サ' => "ｻ",
            'シ' => "ｼ",
            'ス' => "ｽ",
            'セ' => "ｾ",
            'ソ' => "ｿ",
            'タ' => "ﾀ",
            'チ' => "ﾁ",
            'ツ' | 'ッ' => "ﾂ",
            'テ' => "ﾃ",
            'ト' => "ﾄ",
            'ナ' => "ﾅ",
            'ニ' => "ﾆ",
            'ヌ' => "ﾇ",
            'ネ' => "ﾈ",
            'ノ' => "ﾉ",
            'ハ' => "ﾊ",
            'ヒ' => "ﾋ",
            'フ' => "ﾌ",
            'ヘ' => "ﾍ",
            'ホ' => "ﾎ",
            'マ' => "ﾏ",
            'ミ' => "ﾐ",
            'ム' => "ﾑ",
            'メ' => "ﾒ",
            'モ' => "ﾓ",
            'ヤ' | 'ャ' => "ﾔ",
            'ユ' | 'ュ' => "ﾕ",
            'ヨ' | 'ョ' => "ﾖ",
            'ラ' => "ﾗ",
            'リ' => "ﾘ",
            'ル' => "ﾙ",
            'レ' => "ﾚ",
            'ロ' => "ﾛ",
            'ワ' | 'ヮ' => "ﾜ",
            'ヲ' => "ｦ",
            'ン' => "ﾝ",
            'ガ' => "ｶﾞ",
            'ギ' => "ｷﾞ",
            'グ' => "ｸﾞ",
            'ゲ' => "ｹﾞ",
            'ゴ' => "ｺﾞ",
            'ザ' => "ｻﾞ",
            'ジ' => "ｼﾞ",
            'ズ' => "ｽﾞ",
            'ゼ' => "ｾﾞ",
            'ゾ' => "ｿﾞ",
            'ダ' => "ﾀﾞ",
            'ヂ' => "ﾁﾞ",
            'ヅ' => "ﾂﾞ",
            'デ' => "ﾃﾞ",
            'ド' => "ﾄﾞ",
            'バ' => "ﾊﾞ",
            'ビ' => "ﾋﾞ",
            'ブ' => "ﾌﾞ",
            'ベ' => "ﾍﾞ",
            'ボ' => "ﾎﾞ",
            'パ' => "ﾊﾟ",
            'ピ' => "ﾋﾟ",
            'プ' => "ﾌﾟ",
            'ペ' => "ﾍﾟ",
            'ポ' => "ﾎﾟ",
            'ヴ' => "ｳﾞ",
            other => {
                out.push(other.to_ascii_uppercase());
                continue;
            }
        };
        out.push_str(mapped);
    }
    out
}

/// Converts Latin all-caps or mixed-case personal names (`"NGUYEN"`, `"THI LINH"`, `"JEAN-LUC"`,
/// `"O'CONNOR"`) into natural Title Case (`"Nguyen"`, `"Thi Linh"`, `"Jean-Luc"`, `"O'Connor"`).
pub fn title_case_latin_name(text: &str) -> String {
    let mut words = Vec::new();
    for token in text.split_whitespace() {
        let mut word = String::with_capacity(token.len());
        let mut cap_next = true;
        for ch in token.chars() {
            if matches!(ch, '-' | '\'' | '’' | '.') {
                word.push(ch);
                cap_next = true;
            } else if ch.is_alphabetic() {
                if cap_next {
                    for up in ch.to_uppercase() {
                        word.push(up);
                    }
                    cap_next = false;
                } else {
                    for lo in ch.to_lowercase() {
                        word.push(lo);
                    }
                }
            } else {
                word.push(ch);
            }
        }
        if !word.is_empty() {
            words.push(word);
        }
    }
    words.join(" ")
}

/// Converts Japanese katakana or hiragana into Passport / Modified Hepburn Romaji in Title Case
/// (`"ヤマダ タロウ"` -> `"Yamada Taro"`, `"イノウエ ユウキ"` -> `"Inoue Yuki"`,
/// `"グエン ティ リン"` -> `"Guen Ti Rin"`).
pub fn kana_to_hepburn(text: &str) -> String {
    let katakana = to_fullwidth_katakana(text);
    let mut words = Vec::new();
    for raw_word in katakana.split(|c: char| c.is_whitespace() || c == '・' || c == '･') {
        let trimmed = raw_word.trim();
        if trimmed.is_empty() {
            continue;
        }
        let romaji = hepburn_word(trimmed);
        if !romaji.is_empty() {
            words.push(title_case_latin_name(&romaji));
        }
    }
    words.join(" ")
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum KanaToken {
    Syllable(&'static str),
    Sokuon,
    Hatsuon,
    Choon,
    Other(char),
}

fn hepburn_word(word: &str) -> String {
    let chars: Vec<char> = word.chars().collect();
    let mut tokens: Vec<KanaToken> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if i + 1 < chars.len() {
            if let Some(digraph) = hepburn_digraph(ch, chars[i + 1]) {
                tokens.push(KanaToken::Syllable(digraph));
                i += 2;
                continue;
            }
        }
        let tok = match ch {
            'ッ' => KanaToken::Sokuon,
            'ン' => KanaToken::Hatsuon,
            'ー' => KanaToken::Choon,
            other => match hepburn_monograph(other) {
                Some(syl) => KanaToken::Syllable(syl),
                None => KanaToken::Other(other),
            },
        };
        tokens.push(tok);
        i += 1;
    }

    let next_syllable = |from: usize, list: &[KanaToken]| -> Option<&'static str> {
        list.get(from..)?
            .iter()
            .find_map(|t| match t {
                KanaToken::Syllable(s) => Some(*s),
                _ => None,
            })
    };

    let mut out = String::new();
    for idx in 0..tokens.len() {
        match tokens[idx] {
            KanaToken::Choon => {}
            KanaToken::Sokuon => {
                if let Some(next) = next_syllable(idx + 1, &tokens) {
                    if next.starts_with("ch") {
                        out.push('t');
                    } else if let Some(first) = next.chars().next() {
                        if first.is_ascii_alphabetic() && !matches!(first, 'a' | 'i' | 'u' | 'e' | 'o') {
                            out.push(first);
                        }
                    }
                }
            }
            KanaToken::Hatsuon => {
                let labial = next_syllable(idx + 1, &tokens)
                    .and_then(|s| s.chars().next())
                    .is_some_and(|c| matches!(c, 'b' | 'm' | 'p'));
                out.push(if labial { 'm' } else { 'n' });
            }
            KanaToken::Syllable("u") => {
                let prev_ends_o_or_u = matches!(out.chars().last(), Some('o' | 'u'));
                let followed_by_pure_vowel = matches!(
                    tokens.get(idx + 1),
                    Some(KanaToken::Syllable("a" | "i" | "u" | "e" | "o"))
                );
                if !(prev_ends_o_or_u && !followed_by_pure_vowel) {
                    out.push('u');
                }
            }
            KanaToken::Syllable("o") => {
                let prev_ends_o = out.ends_with('o');
                let has_more_after = idx + 1 < tokens.len();
                if !(prev_ends_o && has_more_after) {
                    out.push('o');
                }
            }
            KanaToken::Syllable(syl) => out.push_str(syl),
            KanaToken::Other(ch) => out.push(ch),
        }
    }
    out
}

fn hepburn_digraph(c1: char, c2: char) -> Option<&'static str> {
    Some(match (c1, c2) {
        ('キ', 'ャ') => "kya",
        ('キ', 'ュ') => "kyu",
        ('キ', 'ョ') => "kyo",
        ('キ', 'ェ') => "kye",
        ('ギ', 'ャ') => "gya",
        ('ギ', 'ュ') => "gyu",
        ('ギ', 'ョ') => "gyo",
        ('シ', 'ャ') => "sha",
        ('シ', 'ュ') => "shu",
        ('シ', 'ョ') => "sho",
        ('シ', 'ェ') => "she",
        ('ジ', 'ャ') | ('ヂ', 'ャ') => "ja",
        ('ジ', 'ュ') | ('ヂ', 'ュ') => "ju",
        ('ジ', 'ョ') | ('ヂ', 'ョ') => "jo",
        ('ジ', 'ェ') => "je",
        ('チ', 'ャ') => "cha",
        ('チ', 'ュ') => "chu",
        ('チ', 'ョ') => "cho",
        ('チ', 'ェ') => "che",
        ('ニ', 'ャ') => "nya",
        ('ニ', 'ュ') => "nyu",
        ('ニ', 'ョ') => "nyo",
        ('ヒ', 'ャ') => "hya",
        ('ヒ', 'ュ') => "hyu",
        ('ヒ', 'ョ') => "hyo",
        ('ビ', 'ャ') => "bya",
        ('ビ', 'ュ') => "byu",
        ('ビ', 'ョ') => "byo",
        ('ピ', 'ャ') => "pya",
        ('ピ', 'ュ') => "pyu",
        ('ピ', 'ョ') => "pyo",
        ('ミ', 'ャ') => "mya",
        ('ミ', 'ュ') => "myu",
        ('ミ', 'ョ') => "myo",
        ('リ', 'ャ') => "rya",
        ('リ', 'ュ') => "ryu",
        ('リ', 'ョ') => "ryo",
        ('テ', 'ィ') => "ti",
        ('デ', 'ィ') => "di",
        ('ト', 'ゥ') => "tu",
        ('ド', 'ゥ') => "du",
        ('テ', 'ュ') => "tyu",
        ('デ', 'ュ') => "dyu",
        ('フ', 'ァ') => "fa",
        ('フ', 'ィ') => "fi",
        ('フ', 'ェ') => "fe",
        ('フ', 'ォ') => "fo",
        ('フ', 'ュ') => "fyu",
        ('ヴ', 'ァ') => "va",
        ('ヴ', 'ィ') => "vi",
        ('ヴ', 'ェ') => "ve",
        ('ヴ', 'ォ') => "vo",
        ('ヴ', 'ュ') => "vyu",
        ('ウ', 'ィ') => "wi",
        ('ウ', 'ェ') => "we",
        ('ウ', 'ォ') => "wo",
        ('ク', 'ァ') => "kwa",
        ('ク', 'ィ') => "kwi",
        ('ク', 'ェ') => "kwe",
        ('ク', 'ォ') => "kwo",
        ('グ', 'ァ') => "gwa",
        ('ツ', 'ァ') => "tsa",
        ('ツ', 'ィ') => "tsi",
        ('ツ', 'ェ') => "tse",
        ('ツ', 'ォ') => "tso",
        ('ス', 'ィ') => "si",
        ('ズ', 'ィ') => "zi",
        ('イ', 'ェ') => "ye",
        _ => return None,
    })
}

fn hepburn_monograph(ch: char) -> Option<&'static str> {
    Some(match ch {
        'ア' | 'ァ' => "a",
        'イ' | 'ィ' => "i",
        'ウ' | 'ゥ' => "u",
        'エ' | 'ェ' => "e",
        'オ' | 'ォ' => "o",
        'カ' => "ka",
        'キ' => "ki",
        'ク' => "ku",
        'ケ' => "ke",
        'コ' => "ko",
        'ガ' => "ga",
        'ギ' => "gi",
        'グ' => "gu",
        'ゲ' => "ge",
        'ゴ' => "go",
        'サ' => "sa",
        'シ' => "shi",
        'ス' => "su",
        'セ' => "se",
        'ソ' => "so",
        'ザ' => "za",
        'ジ' | 'ヂ' => "ji",
        'ズ' | 'ヅ' => "zu",
        'ゼ' => "ze",
        'ゾ' => "zo",
        'タ' => "ta",
        'チ' => "chi",
        'ツ' => "tsu",
        'テ' => "te",
        'ト' => "to",
        'ダ' => "da",
        'デ' => "de",
        'ド' => "do",
        'ナ' => "na",
        'ニ' => "ni",
        'ヌ' => "nu",
        'ネ' => "ne",
        'ノ' => "no",
        'ハ' => "ha",
        'ヒ' => "hi",
        'フ' => "fu",
        'ヘ' => "he",
        'ホ' => "ho",
        'バ' => "ba",
        'ビ' => "bi",
        'ブ' => "bu",
        'ベ' => "be",
        'ボ' => "bo",
        'パ' => "pa",
        'ピ' => "pi",
        'プ' => "pu",
        'ペ' => "pe",
        'ポ' => "po",
        'マ' => "ma",
        'ミ' => "mi",
        'ム' => "mu",
        'メ' => "me",
        'モ' => "mo",
        'ヤ' | 'ャ' => "ya",
        'ユ' | 'ュ' => "yu",
        'ヨ' | 'ョ' => "yo",
        'ラ' => "ra",
        'リ' => "ri",
        'ル' => "ru",
        'レ' => "re",
        'ロ' => "ro",
        'ワ' | 'ヮ' => "wa",
        'ヲ' => "o",
        'ヴ' => "vu",
        _ => return None,
    })
}

/// Decomposed international (E.164) phone number with its ITU calling code and domestic form.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhoneParts {
    /// Calling code with leading `+` (e.g. `"+81"`, `"+84"`, `"+1"`).
    pub country_code: String,
    /// Calling code digits without `+` (e.g. `"81"`, `"84"`, `"1"`).
    pub calling_digits: String,
    /// Subscriber number without trunk prefix (e.g. `"9012345678"`).
    pub subscriber_digits: String,
    /// Domestic number as dialed inside the country (e.g. `"09012345678"` or `"4155552671"`).
    pub national_digits: String,
}

impl PhoneParts {
    /// Formats the domestic number with standard group hyphens (`"090-1234-5678"`,
    /// `"091-234-5678"`, `"415-555-2671"`).
    pub fn national_hyphenated(&self) -> String {
        let d = &self.national_digits;
        match (self.calling_digits.as_str(), d.len()) {
            ("81", 11) | ("82", 11) => format!("{}-{}-{}", &d[0..3], &d[3..7], &d[7..11]),
            ("81", 10) if d.starts_with("03") || d.starts_with("06") => {
                format!("{}-{}-{}", &d[0..2], &d[2..6], &d[6..10])
            }
            ("81", 10) | ("82", 10) | ("84", 10) | ("66", 10) => {
                format!("{}-{}-{}", &d[0..3], &d[3..6], &d[6..10])
            }
            ("886", 10) => format!("{}-{}-{}", &d[0..4], &d[4..7], &d[7..10]),
            ("1", 10) => format!("{}-{}-{}", &d[0..3], &d[3..6], &d[6..10]),
            (_, 11) if d.starts_with('0') => format!("{}-{}-{}", &d[0..3], &d[3..7], &d[7..11]),
            (_, 10) if d.starts_with('0') => format!("{}-{}-{}", &d[0..3], &d[3..6], &d[6..10]),
            (_, 10) => format!("{}-{}-{}", &d[0..3], &d[3..6], &d[6..10]),
            _ => d.clone(),
        }
    }
}

/// Calling codes (`digits`, `uses_domestic_trunk_zero`) ordered from 3 digits down to 1 digit.
const ITU_CALLING_CODES: &[(&str, bool)] = &[
    ("886", true),
    ("880", true),
    ("856", true),
    ("855", true),
    ("853", false),
    ("852", false),
    ("977", false),
    ("974", false),
    ("973", false),
    ("972", true),
    ("971", true),
    ("966", true),
    ("421", true),
    ("420", false),
    ("380", true),
    ("358", true),
    ("354", false),
    ("353", true),
    ("352", false),
    ("351", false),
    ("254", true),
    ("234", true),
    ("98", true),
    ("94", true),
    ("92", true),
    ("91", false),
    ("90", true),
    ("86", false),
    ("84", true),
    ("82", true),
    ("81", true),
    ("66", true),
    ("65", false),
    ("64", true),
    ("63", true),
    ("62", true),
    ("61", true),
    ("60", true),
    ("57", false),
    ("56", false),
    ("55", false),
    ("54", false),
    ("52", false),
    ("51", false),
    ("49", true),
    ("48", false),
    ("47", false),
    ("46", true),
    ("45", false),
    ("44", true),
    ("43", true),
    ("41", true),
    ("40", true),
    ("39", false),
    ("36", true),
    ("34", false),
    ("33", true),
    ("32", true),
    ("31", true),
    ("30", false),
    ("27", true),
    ("20", true),
    ("7", false),
    ("1", false),
];

/// Parses an E.164 / international phone string (`"+81 90 1234 5678"`, `"+84-91-234-5678"`,
/// `"+1 (415) 555-2671"`) into calling code and domestic trunk components.
pub fn parse_e164_phone(raw: &str) -> Option<PhoneParts> {
    let normalized: String = raw
        .trim()
        .chars()
        .map(|c| match c {
            '０'..='９' => char::from_u32(u32::from(c) - u32::from('０') + u32::from('0'))
                .unwrap_or(c),
            '＋' => '+',
            _ => c,
        })
        .collect();

    let trimmed = normalized.trim_start();
    let after_prefix = if let Some(rest) = trimmed.strip_prefix('+') {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("00") {
        let digits_count = rest.chars().filter(char::is_ascii_digit).count();
        if digits_count < 9 {
            return None;
        }
        rest
    } else {
        return None;
    };

    // Strip an optional "(0)" trunk annotation right after the calling code, e.g. "+81 (0)90...".
    let cleaned = after_prefix.replace("(0)", "");
    let digits: String = cleaned.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 7 {
        return None;
    }

    let (cc, trunk_zero) = ITU_CALLING_CODES
        .iter()
        .copied()
        .find(|(code, _)| digits.starts_with(code) && digits.len() > code.len() + 5)?;

    let rest = &digits[cc.len()..];
    let subscriber = if trunk_zero {
        rest.strip_prefix('0').unwrap_or(rest)
    } else {
        rest
    };
    if subscriber.len() < 6 {
        return None;
    }
    let national = if trunk_zero {
        format!("0{subscriber}")
    } else {
        subscriber.to_string()
    };

    Some(PhoneParts {
        country_code: format!("+{cc}"),
        calling_digits: cc.to_string(),
        subscriber_digits: subscriber.to_string(),
        national_digits: national,
    })
}
