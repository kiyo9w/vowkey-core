use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Piece {
    pub text: String,
    pub page: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageReading {
    pub index: usize,
    pub width: f64,
    pub height: f64,
    pub aspect: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsure: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
    pub pieces: Vec<Piece>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiecesOutput {
    pub text: String,
    pub page_count: usize,
    pub pages: Vec<PageReading>,
    pub pieces: Vec<Piece>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifyOutput {
    pub kind: String,
    pub interactive_field_count: usize,
    pub widgets: usize,
    pub page_count: usize,
    pub form_signals: usize,
    pub doc_signals: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xfa_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub key: String,
    pub name: String,
    pub tooltip: String,
    pub label: String,
    pub section: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub page: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub max_length: usize,
    pub options: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comb_cells: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_slots: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormOutput {
    pub page_count: usize,
    pub interactive: bool,
    pub fields: Vec<FormField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xfa_only: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontOutput {
    pub app: String,
    pub bundle_id: String,
    pub window_title: String,
    pub title: String,
    pub url: String,
    pub file_path: String,
    pub document: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FillOutput {
    pub filled: usize,
    pub output: String,
}

#[derive(Debug, Clone)]
pub struct ChoiceMark {
    pub option: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone)]
pub struct SubSlot {
    pub x: f64,
    pub w: f64,
}

#[derive(Debug, Clone)]
pub struct ParsedBoxKey {
    pub page: usize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub comb: Option<usize>,
    pub slots: Option<Vec<SubSlot>>,
    pub choices: Option<Vec<ChoiceMark>>,
}

const EQUIVALENCE_GROUPS: &[&[&str]] = &[
    &[
        "f", "female", "女", "女性", "nữ", "nu", "féminin", "feminin", "weiblich", "femenino",
        "femmina",
    ],
    &[
        "m",
        "male",
        "男",
        "男性",
        "nam",
        "masculin",
        "männlich",
        "masculino",
        "maschio",
    ],
    &[
        "yes", "true", "1", "on", "有", "あり", "có", "ja", "oui", "sí", "si",
    ],
    &[
        "no", "false", "0", "off", "無", "なし", "không", "khong", "nein", "non",
    ],
    &[
        "married",
        "既婚",
        "配偶者あり",
        "verheiratet",
        "marié",
        "mariée",
        "casado",
        "casada",
        "đã kết hôn",
    ],
    &[
        "single",
        "unmarried",
        "未婚",
        "独身",
        "配偶者なし",
        "ledig",
        "célibataire",
        "soltero",
        "soltera",
        "độc thân",
    ],
    &[
        "vnm",
        "vn",
        "vietnam",
        "viet nam",
        "việt nam",
        "ベトナム",
        "越南",
    ],
    &["jpn", "jp", "japan", "nippon", "japon", "日本", "日本国"],
    &[
        "usa",
        "us",
        "united states",
        "united states of america",
        "アメリカ",
        "米国",
    ],
    &[
        "kor",
        "kr",
        "korea",
        "south korea",
        "republic of korea",
        "韓国",
        "대한민국",
    ],
    &["chn", "cn", "china", "中国", "中華人民共和国"],
    &["twn", "tw", "taiwan", "台湾"],
];

pub fn matches_widget_option(raw_value: &str, candidates: &[String]) -> bool {
    let norm = raw_value.trim().to_lowercase();
    if norm.is_empty() {
        return false;
    }
    let cleaned: Vec<String> = candidates
        .iter()
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty())
        .collect();
    if cleaned.iter().any(|c| c == &norm) {
        return true;
    }
    for group in EQUIVALENCE_GROUPS {
        if group.contains(&norm.as_str())
            && cleaned.iter().any(|cand| group.contains(&cand.as_str()))
        {
            return true;
        }
    }
    false
}

pub fn match_choice_mark<'a>(raw_value: &str, choices: &'a [ChoiceMark]) -> Option<&'a ChoiceMark> {
    let norm = raw_value.trim().to_lowercase();
    if norm.is_empty() {
        return None;
    }
    if let Some(exact) = choices
        .iter()
        .find(|c| c.option.trim().to_lowercase() == norm)
    {
        return Some(exact);
    }
    for group in EQUIVALENCE_GROUPS {
        if group.contains(&norm.as_str()) {
            if let Some(hit) = choices
                .iter()
                .find(|c| group.contains(&c.option.trim().to_lowercase().as_str()))
            {
                return Some(hit);
            }
        }
    }
    None
}

pub fn parse_box_key(key: &str) -> Option<ParsedBoxKey> {
    let parts: Vec<&str> = key.split(':').collect();
    if parts.len() < 6 || *parts.first()? != "box" {
        return None;
    }
    let page = parts.get(1)?.parse::<usize>().ok()?;
    let x = parts.get(2)?.parse::<f64>().ok()?;
    let y = parts.get(3)?.parse::<f64>().ok()?;
    let w = parts.get(4)?.parse::<f64>().ok()?;
    let h = parts.get(5)?.parse::<f64>().ok()?;

    let mut comb = None;
    let mut slots = None;
    let mut choices = None;

    if let (Some(&tag), Some(&payload)) = (parts.get(6), parts.get(7)) {
        match tag {
            "comb" => {
                if let Ok(cells) = payload.parse::<usize>() {
                    if cells > 1 {
                        comb = Some(cells);
                    }
                }
            }
            "slots" => {
                let parsed: Vec<SubSlot> = payload
                    .split(';')
                    .filter_map(|item| {
                        let mut pair = item.split(',');
                        let sx = pair.next()?.parse::<f64>().ok()?;
                        let sw = pair.next()?.parse::<f64>().ok()?;
                        (sw > 0.0).then_some(SubSlot { x: sx, w: sw })
                    })
                    .collect();
                if !parsed.is_empty() {
                    slots = Some(parsed);
                }
            }
            "choices" => {
                let parsed: Vec<ChoiceMark> = payload
                    .split(';')
                    .filter_map(|item| {
                        let (opt, coords_str) = item.split_once('@')?;
                        let mut coords = coords_str.split(',');
                        let cx = coords.next()?.parse::<f64>().ok()?;
                        let cy = coords.next()?.parse::<f64>().ok()?;
                        let cw = coords.next()?.parse::<f64>().ok()?;
                        let ch = coords.next()?.parse::<f64>().ok()?;
                        (cw > 0.0 && ch > 0.0).then_some(ChoiceMark {
                            option: opt.to_string(),
                            x: cx,
                            y: cy,
                            w: cw,
                            h: ch,
                        })
                    })
                    .collect();
                if !parsed.is_empty() {
                    choices = Some(parsed);
                }
            }
            _ => {}
        }
    }

    Some(ParsedBoxKey {
        page,
        x,
        y,
        w,
        h,
        comb,
        slots,
        choices,
    })
}

pub fn comb_characters(value: &str, cells: usize) -> Vec<char> {
    let no_spaces: Vec<char> = value.chars().filter(|c| !c.is_whitespace()).collect();
    if no_spaces.len() <= cells {
        return no_spaces;
    }
    let alnum: Vec<char> = no_spaces
        .iter()
        .copied()
        .filter(|c| !"-/.–—()".contains(*c))
        .collect();
    if !alnum.is_empty() && alnum.len() <= cells {
        alnum
    } else {
        no_spaces
    }
}

pub fn segmented_parts(value: &str, slots: &[SubSlot]) -> Option<Vec<String>> {
    if slots.len() < 2 {
        return None;
    }
    let parts: Vec<String> = value
        .split(['年', '月', '日', '/', '／', '-', 'ー', '.'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if parts.len() != slots.len() {
        if slots.len() == 3 {
            let digits: Vec<char> = value.chars().filter(char::is_ascii_digit).collect();
            if digits.len() == 8 {
                let first4: String = digits.iter().take(4).collect();
                let last4: String = digits.iter().skip(4).take(4).collect();
                let f4 = first4.parse::<u32>().unwrap_or(0);
                let l4 = last4.parse::<u32>().unwrap_or(0);
                if (1850..=2150).contains(&f4) {
                    let y = first4;
                    let m: String = digits.iter().skip(4).take(2).collect();
                    let d: String = digits.iter().skip(6).take(2).collect();
                    let first_w = slots.first().map_or(0.0, |s| s.w);
                    let last_w = slots.get(2).map_or(0.0, |s| s.w);
                    return Some(if first_w < last_w * 0.72 {
                        vec![d, m, y]
                    } else {
                        vec![y, m, d]
                    });
                } else if (1850..=2150).contains(&l4) {
                    let p0: String = digits.iter().take(2).collect();
                    let p1: String = digits.iter().skip(2).take(2).collect();
                    return Some(vec![p0, p1, last4]);
                }
            }
        }
        return None;
    }
    if parts.len() == 3 {
        let p0 = parts.first()?;
        let p1 = parts.get(1)?;
        let p2 = parts.get(2)?;
        let s0 = slots.first()?;
        let s2 = slots.get(2)?;
        if p0.len() == 4
            && p0.chars().all(|c| c.is_ascii_digit())
            && p2.len() <= 2
            && p2.chars().all(|c| c.is_ascii_digit())
            && s0.w < s2.w * 0.72
        {
            return Some(vec![p2.clone(), p1.clone(), p0.clone()]);
        }
    }
    Some(parts)
}

pub fn group_pieces_into_lines(pieces: &[Piece]) -> Vec<String> {
    if pieces.is_empty() {
        return Vec::new();
    }
    let mut sorted = pieces.to_vec();
    sorted.sort_by(|a, b| {
        let ay = a.y + a.h * 0.5;
        let by = b.y + b.h * 0.5;
        ay.partial_cmp(&by).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut rows: Vec<Vec<Piece>> = Vec::new();
    for piece in sorted {
        let placed = if let Some(last_row) = rows.last_mut() {
            if let Some(anchor) = last_row.first() {
                let anchor_mid = anchor.y + anchor.h * 0.5;
                let piece_mid = piece.y + piece.h * 0.5;
                let tol = anchor.h.max(piece.h) * 0.55;
                if (anchor_mid - piece_mid).abs() <= tol {
                    last_row.push(piece.clone());
                    true
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        };
        if !placed {
            rows.push(vec![piece]);
        }
    }

    rows.into_iter()
        .map(|mut row| {
            row.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
            row.into_iter()
                .map(|p| p.text)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.trim().is_empty())
        .collect()
}

pub fn compute_legibility(
    pieces: &[Piece],
    pixel_height: Option<f64>,
    report_empty_unreadable: bool,
) -> (Option<f64>, Option<f64>, Option<String>) {
    let total_chars: usize = pieces
        .iter()
        .map(|p| p.text.chars().filter(|c| !c.is_whitespace()).count())
        .sum();
    if total_chars == 0 {
        if report_empty_unreadable {
            return (Some(1.0), None, Some("unreadable".to_string()));
        }
        return (None, None, None);
    }

    let unsure_chars: usize = pieces
        .iter()
        .filter(|p| p.confidence < 0.5)
        .map(|p| p.text.chars().filter(|c| !c.is_whitespace()).count())
        .sum();
    let unsure_ratio = unsure_chars as f64 / total_chars as f64;

    let mut line_height_px = None;
    if let Some(h_px) = pixel_height {
        let meaningful: Vec<f64> = pieces
            .iter()
            .filter(|p| p.text.chars().any(|c| c.is_alphanumeric()))
            .map(|p| p.h)
            .collect();
        let mut heights: Vec<f64> = if meaningful.is_empty() {
            pieces.iter().map(|p| p.h).collect()
        } else {
            meaningful
        };
        heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        if let Some(&med) = heights.get(heights.len() / 2) {
            line_height_px = Some(med * h_px);
        }
    }

    let diagnostic = if let Some(lh) = line_height_px {
        if lh < 7.0 {
            Some("too_small".to_string())
        } else if unsure_ratio >= 0.5 {
            if lh < 10.0 {
                Some("too_small".to_string())
            } else {
                Some("unreadable".to_string())
            }
        } else {
            None
        }
    } else if unsure_ratio >= 0.5 {
        Some("unreadable".to_string())
    } else {
        None
    };

    (Some(unsure_ratio), line_height_px, diagnostic)
}

fn is_section_heading(text: &str) -> bool {
    let trimmed = text.trim();
    let lower = trimmed.to_lowercase();
    trimmed.starts_with('※')
        || trimmed.starts_with('■')
        || trimmed.starts_with('●')
        || trimmed.starts_with('◆')
        || trimmed.starts_with('▶')
        || lower.starts_with("part ")
        || lower.starts_with("section ")
        || lower.starts_with("mục ")
        || lower.starts_with("phần ")
        || lower.contains("official use only")
        || lower.contains("do not write in this")
        || lower.contains("legal representative")
        || lower.contains("employer information")
        || trimmed.contains("代理人")
        || trimmed.contains("取次者")
        || trimmed.contains("配偶者")
        || trimmed.contains("勤務先")
        || trimmed.contains("所属機関")
        || trimmed.contains("記入しないで")
}

fn parse_inline_choice_cluster(piece: &Piece) -> Option<Vec<ChoiceMark>> {
    let compact: String = piece.text.chars().filter(|c| !c.is_whitespace()).collect();
    let lower = compact.to_lowercase();
    let pair: Option<(&str, &str)> =
        if compact == "男・女" || compact == "男/女" || compact == "男女" {
            Some(("男", "女"))
        } else if compact == "女・男" || compact == "女/男" {
            Some(("女", "男"))
        } else if compact == "有・無" || compact == "有/無" {
            Some(("有", "無"))
        } else if lower == "male/female" || lower == "male・female" || lower == "male-female" {
            Some(("Male", "Female"))
        } else if lower == "female/male" {
            Some(("Female", "Male"))
        } else if lower == "m/f" {
            Some(("M", "F"))
        } else if lower == "nam/nữ" || lower == "nam-nữ" {
            Some(("Nam", "Nữ"))
        } else if lower == "yes/no" || lower == "yes・no" {
            Some(("Yes", "No"))
        } else {
            None
        };

    let (first, second) = pair?;
    let half_w = (piece.w * 0.45).max(0.016);
    let pad_y = (piece.h * 0.14).max(0.002);
    let y = (piece.y - pad_y).max(0.002);
    let h = (piece.h + pad_y * 2.0).min(0.99 - y);
    let left_x = (piece.x - 0.003).max(0.002);
    let right_x = ((piece.x + piece.w - half_w - 0.003).max(left_x + half_w + 0.002)).min(0.98);
    Some(vec![
        ChoiceMark {
            option: first.to_string(),
            x: left_x,
            y,
            w: half_w + 0.006,
            h,
        },
        ChoiceMark {
            option: second.to_string(),
            x: right_x,
            y,
            w: half_w + 0.006,
            h,
        },
    ])
}

fn clean_form_label(raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches([
        '.', '…', '_', '＿', '・', '-', 'ー', '/', '／', ':', '：', '•', ' ',
    ]);
    let without_num = trimmed
        .trim_start_matches(|c: char| c.is_ascii_digit() || ('①'..='⑳').contains(&c))
        .trim_start_matches(['.', ')', ']', ' ']);
    without_num
        .trim_end_matches([
            ' ', ':', '：', '.', '…', '_', '＿', '・', '-', 'ー', '/', '／',
        ])
        .trim()
        .to_string()
}

pub fn detect_visual_form_fields(pieces: &[Piece], page_index: usize) -> Vec<FormField> {
    if pieces.is_empty() {
        return Vec::new();
    }

    let mut expanded: Vec<(Piece, bool)> = Vec::with_capacity(pieces.len());
    for p in pieces {
        if let Some(leader_idx) = p
            .text
            .find("___")
            .or_else(|| p.text.find("..."))
            .or_else(|| p.text.find("……"))
        {
            let prefix = p.text.get(..leader_idx).unwrap_or("").trim();
            if !prefix.is_empty() {
                let ratio = (prefix.chars().count() as f64 / p.text.chars().count().max(1) as f64)
                    .clamp(0.15, 0.72);
                expanded.push((
                    Piece {
                        text: prefix.to_string(),
                        page: p.page,
                        x: p.x,
                        y: p.y,
                        w: (p.w * ratio).max(0.03),
                        h: p.h,
                        confidence: p.confidence,
                    },
                    true,
                ));
                continue;
            }
        }
        expanded.push((p.clone(), false));
    }

    expanded.sort_by(|(a, _), (b, _)| {
        let ay = a.y + a.h * 0.5;
        let by = b.y + b.h * 0.5;
        ay.partial_cmp(&by)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    let mut active_section = String::new();
    let mut fields = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();

    for (idx, (piece, had_leader)) in expanded.iter().enumerate() {
        let raw_trimmed = piece.text.trim();
        if raw_trimmed.is_empty() {
            continue;
        }
        if is_section_heading(raw_trimmed) {
            active_section = raw_trimmed.to_string();
            continue;
        }
        if parse_inline_choice_cluster(piece).is_some() {
            continue;
        }

        let cleaned = clean_form_label(raw_trimmed);
        if cleaned.is_empty()
            || cleaned.chars().count() > 120
            || !cleaned.chars().any(char::is_alphabetic)
            || cleaned.ends_with('。')
            || cleaned.ends_with("ください")
        {
            continue;
        }
        if piece.w > 0.58 && !*had_leader {
            continue;
        }

        let mid_y = piece.y + piece.h * 0.5;
        let row_band = piece.h.max(0.016) * 0.75;

        // Check if an inline choice cluster sits immediately to the right on the same row.
        let mut right_choice: Option<(Vec<ChoiceMark>, f64)> = None;
        let mut next_label_x = 0.94_f64;

        for (other_idx, (other, _)) in expanded.iter().enumerate() {
            if other_idx == idx {
                continue;
            }
            let other_mid_y = other.y + other.h * 0.5;
            if (other_mid_y - mid_y).abs() <= row_band && other.x > piece.x + piece.w - 0.005 {
                if let Some(marks) = parse_inline_choice_cluster(other) {
                    if other.x < next_label_x {
                        right_choice = Some((marks, other.x + other.w));
                    }
                } else if other.x < next_label_x {
                    next_label_x = other.x - 0.008;
                }
            }
        }

        let has_colon = raw_trimmed.ends_with(':') || raw_trimmed.ends_with('：');
        let (slot_x, slot_y, slot_w, slot_h, choice_marks) = if let Some((marks, _)) = right_choice
        {
            let min_x = marks.iter().map(|m| m.x).fold(1.0_f64, f64::min);
            let min_y = marks.iter().map(|m| m.y).fold(1.0_f64, f64::min);
            let max_x = marks.iter().map(|m| m.x + m.w).fold(0.0_f64, f64::max);
            let max_y = marks.iter().map(|m| m.y + m.h).fold(0.0_f64, f64::max);
            (
                min_x,
                min_y,
                (max_x - min_x).max(0.02),
                (max_y - min_y).max(0.02),
                Some(marks),
            )
        } else {
            let start_x = (piece.x + piece.w + 0.012).min(0.92);
            let right_w = next_label_x - start_x;
            let min_right_w = if has_colon || *had_leader {
                0.055
            } else {
                0.095
            };
            if right_w >= min_right_w {
                let h = (piece.h * 1.25).max(0.022);
                let y = (piece.y - (h - piece.h) * 0.5).clamp(0.005, 0.97);
                (start_x, y, right_w, h, None)
            } else {
                // Check for a blank writing area directly below the label.
                let below_h = (piece.h * 1.35).max(0.024);
                let below_y = piece.y + piece.h + 0.004;
                let below_w = piece.w.max((next_label_x - piece.x).min(0.42));
                if below_y + below_h < 0.97 && below_w >= 0.08 {
                    let overlaps = expanded.iter().any(|(other, _)| {
                        let ox = other.x < piece.x + below_w - 0.004
                            && other.x + other.w > piece.x + 0.004;
                        let oy = other.y < below_y + below_h - 0.003
                            && other.y + other.h > below_y + 0.003;
                        ox && oy
                    });
                    if !overlaps && (has_colon || *had_leader || expanded.len() >= 5) {
                        (piece.x, below_y, below_w, below_h, None)
                    } else {
                        continue;
                    }
                } else {
                    continue;
                }
            }
        };

        let mut key = format!("box:{page_index}:{slot_x:.4}:{slot_y:.4}:{slot_w:.4}:{slot_h:.4}");
        let (field_type, options) = if let Some(ref marks) = choice_marks {
            let encoded = marks
                .iter()
                .map(|m| format!("{}@{:.4},{:.4},{:.4},{:.4}", m.option, m.x, m.y, m.w, m.h))
                .collect::<Vec<_>>()
                .join(";");
            key.push_str(&format!(":choices:{encoded}"));
            (
                "select-one".to_string(),
                marks.iter().map(|m| m.option.clone()).collect(),
            )
        } else {
            ("text".to_string(), Vec::new())
        };

        if !seen_keys.insert(key.clone()) {
            continue;
        }

        fields.push(FormField {
            key,
            name: String::new(),
            tooltip: String::new(),
            label: cleaned,
            section: active_section.clone(),
            field_type,
            page: page_index,
            x: slot_x,
            y: slot_y,
            w: slot_w,
            h: slot_h,
            max_length: 0,
            options,
            export_value: None,
            option_caption: None,
            comb_cells: None,
            date_slots: None,
        });
    }

    fields
}

pub fn classify_from_pieces(pieces: &[Piece], page_count: usize, aspect: f64) -> ClassifyOutput {
    let mut form_signals = 0usize;
    let mut doc_signals = 0usize;

    let all_text = group_pieces_into_lines(pieces).join("\n");
    let lower = all_text.to_lowercase();

    let has_mrz = pieces.iter().any(|p| {
        let compact: String = p.text.chars().filter(|c| !c.is_whitespace()).collect();
        compact.len() >= 24
            && compact.contains("<<")
            && compact
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '<')
    });
    if has_mrz {
        doc_signals += 5;
    }

    let form_headers = [
        "申請書",
        "届出書",
        "申告書",
        "申込書",
        "願書",
        "請求書",
        "問診票",
        "application form",
        "application for",
        "registration form",
        "enrollment form",
        "intake form",
        "tờ khai",
        "đơn đề nghị",
        "đơn đăng ký",
        "antrag auf",
        "anmeldung",
        "formular",
        "formulaire",
        "solicitud de",
        "신청서",
        "신고서",
    ];
    let has_form_header = form_headers
        .iter()
        .any(|h| lower.contains(h) || all_text.contains(h));
    if has_form_header {
        form_signals += 4;
    }

    let doc_headers = [
        "運転免許証",
        "在留カード",
        "個人番号カード",
        "住民票の写し",
        "源泉徴収票",
        "健康保険証",
        "給与明細",
        "支給明細",
        "雇用契約",
        "証明書",
        "residence card",
        "driver's license",
        "driver license",
        "driving licence",
        "căn cước",
        "chứng minh nhân dân",
        "passbook",
        "bank statement",
        "payslip",
        "pay stub",
        "employment contract",
        "certificate of",
    ];
    if !has_form_header
        && (doc_headers
            .iter()
            .any(|h| lower.contains(h) || all_text.contains(h))
            || (lower.contains("passport")
                && !lower.contains("passport number")
                && !lower.contains("passport no")))
    {
        doc_signals += 4;
    }

    let filled_kv_hits = pieces
        .iter()
        .filter(|p| {
            let t = p.text.trim();
            if t.contains("例:") || t.contains("例：") || t.to_lowercase().contains("e.g.") {
                return false;
            }
            if let Some((_, rhs)) = t.split_once(':').or_else(|| t.split_once('：')) {
                let rhs_clean = rhs.trim_matches(|c: char| {
                    c.is_whitespace() || matches!(c, '.' | '…' | '_' | '＿' | '(' | ')')
                });
                rhs_clean.chars().count() >= 2
            } else {
                false
            }
        })
        .count();
    if filled_kv_hits >= 4 {
        doc_signals += 5;
    } else if filled_kv_hits >= 2 {
        doc_signals += 3;
    }

    let checkbox_hits = pieces
        .iter()
        .filter(|p| p.text.contains('□') || p.text.contains('☐') || p.text.contains('☑'))
        .count();
    if checkbox_hits >= 2 {
        form_signals += 3;
    }

    let leader_hits = pieces
        .iter()
        .filter(|p| p.text.contains("...") || p.text.contains("___") || p.text.contains('…'))
        .count();
    if leader_hits >= 3 {
        form_signals += 3;
    }

    let v_fields = detect_visual_form_fields(pieces, 0);
    if v_fields.iter().any(|f| f.field_type == "select-one") {
        form_signals += 2;
    }
    if v_fields.len() >= 16 {
        form_signals += 3;
    } else if v_fields.len() >= 9 {
        form_signals += 2;
    }

    if (1.25..=1.85).contains(&aspect)
        && pieces.len() <= 28
        && checkbox_hits == 0
        && !has_form_header
    {
        doc_signals += 2;
    }

    let kind = if doc_signals >= 5 && doc_signals >= form_signals + 2 {
        "document"
    } else if doc_signals >= 4 && form_signals <= 4 {
        "document"
    } else if form_signals >= 5 && form_signals >= doc_signals + 2 {
        "form"
    } else if doc_signals >= 2 && form_signals <= 2 {
        "document"
    } else if form_signals <= 2 {
        "document"
    } else {
        "ambiguous"
    };

    ClassifyOutput {
        kind: kind.to_string(),
        interactive_field_count: 0,
        widgets: 0,
        page_count,
        form_signals,
        doc_signals,
        xfa_only: None,
    }
}
