use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{anyhow, Context, Result};
use lopdf::{
    content::Content, dictionary, Dictionary, Document, Object, ObjectId, Stream, StringFormat,
};

use crate::types::{
    classify_from_pieces, comb_characters, detect_visual_form_fields, match_choice_mark,
    matches_widget_option, parse_box_key, segmented_parts, ClassifyOutput, FormField, FormOutput,
    Piece,
};

#[derive(Debug, Clone)]
pub struct PageGeometry {
    pub page_id: ObjectId,
    pub page_num: u32,
    pub page_index: usize,
    pub min_x: f64,
    pub min_y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone)]
struct RawWidget {
    annot_id: ObjectId,
    parent_field_id: Option<ObjectId>,
    page_index: usize,
    index_on_page: usize,
    key: String,
    name: String,
    tooltip: String,
    field_type: String,
    rect_pdf: [f64; 4],
    norm_rect: (f64, f64, f64, f64),
    max_length: usize,
    options: Vec<String>,
    export_value: String,
}

fn obj_as_f64(obj: &Object) -> Option<f64> {
    match obj {
        Object::Real(v) => Some(f64::from(*v)),
        Object::Integer(v) => Some(*v as f64),
        _ => None,
    }
}

fn resolve_obj<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Object> {
    let mut cur = obj;
    for _ in 0..8 {
        match cur {
            Object::Reference(id) => {
                cur = doc.get_object(*id).ok()?;
            }
            other => return Some(other),
        }
    }
    None
}

fn resolve_dict<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Dictionary> {
    resolve_obj(doc, obj)?.as_dict().ok()
}

fn resolve_array<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Vec<Object>> {
    resolve_obj(doc, obj)?.as_array().ok()
}

pub fn decode_pdf_string(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.first() == Some(&0xFE) && bytes.get(1) == Some(&0xFF) {
        let mut units = Vec::with_capacity((bytes.len() - 2) / 2);
        let mut idx = 2;
        while idx + 1 < bytes.len() {
            if let (Some(&hi), Some(&lo)) = (bytes.get(idx), bytes.get(idx + 1)) {
                units.push(u16::from_be_bytes([hi, lo]));
            }
            idx += 2;
        }
        return String::from_utf16_lossy(&units)
            .trim_end_matches('\0')
            .to_string();
    }
    if bytes.len() >= 2 && bytes.first() == Some(&0xFF) && bytes.get(1) == Some(&0xFE) {
        let mut units = Vec::with_capacity((bytes.len() - 2) / 2);
        let mut idx = 2;
        while idx + 1 < bytes.len() {
            if let (Some(&lo), Some(&hi)) = (bytes.get(idx), bytes.get(idx + 1)) {
                units.push(u16::from_le_bytes([lo, hi]));
            }
            idx += 2;
        }
        return String::from_utf16_lossy(&units)
            .trim_end_matches('\0')
            .to_string();
    }
    if let Ok(utf8) = std::str::from_utf8(bytes) {
        return utf8.trim_end_matches('\0').to_string();
    }
    bytes.iter().map(|&b| char::from(b)).collect()
}

pub fn encode_pdf_string(value: &str) -> Object {
    if value.is_ascii() {
        Object::String(value.as_bytes().to_vec(), StringFormat::Literal)
    } else {
        let mut bytes = Vec::with_capacity(2 + value.len() * 2);
        bytes.push(0xFE);
        bytes.push(0xFF);
        for unit in value.encode_utf16() {
            bytes.extend_from_slice(&unit.to_be_bytes());
        }
        Object::String(bytes, StringFormat::Hexadecimal)
    }
}

pub fn load_pdf_bytes(bytes: &[u8]) -> Result<Document> {
    let mut doc = Document::load_mem(bytes).context("cannot parse PDF structure")?;
    if doc.is_encrypted() {
        let _ = doc.decrypt("");
    }
    Ok(doc)
}

fn lookup_inherited_box(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<[f64; 4]> {
    let mut cur_id = Some(page_id);
    let mut visited = HashSet::new();
    while let Some(id) = cur_id {
        if !visited.insert(id) {
            break;
        }
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(box_obj) = dict.get(key) {
            if let Some(arr) = resolve_array(doc, box_obj) {
                if arr.len() >= 4 {
                    let x0 = obj_as_f64(arr.first()?)?;
                    let y0 = obj_as_f64(arr.get(1)?)?;
                    let x1 = obj_as_f64(arr.get(2)?)?;
                    let y1 = obj_as_f64(arr.get(3)?)?;
                    let min_x = x0.min(x1);
                    let min_y = y0.min(y1);
                    let w = (x1 - x0).abs().max(1.0);
                    let h = (y1 - y0).abs().max(1.0);
                    return Some([min_x, min_y, w, h]);
                }
            }
        }
        cur_id = dict.get(b"Parent").ok().and_then(|p| p.as_reference().ok());
    }
    None
}

pub fn collect_page_geometries(doc: &Document) -> Vec<PageGeometry> {
    let pages: BTreeMap<u32, ObjectId> = doc.get_pages();
    pages
        .into_iter()
        .enumerate()
        .map(|(page_index, (page_num, page_id))| {
            let [min_x, min_y, width, height] = lookup_inherited_box(doc, page_id, b"CropBox")
                .or_else(|| lookup_inherited_box(doc, page_id, b"MediaBox"))
                .unwrap_or([0.0, 0.0, 595.0, 842.0]);
            PageGeometry {
                page_id,
                page_num,
                page_index,
                min_x,
                min_y,
                width,
                height,
            }
        })
        .collect()
}

pub fn is_xfa_only(doc: &Document, raw_bytes: Option<&[u8]>) -> bool {
    let geoms = collect_page_geometries(doc);
    if !extract_raw_widgets(doc, &geoms).is_empty() {
        return false;
    }
    if let Ok(catalog) = doc.catalog() {
        if let Ok(acro_obj) = catalog.get(b"AcroForm") {
            if let Some(acro_dict) = resolve_dict(doc, acro_obj) {
                if acro_dict.has(b"XFA") {
                    return true;
                }
            }
        }
    }
    if let Some(bytes) = raw_bytes {
        let prefix = bytes.get(..bytes.len().min(512 * 1024)).unwrap_or(bytes);
        let latin: String = prefix.iter().map(|&b| char::from(b)).collect();
        if latin.contains("/XFA")
            && (latin.contains("<xdp:xdp")
                || latin.contains("xfa.org/schema/xfa-template")
                || (latin.contains("Please wait...") && latin.contains("Adobe Reader")))
        {
            return true;
        }
    }
    false
}

/// Parses a PDF `/ToUnicode` CMap stream (`beginbfchar` and `beginbfrange`) into a CID -> String map.
fn parse_tounicode_cmap(data: &[u8]) -> HashMap<u32, String> {
    let mut map = HashMap::new();
    let text: String = data.iter().map(|&b| char::from(b)).collect();

    fn parse_hex_token(tok: &str) -> Option<Vec<u8>> {
        let inner = tok.trim().strip_prefix('<')?.strip_suffix('>')?;
        let clean: String = inner.chars().filter(|c| c.is_ascii_hexdigit()).collect();
        if clean.is_empty() {
            return None;
        }
        let padded = if clean.len() % 2 == 1 {
            format!("{clean}0")
        } else {
            clean
        };
        let mut out = Vec::with_capacity(padded.len() / 2);
        let mut i = 0;
        while i + 1 < padded.len() {
            let sub = padded.get(i..i + 2)?;
            out.push(u8::from_str_radix(sub, 16).ok()?);
            i += 2;
        }
        Some(out)
    }

    fn bytes_to_u32(bytes: &[u8]) -> u32 {
        bytes.iter().fold(0u32, |acc, &b| (acc << 8) | u32::from(b))
    }

    fn decode_utf16be_hex(bytes: &[u8]) -> String {
        if bytes.len() >= 2 && bytes.len() % 2 == 0 {
            let mut units = Vec::with_capacity(bytes.len() / 2);
            let mut i = 0;
            while i + 1 < bytes.len() {
                if let (Some(&hi), Some(&lo)) = (bytes.get(i), bytes.get(i + 1)) {
                    units.push(u16::from_be_bytes([hi, lo]));
                }
                i += 2;
            }
            String::from_utf16_lossy(&units)
        } else {
            bytes.iter().map(|&b| char::from(b)).collect()
        }
    }

    let mut rest = text.as_str();
    while let Some(start_idx) = rest.find("beginbfchar") {
        let after = rest.get(start_idx + "beginbfchar".len()..).unwrap_or("");
        let Some(end_idx) = after.find("endbfchar") else {
            break;
        };
        let body = after.get(..end_idx).unwrap_or("");
        for line in body.lines() {
            let trimmed = line.trim();
            let mut brackets = Vec::new();
            let mut cur = trimmed;
            while let Some(lt) = cur.find('<') {
                let sub = cur.get(lt..).unwrap_or("");
                let Some(gt) = sub.find('>') else { break };
                if let Some(tok) = sub.get(..=gt) {
                    brackets.push(tok);
                }
                cur = sub.get(gt + 1..).unwrap_or("");
            }
            if let (Some(&src_tok), Some(&dst_tok)) = (brackets.first(), brackets.get(1)) {
                if let (Some(src_b), Some(dst_b)) =
                    (parse_hex_token(src_tok), parse_hex_token(dst_tok))
                {
                    map.insert(bytes_to_u32(&src_b), decode_utf16be_hex(&dst_b));
                }
            }
        }
        rest = after.get(end_idx + "endbfchar".len()..).unwrap_or("");
    }

    let mut rest_range = text.as_str();
    while let Some(start_idx) = rest_range.find("beginbfrange") {
        let after = rest_range
            .get(start_idx + "beginbfrange".len()..)
            .unwrap_or("");
        let Some(end_idx) = after.find("endbfrange") else {
            break;
        };
        let body = after.get(..end_idx).unwrap_or("");
        for line in body.lines() {
            let trimmed = line.trim();
            if trimmed.contains('[') {
                continue;
            }
            let mut brackets = Vec::new();
            let mut cur = trimmed;
            while let Some(lt) = cur.find('<') {
                let sub = cur.get(lt..).unwrap_or("");
                let Some(gt) = sub.find('>') else { break };
                if let Some(tok) = sub.get(..=gt) {
                    brackets.push(tok);
                }
                cur = sub.get(gt + 1..).unwrap_or("");
            }
            if let (Some(&s_tok), Some(&e_tok), Some(&d_tok)) =
                (brackets.first(), brackets.get(1), brackets.get(2))
            {
                if let (Some(sb), Some(eb), Some(db)) = (
                    parse_hex_token(s_tok),
                    parse_hex_token(e_tok),
                    parse_hex_token(d_tok),
                ) {
                    let s_code = bytes_to_u32(&sb);
                    let e_code = bytes_to_u32(&eb);
                    let d_base = bytes_to_u32(&db);
                    if e_code >= s_code && e_code - s_code <= 1024 {
                        for offset in 0..=(e_code - s_code) {
                            let target_val = d_base.saturating_add(offset);
                            if let Some(ch) = char::from_u32(target_val) {
                                map.insert(s_code + offset, ch.to_string());
                            }
                        }
                    }
                }
            }
        }
        rest_range = after.get(end_idx + "endbfrange".len()..).unwrap_or("");
    }

    map
}

#[derive(Default)]
struct FontTable {
    cmaps: HashMap<Vec<u8>, (HashMap<u32, String>, bool)>,
}

impl FontTable {
    fn from_page(doc: &Document, page_id: ObjectId) -> Self {
        let mut table = Self::default();
        let mut cur_id = Some(page_id);
        let mut visited = HashSet::new();
        while let Some(id) = cur_id {
            if !visited.insert(id) {
                break;
            }
            if let Ok(dict) = doc.get_dictionary(id) {
                if let Ok(res_obj) = dict.get(b"Resources") {
                    if let Some(res_dict) = resolve_dict(doc, res_obj) {
                        if let Ok(font_obj) = res_dict.get(b"Font") {
                            if let Some(font_dict) = resolve_dict(doc, font_obj) {
                                for (fname, fval) in font_dict.iter() {
                                    if table.cmaps.contains_key(fname) {
                                        continue;
                                    }
                                    if let Some(fd) = resolve_dict(doc, fval) {
                                        let is_cid = fd
                                            .get(b"Subtype")
                                            .ok()
                                            .and_then(|o| o.as_name().ok())
                                            .is_some_and(|n| n == b"Type0");
                                        let mut cmap = HashMap::new();
                                        if let Ok(tu_obj) = fd.get(b"ToUnicode") {
                                            if let Some(Object::Stream(stream)) =
                                                resolve_obj(doc, tu_obj)
                                            {
                                                let raw = stream
                                                    .decompressed_content()
                                                    .unwrap_or_else(|_| stream.content.clone());
                                                cmap = parse_tounicode_cmap(&raw);
                                            }
                                        }
                                        table.cmaps.insert(fname.clone(), (cmap, is_cid));
                                    }
                                }
                            }
                        }
                    }
                }
                cur_id = dict.get(b"Parent").ok().and_then(|p| p.as_reference().ok());
            } else {
                break;
            }
        }
        table
    }

    fn decode_glyph_bytes(&self, font_name: &[u8], bytes: &[u8]) -> String {
        if let Some((cmap, is_cid)) = self.cmaps.get(font_name) {
            if !cmap.is_empty() {
                if *is_cid && bytes.len() >= 2 && bytes.len() % 2 == 0 {
                    let mut out = String::new();
                    let mut i = 0;
                    while i + 1 < bytes.len() {
                        if let (Some(&hi), Some(&lo)) = (bytes.get(i), bytes.get(i + 1)) {
                            let cid = u32::from(u16::from_be_bytes([hi, lo]));
                            if let Some(mapped) = cmap.get(&cid) {
                                out.push_str(mapped);
                            } else if let Some(ch) = char::from_u32(cid) {
                                out.push(ch);
                            }
                        }
                        i += 2;
                    }
                    return out;
                }
                let mut out = String::new();
                for &b in bytes {
                    if let Some(mapped) = cmap.get(&u32::from(b)) {
                        out.push_str(mapped);
                    } else {
                        out.push(char::from(b));
                    }
                }
                return out;
            }
        }
        decode_pdf_string(bytes)
    }
}

fn mat_mul(m1: [f64; 6], m2: [f64; 6]) -> [f64; 6] {
    [
        m1[0] * m2[0] + m1[1] * m2[2],
        m1[0] * m2[1] + m1[1] * m2[3],
        m1[2] * m2[0] + m1[3] * m2[2],
        m1[2] * m2[1] + m1[3] * m2[3],
        m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
        m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
    ]
}

fn estimate_text_advance_units(text: &str) -> f64 {
    text.chars()
        .map(|c| {
            if c as u32 >= 0x3000 {
                1.0
            } else if "ilI1.,:;|! ".contains(c) {
                0.32
            } else {
                0.56
            }
        })
        .sum()
}

/// Extracts digital text pieces from a single PDF page with normalized top-left `0.0..1.0` boxes.
pub fn extract_page_digital_pieces(doc: &Document, geom: &PageGeometry) -> Vec<Piece> {
    let raw_content = doc.get_page_content(geom.page_id);
    if raw_content.is_empty() {
        return Vec::new();
    }
    let Ok(content) = Content::decode(&raw_content) else {
        return Vec::new();
    };

    let fonts = FontTable::from_page(doc, geom.page_id);
    let mut ctm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut ctm_stack: Vec<[f64; 6]> = Vec::new();
    let mut tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
    let mut font_size = 11.0_f64;
    let mut leading = 0.0_f64;
    let mut active_font: Vec<u8> = Vec::new();

    struct RawRun {
        text: String,
        x_pdf: f64,
        y_pdf: f64,
        w_pdf: f64,
        h_pdf: f64,
    }
    let mut runs: Vec<RawRun> = Vec::new();

    for op in &content.operations {
        match op.operator.as_str() {
            "q" => ctm_stack.push(ctm),
            "Q" => {
                if let Some(saved) = ctm_stack.pop() {
                    ctm = saved;
                }
            }
            "cm" if op.operands.len() >= 6 => {
                if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                    op.operands.first().and_then(obj_as_f64),
                    op.operands.get(1).and_then(obj_as_f64),
                    op.operands.get(2).and_then(obj_as_f64),
                    op.operands.get(3).and_then(obj_as_f64),
                    op.operands.get(4).and_then(obj_as_f64),
                    op.operands.get(5).and_then(obj_as_f64),
                ) {
                    ctm = mat_mul([a, b, c, d, e, f], ctm);
                }
            }
            "BT" => {
                tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
                tlm = tm;
            }
            "Tf" if op.operands.len() >= 2 => {
                if let Some(fname) = op.operands.first().and_then(|o| o.as_name().ok()) {
                    active_font = fname.to_vec();
                }
                if let Some(sz) = op.operands.get(1).and_then(obj_as_f64) {
                    if sz.abs() > 0.01 {
                        font_size = sz.abs();
                    }
                }
            }
            "TL" => {
                if let Some(tl) = op.operands.first().and_then(obj_as_f64) {
                    leading = tl;
                }
            }
            "Tm" if op.operands.len() >= 6 => {
                if let (Some(a), Some(b), Some(c), Some(d), Some(e), Some(f)) = (
                    op.operands.first().and_then(obj_as_f64),
                    op.operands.get(1).and_then(obj_as_f64),
                    op.operands.get(2).and_then(obj_as_f64),
                    op.operands.get(3).and_then(obj_as_f64),
                    op.operands.get(4).and_then(obj_as_f64),
                    op.operands.get(5).and_then(obj_as_f64),
                ) {
                    tm = [a, b, c, d, e, f];
                    tlm = tm;
                }
            }
            "Td" | "TD" if op.operands.len() >= 2 => {
                if let (Some(tx), Some(ty)) = (
                    op.operands.first().and_then(obj_as_f64),
                    op.operands.get(1).and_then(obj_as_f64),
                ) {
                    if op.operator == "TD" {
                        leading = -ty;
                    }
                    tlm = mat_mul([1.0, 0.0, 0.0, 1.0, tx, ty], tlm);
                    tm = tlm;
                }
            }
            "T*" => {
                tlm = mat_mul([1.0, 0.0, 0.0, 1.0, 0.0, -leading], tlm);
                tm = tlm;
            }
            "Tj" | "'" | "\"" => {
                if op.operator == "'" || op.operator == "\"" {
                    tlm = mat_mul([1.0, 0.0, 0.0, 1.0, 0.0, -leading], tlm);
                    tm = tlm;
                }
                let str_operand = if op.operator == "\"" {
                    op.operands.get(2)
                } else {
                    op.operands.first()
                };
                if let Some(Object::String(bytes, _)) = str_operand {
                    let decoded = fonts.decode_glyph_bytes(&active_font, bytes);
                    let combined = mat_mul(tm, ctm);
                    let scale_y = (combined[1].hypot(combined[3])).max(0.5);
                    let scale_x = (combined[0].hypot(combined[2])).max(0.5);
                    let eff_h = (font_size * scale_y).max(6.0);
                    let adv = estimate_text_advance_units(&decoded) * font_size;
                    let eff_w = (adv * scale_x).max(2.0);
                    if !decoded.trim().is_empty() {
                        runs.push(RawRun {
                            text: decoded,
                            x_pdf: combined[4],
                            y_pdf: combined[5] - eff_h * 0.18,
                            w_pdf: eff_w,
                            h_pdf: eff_h * 1.15,
                        });
                    }
                    tm = mat_mul([1.0, 0.0, 0.0, 1.0, adv, 0.0], tm);
                }
            }
            "TJ" => {
                if let Some(Object::Array(items)) = op.operands.first() {
                    let mut seg_text = String::new();
                    let mut seg_start_tm = tm;
                    let mut seg_adv = 0.0_f64;

                    let flush_seg =
                        |text: &mut String,
                         start_tm: [f64; 6],
                         adv_units: f64,
                         runs_out: &mut Vec<RawRun>| {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                let combined = mat_mul(start_tm, ctm);
                                let scale_y = (combined[1].hypot(combined[3])).max(0.5);
                                let scale_x = (combined[0].hypot(combined[2])).max(0.5);
                                let eff_h = (font_size * scale_y).max(6.0);
                                let eff_w = (adv_units.max(0.4) * scale_x).max(2.0);
                                runs_out.push(RawRun {
                                    text: trimmed.to_string(),
                                    x_pdf: combined[4],
                                    y_pdf: combined[5] - eff_h * 0.18,
                                    w_pdf: eff_w,
                                    h_pdf: eff_h * 1.15,
                                });
                            }
                            text.clear();
                        };

                    for item in items {
                        match item {
                            Object::String(bytes, _) => {
                                let part = fonts.decode_glyph_bytes(&active_font, bytes);
                                if seg_text.is_empty() {
                                    seg_start_tm = tm;
                                    seg_adv = 0.0;
                                }
                                let adv = estimate_text_advance_units(&part) * font_size;
                                seg_text.push_str(&part);
                                seg_adv += adv;
                                tm = mat_mul([1.0, 0.0, 0.0, 1.0, adv, 0.0], tm);
                            }
                            other => {
                                if let Some(kern) = obj_as_f64(other) {
                                    let shift = (-kern / 1000.0) * font_size;
                                    if shift > font_size * 0.9 {
                                        flush_seg(&mut seg_text, seg_start_tm, seg_adv, &mut runs);
                                    } else if shift > font_size * 0.18 && !seg_text.ends_with(' ') {
                                        seg_text.push(' ');
                                        seg_adv += shift;
                                    } else {
                                        seg_adv += shift.max(0.0);
                                    }
                                    tm = mat_mul([1.0, 0.0, 0.0, 1.0, shift, 0.0], tm);
                                }
                            }
                        }
                    }
                    flush_seg(&mut seg_text, seg_start_tm, seg_adv, &mut runs);
                }
            }
            _ => {}
        }
    }

    // Coalesce adjacent runs on the same baseline unless separated by a cell-wide gap.
    let mut merged: Vec<RawRun> = Vec::new();
    for run in runs {
        let should_join = if let Some(prev) = merged.last_mut() {
            let same_row = (prev.y_pdf - run.y_pdf).abs() <= prev.h_pdf.max(run.h_pdf) * 0.45;
            let gap = run.x_pdf - (prev.x_pdf + prev.w_pdf);
            let max_word_gap = prev.h_pdf.max(run.h_pdf) * 0.85;
            if same_row && gap >= -3.0 && gap <= max_word_gap {
                if gap > prev.h_pdf * 0.18
                    && !prev.text.ends_with(' ')
                    && !run.text.starts_with(' ')
                {
                    prev.text.push(' ');
                }
                prev.text.push_str(&run.text);
                let new_right = (run.x_pdf + run.w_pdf).max(prev.x_pdf + prev.w_pdf);
                prev.w_pdf = new_right - prev.x_pdf;
                prev.h_pdf = prev.h_pdf.max(run.h_pdf);
                true
            } else {
                false
            }
        } else {
            false
        };
        if !should_join {
            merged.push(run);
        }
    }

    let mut pieces: Vec<Piece> = merged
        .into_iter()
        .filter_map(|r| {
            let trimmed = r.text.trim();
            if trimmed.is_empty() {
                return None;
            }
            let nx = ((r.x_pdf - geom.min_x) / geom.width).clamp(0.0, 0.995);
            let top_pdf_y = r.y_pdf + r.h_pdf;
            let ny = (1.0 - (top_pdf_y - geom.min_y) / geom.height).clamp(0.0, 0.995);
            let nw = (r.w_pdf / geom.width).clamp(0.005, 1.0 - nx);
            let nh = (r.h_pdf / geom.height).clamp(0.005, 1.0 - ny);
            Some(Piece {
                text: trimmed.to_string(),
                page: geom.page_index,
                x: nx,
                y: ny,
                w: nw,
                h: nh,
                confidence: 1.0,
            })
        })
        .collect();

    if pieces.is_empty() {
        if let Ok(fallback_text) = doc.extract_text(&[geom.page_num]) {
            let lines: Vec<&str> = fallback_text
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect();
            let count = lines.len().max(1) as f64;
            for (idx, line) in lines.into_iter().enumerate() {
                pieces.push(Piece {
                    text: line.to_string(),
                    page: geom.page_index,
                    x: 0.05,
                    y: (0.05 + 0.88 * (idx as f64 / count)).min(0.95),
                    w: 0.85,
                    h: (0.7 / count).clamp(0.014, 0.04),
                    confidence: 1.0,
                });
            }
        }
    }

    pieces.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    pieces
}

fn widget_appearance_export_value(doc: &Document, annot_dict: &Dictionary) -> String {
    if let Ok(ap_obj) = annot_dict.get(b"AP") {
        if let Some(ap_dict) = resolve_dict(doc, ap_obj) {
            if let Ok(n_obj) = ap_dict.get(b"N") {
                if let Some(n_dict) = resolve_dict(doc, n_obj) {
                    for (k, _) in n_dict.iter() {
                        let key_str = decode_pdf_string(k);
                        if !key_str.is_empty() && !key_str.eq_ignore_ascii_case("Off") {
                            return key_str;
                        }
                    }
                }
            }
        }
    }
    String::new()
}

fn extract_raw_widgets(doc: &Document, geoms: &[PageGeometry]) -> Vec<RawWidget> {
    let mut widgets = Vec::new();
    let mut seen_keys = HashSet::new();

    for geom in geoms {
        let Ok(page_dict) = doc.get_dictionary(geom.page_id) else {
            continue;
        };
        let Ok(annots_obj) = page_dict.get(b"Annots") else {
            continue;
        };
        let Some(annots_arr) = resolve_array(doc, annots_obj) else {
            continue;
        };

        for (index_on_page, item) in annots_arr.iter().enumerate() {
            let Some(annot_id) = item.as_reference().ok() else {
                continue;
            };
            let Ok(annot_dict) = doc.get_dictionary(annot_id) else {
                continue;
            };

            let is_widget = annot_dict
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .is_some_and(|n| n == b"Widget");
            if !is_widget {
                continue;
            }

            let Some(rect_arr) = annot_dict
                .get(b"Rect")
                .ok()
                .and_then(|o| resolve_array(doc, o))
            else {
                continue;
            };
            if rect_arr.len() < 4 {
                continue;
            }
            let (Some(rx0), Some(ry0), Some(rx1), Some(ry1)) = (
                rect_arr.first().and_then(obj_as_f64),
                rect_arr.get(1).and_then(obj_as_f64),
                rect_arr.get(2).and_then(obj_as_f64),
                rect_arr.get(3).and_then(obj_as_f64),
            ) else {
                continue;
            };
            let rect_pdf = [rx0.min(rx1), ry0.min(ry1), rx0.max(rx1), ry0.max(ry1)];

            // Walk /Parent chain to resolve inherited AcroForm attributes.
            let mut chain: Vec<(ObjectId, &Dictionary)> = vec![(annot_id, annot_dict)];
            let mut visited = HashSet::new();
            visited.insert(annot_id);
            let mut cur_parent = annot_dict
                .get(b"Parent")
                .ok()
                .and_then(|o| o.as_reference().ok());
            while let Some(pid) = cur_parent {
                if !visited.insert(pid) {
                    break;
                }
                if let Ok(pdict) = doc.get_dictionary(pid) {
                    chain.push((pid, pdict));
                    cur_parent = pdict
                        .get(b"Parent")
                        .ok()
                        .and_then(|o| o.as_reference().ok());
                } else {
                    break;
                }
            }

            let ft = chain
                .iter()
                .find_map(|(_, d)| {
                    d.get(b"FT")
                        .ok()
                        .and_then(|o| resolve_obj(doc, o))
                        .and_then(|o| o.as_name().ok())
                })
                .unwrap_or(b"");
            if ft.is_empty() {
                continue;
            }

            let ff = chain
                .iter()
                .find_map(|(_, d)| {
                    d.get(b"Ff")
                        .ok()
                        .and_then(|o| resolve_obj(doc, o))
                        .and_then(|o| o.as_i64().ok())
                })
                .unwrap_or(0);

            // Skip pushbutton controls (Ff bit 17 = 1 << 16).
            if ft == b"Btn" && (ff & (1 << 16)) != 0 {
                continue;
            }

            let mut name_parts = Vec::new();
            for (_, d) in chain.iter().rev() {
                if let Ok(t_obj) = d.get(b"T") {
                    if let Some(Object::String(bytes, _)) = resolve_obj(doc, t_obj) {
                        let s = decode_pdf_string(bytes);
                        if !s.is_empty() {
                            name_parts.push(s);
                        }
                    }
                }
            }
            let full_name = name_parts.join(".");

            let tooltip = chain
                .iter()
                .find_map(|(_, d)| {
                    let o = d.get(b"TU").ok()?;
                    if let Some(Object::String(bytes, _)) = resolve_obj(doc, o) {
                        Some(decode_pdf_string(bytes))
                    } else {
                        None
                    }
                })
                .unwrap_or_default();

            let max_length = chain
                .iter()
                .find_map(|(_, d)| {
                    d.get(b"MaxLen")
                        .ok()
                        .and_then(|o| resolve_obj(doc, o))
                        .and_then(|o| o.as_i64().ok())
                })
                .unwrap_or(0)
                .max(0) as usize;

            let opt_values: Vec<String> = chain
                .iter()
                .find_map(|(_, d)| {
                    let o = d.get(b"Opt").ok()?;
                    let arr = resolve_array(doc, o)?;
                    let mut out = Vec::new();
                    for entry in arr {
                        match resolve_obj(doc, entry) {
                            Some(Object::String(bytes, _)) => out.push(decode_pdf_string(bytes)),
                            Some(Object::Array(pair)) => {
                                if let Some(Object::String(bytes, _)) = pair
                                    .get(1)
                                    .or_else(|| pair.first())
                                    .and_then(|x| resolve_obj(doc, x))
                                {
                                    out.push(decode_pdf_string(bytes));
                                }
                            }
                            _ => {}
                        }
                    }
                    Some(out)
                })
                .unwrap_or_default();

            let parent_field_id = chain.get(1).map(|(id, _)| *id);
            let parent_has_multiple_kids = chain.get(1).is_some_and(|(_, pdict)| {
                pdict
                    .get(b"Kids")
                    .ok()
                    .and_then(|o| resolve_array(doc, o))
                    .is_some_and(|k| k.len() >= 2)
            });

            let mut export_value = widget_appearance_export_value(doc, annot_dict);
            if export_value.is_empty() && !opt_values.is_empty() {
                if let Some((_, pdict)) = chain.get(1) {
                    if let Some(kids) = pdict.get(b"Kids").ok().and_then(|o| resolve_array(doc, o))
                    {
                        if let Some(pos) = kids
                            .iter()
                            .position(|k| k.as_reference().ok() == Some(annot_id))
                        {
                            if let Some(opt_v) = opt_values.get(pos) {
                                export_value = opt_v.clone();
                            }
                        }
                    }
                }
            }

            let field_type = match ft {
                b"Tx" => "text",
                b"Ch" => "select-one",
                b"Btn" => {
                    let is_radio = (ff & (1 << 15)) != 0 || parent_has_multiple_kids;
                    if is_radio {
                        "radio"
                    } else {
                        "checkbox"
                    }
                }
                _ => continue,
            }
            .to_string();

            let base_key = if field_type == "radio" {
                if !full_name.is_empty() {
                    if export_value.is_empty() {
                        format!("{full_name}#p{}:{index_on_page}", geom.page_index)
                    } else {
                        format!("{full_name}#{export_value}")
                    }
                } else if export_value.is_empty() {
                    format!("p{}:{index_on_page}", geom.page_index)
                } else {
                    format!("p{}:{index_on_page}#{export_value}", geom.page_index)
                }
            } else if !full_name.is_empty() {
                full_name.clone()
            } else {
                format!("p{}:{index_on_page}", geom.page_index)
            };

            let key = if seen_keys.contains(&base_key) {
                format!("{base_key}#p{}:{index_on_page}", geom.page_index)
            } else {
                base_key
            };
            seen_keys.insert(key.clone());

            let nx = ((rect_pdf[0] - geom.min_x) / geom.width).clamp(0.0, 0.995);
            let ny = (1.0 - (rect_pdf[3] - geom.min_y) / geom.height).clamp(0.0, 0.995);
            let nw = ((rect_pdf[2] - rect_pdf[0]) / geom.width).clamp(0.002, 1.0 - nx);
            let nh = ((rect_pdf[3] - rect_pdf[1]) / geom.height).clamp(0.002, 1.0 - ny);

            let options = if field_type == "select-one" {
                opt_values
            } else {
                Vec::new()
            };

            widgets.push(RawWidget {
                annot_id,
                parent_field_id,
                page_index: geom.page_index,
                index_on_page,
                key,
                name: full_name,
                tooltip,
                field_type,
                rect_pdf,
                norm_rect: (nx, ny, nw, nh),
                max_length,
                options,
                export_value,
            });
        }
    }

    widgets
}

fn find_label_near_norm(pieces: &[Piece], rect: (f64, f64, f64, f64)) -> String {
    let (bx, by, bw, bh) = rect;
    let b_mid_y = by + bh * 0.5;
    let row_band = bh.max(0.016) * 0.85;

    let mut left_best: Option<(f64, &Piece)> = None;
    let mut above_best: Option<(f64, &Piece)> = None;

    for p in pieces {
        let p_mid_y = p.y + p.h * 0.5;
        let p_right = p.x + p.w;
        let p_bot = p.y + p.h;

        if (p_mid_y - b_mid_y).abs() <= row_band && p_right <= bx + 0.012 && bx - p_right <= 0.38 {
            let dist = (bx - p_right).max(0.0);
            if left_best.is_none_or(|(d, _)| dist < d) {
                left_best = Some((dist, p));
            }
        }
        if p_bot <= by + 0.006
            && by - p_bot <= 0.045
            && p_right >= bx - 0.01
            && p.x <= bx + bw + 0.02
        {
            let dist = (by - p_bot).max(0.0);
            if above_best.is_none_or(|(d, _)| dist < d) {
                above_best = Some((dist, p));
            }
        }
    }

    match (above_best, left_best) {
        (Some((ad, ap)), Some((ld, lp))) => {
            if (ap.x - bx).abs() <= 0.03
                && ad < 0.014
                && !lp.text.contains(':')
                && !lp.text.contains('：')
            {
                ap.text.trim().to_string()
            } else if lp.text.contains(':') || lp.text.contains('：') || ld <= 0.22 {
                lp.text.trim().to_string()
            } else if ad < ld {
                ap.text.trim().to_string()
            } else {
                lp.text.trim().to_string()
            }
        }
        (Some((_, ap)), None) => ap.text.trim().to_string(),
        (None, Some((_, lp))) => lp.text.trim().to_string(),
        (None, None) => String::new(),
    }
}

fn find_section_near_norm(pieces: &[Piece], rect: (f64, f64, f64, f64)) -> String {
    let (bx, by, _, _) = rect;
    let mut best: Option<(f64, &str)> = None;
    for p in pieces {
        let dy = by - (p.y + p.h);
        if (-0.005..=0.32).contains(&dy) {
            let trimmed = p.text.trim();
            let lower = trimmed.to_lowercase();
            let is_sec = trimmed.starts_with('※')
                || trimmed.starts_with('■')
                || lower.starts_with("part ")
                || lower.starts_with("section ")
                || lower.contains("official use only")
                || lower.contains("do not write")
                || trimmed.contains("代理人")
                || trimmed.contains("配偶者")
                || trimmed.contains("勤務先")
                || trimmed.contains("記入しないで");
            if is_sec && (p.x <= 0.28 || p.w >= 0.45 || (bx >= p.x - 0.03 && bx <= p.x + p.w + 0.1))
            {
                if best.is_none_or(|(d, _)| dy < d) {
                    best = Some((dy, trimmed));
                }
            }
        }
    }
    best.map_or_else(String::new, |(_, s)| s.to_string())
}

fn find_option_caption_near_norm(
    pieces: &[Piece],
    rect: (f64, f64, f64, f64),
    same_page_widget_rects: &[(f64, f64, f64, f64)],
) -> String {
    let (bx, by, bw, bh) = rect;
    let b_mid_y = by + bh * 0.5;
    let row_band = bh.max(0.016) * 0.9;

    let next_widget_x = same_page_widget_rects
        .iter()
        .filter(|&&(ox, oy, _, oh)| {
            let o_mid_y = oy + oh * 0.5;
            (o_mid_y - b_mid_y).abs() <= row_band && ox > bx + bw + 0.002
        })
        .map(|&(ox, _, _, _)| ox)
        .fold(1.0_f64, f64::min);

    let right_limit = next_widget_x.min(bx + bw + 0.26);
    let mut right_words: Vec<&Piece> = pieces
        .iter()
        .filter(|p| {
            let p_mid_y = p.y + p.h * 0.5;
            (p_mid_y - b_mid_y).abs() <= row_band + 0.006
                && p.x >= bx + bw - 0.006
                && p.x + p.w * 0.5 <= right_limit + 0.006
        })
        .collect();
    right_words.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
    let right_text = right_words
        .into_iter()
        .map(|p| p.text.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !right_text.is_empty() {
        return right_text;
    }

    let prev_widget_right = same_page_widget_rects
        .iter()
        .filter(|&&(ox, oy, ow, oh)| {
            let o_mid_y = oy + oh * 0.5;
            (o_mid_y - b_mid_y).abs() <= row_band && ox + ow < bx - 0.002
        })
        .map(|&(ox, _, ow, _)| ox + ow)
        .fold(0.0_f64, f64::max);

    let left_start = prev_widget_right.max(bx - 0.16);
    let mut left_words: Vec<&Piece> = pieces
        .iter()
        .filter(|p| {
            let p_mid_y = p.y + p.h * 0.5;
            (p_mid_y - b_mid_y).abs() <= row_band + 0.006
                && p.x >= left_start - 0.004
                && p.x + p.w <= bx + 0.006
        })
        .collect();
    left_words.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
    let left_text = left_words
        .into_iter()
        .map(|p| p.text.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !left_text.is_empty() && !left_text.ends_with(':') && !left_text.ends_with('：') {
        return left_text;
    }
    String::new()
}

pub fn classify_pdf(
    doc: &Document,
    raw_bytes: Option<&[u8]>,
    page_pieces_fn: impl FnOnce(&Document, &PageGeometry) -> Vec<Piece>,
) -> ClassifyOutput {
    let geoms = collect_page_geometries(doc);
    let page_count = geoms.len();
    let widgets = extract_raw_widgets(doc, &geoms);
    if !widgets.is_empty() {
        return ClassifyOutput {
            kind: "form".to_string(),
            interactive_field_count: widgets.len(),
            widgets: widgets.len(),
            page_count,
            form_signals: 10,
            doc_signals: 0,
            xfa_only: None,
        };
    }
    if is_xfa_only(doc, raw_bytes) {
        return ClassifyOutput {
            kind: "form".to_string(),
            interactive_field_count: 0,
            widgets: 0,
            page_count,
            form_signals: 10,
            doc_signals: 0,
            xfa_only: Some(true),
        };
    }
    if let Some(first_geom) = geoms.first() {
        let pieces = page_pieces_fn(doc, first_geom);
        let aspect = first_geom.width / first_geom.height.max(1.0);
        return classify_from_pieces(&pieces, page_count, aspect);
    }
    ClassifyOutput {
        kind: "document".to_string(),
        interactive_field_count: 0,
        widgets: 0,
        page_count,
        form_signals: 0,
        doc_signals: 0,
        xfa_only: None,
    }
}

pub fn extract_pdf_form(
    doc: &Document,
    raw_bytes: Option<&[u8]>,
    mut page_pieces_fn: impl FnMut(&Document, &PageGeometry) -> Vec<Piece>,
) -> FormOutput {
    let geoms = collect_page_geometries(doc);
    let page_count = geoms.len();
    let raw_widgets = extract_raw_widgets(doc, &geoms);

    if !raw_widgets.is_empty() {
        let mut pieces_by_page: HashMap<usize, Vec<Piece>> = HashMap::new();
        for w in &raw_widgets {
            if !pieces_by_page.contains_key(&w.page_index) {
                if let Some(geom) = geoms.get(w.page_index) {
                    pieces_by_page.insert(w.page_index, page_pieces_fn(doc, geom));
                }
            }
        }

        let mut radio_group_labels: HashMap<(usize, String), String> = HashMap::new();
        for geom in &geoms {
            let page_widgets: Vec<&RawWidget> = raw_widgets
                .iter()
                .filter(|w| w.page_index == geom.page_index)
                .collect();
            let Some(pieces) = pieces_by_page.get(&geom.page_index) else {
                continue;
            };
            let mut groups: HashMap<&str, Vec<(f64, f64, f64, f64)>> = HashMap::new();
            for w in &page_widgets {
                if w.field_type == "radio" && !w.name.is_empty() {
                    groups.entry(&w.name).or_default().push(w.norm_rect);
                }
            }
            for (gname, rects) in groups {
                let min_x = rects.iter().map(|r| r.0).fold(1.0_f64, f64::min);
                let min_y = rects.iter().map(|r| r.1).fold(1.0_f64, f64::min);
                let max_x = rects.iter().map(|r| r.0 + r.2).fold(0.0_f64, f64::max);
                let max_y = rects.iter().map(|r| r.1 + r.3).fold(0.0_f64, f64::max);
                let union_rect = (min_x, min_y, max_x - min_x, max_y - min_y);
                let glabel = find_label_near_norm(pieces, union_rect);
                if !glabel.is_empty() {
                    radio_group_labels.insert((geom.page_index, gname.to_string()), glabel);
                }
            }
        }

        let mut fields = Vec::with_capacity(raw_widgets.len());
        for w in &raw_widgets {
            let empty_pieces = Vec::new();
            let pieces = pieces_by_page.get(&w.page_index).unwrap_or(&empty_pieces);
            let same_page_rects: Vec<(f64, f64, f64, f64)> = raw_widgets
                .iter()
                .filter(|other| other.page_index == w.page_index && other.annot_id != w.annot_id)
                .map(|other| other.norm_rect)
                .collect();

            let mut label = find_label_near_norm(pieces, w.norm_rect);
            let section = find_section_near_norm(pieces, w.norm_rect);
            let mut options = w.options.clone();
            let mut export_value = None;
            let mut option_caption = None;

            if w.field_type == "radio" {
                let caption = find_option_caption_near_norm(pieces, w.norm_rect, &same_page_rects);
                if let Some(gl) = radio_group_labels.get(&(w.page_index, w.name.clone())) {
                    label = gl.clone();
                } else if label.is_empty() {
                    label = caption.clone();
                }
                let mut dedup = Vec::new();
                for cand in [&caption, &w.export_value] {
                    let t = cand.trim();
                    if !t.is_empty()
                        && !dedup
                            .iter()
                            .any(|existing: &String| existing.eq_ignore_ascii_case(t))
                    {
                        dedup.push(t.to_string());
                    }
                }
                options = dedup;
                export_value = Some(w.export_value.clone());
                option_caption = Some(caption);
            } else if w.field_type == "checkbox" {
                let caption = find_option_caption_near_norm(pieces, w.norm_rect, &same_page_rects);
                if label.is_empty() && !caption.is_empty() {
                    label = caption.clone();
                }
                if !w.export_value.is_empty() {
                    export_value = Some(w.export_value.clone());
                }
                if !caption.is_empty() {
                    option_caption = Some(caption);
                }
            }

            let _ = w.index_on_page;
            let _ = w.rect_pdf;

            fields.push(FormField {
                key: w.key.clone(),
                name: w.name.clone(),
                tooltip: w.tooltip.clone(),
                label,
                section,
                field_type: w.field_type.clone(),
                page: w.page_index,
                x: w.norm_rect.0,
                y: w.norm_rect.1,
                w: w.norm_rect.2,
                h: w.norm_rect.3,
                max_length: w.max_length,
                options,
                export_value,
                option_caption,
                comb_cells: None,
                date_slots: None,
            });
        }

        return FormOutput {
            page_count,
            interactive: true,
            fields,
            xfa_only: None,
        };
    }

    if is_xfa_only(doc, raw_bytes) {
        return FormOutput {
            page_count,
            interactive: false,
            fields: Vec::new(),
            xfa_only: Some(true),
        };
    }

    let mut visual_fields = Vec::new();
    for geom in &geoms {
        let pieces = page_pieces_fn(doc, geom);
        visual_fields.extend(detect_visual_form_fields(&pieces, geom.page_index));
    }

    FormOutput {
        page_count,
        interactive: false,
        fields: visual_fields,
        xfa_only: None,
    }
}

fn ensure_need_appearances(doc: &mut Document) {
    let helv_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let acro_ref = doc
        .catalog()
        .ok()
        .and_then(|c| c.get(b"AcroForm").ok())
        .and_then(|o| o.as_reference().ok());

    if let Some(acro_id) = acro_ref {
        if let Ok(acro_dict) = doc.get_dictionary_mut(acro_id) {
            acro_dict.set("NeedAppearances", Object::Boolean(true));
            if !acro_dict.has(b"DR") {
                acro_dict.set(
                    "DR",
                    dictionary! {
                        "Font" => dictionary! { "Helv" => helv_id }
                    },
                );
            }
        }
        return;
    }

    if let Ok(catalog) = doc.catalog_mut() {
        if let Ok(Object::Dictionary(acro_dict)) = catalog.get_mut(b"AcroForm") {
            acro_dict.set("NeedAppearances", Object::Boolean(true));
            if !acro_dict.has(b"DR") {
                acro_dict.set(
                    "DR",
                    dictionary! {
                        "Font" => dictionary! { "Helv" => helv_id }
                    },
                );
            }
        } else {
            catalog.set(
                "AcroForm",
                dictionary! {
                    "Fields" => Vec::<Object>::new(),
                    "NeedAppearances" => true,
                    "DR" => dictionary! {
                        "Font" => dictionary! { "Helv" => helv_id }
                    },
                },
            );
        }
    }
}

fn append_page_annot(doc: &mut Document, page_id: ObjectId, annot_id: ObjectId) {
    let annots_ref = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"Annots").ok())
        .and_then(|o| o.as_reference().ok());

    if let Some(arr_id) = annots_ref {
        if let Ok(Object::Array(arr)) = doc.get_object_mut(arr_id) {
            arr.push(Object::Reference(annot_id));
            return;
        }
    }

    if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
        if let Ok(Object::Array(arr)) = page_dict.get_mut(b"Annots") {
            arr.push(Object::Reference(annot_id));
        } else {
            page_dict.set("Annots", vec![Object::Reference(annot_id)]);
        }
    }
}

fn add_freetext_annot(
    doc: &mut Document,
    page_id: ObjectId,
    rect_pdf: [f64; 4],
    text: &str,
    centered: bool,
) {
    let w = (rect_pdf[2] - rect_pdf[0]).max(4.0);
    let h = (rect_pdf[3] - rect_pdf[1]).max(4.0);
    let char_count = text.chars().count().max(1) as f64;
    let font_size = (h * 0.62)
        .clamp(8.0, 15.0)
        .min(((w * 0.92) / (char_count * 0.60).max(1.0)).max(7.5));
    let da = format!("/Helv {font_size:.1} Tf 0.04 0.15 0.42 rg");
    let quadding = if centered { 1_i64 } else { 0_i64 };

    let annot = dictionary! {
        "Type" => "Annot",
        "Subtype" => "FreeText",
        "Rect" => vec![
            Object::Real(rect_pdf[0] as f32),
            Object::Real(rect_pdf[1] as f32),
            Object::Real(rect_pdf[2] as f32),
            Object::Real(rect_pdf[3] as f32),
        ],
        "Contents" => encode_pdf_string(text),
        "DA" => Object::String(da.into_bytes(), StringFormat::Literal),
        "Q" => quadding,
        "F" => 4_i64,
        "Border" => vec![Object::Integer(0), Object::Integer(0), Object::Integer(0)],
    };
    let annot_id = doc.add_object(annot);
    append_page_annot(doc, page_id, annot_id);
}

fn add_circle_annot(doc: &mut Document, page_id: ObjectId, rect_pdf: [f64; 4]) {
    let annot = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Circle",
        "Rect" => vec![
            Object::Real((rect_pdf[0] - 2.0) as f32),
            Object::Real((rect_pdf[1] - 1.5) as f32),
            Object::Real((rect_pdf[2] + 2.0) as f32),
            Object::Real((rect_pdf[3] + 1.5) as f32),
        ],
        "C" => vec![Object::Real(0.04), Object::Real(0.15), Object::Real(0.42)],
        "F" => 4_i64,
        "Border" => vec![Object::Integer(0), Object::Integer(0), Object::Real(1.6)],
    };
    let annot_id = doc.add_object(annot);
    append_page_annot(doc, page_id, annot_id);
}

pub fn fill_pdf_document(
    doc: &mut Document,
    values: &HashMap<String, String>,
    mut page_pieces_fn: impl FnMut(&Document, &PageGeometry) -> Vec<Piece>,
) -> usize {
    let geoms = collect_page_geometries(doc);
    let raw_widgets = extract_raw_widgets(doc, &geoms);
    let mut filled_keys: HashSet<String> = HashSet::new();
    let mut touched_acroform = false;

    let mut radio_widgets: Vec<RawWidget> = Vec::new();

    for w in &raw_widgets {
        match w.field_type.as_str() {
            "text" | "select-one" => {
                let Some(val) = values
                    .get(&w.key)
                    .or_else(|| (!w.name.is_empty()).then(|| values.get(&w.name)).flatten())
                else {
                    continue;
                };
                let encoded = encode_pdf_string(val);
                if let Ok(annot_dict) = doc.get_dictionary_mut(w.annot_id) {
                    annot_dict.set("V", encoded.clone());
                    annot_dict.remove(b"AP");
                }
                if let Some(pid) = w.parent_field_id {
                    if let Ok(pdict) = doc.get_dictionary_mut(pid) {
                        if pdict.has(b"T") {
                            pdict.set("V", encoded);
                        }
                    }
                }
                filled_keys.insert(w.key.clone());
                touched_acroform = true;
            }
            "checkbox" => {
                let Some(val) = values
                    .get(&w.key)
                    .or_else(|| (!w.name.is_empty()).then(|| values.get(&w.name)).flatten())
                else {
                    continue;
                };
                let norm = val.trim().to_lowercase();
                let is_off = matches!(norm.as_str(), "" | "false" | "0" | "off" | "no");
                let on_bytes = if w.export_value.is_empty() {
                    b"Yes".to_vec()
                } else {
                    w.export_value.as_bytes().to_vec()
                };
                let state_name = if is_off { b"Off".to_vec() } else { on_bytes };
                if let Ok(annot_dict) = doc.get_dictionary_mut(w.annot_id) {
                    annot_dict.set("AS", Object::Name(state_name.clone()));
                    annot_dict.set("V", Object::Name(state_name.clone()));
                }
                if let Some(pid) = w.parent_field_id {
                    if let Ok(pdict) = doc.get_dictionary_mut(pid) {
                        pdict.set("V", Object::Name(state_name));
                    }
                }
                if !is_off {
                    filled_keys.insert(w.key.clone());
                    touched_acroform = true;
                }
            }
            "radio" => {
                radio_widgets.push(w.clone());
            }
            _ => {}
        }
    }

    if !radio_widgets.is_empty() {
        let mut pieces_cache: HashMap<usize, Vec<Piece>> = HashMap::new();
        let mut groups: BTreeMap<String, Vec<RawWidget>> = BTreeMap::new();
        for rw in radio_widgets {
            let gid = if rw.name.is_empty() {
                rw.key.clone()
            } else {
                rw.name.clone()
            };
            groups.entry(gid).or_default().push(rw);
        }

        for (gid, members) in groups {
            let direct_hits: Vec<&RawWidget> = members
                .iter()
                .filter(|m| values.contains_key(&m.key))
                .collect();
            let group_val = values.get(&gid);
            if direct_hits.is_empty() && group_val.is_none() {
                continue;
            }

            let mut winner: Option<&RawWidget> = None;

            if direct_hits.len() == 1 {
                if let Some(&target) = direct_hits.first() {
                    if let Some(raw_val) = values.get(&target.key) {
                        let norm = raw_val.trim().to_lowercase();
                        let caption = {
                            if !pieces_cache.contains_key(&target.page_index) {
                                if let Some(g) = geoms.get(target.page_index) {
                                    pieces_cache.insert(target.page_index, page_pieces_fn(doc, g));
                                }
                            }
                            let pieces = pieces_cache
                                .get(&target.page_index)
                                .map_or(&[][..], Vec::as_slice);
                            let same_page: Vec<(f64, f64, f64, f64)> = raw_widgets
                                .iter()
                                .filter(|o| {
                                    o.page_index == target.page_index
                                        && o.annot_id != target.annot_id
                                })
                                .map(|o| o.norm_rect)
                                .collect();
                            find_option_caption_near_norm(pieces, target.norm_rect, &same_page)
                        };
                        if matches!(norm.as_str(), "true" | "1" | "on")
                            || matches_widget_option(
                                raw_val,
                                &[target.export_value.clone(), caption],
                            )
                        {
                            winner = Some(target);
                        }
                    }
                }
            } else {
                for member in &members {
                    let Some(raw_val) = values.get(&member.key).or(group_val) else {
                        continue;
                    };
                    if !pieces_cache.contains_key(&member.page_index) {
                        if let Some(g) = geoms.get(member.page_index) {
                            pieces_cache.insert(member.page_index, page_pieces_fn(doc, g));
                        }
                    }
                    let pieces = pieces_cache
                        .get(&member.page_index)
                        .map_or(&[][..], Vec::as_slice);
                    let same_page: Vec<(f64, f64, f64, f64)> = raw_widgets
                        .iter()
                        .filter(|o| {
                            o.page_index == member.page_index && o.annot_id != member.annot_id
                        })
                        .map(|o| o.norm_rect)
                        .collect();
                    let caption =
                        find_option_caption_near_norm(pieces, member.norm_rect, &same_page);
                    if matches_widget_option(raw_val, &[member.export_value.clone(), caption]) {
                        winner = Some(member);
                        break;
                    }
                }
            }

            if let Some(win) = winner {
                let on_name = if win.export_value.is_empty() {
                    b"Yes".to_vec()
                } else {
                    win.export_value.as_bytes().to_vec()
                };
                for m in &members {
                    if m.annot_id == win.annot_id {
                        if let Ok(ad) = doc.get_dictionary_mut(m.annot_id) {
                            ad.set("AS", Object::Name(on_name.clone()));
                            if m.parent_field_id.is_none() {
                                ad.set("V", Object::Name(on_name.clone()));
                            }
                        }
                    } else if let Ok(ad) = doc.get_dictionary_mut(m.annot_id) {
                        ad.set("AS", Object::Name(b"Off".to_vec()));
                    }
                }
                if let Some(pid) = win.parent_field_id {
                    if let Ok(pdict) = doc.get_dictionary_mut(pid) {
                        pdict.set("V", Object::Name(on_name));
                    }
                }
                filled_keys.insert(win.key.clone());
                touched_acroform = true;
            }
        }
    }

    for (key, value) in values {
        if filled_keys.contains(key) {
            continue;
        }
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(parsed) = parse_box_key(key) else {
            continue;
        };
        let Some(geom) = geoms.get(parsed.page) else {
            continue;
        };

        let to_pdf_rect = |nx: f64, ny: f64, nw: f64, nh: f64| -> [f64; 4] {
            let x0 = geom.min_x + nx * geom.width;
            let x1 = geom.min_x + (nx + nw) * geom.width;
            let y1 = geom.min_y + (1.0 - ny) * geom.height;
            let y0 = geom.min_y + (1.0 - (ny + nh)) * geom.height;
            [x0, y0, x1, y1]
        };

        if let Some(ref choices) = parsed.choices {
            if let Some(hit) = match_choice_mark(trimmed, choices) {
                let c_rect = to_pdf_rect(hit.x, hit.y, hit.w, hit.h);
                add_circle_annot(doc, geom.page_id, c_rect);
                filled_keys.insert(key.clone());
                touched_acroform = true;
                continue;
            }
        }

        if let Some(cells) = parsed.comb {
            if cells > 1 {
                let chars = comb_characters(trimmed, cells);
                let cell_w = parsed.w / cells as f64;
                for (idx, ch) in chars.into_iter().take(cells).enumerate() {
                    let cx = parsed.x + idx as f64 * cell_w;
                    let c_rect = to_pdf_rect(cx, parsed.y, cell_w, parsed.h);
                    add_freetext_annot(doc, geom.page_id, c_rect, &ch.to_string(), true);
                }
                filled_keys.insert(key.clone());
                touched_acroform = true;
                continue;
            }
        }

        if let Some(ref slots) = parsed.slots {
            if let Some(parts) = segmented_parts(trimmed, slots) {
                for (part, slot) in parts.iter().zip(slots.iter()) {
                    let s_rect = to_pdf_rect(slot.x, parsed.y, slot.w, parsed.h);
                    add_freetext_annot(doc, geom.page_id, s_rect, part, true);
                }
                filled_keys.insert(key.clone());
                touched_acroform = true;
                continue;
            }
        }

        let rect_pdf = to_pdf_rect(parsed.x, parsed.y, parsed.w, parsed.h);
        add_freetext_annot(doc, geom.page_id, rect_pdf, trimmed, false);
        filled_keys.insert(key.clone());
        touched_acroform = true;
    }

    if touched_acroform {
        ensure_need_appearances(doc);
    }

    filled_keys.len()
}

/// Builds a single-page PDF wrapping an image (`RGB8`) and applies `box:...` fill overlays.
pub fn create_filled_pdf_from_image(
    img: &image::DynamicImage,
    values: &HashMap<String, String>,
) -> Result<(Document, usize)> {
    let rgb = img.to_rgb8();
    let (img_w, img_h) = rgb.dimensions();
    if img_w == 0 || img_h == 0 {
        return Err(anyhow!("empty image dimensions"));
    }

    let page_w = 595.0_f32;
    let page_h = (595.0_f64 * (f64::from(img_h) / f64::from(img_w))).clamp(120.0, 2400.0) as f32;

    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();

    let mut img_stream = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => i64::from(img_w),
            "Height" => i64::from(img_h),
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8_i64,
        },
        rgb.into_raw(),
    );
    let _ = img_stream.compress();
    let img_id = doc.add_object(img_stream);

    let draw_ops = format!("q {page_w:.2} 0 0 {page_h:.2} 0 0 cm /Im0 Do Q\n");
    let content_id = doc.add_object(Stream::new(dictionary! {}, draw_ops.into_bytes()));

    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), Object::Real(page_w), Object::Real(page_h)],
        "Resources" => dictionary! {
            "XObject" => dictionary! { "Im0" => img_id },
        },
        "Contents" => content_id,
    });

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1_i64,
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let filled = fill_pdf_document(&mut doc, values, |_, _| Vec::new());
    Ok((doc, filled))
}
