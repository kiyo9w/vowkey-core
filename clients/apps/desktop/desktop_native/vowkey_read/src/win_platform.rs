#![cfg(target_os = "windows")]

use std::{
    collections::{HashMap, HashSet},
    ffi::c_void,
    path::Path,
};

use anyhow::{anyhow, Context, Result};
use windows::{
    core::{BOOL, PCWSTR, PWSTR},
    Data::Pdf::{PdfDocument, PdfPageRenderOptions},
    Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
    Media::Ocr::OcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    Win32::{
        Foundation::{CloseHandle, COLORREF, HWND, LPARAM, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Gdi::{
                CreateCompatibleDC, CreateDIBSection, CreateFontW, CreatePen, DeleteDC,
                DeleteObject, DrawTextW, Ellipse, GdiFlush, GetStockObject, SelectObject,
                SetBkMode, SetTextColor, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLEARTYPE_QUALITY,
                CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CENTER, DT_LEFT,
                DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, HGDIOBJ, HOLLOW_BRUSH, OUT_TT_PRECIS,
                PS_SOLID, TRANSPARENT,
            },
        },
        System::{
            Com::{CoInitializeEx, COINIT_MULTITHREADED},
            Threading::{
                GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::WindowsAndMessaging::{
            EnumChildWindows, EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW,
            GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
            GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
        },
    },
};

use crate::types::{
    comb_characters, match_choice_mark, parse_box_key, segmented_parts, FrontOutput, Piece,
};

const APPLICATION_FRAME_HOST: &str = "ApplicationFrameHost.exe";

fn ensure_com() {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

struct EnumExternalCtx {
    self_pid: u32,
    found: Option<(HWND, u32)>,
}

struct ChildPidCtx {
    frame_pid: u32,
    found_pid: u32,
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let res = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast::<c_void>(),
            std::mem::size_of_val(&cloaked) as u32,
        )
    };
    res.is_ok() && cloaked != 0
}

unsafe extern "system" fn enum_external_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = unsafe { &mut *(lparam.0 as *mut EnumExternalCtx) };
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || is_cloaked(hwnd) {
        return BOOL(1);
    }
    if unsafe { GetWindowTextLengthW(hwnd) } <= 0 {
        return BOOL(1);
    }
    let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
    if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
        return BOOL(1);
    }
    if let Ok(owner) = unsafe { GetWindow(hwnd, GW_OWNER) } {
        if !owner.0.is_null() {
            return BOOL(1);
        }
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 || pid == ctx.self_pid {
        return BOOL(1);
    }
    ctx.found = Some((hwnd, pid));
    BOOL(0)
}

unsafe extern "system" fn enum_child_pid_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let ctx = unsafe { &mut *(lparam.0 as *mut ChildPidCtx) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid != 0 && pid != ctx.frame_pid {
        ctx.found_pid = pid;
        return BOOL(0);
    }
    BOOL(1)
}

fn resolve_child_pid(parent: HWND, frame_pid: u32) -> Option<u32> {
    let mut ctx = ChildPidCtx {
        frame_pid,
        found_pid: 0,
    };
    let _ = unsafe {
        EnumChildWindows(
            Some(parent),
            Some(enum_child_pid_proc),
            LPARAM(&mut ctx as *mut ChildPidCtx as isize),
        )
    };
    (ctx.found_pid != 0).then_some(ctx.found_pid)
}

fn query_process_exe_path(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    let res = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    res.ok()?;
    let slice = buf.get(..size as usize)?;
    Some(String::from_utf16_lossy(slice))
}

fn read_window_title(hwnd: HWND) -> String {
    let len = unsafe { GetWindowTextLengthW(hwnd) };
    if len <= 0 {
        return String::new();
    }
    let cap = (len as usize).saturating_add(1);
    let mut buf = vec![0u16; cap];
    let written = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if written <= 0 {
        return String::new();
    }
    let slice = buf.get(..written as usize).unwrap_or(&[]);
    String::from_utf16_lossy(slice)
}

fn extract_path_from_title(title: &str) -> (String, String) {
    let trimmed = title.trim();
    if let Some(idx) = trimmed.find("file:///") {
        let rest = trimmed.get(idx..).unwrap_or("");
        let token = rest
            .split([' ', '"', '\'', '|', '—', '–'])
            .next()
            .unwrap_or("");
        let local = token
            .strip_prefix("file:///")
            .unwrap_or("")
            .replace('/', "\\");
        if !local.is_empty() && Path::new(&local).exists() {
            return (token.to_string(), local);
        }
        return (token.to_string(), String::new());
    }

    let chars: Vec<char> = trimmed.chars().collect();
    for i in 0..chars.len() {
        let is_drive = chars.get(i).is_some_and(char::is_ascii_alphabetic)
            && chars.get(i + 1) == Some(&':')
            && matches!(chars.get(i + 2), Some(&'\\') | Some(&'/'));
        let is_unc = chars.get(i) == Some(&'\\') && chars.get(i + 1) == Some(&'\\');
        if !is_drive && !is_unc {
            continue;
        }
        let candidate_tail: String = chars.get(i..).unwrap_or(&[]).iter().collect();
        for sep in [" - ", " — ", " – ", " | ", "\"", "'", " ("] {
            if let Some(head) = candidate_tail.split(sep).next() {
                let cand = head.trim();
                if Path::new(cand).exists() {
                    return (String::new(), cand.to_string());
                }
            }
        }
        if Path::new(&candidate_tail).exists() {
            return (String::new(), candidate_tail);
        }
    }

    (String::new(), String::new())
}

pub fn front_window_info() -> FrontOutput {
    let self_pid = unsafe { GetCurrentProcessId() };
    let fg = unsafe { GetForegroundWindow() };
    let mut target: Option<(HWND, u32)> = None;

    if !fg.0.is_null() {
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(fg, Some(&mut pid)) };
        if pid != 0 && pid != self_pid {
            target = Some((fg, pid));
        }
    }

    if target.is_none() {
        let mut ctx = EnumExternalCtx {
            self_pid,
            found: None,
        };
        let _ = unsafe {
            EnumWindows(
                Some(enum_external_window_proc),
                LPARAM(&mut ctx as *mut EnumExternalCtx as isize),
            )
        };
        target = ctx.found;
    }

    let Some((hwnd, mut pid)) = target else {
        return FrontOutput {
            app: String::new(),
            bundle_id: String::new(),
            window_title: String::new(),
            title: String::new(),
            url: String::new(),
            file_path: String::new(),
            document: String::new(),
        };
    };

    let mut exe_path = query_process_exe_path(pid).unwrap_or_default();
    if exe_path
        .rsplit(['\\', '/'])
        .next()
        .is_some_and(|f| f.eq_ignore_ascii_case(APPLICATION_FRAME_HOST))
    {
        if let Some(child_pid) = resolve_child_pid(hwnd, pid) {
            pid = child_pid;
            if let Some(child_exe) = query_process_exe_path(pid) {
                exe_path = child_exe;
            }
        }
    }

    let file_name = exe_path.rsplit(['\\', '/']).next().unwrap_or("");
    let app = file_name
        .strip_suffix(".exe")
        .or_else(|| file_name.strip_suffix(".EXE"))
        .unwrap_or(file_name)
        .to_string();
    let window_title = read_window_title(hwnd);
    let (url, file_path) = extract_path_from_title(&window_title);

    FrontOutput {
        app,
        bundle_id: exe_path,
        window_title: window_title.clone(),
        title: window_title,
        url,
        file_path: file_path.clone(),
        document: file_path,
    }
}

fn bytes_to_stream(bytes: &[u8]) -> Result<InMemoryRandomAccessStream> {
    let stream = InMemoryRandomAccessStream::new().context("InMemoryRandomAccessStream::new")?;
    let writer = DataWriter::new().context("DataWriter::new")?;
    writer.WriteBytes(bytes).context("DataWriter::WriteBytes")?;
    let buffer = writer.DetachBuffer().context("DataWriter::DetachBuffer")?;
    stream
        .WriteAsync(&buffer)
        .context("InMemoryRandomAccessStream::WriteAsync")?
        .join()
        .context("InMemoryRandomAccessStream::WriteAsync join")?;
    stream
        .FlushAsync()
        .context("InMemoryRandomAccessStream::FlushAsync")?
        .join()
        .context("InMemoryRandomAccessStream::FlushAsync join")?;
    stream
        .Seek(0)
        .context("InMemoryRandomAccessStream::Seek(0)")?;
    Ok(stream)
}

fn dynamic_image_to_software_bitmap(img: &image::DynamicImage) -> Result<SoftwareBitmap> {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    if w == 0 || h == 0 {
        return Err(anyhow!("empty image"));
    }
    let mut bgra = rgba.into_raw();
    for px in bgra.chunks_exact_mut(4) {
        px.swap(0, 2);
    }
    let writer = DataWriter::new().context("DataWriter::new")?;
    writer.WriteBytes(&bgra).context("DataWriter::WriteBytes")?;
    let buffer = writer.DetachBuffer().context("DataWriter::DetachBuffer")?;
    SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)
        .context("SoftwareBitmap::CreateCopyFromBuffer")
}

fn collect_ocr_engines() -> Vec<OcrEngine> {
    let mut engines = Vec::new();
    let mut seen_tags = HashSet::new();

    if let Ok(profile_engine) = OcrEngine::TryCreateFromUserProfileLanguages() {
        if let Ok(lang) = profile_engine.RecognizerLanguage() {
            if let Ok(tag) = lang.LanguageTag() {
                seen_tags.insert(tag.to_string().to_lowercase());
            }
        }
        engines.push(profile_engine);
    }

    let preferred_prefixes = [
        "ja", "ko", "zh-hans", "zh-cn", "zh-hant", "zh-tw", "zh-hk", "vi", "en",
    ];
    if let Ok(available) = OcrEngine::AvailableRecognizerLanguages() {
        let mut candidates = Vec::new();
        for lang in available {
            if let Ok(tag_h) = lang.LanguageTag() {
                let tag_lower = tag_h.to_string().to_lowercase();
                if let Some(rank) = preferred_prefixes.iter().position(|pref| {
                    tag_lower == *pref || tag_lower.starts_with(&format!("{pref}-"))
                }) {
                    candidates.push((rank, tag_lower, lang));
                }
            }
        }
        candidates.sort_by_key(|(rank, _, _)| *rank);
        for (_, tag_lower, lang) in candidates {
            if seen_tags.contains(&tag_lower) {
                continue;
            }
            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&lang) {
                seen_tags.insert(tag_lower);
                engines.push(engine);
            }
        }
    }

    engines
}

fn is_cjk_char(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x30FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF
            | 0xFF00..=0xFFEF
    )
}

fn piece_script_score(text: &str) -> i32 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let compact: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.len() >= 20
        && compact.contains("<<")
        && compact
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '<')
    {
        return 500 + compact.len() as i32;
    }

    let mut score = 0i32;
    for ch in trimmed.chars() {
        let code = ch as u32;
        if is_cjk_char(ch) {
            score += 6;
        } else if (0x00C0..=0x024F).contains(&code) || (0x1E00..=0x1EFF).contains(&code) {
            score += 5;
        } else if ch.is_ascii_alphanumeric() {
            score += 3;
        } else if ch.is_whitespace() || ":：/-.,()[]・".contains(ch) {
            score += 1;
        } else {
            score -= 2;
        }
    }
    score
}

fn pieces_overlap(a: &Piece, b: &Piece) -> bool {
    let x_ov = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let y_ov = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if x_ov <= 0.0 || y_ov <= 0.0 {
        return false;
    }
    let min_w = a.w.min(b.w).max(0.001);
    let min_h = a.h.min(b.h).max(0.001);
    y_ov > 0.45 * min_h && x_ov > 0.35 * min_w
}

fn extract_engine_pieces(
    engine: &OcrEngine,
    bmp: &SoftwareBitmap,
    bmp_w: f64,
    bmp_h: f64,
    page_index: usize,
) -> Result<Vec<Piece>> {
    let ocr_res = engine
        .RecognizeAsync(bmp)
        .context("OcrEngine::RecognizeAsync")?
        .join()
        .context("OcrEngine::RecognizeAsync join")?;
    let lines = ocr_res.Lines().context("OcrResult::Lines")?;

    let mut out = Vec::new();
    for line in lines {
        let Ok(words) = line.Words() else {
            continue;
        };

        struct WordBox {
            text: String,
            x: f64,
            y: f64,
            w: f64,
            h: f64,
        }
        let mut word_boxes = Vec::new();
        for word in words {
            let Ok(w_text) = word.Text() else { continue };
            let Ok(rect) = word.BoundingRect() else {
                continue;
            };
            let s = w_text.to_string();
            let trimmed = s.trim();
            if trimmed.is_empty() {
                continue;
            }
            word_boxes.push(WordBox {
                text: trimmed.to_string(),
                x: f64::from(rect.X),
                y: f64::from(rect.Y),
                w: f64::from(rect.Width).max(1.0),
                h: f64::from(rect.Height).max(1.0),
            });
        }
        if word_boxes.is_empty() {
            continue;
        }

        let line_h = word_boxes.iter().map(|wb| wb.h).fold(1.0_f64, f64::max);

        let mut cur_text = String::new();
        let mut cur_min_x = 0.0_f64;
        let mut cur_min_y = 0.0_f64;
        let mut cur_max_x = 0.0_f64;
        let mut cur_max_y = 0.0_f64;

        let flush_group = |txt: &mut String,
                           min_x: f64,
                           min_y: f64,
                           max_x: f64,
                           max_y: f64,
                           dest: &mut Vec<Piece>| {
            let trimmed = txt.trim();
            if !trimmed.is_empty() {
                let nx = (min_x / bmp_w).clamp(0.0, 0.995);
                let ny = (min_y / bmp_h).clamp(0.0, 0.995);
                let nw = ((max_x - min_x) / bmp_w).clamp(0.002, 1.0 - nx);
                let nh = ((max_y - min_y) / bmp_h).clamp(0.002, 1.0 - ny);
                dest.push(Piece {
                    text: trimmed.to_string(),
                    page: page_index,
                    x: nx,
                    y: ny,
                    w: nw,
                    h: nh,
                    confidence: 0.92,
                });
            }
            txt.clear();
        };

        for wb in word_boxes {
            if cur_text.is_empty() {
                cur_text.push_str(&wb.text);
                cur_min_x = wb.x;
                cur_min_y = wb.y;
                cur_max_x = wb.x + wb.w;
                cur_max_y = wb.y + wb.h;
                continue;
            }
            let gap = wb.x - cur_max_x;
            if gap > line_h * 0.85 {
                flush_group(
                    &mut cur_text,
                    cur_min_x,
                    cur_min_y,
                    cur_max_x,
                    cur_max_y,
                    &mut out,
                );
                cur_text.push_str(&wb.text);
                cur_min_x = wb.x;
                cur_min_y = wb.y;
                cur_max_x = wb.x + wb.w;
                cur_max_y = wb.y + wb.h;
            } else {
                let prev_cjk = cur_text.chars().last().is_some_and(is_cjk_char);
                let next_cjk = wb.text.chars().next().is_some_and(is_cjk_char);
                if !(prev_cjk && next_cjk && gap < line_h * 0.45) {
                    cur_text.push(' ');
                }
                cur_text.push_str(&wb.text);
                cur_min_x = cur_min_x.min(wb.x);
                cur_min_y = cur_min_y.min(wb.y);
                cur_max_x = cur_max_x.max(wb.x + wb.w);
                cur_max_y = cur_max_y.max(wb.y + wb.h);
            }
        }

        flush_group(
            &mut cur_text,
            cur_min_x,
            cur_min_y,
            cur_max_x,
            cur_max_y,
            &mut out,
        );
    }

    Ok(out)
}

fn ocr_software_bitmap(bmp: &SoftwareBitmap, page_index: usize) -> Result<Vec<Piece>> {
    let bmp_w = f64::from(bmp.PixelWidth()?.max(1));
    let bmp_h = f64::from(bmp.PixelHeight()?.max(1));
    let engines = collect_ocr_engines();
    if engines.is_empty() {
        return Err(anyhow!("no Windows Media OCR language packs available"));
    }

    let mut merged: Vec<Piece> = Vec::new();
    for engine in &engines {
        let Ok(candidate_pieces) = extract_engine_pieces(engine, bmp, bmp_w, bmp_h, page_index)
        else {
            continue;
        };
        if merged.is_empty() {
            merged = candidate_pieces;
            continue;
        }
        for cand in candidate_pieces {
            let cand_score = piece_script_score(&cand.text);
            let mut overlapped_idx = None;
            for (idx, existing) in merged.iter().enumerate() {
                if pieces_overlap(existing, &cand) {
                    overlapped_idx = Some(idx);
                    break;
                }
            }
            if let Some(idx) = overlapped_idx {
                if let Some(existing) = merged.get_mut(idx) {
                    if cand_score > piece_script_score(&existing.text) {
                        *existing = cand;
                    }
                }
            } else {
                merged.push(cand);
            }
        }
    }

    merged.sort_by(|a, b| {
        a.y.partial_cmp(&b.y)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });
    Ok(merged)
}

pub fn ocr_image_file(path: &Path) -> Result<(u32, u32, Vec<Piece>)> {
    ensure_com();
    let bytes = std::fs::read(path)
        .with_context(|| format!("failed to read image file {}", path.display()))?;
    let max_dim = OcrEngine::MaxImageDimension().unwrap_or(4096).max(2048);

    if let Ok(decoded_img) = image::load_from_memory(&bytes) {
        let orig_w = decoded_img.width().max(1);
        let orig_h = decoded_img.height().max(1);
        let working = if orig_w.min(orig_h) < 900
            && orig_w.saturating_mul(2) <= max_dim
            && orig_h.saturating_mul(2) <= max_dim
        {
            decoded_img.resize(
                orig_w * 2,
                orig_h * 2,
                image::imageops::FilterType::CatmullRom,
            )
        } else if orig_w > max_dim || orig_h > max_dim {
            decoded_img.resize(max_dim, max_dim, image::imageops::FilterType::Triangle)
        } else {
            decoded_img
        };
        let bmp = dynamic_image_to_software_bitmap(&working)?;
        let pieces = ocr_software_bitmap(&bmp, 0)?;
        return Ok((orig_w, orig_h, pieces));
    }

    let stream = bytes_to_stream(&bytes)?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .context("BitmapDecoder::CreateAsync")?
        .join()
        .context("BitmapDecoder::CreateAsync join")?;
    let orig_w = decoder
        .OrientedPixelWidth()
        .or_else(|_| decoder.PixelWidth())?
        .max(1);
    let orig_h = decoder
        .OrientedPixelHeight()
        .or_else(|_| decoder.PixelHeight())?
        .max(1);
    let bmp = match decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
    {
        Ok(op) => op.join()?,
        Err(_) => {
            let raw = decoder.GetSoftwareBitmapAsync()?.join()?;
            SoftwareBitmap::Convert(&raw, BitmapPixelFormat::Bgra8)?
        }
    };
    let pieces = ocr_software_bitmap(&bmp, 0)?;
    Ok((orig_w, orig_h, pieces))
}

pub fn ocr_pdf_page(pdf_bytes: &[u8], page_index: usize) -> Result<(u32, u32, Vec<Piece>)> {
    ensure_com();
    let pdf_stream = bytes_to_stream(pdf_bytes)?;
    let pdf_doc = PdfDocument::LoadFromStreamAsync(&pdf_stream)
        .context("PdfDocument::LoadFromStreamAsync")?
        .join()
        .context("PdfDocument::LoadFromStreamAsync join")?;
    let count = pdf_doc.PageCount()? as usize;
    if page_index >= count {
        return Err(anyhow!(
            "PDF page index {page_index} out of range ({count})"
        ));
    }

    let page = pdf_doc.GetPage(page_index as u32)?;
    let size = page.Size()?;
    let max_pt = f64::from(size.Width.max(size.Height)).max(1.0);
    let max_dim = f64::from(OcrEngine::MaxImageDimension().unwrap_or(4096)).max(2048.0) - 32.0;
    let scale = (2400.0 / max_pt).clamp(2.0, 3.5).min(max_dim / max_pt);
    let dst_w = ((f64::from(size.Width) * scale).round() as u32).max(64);
    let dst_h = ((f64::from(size.Height) * scale).round() as u32).max(64);

    let opts = PdfPageRenderOptions::new()?;
    opts.SetDestinationWidth(dst_w)?;
    opts.SetDestinationHeight(dst_h)?;

    let render_stream = InMemoryRandomAccessStream::new()?;
    page.RenderWithOptionsToStreamAsync(&render_stream, &opts)
        .context("PdfPage::RenderWithOptionsToStreamAsync")?
        .join()
        .context("PdfPage::RenderWithOptionsToStreamAsync join")?;
    render_stream.FlushAsync()?.join()?;
    render_stream.Seek(0)?;

    let decoder = BitmapDecoder::CreateAsync(&render_stream)?.join()?;
    let bmp = match decoder
        .GetSoftwareBitmapConvertedAsync(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore)
    {
        Ok(op) => op.join()?,
        Err(_) => {
            let raw = decoder.GetSoftwareBitmapAsync()?.join()?;
            SoftwareBitmap::Convert(&raw, BitmapPixelFormat::Bgra8)?
        }
    };
    let pieces = ocr_software_bitmap(&bmp, page_index)?;
    Ok((dst_w, dst_h, pieces))
}

pub fn fill_image_with_gdi(
    img: &image::DynamicImage,
    values: &HashMap<String, String>,
) -> Result<(image::RgbaImage, usize)> {
    let orig_rgba = img.to_rgba8();
    let (w_u32, h_u32) = orig_rgba.dimensions();
    if w_u32 == 0 || h_u32 == 0 {
        return Err(anyhow!("empty image dimensions"));
    }
    let w = w_u32 as i32;
    let h = h_u32 as i32;
    let pixel_count = (w_u32 as usize).saturating_mul(h_u32 as usize);

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down DIB
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            biSizeImage: (pixel_count * 4) as u32,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: Default::default(),
    };

    let hdc = unsafe { CreateCompatibleDC(None) };
    if hdc.0.is_null() {
        return Err(anyhow!("CreateCompatibleDC failed"));
    }

    let mut bits_ptr: *mut c_void = std::ptr::null_mut();
    let hbmp = match unsafe {
        CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits_ptr, None, 0)
    } {
        Ok(b) if !b.0.is_null() && !bits_ptr.is_null() => b,
        _ => {
            let _ = unsafe { DeleteDC(hdc) };
            return Err(anyhow!("CreateDIBSection failed"));
        }
    };

    let old_bmp = unsafe { SelectObject(hdc, HGDIOBJ(hbmp.0)) };
    let src_raw = orig_rgba.as_raw();
    let dib_slice =
        unsafe { std::slice::from_raw_parts_mut(bits_ptr.cast::<u8>(), pixel_count * 4) };
    for (dst_px, src_px) in dib_slice.chunks_exact_mut(4).zip(src_raw.chunks_exact(4)) {
        if let ([b_out, g_out, r_out, a_out], [r_in, g_in, b_in, a_in]) = (dst_px, src_px) {
            *b_out = *b_in;
            *g_out = *g_in;
            *r_out = *r_in;
            *a_out = *a_in;
        }
    }

    // COLORREF is 0x00BBGGRR: dark navy ink RGB(10, 38, 107).
    let ink_color = COLORREF(0x006B_260A);
    unsafe {
        let _ = SetBkMode(hdc, TRANSPARENT);
        let _ = SetTextColor(hdc, ink_color);
    }

    let face_wide: Vec<u16> = "Yu Gothic UI"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let draw_text_in_norm = |nx: f64, ny: f64, nw: f64, nh: f64, text: &str, centered: bool| {
        let left = (nx * f64::from(w_u32)).round() as i32;
        let top = (ny * f64::from(h_u32)).round() as i32;
        let right = ((nx + nw) * f64::from(w_u32)).round() as i32;
        let bottom = ((ny + nh) * f64::from(h_u32)).round() as i32;
        let box_w = (right - left).max(4);
        let box_h = (bottom - top).max(8);
        let char_count = text.chars().count().max(1) as f64;
        let font_px = ((f64::from(box_h) * 0.68)
            .min((f64::from(box_w) * 0.94) / (char_count * 0.58).max(1.0)))
        .clamp(11.0, 64.0)
        .round() as i32;

        let hfont = unsafe {
            CreateFontW(
                -font_px,
                0,
                0,
                0,
                500,
                0,
                0,
                0,
                DEFAULT_CHARSET,
                OUT_TT_PRECIS,
                CLIP_DEFAULT_PRECIS,
                CLEARTYPE_QUALITY,
                0,
                PCWSTR(face_wide.as_ptr()),
            )
        };
        let prev_font = if !hfont.0.is_null() {
            Some(unsafe { SelectObject(hdc, HGDIOBJ(hfont.0)) })
        } else {
            None
        };

        let mut utf16: Vec<u16> = text.encode_utf16().collect();
        let mut rc = RECT {
            left: if centered { left } else { left + 2 },
            top,
            right,
            bottom,
        };
        let fmt =
            DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX | if centered { DT_CENTER } else { DT_LEFT };
        let _ = unsafe { DrawTextW(hdc, &mut utf16, &mut rc, fmt) };

        if let Some(pf) = prev_font {
            let _ = unsafe { SelectObject(hdc, pf) };
            let _ = unsafe { DeleteObject(HGDIOBJ(hfont.0)) };
        }
    };

    let pen_w = ((f64::from(w_u32.min(h_u32)) * 0.0022).round() as i32).clamp(2, 6);
    let hpen = unsafe { CreatePen(PS_SOLID, pen_w, ink_color) };
    let prev_pen = unsafe { SelectObject(hdc, HGDIOBJ(hpen.0)) };
    let hollow = unsafe { GetStockObject(HOLLOW_BRUSH) };
    let prev_brush = unsafe { SelectObject(hdc, hollow) };

    let mut filled = 0usize;
    for (key, raw_val) in values {
        let trimmed = raw_val.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(parsed) = parse_box_key(key) else {
            continue;
        };
        if parsed.page != 0 {
            continue;
        }

        if let Some(ref choices) = parsed.choices {
            if let Some(hit) = match_choice_mark(trimmed, choices) {
                let left = (hit.x * f64::from(w_u32)).round() as i32 - 2;
                let top = (hit.y * f64::from(h_u32)).round() as i32 - 2;
                let right = ((hit.x + hit.w) * f64::from(w_u32)).round() as i32 + 2;
                let bottom = ((hit.y + hit.h) * f64::from(h_u32)).round() as i32 + 2;
                let _ = unsafe { Ellipse(hdc, left, top, right, bottom) };
                filled += 1;
                continue;
            }
        }

        if let Some(cells) = parsed.comb {
            if cells > 1 {
                let chars = comb_characters(trimmed, cells);
                let cell_w = parsed.w / cells as f64;
                for (idx, ch) in chars.into_iter().take(cells).enumerate() {
                    let cx = parsed.x + idx as f64 * cell_w;
                    draw_text_in_norm(cx, parsed.y, cell_w, parsed.h, &ch.to_string(), true);
                }
                filled += 1;
                continue;
            }
        }

        if let Some(ref slots) = parsed.slots {
            if let Some(parts) = segmented_parts(trimmed, slots) {
                for (part, slot) in parts.iter().zip(slots.iter()) {
                    draw_text_in_norm(slot.x, parsed.y, slot.w, parsed.h, part, true);
                }
                filled += 1;
                continue;
            }
        }

        draw_text_in_norm(parsed.x, parsed.y, parsed.w, parsed.h, trimmed, false);
        filled += 1;
    }

    let _ = unsafe { GdiFlush() };

    let mut out_rgba = vec![0u8; pixel_count * 4];
    for ((out_px, dib_px), orig_px) in out_rgba
        .chunks_exact_mut(4)
        .zip(dib_slice.chunks_exact(4))
        .zip(src_raw.chunks_exact(4))
    {
        if let (
            [r_out, g_out, b_out, a_out],
            [b_dib, g_dib, r_dib, _],
            [r_orig, g_orig, b_orig, a_orig],
        ) = (out_px, dib_px, orig_px)
        {
            *r_out = *r_dib;
            *g_out = *g_dib;
            *b_out = *b_dib;
            *a_out = if *r_dib != *r_orig || *g_dib != *g_orig || *b_dib != *b_orig {
                255
            } else {
                *a_orig
            };
        }
    }

    unsafe {
        let _ = SelectObject(hdc, prev_brush);
        let _ = SelectObject(hdc, prev_pen);
        let _ = DeleteObject(HGDIOBJ(hpen.0));
        let _ = SelectObject(hdc, old_bmp);
        let _ = DeleteObject(HGDIOBJ(hbmp.0));
        let _ = DeleteDC(hdc);
    }

    image::RgbaImage::from_raw(w_u32, h_u32, out_rgba)
        .ok_or_else(|| anyhow!("failed to build output RgbaImage"))
        .map(|rgba| (rgba, filled))
}
