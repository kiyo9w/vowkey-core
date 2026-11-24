//! 2D grayscale form-layout geometry & hybrid VLM-to-contour box snapping.
//!
//! Operates directly on 8-bit luminance pixels (`width * height`, top-left row-major) plus OCR
//! bounding boxes (`[left, top, width, height]` normalized to `0.0..=1.0`, top-left origin).
//! Shared across Android, iOS, Desktop, and WebAssembly so flat PDFs, scanned forms, and camera
//! photos place text, comb characters, checkmarks, and choice circles onto real printed boxes and
//! baselines instead of floating over labels.
#![allow(missing_docs)]

use serde::{Deserialize, Serialize};

/// One recognized text run on a page in normalized top-left `[0..1]` coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OcrPieceBox {
    pub text: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

impl OcrPieceBox {
    #[inline]
    pub fn right(&self) -> f64 {
        self.left + self.width
    }
    #[inline]
    pub fn bottom(&self) -> f64 {
        self.top + self.height
    }
    #[inline]
    pub fn center_x(&self) -> f64 {
        self.left + self.width * 0.5
    }
    #[inline]
    pub fn center_y(&self) -> f64 {
        self.top + self.height * 0.5
    }
}

/// A writing slot, comb grid, table cell, checkbox, or choice control detected on a flat page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectedFormSlot {
    /// Canonical `box:{page}:{left:.4}:{bottom_up_y:.4}:{width:.4}:{height:.4}` identifier.
    pub id: String,
    pub label: String,
    pub section: String,
    pub input_type: String,
    pub format: String,
    pub max_length: i32,
    pub options: Vec<String>,
    /// Top-left normalized `[left, top, width, height]`.
    pub rect: [f64; 4],
}

/// One placement planned by `/v1/forms/fill-image` (top-left normalized `[left, top, width, height]`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlannedImageFillItem {
    #[serde(default)]
    pub key: String,
    pub value: String,
    #[serde(default = "default_text_action")]
    pub action: String,
    #[serde(rename = "box")]
    pub rect: [f64; 4],
    #[serde(default)]
    pub comb: Option<u32>,
    #[serde(default)]
    pub label: String,
}

fn default_text_action() -> String {
    "text".to_string()
}

/// Pixel-snapped placement ready to render onto an image or flat PDF page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnappedImageFillItem {
    pub key: String,
    pub value: String,
    pub action: String,
    /// Top-left normalized `[left, top, width, height]`.
    #[serde(rename = "box")]
    pub rect: [f64; 4],
    /// Bottom-left `box:{page}:{x:.4}:{y_bottom:.4}:{w:.4}:{h:.4}` target for PDF/CLI engines.
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comb: Option<u32>,
    /// True when the slot sits inside a closed 4-wall cell (center vertically) vs an open baseline.
    pub closed_cell: bool,
    pub label: String,
}

#[derive(Debug, Clone, Copy)]
struct HLine {
    y: f64,
    x0: f64,
    x1: f64,
}

#[derive(Debug, Clone, Copy)]
struct VLine {
    x: f64,
    y0: f64,
    y1: f64,
}

#[derive(Debug, Clone, Copy)]
struct CellRect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl CellRect {
    fn width(&self) -> f64 {
        self.right - self.left
    }
    fn height(&self) -> f64 {
        self.bottom - self.top
    }
}

#[derive(Debug, Clone)]
struct CombGrid {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    count: u32,
}

#[derive(Debug, Default)]
struct PageContours {
    h_lines: Vec<HLine>,
    #[allow(dead_code)]
    v_lines: Vec<VLine>,
    cells: Vec<CellRect>,
    combs: Vec<CombGrid>,
    checkboxes: Vec<CellRect>,
}

fn adaptive_dark_threshold(luma: &[u8]) -> u8 {
    if luma.is_empty() {
        return 180;
    }
    let mut hist = [0usize; 256];
    let step = (luma.len() / 32_768).max(1);
    let mut samples = 0usize;
    for &px in luma.iter().step_by(step) {
        hist[px as usize] += 1;
        samples += 1;
    }
    // 80th percentile approximates background paper brightness even on warm/gray desk photos.
    let target = (samples * 80) / 100;
    let mut acc = 0usize;
    let mut paper = 235u8;
    for (val, &count) in hist.iter().enumerate() {
        acc += count;
        if acc >= target {
            paper = val as u8;
            break;
        }
    }
    paper.saturating_sub(32).clamp(95, 222)
}

fn extract_contours(luma: &[u8], width: u32, height: u32) -> PageContours {
    let w = width as usize;
    let h = height as usize;
    if w < 32 || h < 32 || luma.len() < w * h {
        return PageContours::default();
    }
    let thresh = adaptive_dark_threshold(luma);
    let wf = w as f64;
    let hf = h as f64;

    // 1. Horizontal line segments (solid underlines, table borders, and UI input borders).
    let min_h_run = (w / 18).max(18);
    let max_gap = (w / 220).max(2);
    let mut raw_h: Vec<(usize, usize, usize)> = Vec::new();
    for y in 0..h {
        let row = &luma[y * w..(y + 1) * w];
        let mut x = 0usize;
        while x < w {
            if row[x] > thresh {
                x += 1;
                continue;
            }
            let start = x;
            let mut end = x;
            let mut gap = 0usize;
            while x < w {
                if row[x] <= thresh {
                    end = x;
                    gap = 0;
                } else {
                    gap += 1;
                    if gap > max_gap {
                        break;
                    }
                }
                x += 1;
            }
            if end + 1 - start >= min_h_run {
                raw_h.push((y, start, end + 1));
            }
        }
    }

    // Merge vertically adjacent or gently tilted collinear horizontal segments.
    let mut h_lines: Vec<HLine> = Vec::new();
    for (y, x0, x1) in raw_h {
        let yf = (y as f64 + 0.5) / hf;
        let x0f = x0 as f64 / wf;
        let x1f = x1 as f64 / wf;
        if let Some(prev) = h_lines.iter_mut().rev().take(16).find(|prev| {
            (yf - prev.y).abs() <= (5.5 / hf).max(0.005)
                && x0f <= prev.x1 + 0.012
                && x1f >= prev.x0 - 0.012
        }) {
            let w_prev = (prev.x1 - prev.x0).max(0.001);
            let w_new = (x1f - x0f).max(0.001);
            prev.y = (prev.y * w_prev + yf * w_new) / (w_prev + w_new);
            prev.x0 = prev.x0.min(x0f);
            prev.x1 = prev.x1.max(x1f);
        } else {
            h_lines.push(HLine { y: yf, x0: x0f, x1: x1f });
        }
    }

    // 2. Vertical line segments (table column dividers, comb ticks, checkbox sides).
    let min_v_run = (h / 75).max(10);
    let max_v_gap = (h / 300).max(2);
    let mut raw_v: Vec<(usize, usize, usize)> = Vec::new();
    for x in 0..w {
        let mut y = 0usize;
        while y < h {
            if luma[y * w + x] > thresh {
                y += 1;
                continue;
            }
            let start = y;
            let mut end = y;
            let mut gap = 0usize;
            while y < h {
                if luma[y * w + x] <= thresh {
                    end = y;
                    gap = 0;
                } else {
                    gap += 1;
                    if gap > max_v_gap {
                        break;
                    }
                }
                y += 1;
            }
            if end + 1 - start >= min_v_run {
                raw_v.push((x, start, end + 1));
            }
        }
    }

    let mut v_lines: Vec<VLine> = Vec::new();
    for (x, y0, y1) in raw_v {
        let xf = (x as f64 + 0.5) / wf;
        let y0f = y0 as f64 / hf;
        let y1f = y1 as f64 / hf;
        if let Some(prev) = v_lines.iter_mut().rev().take(8).find(|prev| {
            (xf - prev.x).abs() <= (3.5 / wf).max(0.003)
                && (y0f - prev.y0).abs() < 0.02
                && (y1f - prev.y1).abs() < 0.02
        }) {
            prev.x = (prev.x + xf) * 0.5;
            prev.y0 = prev.y0.min(y0f);
            prev.y1 = prev.y1.max(y1f);
        } else {
            v_lines.push(VLine { x: xf, y0: y0f, y1: y1f });
        }
    }

    // 3. Reconstruct closed 2D cells and comb grids from intersecting HLines & VLines.
    let mut cells: Vec<CellRect> = Vec::new();
    let mut checkboxes: Vec<CellRect> = Vec::new();
    let tol_x = (4.0 / wf).max(0.004);
    let tol_y = (4.0 / hf).max(0.004);

    h_lines.sort_by(|a, b| a.y.total_cmp(&b.y));
    v_lines.sort_by(|a, b| a.x.total_cmp(&b.x));

    for i in 0..h_lines.len() {
        let top_h = h_lines[i];
        for j in (i + 1)..h_lines.len() {
            let bot_h = h_lines[j];
            let dy = bot_h.y - top_h.y;
            if dy < 0.010 {
                continue;
            }
            if dy > 0.14 {
                break;
            }
            let span_x0 = top_h.x0.max(bot_h.x0);
            let span_x1 = top_h.x1.min(bot_h.x1);
            if span_x1 - span_x0 < 0.008 {
                continue;
            }
            // Skip if another horizontal line spans the exact same [span_x0, span_x1] strictly inside (top_h, bot_h)
            // so we extract leaf cells rather than whole multi-row outer boxes.
            let has_inner_full_h = h_lines[(i + 1)..j].iter().any(|mid| {
                (mid.y - top_h.y) > 0.008
                    && (bot_h.y - mid.y) > 0.008
                    && mid.x0 <= span_x0 + 0.015
                    && mid.x1 >= span_x1 - 0.015
            });
            if has_inner_full_h {
                continue;
            }

            // Collect vertical walls spanning from top_h.y to bot_h.y (or comb half-ticks >= 45% of dy).
            let mut walls: Vec<f64> = v_lines
                .iter()
                .filter(|v| {
                    v.x >= span_x0 - tol_x
                        && v.x <= span_x1 + tol_x
                        && v.y0 <= top_h.y + dy * 0.55
                        && v.y1 >= bot_h.y - tol_y
                })
                .map(|v| v.x)
                .collect();
            walls.dedup_by(|a, b| (*a - *b).abs() < 0.005);
            if walls.len() < 2 {
                continue;
            }
            for pair in walls.windows(2) {
                let c = CellRect {
                    left: pair[0],
                    top: top_h.y,
                    right: pair[1],
                    bottom: bot_h.y,
                };
                let cw = c.width();
                let ch = c.height();
                let aspect = (cw * wf) / (ch * hf).max(1.0);
                if walls.len() <= 3
                    && (0.007..=0.032).contains(&cw)
                    && (0.007..=0.032).contains(&ch)
                    && (0.70..=1.38).contains(&aspect)
                {
                    checkboxes.push(c);
                } else if cw >= 0.011 && ch >= 0.012 {
                    // Deduplicate identical leaf cells
                    if !cells.iter().any(|ex| {
                        (ex.left - c.left).abs() < 0.005
                            && (ex.right - c.right).abs() < 0.005
                            && (ex.top - c.top).abs() < 0.005
                            && (ex.bottom - c.bottom).abs() < 0.005
                    }) {
                        cells.push(c);
                    }
                }
            }
        }
    }

    // 4. Group contiguous uniform narrow cells on the same row into CombGrids (count >= 4).
    let mut combs: Vec<CombGrid> = Vec::new();
    let mut row_sorted = cells.clone();
    row_sorted.sort_by(|a, b| a.top.total_cmp(&b.top).then(a.left.total_cmp(&b.left)));
    let mut used = vec![false; row_sorted.len()];
    for idx in 0..row_sorted.len() {
        if used[idx] {
            continue;
        }
        let first = row_sorted[idx];
        let w0 = first.width();
        let h0 = first.height();
        if !(0.011..=0.055).contains(&w0) || !(0.012..=0.065).contains(&h0) {
            continue;
        }
        let mut run = vec![idx];
        let mut prev_cell = first;
        for (k, cand) in row_sorted.iter().enumerate().skip(idx + 1) {
            if used[k] {
                continue;
            }
            if (cand.top - prev_cell.top).abs() > 0.010
                || (cand.bottom - prev_cell.bottom).abs() > 0.010
            {
                if cand.top - prev_cell.top > 0.018 {
                    break;
                }
                continue;
            }
            if (cand.left - prev_cell.right).abs() <= 0.008
                && (cand.width() - w0).abs() <= w0 * 0.34
            {
                run.push(k);
                prev_cell = *cand;
            }
        }
        if run.len() >= 4 {
            for &k in &run {
                used[k] = true;
            }
            let last = row_sorted[*run.last().unwrap_or(&idx)];
            let min_top = run.iter().map(|&k| row_sorted[k].top).fold(first.top, f64::min);
            let max_bot = run.iter().map(|&k| row_sorted[k].bottom).fold(first.bottom, f64::max);
            combs.push(CombGrid {
                left: first.left,
                top: min_top,
                right: last.right,
                bottom: max_bot,
                count: run.len() as u32,
            });
        }
    }

    PageContours {
        h_lines,
        v_lines,
        cells,
        combs,
        checkboxes,
    }
}

fn is_leader_only_text(text: &str) -> bool {
    let trimmed = text.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| matches!(c, '.' | '…' | '_' | '・' | '-' | ' ' | '\t'))
}

fn horizontal_dotted_or_line_near(
    luma: &[u8],
    width: u32,
    height: u32,
    contours: &PageContours,
    left: f64,
    right: f64,
    approx_bottom: f64,
) -> Option<f64> {
    let span = right - left;
    if span < 0.03 {
        return None;
    }
    // First check solid horizontal contours near approx_bottom.
    if let Some(hl) = contours
        .h_lines
        .iter()
        .filter(|hl| {
            (hl.y - approx_bottom).abs() <= 0.020
                && hl.x1.min(right) - hl.x0.max(left) >= span * 0.45
        })
        .min_by(|a, b| (a.y - approx_bottom).abs().total_cmp(&(b.y - approx_bottom).abs()))
    {
        return Some(hl.y);
    }

    // Second check dotted leader row (`......`) in luma within +-1.8% of approx_bottom:
    // a dotted baseline has many short dark->light transitions across [left, right].
    let w = width as usize;
    let h = height as usize;
    if w < 64 || h < 64 || luma.len() < w * h {
        return None;
    }
    let thresh = adaptive_dark_threshold(luma);
    let x0 = ((left.clamp(0.0, 1.0) * w as f64) as usize).min(w - 1);
    let x1 = ((right.clamp(0.0, 1.0) * w as f64) as usize).min(w);
    if x1 <= x0 + 16 {
        return None;
    }
    let y_min = (((approx_bottom - 0.018).clamp(0.0, 1.0) * h as f64) as usize).min(h - 1);
    let y_max = (((approx_bottom + 0.018).clamp(0.0, 1.0) * h as f64) as usize).min(h - 1);
    let mut best: Option<(usize, f64)> = None;
    for y in y_min..=y_max {
        let row = &luma[y * w + x0..y * w + x1];
        let mut transitions = 0usize;
        let mut dark = 0usize;
        let mut prev_dark = false;
        for &px in row {
            let is_d = px <= thresh;
            if is_d {
                dark += 1;
            }
            if is_d != prev_dark {
                transitions += 1;
            }
            prev_dark = is_d;
        }
        let dark_ratio = dark as f64 / (x1 - x0) as f64;
        if transitions >= 12 && (0.06..=0.65).contains(&dark_ratio) {
            let yf = (y as f64 + 0.5) / h as f64;
            if best.is_none_or(|(b_tr, _)| transitions > b_tr) {
                best = Some((transitions, yf));
            }
        }
    }
    best.map(|(_, yf)| yf)
}

fn pieces_in_rect<'a>(pieces: &'a [OcrPieceBox], cell: &CellRect) -> Vec<&'a OcrPieceBox> {
    pieces
        .iter()
        .filter(|p| {
            !is_leader_only_text(&p.text)
                && p.center_x() >= cell.left - 0.003
                && p.center_x() <= cell.right + 0.003
                && p.center_y() >= cell.top - 0.003
                && p.center_y() <= cell.bottom + 0.003
        })
        .collect()
}

fn is_portrait_photo_box(cell: &CellRect, inside_text: &str) -> bool {
    let w = cell.width();
    let h = cell.height();
    if h >= 0.09 && (0.06..=0.22).contains(&w) && (0.55..=1.05).contains(&(w / h)) {
        let low = inside_text.to_lowercase();
        if inside_text.is_empty()
            || low.contains("photo")
            || low.contains("写真")
            || low.contains("ảnh")
            || low.contains("3x4")
            || low.contains("4x6")
            || low.contains("4cm")
        {
            return true;
        }
    }
    false
}

fn is_official_note_text(text: &str) -> bool {
    let t = text.trim();
    if t.starts_with('※') {
        return ["取次者", "官公署", "市区町村", "記入しないで", "公用欄", "受付印"]
            .iter()
            .any(|k| t.contains(k));
    }
    let low = t.to_lowercase();
    ["for official use", "official use only", "do not write", "【取次者】"]
        .iter()
        .any(|k| low.contains(k))
}

fn format_box_id(page: u32, left: f64, top: f64, width: f64, height: f64) -> String {
    let l = left.clamp(0.0, 0.995);
    let w = width.clamp(0.004, 1.0 - l);
    let h = height.clamp(0.004, 1.0 - top.clamp(0.0, 0.995));
    let y_bottom = (1.0 - top - h).clamp(0.0, 0.995);
    format!("box:{page}:{l:.4}:{y_bottom:.4}:{w:.4}:{h:.4}")
}

/// Detects visual writing slots, comb grids, multi-row data tables, and checkboxes on a flat page.
pub fn detect_form_layout(
    luma: &[u8],
    width: u32,
    height: u32,
    pieces: &[OcrPieceBox],
    page: u32,
) -> Vec<DetectedFormSlot> {
    let contours = extract_contours(luma, width, height);
    let mut slots: Vec<DetectedFormSlot> = Vec::new();
    let mut claimed_cells: Vec<CellRect> = Vec::new();

    // Section banners sorted top-to-bottom.
    let mut section_banners: Vec<(f64, String)> = pieces
        .iter()
        .filter(|p| {
            let t = p.text.trim();
            if t.is_empty() || is_leader_only_text(t) || t.chars().count() > 90 {
                return false;
            }
            let folded = crate::normalize::fold(t);
            is_official_note_text(t)
                || [
                    "配偶者",
                    "扶養",
                    "同居家族",
                    "世帯主",
                    "勤務先",
                    "所属機関",
                    "申請人",
                    "保護者",
                    "児童",
                    "thanh vien",
                    "noi dung de nghi",
                    "nguoi khai",
                    "spouse",
                    "dependent",
                    "employer",
                    "applicant",
                ]
                .iter()
                .any(|kw| folded.contains(kw))
        })
        .map(|p| (p.top, p.text.trim().to_string()))
        .collect();
    section_banners.sort_by(|a, b| a.0.total_cmp(&b.0));

    let section_at = |top: f64| -> String {
        section_banners
            .iter()
            .rev()
            .find(|(y, _)| *y <= top + 0.005 && top - *y <= 0.35)
            .map(|(_, s)| s.clone())
            .unwrap_or_default()
    };

    // 1. Comb grids (`comb:N`) paired with the label on their own row (left) first,
    // falling back to a left-aligned caption directly above only when the row has no left label.
    for comb in &contours.combs {
        let comb_cy = (comb.top + comb.bottom) * 0.5;
        let mut row_left_pieces: Vec<&OcrPieceBox> = pieces
            .iter()
            .filter(|p| {
                !is_leader_only_text(&p.text)
                    && p.right() <= comb.left + 0.018
                    && (p.center_y() - comb_cy).abs() <= 0.028
            })
            .collect();
        let label = if !row_left_pieces.is_empty() {
            row_left_pieces.sort_by(|a, b| a.left.total_cmp(&b.left));
            // Take the contiguous label phrase closest to `comb.left` on the same row.
            let rightmost = row_left_pieces.last().copied().unwrap();
            let phrase: Vec<&str> = row_left_pieces
                .iter()
                .filter(|p| (p.center_y() - rightmost.center_y()).abs() <= 0.014)
                .map(|p| p.text.trim())
                .collect();
            phrase.join(" ")
        } else {
            pieces
                .iter()
                .filter(|p| {
                    !is_leader_only_text(&p.text)
                        && p.bottom() <= comb.top + 0.008
                        && comb.top - p.bottom() <= 0.030
                        && p.left >= comb.left - 0.15
                        && p.left <= comb.left + 0.06
                })
                .min_by(|a, b| {
                    let da = (comb.top - a.bottom()).max(0.0) + (a.left - comb.left).abs();
                    let db = (comb.top - b.bottom()).max(0.0) + (b.left - comb.left).abs();
                    da.total_cmp(&db)
                })
                .map(|p| p.text.trim().to_string())
                .unwrap_or_default()
        };
        if label.is_empty() || is_official_note_text(&label) {
            continue;
        }
        let cw = comb.right - comb.left;
        let ch = comb.bottom - comb.top;
        slots.push(DetectedFormSlot {
            id: format!("{}:comb:{}", format_box_id(page, comb.left, comb.top, cw, ch), comb.count),
            label,
            section: section_at(comb.top),
            input_type: "text".to_string(),
            format: format!("comb:{}", comb.count),
            max_length: comb.count as i32,
            options: Vec::new(),
            rect: [comb.left, comb.top, cw, ch],
        });
        claimed_cells.push(CellRect {
            left: comb.left,
            top: comb.top,
            right: comb.right,
            bottom: comb.bottom,
        });
    }

    // 2. Multi-row data tables (header row of >= 3 non-empty cells + >= 1 empty data rows sharing columns).
    let mut rows_by_top: Vec<Vec<CellRect>> = Vec::new();
    for &c in &contours.cells {
        if claimed_cells.iter().any(|cc| {
            c.left >= cc.left - 0.005
                && c.right <= cc.right + 0.005
                && (c.top - cc.top).abs() < 0.008
        }) {
            continue;
        }
        if let Some(row) = rows_by_top
            .iter_mut()
            .find(|r| (r[0].top - c.top).abs() < 0.008 && (r[0].bottom - c.bottom).abs() < 0.012)
        {
            row.push(c);
        } else {
            rows_by_top.push(vec![c]);
        }
    }
    for r in &mut rows_by_top {
        r.sort_by(|a, b| a.left.total_cmp(&b.left));
    }
    rows_by_top.sort_by(|a, b| a[0].top.total_cmp(&b[0].top));

    let mut r_idx = 0usize;
    while r_idx < rows_by_top.len() {
        let hdr_row = &rows_by_top[r_idx];
        if hdr_row.len() >= 3 {
            let hdr_labels: Vec<String> = hdr_row
                .iter()
                .map(|cell| {
                    let mut inside = pieces_in_rect(pieces, cell);
                    inside.sort_by(|a, b| a.top.total_cmp(&b.top).then(a.left.total_cmp(&b.left)));
                    inside
                        .into_iter()
                        .map(|p| p.text.trim())
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect();
            let populated_hdr_cols = hdr_labels.iter().filter(|s| !s.is_empty()).count();
            if populated_hdr_cols >= 3 {
                let mut data_rows: Vec<&Vec<CellRect>> = Vec::new();
                let mut next_r = r_idx + 1;
                while next_r < rows_by_top.len() {
                    let cand_row = &rows_by_top[next_r];
                    let prev_bottom = data_rows
                        .last()
                        .map(|r| r[0].bottom)
                        .unwrap_or(hdr_row[0].bottom);
                    if cand_row.len() == hdr_row.len()
                        && (cand_row[0].top - prev_bottom).abs() <= 0.015
                        && cand_row
                            .iter()
                            .zip(hdr_row.iter())
                            .all(|(dc, hc)| (dc.left - hc.left).abs() <= 0.015)
                    {
                        let non_index_text = cand_row
                            .iter()
                            .enumerate()
                            .skip(1)
                            .any(|(_, dc)| !pieces_in_rect(pieces, dc).is_empty());
                        if !non_index_text {
                            data_rows.push(cand_row);
                            next_r += 1;
                            continue;
                        }
                    }
                    break;
                }
                if !data_rows.is_empty() {
                    // Claim both the header row (so no false slots land ON TOP OF header text!) and data rows.
                    for hc in hdr_row {
                        claimed_cells.push(*hc);
                    }
                    let base_sec = {
                        let s = section_at(hdr_row[0].top);
                        if s.is_empty() {
                            "household member".to_string()
                        } else {
                            s
                        }
                    };
                    for (d_idx, d_row) in data_rows.iter().enumerate() {
                        let row_num = d_idx + 1;
                        for (col_i, dc) in d_row.iter().enumerate() {
                            claimed_cells.push(*dc);
                            let col_label = hdr_labels[col_i].trim();
                            if col_label.is_empty()
                                || matches!(
                                    col_label.to_lowercase().as_str(),
                                    "tt" | "stt" | "no" | "no." | "#"
                                )
                            {
                                continue;
                            }
                            let cw = dc.width();
                            let ch = dc.height();
                            slots.push(DetectedFormSlot {
                                id: format!("{}:cell", format_box_id(page, dc.left, dc.top, cw, ch)),
                                label: col_label.to_string(),
                                section: format!("{base_sec} #{row_num}"),
                                input_type: "text".to_string(),
                                format: String::new(),
                                max_length: 0,
                                options: Vec::new(),
                                rect: [dc.left, dc.top, cw, ch],
                            });
                        }
                    }
                    r_idx = next_r;
                    continue;
                }
            }
        }
        r_idx += 1;
    }

    // 3. Remaining 2D grid cells: inline label-cell -> empty-value-cell, or overlined sub-captions inside wide cells.
    for row in &rows_by_top {
        for (c_idx, cell) in row.iter().enumerate() {
            if claimed_cells.iter().any(|cc| {
                (cc.left - cell.left).abs() < 0.005 && (cc.top - cell.top).abs() < 0.005
            }) {
                continue;
            }
            let inside = pieces_in_rect(pieces, cell);
            let inside_joined = inside
                .iter()
                .map(|p| p.text.trim())
                .collect::<Vec<_>>()
                .join(" ");
            if is_portrait_photo_box(cell, &inside_joined) || is_official_note_text(&inside_joined)
            {
                continue;
            }

            // Case 3a: Wide cell containing >= 2 small sub-captions along its bottom or top edge
            // (e.g. `Family name` and `Given name` inside the `Name` cell on Japanese ISA forms).
            if inside.len() >= 2 && cell.width() >= 0.25 {
                let mut sub_caps = inside.clone();
                sub_caps.sort_by(|a, b| a.left.total_cmp(&b.left));
                let near_bottom = sub_caps
                    .iter()
                    .all(|p| p.top >= cell.top + cell.height() * 0.48 && p.height <= cell.height() * 0.48);
                let near_top = sub_caps
                    .iter()
                    .all(|p| p.bottom() <= cell.top + cell.height() * 0.48 && p.height <= cell.height() * 0.48);
                if near_bottom || near_top {
                    let parent_lbl = if c_idx > 0 {
                        pieces_in_rect(pieces, &row[c_idx - 1])
                            .iter()
                            .map(|p| p.text.trim())
                            .collect::<Vec<_>>()
                            .join(" ")
                    } else {
                        String::new()
                    };
                    for (s_i, cap) in sub_caps.iter().enumerate() {
                        let slot_l = if s_i == 0 { cell.left + 0.004 } else { cap.left };
                        let slot_r = sub_caps
                            .get(s_i + 1)
                            .map(|nx| nx.left - 0.006)
                            .unwrap_or(cell.right - 0.004);
                        if slot_r - slot_l < 0.04 {
                            continue;
                        }
                        let (slot_t, slot_b) = if near_bottom {
                            (cell.top + 0.003, cap.top - 0.002)
                        } else {
                            (cap.bottom() + 0.002, cell.bottom - 0.003)
                        };
                        if slot_b - slot_t < 0.010 {
                            continue;
                        }
                        let full_lbl = if parent_lbl.is_empty() {
                            cap.text.trim().to_string()
                        } else {
                            format!("{parent_lbl} {}", cap.text.trim())
                        };
                        slots.push(DetectedFormSlot {
                            id: format_box_id(page, slot_l, slot_t, slot_r - slot_l, slot_b - slot_t),
                            label: full_lbl,
                            section: section_at(slot_t),
                            input_type: "text".to_string(),
                            format: String::new(),
                            max_length: 0,
                            options: Vec::new(),
                            rect: [slot_l, slot_t, slot_r - slot_l, slot_b - slot_t],
                        });
                    }
                    claimed_cells.push(*cell);
                    continue;
                }
            }

            // Case 3b: Empty cell immediately to the right of a populated label cell.
            if inside.is_empty() && c_idx > 0 {
                let left_cell = &row[c_idx - 1];
                let left_text = pieces_in_rect(pieces, left_cell)
                    .iter()
                    .map(|p| p.text.trim())
                    .collect::<Vec<_>>()
                    .join(" ");
                if !left_text.is_empty() && !is_official_note_text(&left_text) {
                    let cw = cell.width();
                    let ch = cell.height();
                    slots.push(DetectedFormSlot {
                        id: format!("{}:cell", format_box_id(page, cell.left, cell.top, cw, ch)),
                        label: left_text,
                        section: section_at(cell.top),
                        input_type: "text".to_string(),
                        format: String::new(),
                        max_length: 0,
                        options: Vec::new(),
                        rect: [cell.left, cell.top, cw, ch],
                    });
                    claimed_cells.push(*cell);
                }
            }
        }
    }

    // 4. Open writing lines / dotted leaders (`Label: .........`) not already inside a claimed cell.
    for p in pieces {
        let raw = p.text.trim();
        if raw.is_empty() || is_leader_only_text(raw) || is_official_note_text(raw) {
            continue;
        }
        // Reject centered page titles/headers near the top of the page.
        if p.top < 0.16 && (p.center_x() - 0.5).abs() < 0.12 && !raw.contains(':') && !raw.contains('：') {
            continue;
        }
        // If `raw` contains inline `Label: ......` leader dots, split proportional to non-leader prefix.
        let (clean_label, slot_left) = if let Some(colon_pos) = raw.find([':', '：']) {
            let head = raw[..=colon_pos].trim();
            let tail = raw[colon_pos + 1..].trim();
            if tail.is_empty() || is_leader_only_text(tail) {
                let head_chars = head.chars().count().max(1) as f64;
                // Dots are narrower than letters (~0.48x), so weight letters 1.0 and dots 0.48.
                let tail_dots = tail.chars().count() as f64;
                let eff_total = head_chars + tail_dots * 0.48;
                let frac = (head_chars / eff_total).clamp(0.08, 0.96);
                (
                    head.trim_end_matches([':', '：']).trim().to_string(),
                    p.left + p.width * frac + 0.006,
                )
            } else {
                continue;
            }
        } else {
            continue;
        };
        if clean_label.is_empty() {
            continue;
        }
        // Find next non-leader piece on the same line to bound the right edge.
        let right_bound = pieces
            .iter()
            .filter(|other| {
                !std::ptr::eq(*other, p)
                    && !is_leader_only_text(&other.text)
                    && (other.center_y() - p.center_y()).abs() <= p.height.max(0.014) * 0.75
                    && other.left > slot_left + 0.01
            })
            .map(|other| other.left - 0.008)
            .fold(0.93_f64, f64::min);
        if right_bound - slot_left < 0.045 {
            continue;
        }
        let slot_bottom = horizontal_dotted_or_line_near(
            luma,
            width,
            height,
            &contours,
            slot_left,
            right_bound,
            p.bottom(),
        )
        .unwrap_or_else(|| p.bottom());
        let slot_h = p.height.clamp(0.016, 0.032);
        let slot_top = (slot_bottom - slot_h).max(0.0);
        let overlaps_existing = slots.iter().any(|ex| {
            let ox = ex.rect[0].max(slot_left);
            let or_ = (ex.rect[0] + ex.rect[2]).min(right_bound);
            let oy = ex.rect[1].max(slot_top);
            let ob = (ex.rect[1] + ex.rect[3]).min(slot_bottom);
            or_ > ox + 0.01 && ob > oy + 0.005
        });
        if !overlaps_existing {
            slots.push(DetectedFormSlot {
                id: format_box_id(page, slot_left, slot_top, right_bound - slot_left, slot_bottom - slot_top),
                label: clean_label,
                section: section_at(slot_top),
                input_type: "text".to_string(),
                format: String::new(),
                max_length: 0,
                options: Vec::new(),
                rect: [slot_left, slot_top, right_bound - slot_left, slot_bottom - slot_top],
            });
        }
    }

    slots
}

/// Snaps semantic placements from `/v1/forms/fill-image` onto exact pixel contours, comb grids,
/// closed table cells, dotted/solid baselines, choice tokens, and checkbox squares.
pub fn snap_planned_fills(
    luma: &[u8],
    width: u32,
    height: u32,
    pieces: &[OcrPieceBox],
    planned: &[PlannedImageFillItem],
    page: u32,
) -> Vec<SnappedImageFillItem> {
    let contours = extract_contours(luma, width, height);
    let mut out = Vec::with_capacity(planned.len());

    for item in planned {
        let mut left = item.rect[0].clamp(0.0, 0.99);
        let mut top = item.rect[1].clamp(0.0, 0.99);
        let mut w = item.rect[2].clamp(0.004, 1.0 - left);
        let mut h = item.rect[3].clamp(0.004, 1.0 - top);
        let action = match item.action.as_str() {
            "circle" | "check" => item.action.as_str(),
            _ => "text",
        };
        let mut comb = item.comb.filter(|&c| (2..=40).contains(&c));
        let mut closed_cell = false;

        if action == "check" {
            let cx = left + w * 0.5;
            let cy = top + h * 0.5;
            if let Some(cb) = contours
                .checkboxes
                .iter()
                .filter(|cb| {
                    let bx = (cb.left + cb.right) * 0.5;
                    let by = (cb.top + cb.bottom) * 0.5;
                    (bx - cx).hypot(by - cy) <= 0.032
                })
                .min_by(|a, b| {
                    let da = ((a.left + a.right) * 0.5 - cx).hypot((a.top + a.bottom) * 0.5 - cy);
                    let db = ((b.left + b.right) * 0.5 - cx).hypot((b.top + b.bottom) * 0.5 - cy);
                    da.total_cmp(&db)
                })
            {
                left = cb.left;
                top = cb.top;
                w = cb.width();
                h = cb.height();
                closed_cell = true;
            }
        } else if action == "circle" {
            let want = item.value.trim();
            let cx = left + w * 0.5;
            let cy = top + h * 0.5;
            if !want.is_empty() {
                if let Some(tok) = pieces
                    .iter()
                    .filter(|p| {
                        (p.center_x() - cx).abs() <= 0.08
                            && (p.center_y() - cy).abs() <= 0.035
                            && (p.text.trim() == want || p.text.contains(want))
                    })
                    .min_by(|a, b| {
                        let da = (a.center_x() - cx).hypot(a.center_y() - cy);
                        let db = (b.center_x() - cx).hypot(b.center_y() - cy);
                        da.total_cmp(&db)
                    })
                {
                    if tok.text.trim() == want {
                        let pad_x = (tok.height * 0.35).clamp(0.003, 0.010);
                        let pad_y = (tok.height * 0.22).clamp(0.002, 0.007);
                        left = (tok.left - pad_x).max(0.0);
                        top = (tok.top - pad_y).max(0.0);
                        w = (tok.width + pad_x * 2.0).min(1.0 - left);
                        h = (tok.height + pad_y * 2.0).min(1.0 - top);
                    }
                }
            }
        } else {
            // Action == "text":
            // Step A: Check if a pixel-detected CombGrid genuinely corresponds to this placement
            // (never vacuuming a narrow plain-text field from the writing line above/below a comb!).
            let right = left + w;
            let bottom = top + h;
            let cy_vlm = top + h * 0.5;
            if let Some(cg) = contours.combs.iter().find(|cg| {
                let cg_w = cg.right - cg.left;
                let cg_h = cg.bottom - cg.top;
                let oy = cg.bottom.min(bottom) - cg.top.max(top);
                let ox = cg.right.min(right) - cg.left.max(left);
                let center_inside_y = cy_vlm >= cg.top - 0.004 && cy_vlm <= cg.bottom + 0.004;
                if item.comb.is_some() {
                    oy > h.min(cg_h) * 0.30 && ox > w.min(cg_w) * 0.35
                } else {
                    center_inside_y && ox >= cg_w * 0.45 && oy > h.min(cg_h) * 0.45
                }
            }) {
                left = cg.left;
                top = cg.top;
                w = cg.right - cg.left;
                h = cg.bottom - cg.top;
                comb = Some(cg.count);
                closed_cell = true;
            } else {
                // Step B: De-collide from any printed non-leader label overlapping the left edge!
                for p in pieces {
                    if is_leader_only_text(&p.text) {
                        continue;
                    }
                    let oy = p.bottom().min(top + h) - p.top.max(top);
                    if oy <= h.min(p.height) * 0.38 {
                        continue;
                    }
                    // Label sits on the left half of our box and leaves at least 3.5% width to the right.
                    if p.left <= left + w * 0.35 && p.right() > left && (left + w) - p.right() >= 0.035 {
                        // Only trim if the piece doesn't span the entire slot with leader dots (`Label: ......`)
                        if !p.text.contains("....") && !p.text.contains("____") {
                            let new_left = p.right() + 0.005;
                            w = (left + w) - new_left;
                            left = new_left;
                        }
                    }
                }

                // Step C: Snap to an enclosing empty closed cell if the center falls inside one.
                let cx = left + w * 0.5;
                let cy = top + h * 0.5;
                if let Some(cell) = contours
                    .cells
                    .iter()
                    .filter(|c| {
                        cx >= c.left
                            && cx <= c.right
                            && cy >= c.top
                            && cy <= c.bottom
                            && c.width() <= w * 2.2
                            && c.height() <= h * 2.4
                    })
                    .min_by(|a, b| (a.width() * a.height()).total_cmp(&(b.width() * b.height())))
                {
                    // Verify the cell itself is empty (or only has small bottom/top caption).
                    let inside = pieces_in_rect(pieces, cell);
                    if inside.is_empty() {
                        left = cell.left + 0.002;
                        top = cell.top + 0.002;
                        w = (cell.width() - 0.004).max(0.008);
                        h = (cell.height() - 0.004).max(0.008);
                        closed_cell = true;
                    }
                }

                // Step D: On an open line or dotted leader, snap `bottom` directly onto the line/dots!
                if !closed_cell {
                    if let Some(line_y) = horizontal_dotted_or_line_near(
                        luma,
                        width,
                        height,
                        &contours,
                        left,
                        left + w,
                        top + h,
                    ) {
                        let new_bottom = line_y;
                        top = (new_bottom - h).max(0.0);
                        h = (new_bottom - top).max(0.008);
                    }
                }
            }
        }

        let target = if let Some(c) = comb {
            format!("{}|comb:{c}", format_box_id(page, left, top, w, h))
        } else if action != "text" {
            format!("{}|{action}", format_box_id(page, left, top, w, h))
        } else {
            format_box_id(page, left, top, w, h)
        };

        out.push(SnappedImageFillItem {
            key: item.key.clone(),
            value: item.value.clone(),
            action: action.to_string(),
            rect: [left, top, w, h],
            target,
            comb,
            closed_cell,
            label: item.label.clone(),
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn blank_page(w: usize, h: usize) -> Vec<u8> {
        vec![248u8; w * h]
    }

    fn draw_h(buf: &mut [u8], w: usize, y: usize, x0: usize, x1: usize) {
        for x in x0..=x1.min(w - 1) {
            buf[y * w + x] = 24;
        }
    }

    fn draw_v(buf: &mut [u8], w: usize, h: usize, x: usize, y0: usize, y1: usize) {
        for y in y0..=y1.min(h - 1) {
            buf[y * w + x] = 24;
        }
    }

    #[test]
    fn detects_twelve_cell_comb_and_snaps_drifted_vlm_box() {
        let (w, h) = (1000usize, 1000usize);
        let mut luma = blank_page(w, h);
        // 12-cell comb from x=360..840 (each cell 40px wide), y=200..235
        draw_h(&mut luma, w, 200, 360, 840);
        draw_h(&mut luma, w, 235, 360, 840);
        for i in 0..=12 {
            draw_v(&mut luma, w, h, 360 + i * 40, 200, 235);
        }
        let pieces = vec![OcrPieceBox {
            text: "9. Số định danh cá nhân".to_string(),
            left: 0.08,
            top: 0.205,
            width: 0.25,
            height: 0.024,
        }];

        let slots = detect_form_layout(&luma, w as u32, h as u32, &pieces, 0);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].format, "comb:12");
        assert_eq!(slots[0].max_length, 12);

        // VLM box drifted slightly left/up and omitted `comb`
        let planned = vec![PlannedImageFillItem {
            key: "id.national.number".to_string(),
            value: "001088012345".to_string(),
            action: "text".to_string(),
            rect: [0.34, 0.19, 0.49, 0.045],
            comb: None,
            label: "9. Số định danh cá nhân".to_string(),
        }];
        let snapped = snap_planned_fills(&luma, w as u32, h as u32, &pieces, &planned, 0);
        assert_eq!(snapped[0].comb, Some(12));
        assert!((snapped[0].rect[0] - 0.360).abs() < 0.005);
        assert!((snapped[0].rect[2] - 0.480).abs() < 0.005);
    }

    #[test]
    fn detects_multirow_household_table_without_placing_slots_on_headers() {
        let (w, h) = (1000usize, 1000usize);
        let mut luma = blank_page(w, h);
        let cols = [60usize, 120, 380, 560, 720, 920];
        let rows = [400usize, 450, 490, 530]; // 1 header row + 2 empty data rows
        for &ry in &rows {
            draw_h(&mut luma, w, ry, cols[0], cols[5]);
        }
        for &cx in &cols {
            draw_v(&mut luma, w, h, cx, rows[0], rows[3]);
        }
        let pieces = vec![
            OcrPieceBox { text: "TT".into(), left: 0.07, top: 0.415, width: 0.03, height: 0.02 },
            OcrPieceBox { text: "Họ, chữ đệm".into(), left: 0.14, top: 0.408, width: 0.18, height: 0.018 },
            OcrPieceBox { text: "và tên".into(), left: 0.16, top: 0.428, width: 0.12, height: 0.018 },
            OcrPieceBox { text: "Ngày sinh".into(), left: 0.40, top: 0.415, width: 0.12, height: 0.02 },
            OcrPieceBox { text: "Giới tính".into(), left: 0.58, top: 0.415, width: 0.10, height: 0.02 },
            OcrPieceBox { text: "Số định danh".into(), left: 0.74, top: 0.415, width: 0.15, height: 0.02 },
        ];
        let slots = detect_form_layout(&luma, w as u32, h as u32, &pieces, 0);
        // 2 data rows * 4 non-TT columns = 8 slots; zero slots in header band [0.40..0.45]!
        assert_eq!(slots.len(), 8);
        assert!(slots.iter().all(|s| s.rect[1] >= 0.449));
        assert!(slots.iter().any(|s| s.label == "Họ, chữ đệm và tên" && s.section.ends_with("#1")));
        assert!(slots.iter().any(|s| s.label == "Họ, chữ đệm và tên" && s.section.ends_with("#2")));
    }

    #[test]
    fn snaps_open_slot_past_label_and_onto_dotted_leader() {
        let (w, h) = (1000usize, 600usize);
        let mut luma = blank_page(w, h);
        // Draw dotted baseline at y = 180 from x = 280..880
        for x in (280..880).step_by(8) {
            luma[180 * w + x] = 30;
            luma[180 * w + x + 1] = 30;
        }
        let pieces = vec![OcrPieceBox {
            text: "1. Họ và tên:".into(),
            left: 0.08,
            top: 0.265,
            width: 0.18,
            height: 0.032,
        }];
        let planned = vec![PlannedImageFillItem {
            key: "name.full".into(),
            value: "TRẦN MINH KHOA".into(),
            action: "text".into(),
            // Overlaps label on left (0.20 < 0.26) and floats slightly above dotted line (bottom=0.292 vs 0.300)
            rect: [0.20, 0.260, 0.65, 0.032],
            comb: None,
            label: "1. Họ và tên".into(),
        }];
        let snapped = snap_planned_fills(&luma, w as u32, h as u32, &pieces, &planned, 0);
        assert!(snapped[0].rect[0] >= 0.264, "left={} should clear label right=0.26", snapped[0].rect[0]);
        let bottom = snapped[0].rect[1] + snapped[0].rect[3];
        assert!((bottom - 0.3008).abs() < 0.004, "bottom={bottom} should snap to y=180/600=0.300");
    }

    #[test]
    fn detects_square_cell_12_digit_comb_without_misclassifying_cells_as_checkboxes() {
        let (w, h) = (1000usize, 1400usize);
        let mut luma = blank_page(w, h);
        // 12 cells each 30px wide (cw = 0.030 <= 0.032) and 34px tall (ch = 0.0243 <= 0.032), aspect = 0.88
        let x0 = 420usize;
        let y0 = 360usize;
        let y1 = 394usize;
        draw_h(&mut luma, w, y0, x0, x0 + 12 * 30);
        draw_h(&mut luma, w, y1, x0, x0 + 12 * 30);
        for i in 0..=12 {
            draw_v(&mut luma, w, h, x0 + i * 30, y0, y1);
        }
        let pieces = vec![OcrPieceBox {
            text: "4. Số định danh cá nhân:".into(),
            left: 0.14,
            top: 0.260,
            width: 0.24,
            height: 0.018,
        }];
        let slots = detect_form_layout(&luma, w as u32, h as u32, &pieces, 0);
        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].format, "comb:12");
        assert!(slots[0].id.ends_with(":comb:12"));
    }

    #[test]
    fn comb_prefers_same_row_left_label_over_upper_row_right_column_label_and_ignores_plain_text_above() {
        let (w, h) = (1000usize, 1400usize);
        let mut luma = blank_page(w, h);
        // Gently tilted 12-cell comb (steps down 2px across x=420..780)
        let x0 = 420usize;
        for cell in 0..12 {
            let dy = cell / 4;
            draw_h(&mut luma, w, 360 + dy, x0 + cell * 30, x0 + (cell + 1) * 30);
            draw_h(&mut luma, w, 394 + dy, x0 + cell * 30, x0 + (cell + 1) * 30);
        }
        for i in 0..=12 {
            let dy = i.min(11) / 4;
            draw_v(&mut luma, w, h, x0 + i * 30, 360 + dy, 394 + dy);
        }
        let pieces = vec![
            // Upper-row right-column field sitting directly above cells 8..11 of the comb!
            OcrPieceBox {
                text: "3. Giới tính:".into(),
                left: 0.68,
                top: 0.236,
                width: 0.11,
                height: 0.016,
            },
            // Actual comb label on the same row to its left
            OcrPieceBox {
                text: "4. Số định danh cá nhân:".into(),
                left: 0.14,
                top: 0.260,
                width: 0.24,
                height: 0.018,
            },
        ];
        let slots = detect_form_layout(&luma, w as u32, h as u32, &pieces, 0);
        assert_eq!(slots.len(), 2);
        assert_eq!(slots[0].format, "comb:12");
        assert_eq!(slots[0].label, "4. Số định danh cá nhân:");
        assert_eq!(slots[1].label, "3. Giới tính");

        // A plain-text year (`1989`, comb=None) on the row just above the comb must NOT be snapped into the comb!
        let planned = vec![PlannedImageFillItem {
            key: "birth.year".into(),
            value: "1989".into(),
            action: "text".into(),
            rect: [0.52, 0.238, 0.08, 0.024],
            comb: None,
            label: "năm sinh".into(),
        }];
        let snapped = snap_planned_fills(&luma, w as u32, h as u32, &pieces, &planned, 0);
        assert_eq!(snapped[0].comb, None);
    }
}
