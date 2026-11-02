//! Formats a canonical ISO date into the shape a birth, issue or expiry control asks for.
//!
//! Chromium (`AutofillField::format_string`, `data_util::FormatDate`) stores one format string
//! per field. `<input type="date">` is `YYYY-MM-DD` and `<input type="month">` is `YYYY-MM`. A
//! text control contributes a format only when its placeholder, format hint or pattern contains
//! one: `YYYY`/`YY`, `MM`/`M`, `DD`/`D`, joined by `-`, `/`, `.` or space. Year letters follow
//! Chromium's card-expiry set (`Y`, `A`, `J`) plus Bitwarden's Danish, Russian and Portuguese
//! letters. `年`, `月` and `日` are the Japanese year, month and day marks. An eight-digit value
//! is emitted only when that guidance states the order.
//!
//! Japanese era text stays in `format::to_wareki`. A wareki control returns `None`.

use crate::matcher::FormFieldInput;

/// Formats `value`, a canonical `YYYY-MM-DD` (or `YYYY-MM` when no day is needed), for `field`.
///
/// `attribute` is the canonical detail, or the alias the matcher passes for a split control
/// (`birth.date.year`, `birth.date.month`, `birth.date.day`). `None` means this value is not a
/// date the control can format, or the control does not say how; the caller keeps `value`.
pub fn format_date_value(field: &FormFieldInput, attribute: &str, value: &str) -> Option<String> {
    let mut part = date_part(attribute)?;
    if is_wareki(field) {
        return None;
    }
    let date = parse_iso(value)?;
    if part == Part::Full
        && let Some(single) = inferred_single_part(field)
    {
        part = single;
    }
    let format = detect_format(field, part)?;
    render(&date, &format, part)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Part {
    Full,
    Year,
    Month,
    Day,
}

struct IsoDate {
    year: u16,
    month: u8,
    day: Option<u8>,
}

#[derive(Clone, Copy)]
enum Token {
    Year(u8),
    Month(u8),
    Day(u8),
}

struct Format {
    tokens: Vec<Token>,
    /// Text between tokens. Its length is one less than `tokens`.
    gaps: Vec<String>,
    /// A trailing Japanese mark such as `日`, when the format has one.
    suffix: String,
}

fn date_part(attribute: &str) -> Option<Part> {
    let tail = attribute.rsplit('.').next().unwrap_or(attribute);
    if matches!(tail, "date" | "issued" | "expiry") || tail.ends_with("_date") {
        return Some(Part::Full);
    }
    match tail {
        "year" => Some(Part::Year),
        "month" => Some(Part::Month),
        "day" => Some(Part::Day),
        _ => None,
    }
}

/// Detects when a short or select control mapped to a canonical `*.date` attribute actually asks for
/// only `Day`, `Month`, or `Year` (such as `4-dateDay`, `4-dateMonth`, `4-dateYear`).
fn inferred_single_part(field: &FormFieldInput) -> Option<Part> {
    let kind = field.input_type.trim().to_ascii_lowercase();
    let short_box = (1..=4).contains(&field.max_length) || kind == "select-one";
    if !short_box {
        return None;
    }
    for id_source in [&field.name, &field.id] {
        if let Some(p) = single_unit_in_identifier(id_source) {
            return Some(p);
        }
    }
    single_unit_in_label(&field.label).or_else(|| single_unit_in_label(&field.placeholder))
}

fn single_unit_in_identifier(raw: &str) -> Option<Part> {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }
    let has_day = lower.ends_with("day") || lower.contains("_day") || lower.contains("-day");
    let has_month = lower.ends_with("month")
        || lower.ends_with("mon")
        || lower.contains("_month")
        || lower.contains("-month");
    let has_year = lower.ends_with("year")
        || lower.ends_with("yr")
        || lower.contains("_year")
        || lower.contains("-year");
    match (has_day, has_month, has_year) {
        (true, false, false) => Some(Part::Day),
        (false, true, false) => Some(Part::Month),
        (false, false, true) => Some(Part::Year),
        _ => None,
    }
}

fn single_unit_in_label(raw: &str) -> Option<Part> {
    let clean = raw
        .trim()
        .trim_matches(|c: char| !c.is_alphanumeric() && !is_jp_mark(c))
        .to_ascii_lowercase();
    match clean.as_str() {
        "day" | "dd" | "jour" | "tag" | "día" | "dia" | "ngày" | "日" => Some(Part::Day),
        "month" | "mm" | "mois" | "monat" | "mes" | "tháng" | "月" => Some(Part::Month),
        "year" | "yyyy" | "yy" | "année" | "jahr" | "año" | "ano" | "năm" | "年" => Some(Part::Year),
        _ => None,
    }
}

fn is_wareki(field: &FormFieldInput) -> bool {
    let text = format!(
        "{} {} {} {}",
        field.placeholder, field.format, field.pattern, field.label
    );
    ["和暦", "wareki", "昭和", "平成", "令和"].iter().any(|needle| text.contains(needle))
}

fn parse_iso(value: &str) -> Option<IsoDate> {
    let mut parts = value.trim().split('-');
    let year: u16 = parts.next()?.parse().ok()?;
    let month: u8 = parts.next()?.parse().ok()?;
    let day = match parts.next() {
        Some(raw) => Some(raw.parse().ok()?),
        None => None,
    };
    if parts.next().is_some() || !(1..=9999).contains(&year) || !(1..=12).contains(&month) {
        return None;
    }
    if let Some(day) = day
        && (day == 0 || day > days_in_month(year, month))
    {
        return None;
    }
    Some(IsoDate { year, month, day })
}

fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap(year: u16) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fn detect_format(field: &FormFieldInput, part: Part) -> Option<Format> {
    let kind = field.input_type.trim().to_ascii_lowercase();
    if part == Part::Full && matches!(kind.as_str(), "date" | "month") {
        let pattern = if kind == "month" { "YYYY-MM" } else { "YYYY-MM-DD" };
        return parse_format(pattern);
    }
    if let Some(format) = guidance_format(field) {
        return Some(narrow_single_token(format, field.max_length));
    }
    part_format(field, part)
}

/// A two-character box wins over a four-letter placeholder, as Chromium does for `maxlength=2`.
fn narrow_single_token(mut format: Format, max_length: i32) -> Format {
    if max_length == 2 && format.tokens.len() == 1 {
        format.tokens = vec![match format.tokens[0] {
            Token::Year(_) => Token::Year(2),
            Token::Month(_) => Token::Month(2),
            Token::Day(_) => Token::Day(2),
        }];
    }
    format
}

fn guidance_format(field: &FormFieldInput) -> Option<Format> {
    [&field.placeholder, &field.format, &field.pattern]
        .into_iter()
        .find_map(|source| scan_format(source).or_else(|| scan_spelled_order(source)))
        .or_else(|| scan_label_format(&field.label))
}

/// Scans a human-facing label for an explicit 3-part `Y`/`M`/`D` format (such as `(mm/dd/yyyy)`,
/// `(YYYY/MM/DD)`, `DD MM YYYY`, `(DD-MM-YYYY)`) or spelled-out `day-month-year` order, bounded by
/// non-letters so ordinary words (`My`, `May`, `生年月日`) are never mistaken for format strings.
fn scan_label_format(label: &str) -> Option<Format> {
    if let Some(spelled) = scan_spelled_order(label) {
        return Some(spelled);
    }
    let chars: Vec<char> = label.chars().collect();
    let is_strict_ymd = |c: char| matches!(c.to_ascii_uppercase(), 'Y' | 'M' | 'D');
    let mut i = 0;
    while i < chars.len() {
        let prev_alpha = i > 0 && chars[i - 1].is_alphabetic();
        if !prev_alpha && is_strict_ymd(chars[i]) {
            let mut end = i + 1;
            while end < chars.len() && (is_strict_ymd(chars[end]) || is_latin_gap(chars[end])) {
                end += 1;
            }
            let mut trim = end;
            while trim > i && is_latin_gap(chars[trim - 1]) {
                trim -= 1;
            }
            let next_alpha = trim < chars.len() && chars[trim].is_alphabetic();
            if !next_alpha {
                let candidate: String = chars[i..trim].iter().collect();
                if let Some(fmt) = parse_format(&candidate)
                    && fmt.tokens.len() == 3
                {
                    return Some(fmt);
                }
            }
            i = end.max(i + 1);
        } else {
            i += 1;
        }
    }
    None
}

fn scan_spelled_order(source: &str) -> Option<Format> {
    let lower = source.to_ascii_lowercase();
    for (needle, pattern) in [
        ("day-month-year", "DD-MM-YYYY"),
        ("day/month/year", "DD/MM/YYYY"),
        ("day.month.year", "DD.MM.YYYY"),
        ("day month year", "DD MM YYYY"),
        ("month-day-year", "MM-DD-YYYY"),
        ("month/day/year", "MM/DD/YYYY"),
        ("month day year", "MM DD YYYY"),
        ("year-month-day", "YYYY-MM-DD"),
        ("year/month/day", "YYYY/MM/DD"),
        ("year month day", "YYYY MM DD"),
    ] {
        if lower.contains(needle) {
            return parse_format(pattern);
        }
    }
    None
}

fn scan_format(source: &str) -> Option<Format> {
    let chars: Vec<char> = source.chars().collect();
    let mut start = 0;
    while start < chars.len() {
        if is_token_start(chars[start]) {
            let mut end = start + 1;
            while end < chars.len() && (is_token_start(chars[end]) || is_gap_char(chars[end])) {
                end += 1;
            }
            let mut trim = end;
            while trim > start && is_latin_gap(chars[trim - 1]) {
                trim -= 1;
            }
            let candidate: String = chars[start..trim].iter().collect();
            if let Some(format) = parse_format(&candidate)
                && !unknown_token_follows(&chars, end)
            {
                return Some(format);
            }
            start = end.max(start + 1);
        } else {
            start += 1;
        }
    }
    None
}

/// `JJJJ-MM-TT` is not a date format: the unrecognized `TT` must not leave `YYYY-MM` behind.
fn unknown_token_follows(chars: &[char], mut index: usize) -> bool {
    while index < chars.len() && is_latin_gap(chars[index]) {
        index += 1;
    }
    let rest = &chars[index..];
    let Some(first) = rest.first().copied() else {
        return false;
    };
    if !first.is_alphabetic() || is_token_start(first) {
        return false;
    }
    let run = rest.iter().take_while(|c| same_letter(**c, first)).count();
    (1..=4).contains(&run)
}

fn parse_format(raw: &str) -> Option<Format> {
    let chars: Vec<char> = raw.chars().collect();
    let mut tokens = Vec::new();
    let mut gaps = Vec::new();
    let mut suffix = String::new();
    let mut seen = [false; 3];
    let mut i = 0;
    while i < chars.len() {
        let (token, taken) = take_token(&chars, i)?;
        let slot = match token {
            Token::Year(_) => 0,
            Token::Month(_) => 1,
            Token::Day(_) => 2,
        };
        if seen[slot] {
            return None;
        }
        seen[slot] = true;
        tokens.push(token);
        i += taken as usize;
        let gap_start = i;
        if i < chars.len() && jp_mark(token) == Some(chars[i]) {
            i += 1;
        }
        while i < chars.len() && is_latin_gap(chars[i]) {
            i += 1;
        }
        if i == chars.len() {
            suffix = chars[gap_start..].iter().collect();
            break;
        }
        if i == gap_start {
            if take_token(&chars, i).is_none() {
                return None;
            }
            gaps.push(String::new());
            continue;
        }
        gaps.push(chars[gap_start..i].iter().collect());
    }
    if tokens.is_empty() || gaps.len() + 1 != tokens.len() {
        return None;
    }
    if suffix.chars().any(|c| !is_jp_mark(c)) {
        return None;
    }
    let bare: Vec<String> = gaps.iter().map(|gap| gap.chars().filter(|c| !is_jp_mark(*c)).collect()).collect();
    if bare.windows(2).any(|pair| pair[0] != pair[1]) {
        return None;
    }
    let compact = bare.first().is_none_or(String::is_empty) && !gaps.iter().any(|gap| gap.chars().any(is_jp_mark));
    if compact {
        let widths: Vec<u8> = tokens
            .iter()
            .filter_map(|token| match token {
                Token::Month(width) | Token::Day(width) => Some(*width),
                Token::Year(_) => None,
            })
            .collect();
        if widths.len() == 2 && widths[0] != widths[1] {
            return None;
        }
        if widths.iter().any(|width| *width == 1) {
            return None;
        }
    }
    Some(Format { tokens, gaps, suffix })
}

fn take_token(chars: &[char], i: usize) -> Option<(Token, u8)> {
    match chars.get(i).copied() {
        Some('年') => Some((Token::Year(4), 1)),
        Some('月') => Some((Token::Month(2), 1)),
        Some('日') => Some((Token::Day(2), 1)),
        Some(c) => {
            let kind = part_kind(c)?;
            let mut width = 1u8;
            while (i + width as usize) < chars.len() && same_letter(chars[i + width as usize], c) {
                width += 1;
            }
            let token = match (kind, width) {
                ('Y', 2 | 4) => Token::Year(width),
                ('M', 1 | 2) => Token::Month(width),
                ('D', 1 | 2) => Token::Day(width),
                _ => return None,
            };
            Some((token, width))
        }
        None => None,
    }
}

fn part_kind(c: char) -> Option<char> {
    match c {
        'y' | 'Y' | 'a' | 'A' | 'j' | 'J' | 'å' | 'Å' | 'г' | 'Г' | 'r' | 'R' => Some('Y'),
        'm' | 'M' => Some('M'),
        'd' | 'D' => Some('D'),
        _ => None,
    }
}

fn jp_mark(token: Token) -> Option<char> {
    match token {
        Token::Year(_) => Some('年'),
        Token::Month(_) => Some('月'),
        Token::Day(_) => Some('日'),
    }
}

fn is_jp_mark(c: char) -> bool {
    matches!(c, '年' | '月' | '日')
}

fn is_token_start(c: char) -> bool {
    part_kind(c).is_some() || is_jp_mark(c)
}

fn is_gap_char(c: char) -> bool {
    is_latin_gap(c) || is_jp_mark(c)
}

fn is_latin_gap(c: char) -> bool {
    matches!(c, '-' | '/' | '.' | ' ')
}

fn same_letter(a: char, b: char) -> bool {
    a == b || a.to_ascii_lowercase() == b.to_ascii_lowercase()
}

/// One date part, when the control gives no format string. For a full-date 8-character comb box
/// without separators, emit 8 digits in the order the field's language convention implies.
fn part_format(field: &FormFieldInput, part: Part) -> Option<Format> {
    let token = match part {
        Part::Year => Token::Year(if field.max_length == 2 { 2 } else { 4 }),
        Part::Month => Token::Month(if field.max_length == 2 { 2 } else { 1 }),
        Part::Day => Token::Day(if field.max_length == 2 { 2 } else { 1 }),
        Part::Full => {
            if field.max_length == 8 {
                let lower = format!("{} {} {}", field.label, field.name, field.id).to_lowercase();
                let dmy = [
                    "né",
                    "naissance",
                    "geburts",
                    "nacim",
                    "nascim",
                    "nascita",
                    "ngày",
                    "ddmmyyyy",
                ]
                .iter()
                .any(|w| lower.contains(w));
                let mdy = ["mmddyyyy", "month/day"].iter().any(|w| lower.contains(w));
                let ymd = ["生年月日", "出生", "생년월일", "yyyymmdd"]
                    .iter()
                    .any(|w| lower.contains(w));
                let tokens = if dmy {
                    vec![Token::Day(2), Token::Month(2), Token::Year(4)]
                } else if mdy {
                    vec![Token::Month(2), Token::Day(2), Token::Year(4)]
                } else if ymd {
                    vec![Token::Year(4), Token::Month(2), Token::Day(2)]
                } else {
                    return None;
                };
                return Some(Format {
                    tokens,
                    gaps: vec![String::new(), String::new()],
                    suffix: String::new(),
                });
            }
            return None;
        }
    };
    Some(Format { tokens: vec![token], gaps: Vec::new(), suffix: String::new() })
}

fn render(date: &IsoDate, format: &Format, part: Part) -> Option<String> {
    let selected: Vec<usize> = format
        .tokens
        .iter()
        .enumerate()
        .filter(|(_, token)| {
            matches!(
                (part, token),
                (Part::Full, _)
                    | (Part::Year, Token::Year(_))
                    | (Part::Month, Token::Month(_))
                    | (Part::Day, Token::Day(_))
            )
        })
        .map(|(index, _)| index)
        .collect();
    if selected.is_empty() {
        return None;
    }
    let mut out = String::new();
    for (nth, index) in selected.iter().copied().enumerate() {
        if nth > 0 {
            out.push_str(&format.gaps[index - 1]);
        }
        match format.tokens[index] {
            Token::Year(4) => out.push_str(&format!("{:04}", date.year)),
            Token::Year(2) => out.push_str(&format!("{:02}", date.year % 100)),
            Token::Year(_) => return None,
            Token::Month(2) => out.push_str(&format!("{:02}", date.month)),
            Token::Month(_) => out.push_str(&date.month.to_string()),
            Token::Day(2) => {
                let day = date.day?;
                out.push_str(&format!("{day:02}"));
            }
            Token::Day(_) => out.push_str(&date.day?.to_string()),
        }
    }
    if part == Part::Full {
        out.push_str(&format.suffix);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(
        input_type: &str,
        placeholder: &str,
        format: &str,
        pattern: &str,
        max_length: i32,
    ) -> FormFieldInput {
        FormFieldInput {
            input_type: input_type.into(),
            placeholder: placeholder.into(),
            format: format.into(),
            pattern: pattern.into(),
            max_length,
            ..FormFieldInput::default()
        }
    }

    #[test]
    fn native_date_and_month_controls_are_iso() {
        let date = field("date", "", "", "", 0);
        assert_eq!(format_date_value(&date, "birth.date", "1998-03-14").as_deref(), Some("1998-03-14"));
        assert_eq!(
            format_date_value(&date, "id.passport.expiry_date", "2000-02-29").as_deref(),
            Some("2000-02-29")
        );
        let month = field("month", "", "", "", 0);
        assert_eq!(format_date_value(&month, "birth.date", "1998-03-14").as_deref(), Some("1998-03"));
    }

    #[test]
    fn guidance_sets_the_order_and_the_padding() {
        let cases = [
            ("YYYY/MM/DD", "1998/03/14"),
            ("DD/MM/YYYY", "14/03/1998"),
            ("MM/DD/YYYY", "03/14/1998"),
            ("DD.MM.YY", "14.03.98"),
            ("YYYY年MM月DD日", "1998年03月14日"),
            ("年/月/日", "1998/03/14"),
            ("D.M.YYYY", "14.3.1998"),
        ];
        for (hint, expected) in cases {
            let control = field("text", hint, "", "", 0);
            assert_eq!(
                format_date_value(&control, "birth.date", "1998-03-14").as_deref(),
                Some(expected),
                "{hint}"
            );
        }
        let from_pattern = field("text", "", "", "DD/MM/YYYY", 0);
        assert_eq!(
            format_date_value(&from_pattern, "issue.date", "2024-01-05").as_deref(),
            Some("05/01/2024")
        );
    }

    #[test]
    fn a_card_expiry_keeps_its_month_and_year() {
        let combined = field("text", "MM/YY", "", "", 0);
        assert_eq!(
            format_date_value(&combined, "card.expiry_date", "2027-03").as_deref(),
            Some("03/27")
        );
        let month = field("text", "", "", "", 0);
        assert_eq!(format_date_value(&month, "card.expiry.month", "2027-03").as_deref(), Some("3"));
        let year = field("text", "", "", "", 2);
        assert_eq!(format_date_value(&year, "card.expiry.year", "2027-03").as_deref(), Some("27"));
        assert_eq!(format_date_value(&combined, "card.expiry.day", "2027-03"), None);
    }

    #[test]
    fn a_split_control_gets_its_own_part() {
        let year = field("text", "", "", "", 4);
        assert_eq!(
            format_date_value(&year, "birth.date.year", "1998-03-14").as_deref(),
            Some("1998")
        );
        let month = field("text", "MM", "", "", 2);
        assert_eq!(
            format_date_value(&month, "birth.date.month", "1998-03-14").as_deref(),
            Some("03")
        );
        let day = field("text", "", "", "", 0);
        assert_eq!(format_date_value(&day, "birth.date.day", "1998-03-14").as_deref(), Some("14"));
        let two_digit_year = field("text", "YYYY", "", "", 2);
        assert_eq!(
            format_date_value(&two_digit_year, "birth.date.year", "1998-03-14").as_deref(),
            Some("98")
        );
    }

    #[test]
    fn eight_digits_need_an_order_and_invalid_dates_stay_put() {
        let hinted = field("text", "YYYYMMDD", "", "", 8);
        assert_eq!(format_date_value(&hinted, "birth.date", "1998-03-14").as_deref(), Some("19980314"));
        let japanese = field("text", "年月日", "", "", 8);
        assert_eq!(format_date_value(&japanese, "birth.date", "1998-03-14").as_deref(), Some("19980314"));
        let bare = field("text", "", "", "", 8);
        assert_eq!(format_date_value(&bare, "birth.date", "1998-03-14"), None);
        let leap = field("date", "", "", "", 0);
        assert_eq!(format_date_value(&leap, "birth.date", "1900-02-29"), None);
        assert_eq!(format_date_value(&leap, "birth.date", "2000-02-29").as_deref(), Some("2000-02-29"));
        assert_eq!(format_date_value(&leap, "birth.date", "1998-04-31"), None);
        assert_eq!(format_date_value(&leap, "name.full", "1998-03-14"), None);
        assert_eq!(format_date_value(&leap, "birth.date", "not-a-date"), None);
        let unknown = field("text", "JJJJ-MM-TT", "", "", 0);
        assert_eq!(format_date_value(&unknown, "birth.date", "1998-03-14"), None);
        let wareki = field("text", "", "和暦", "", 0);
        assert_eq!(format_date_value(&wareki, "birth.date", "1998-03-14"), None);

        let mut us_label = field("text", "", "", "", 0);
        us_label.label = "*Date of Birth (mm/dd/yyyy)".into();
        assert_eq!(format_date_value(&us_label, "birth.date", "1992-07-04").as_deref(), Some("07/04/1992"));

        let mut schengen = field("text", "", "", "", 0);
        schengen.label = "4. Date of birth (day-month-year)".into();
        assert_eq!(format_date_value(&schengen, "birth.date", "1983-08-12").as_deref(), Some("12-08-1983"));

        let mut jp_plain = field("text", "", "", "", 0);
        jp_plain.label = "2 生年月日".into();
        assert_eq!(format_date_value(&jp_plain, "birth.date", "1998-03-14"), None);

        let mut split_day = field("text", "", "", "", 2);
        split_day.name = "4-dateDay".into();
        split_day.label = "Day".into();
        assert_eq!(format_date_value(&split_day, "birth.date", "1992-07-04").as_deref(), Some("04"));

        let mut split_year = field("text", "", "", "", 4);
        split_year.name = "4-dateYear".into();
        split_year.label = "Month Year".into();
        assert_eq!(format_date_value(&split_year, "birth.date", "1992-07-04").as_deref(), Some("1992"));
    }
}
