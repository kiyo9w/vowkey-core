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
