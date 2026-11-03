mod pdf_ops;
mod types;
#[cfg(target_os = "windows")]
mod win_platform;

use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    process::ExitCode,
};

use anyhow::{anyhow, bail, Context, Result};
use pdf_ops::{
    classify_pdf, collect_page_geometries, create_filled_pdf_from_image,
    extract_page_digital_pieces, extract_pdf_form, fill_pdf_document, is_xfa_only, load_pdf_bytes,
    PageGeometry,
};
use types::{
    classify_from_pieces, compute_legibility, detect_visual_form_fields, group_pieces_into_lines,
    ClassifyOutput, FillOutput, FormOutput, PageReading, Piece, PiecesOutput,
};

fn write_stdout_line(s: &str) -> Result<()> {
    let mut out = std::io::stdout().lock();
    out.write_all(s.as_bytes())?;
    if !s.ends_with('\n') {
        out.write_all(b"\n")?;
    }
    out.flush()?;
    Ok(())
}

fn write_stderr_line(s: &str) {
    let mut err = std::io::stderr().lock();
    let _ = err.write_all(s.as_bytes());
    if !s.ends_with('\n') {
        let _ = err.write_all(b"\n");
    }
    let _ = err.flush();
}

fn is_pdf_file(path: &Path, sniff: Option<&[u8]>) -> bool {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
    {
        return true;
    }
    sniff.is_some_and(|bytes| {
        bytes
            .get(..1024.min(bytes.len()))
            .is_some_and(|head| head.windows(5).any(|w| w == b"%PDF-"))
    })
}

fn read_pdf_page_pieces(
    doc: &lopdf::Document,
    raw_bytes: &[u8],
    geom: &PageGeometry,
) -> Vec<Piece> {
    let digital = extract_page_digital_pieces(doc, geom);
    let non_ws_chars: usize = digital
        .iter()
        .map(|p| p.text.chars().filter(|c| !c.is_whitespace()).count())
        .sum();
    if non_ws_chars >= 20 {
        return digital;
    }

    #[cfg(target_os = "windows")]
    {
        if !is_xfa_only(doc, Some(raw_bytes)) {
            if let Ok((_, _, ocr_pieces)) = win_platform::ocr_pdf_page(raw_bytes, geom.page_index) {
                let ocr_chars: usize = ocr_pieces
                    .iter()
                    .map(|p| p.text.chars().filter(|c| !c.is_whitespace()).count())
                    .sum();
                if ocr_chars > non_ws_chars {
                    return ocr_pieces;
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = raw_bytes;
    }

    digital
}

fn read_image_pieces(path: &Path) -> Result<(u32, u32, Vec<Piece>)> {
    #[cfg(target_os = "windows")]
    {
        win_platform::ocr_image_file(path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let img = image::open(path)
            .with_context(|| format!("cannot decode image file {}", path.display()))?;
        Ok((img.width().max(1), img.height().max(1), Vec::new()))
    }
}

fn build_pieces_output(path: &Path) -> Result<PiecesOutput> {
    let raw_bytes =
        std::fs::read(path).with_context(|| format!("cannot read file {}", path.display()))?;

    if is_pdf_file(path, Some(&raw_bytes)) {
        let doc = load_pdf_bytes(&raw_bytes)?;
        let geoms = collect_page_geometries(&doc);
        let xfa_only = is_xfa_only(&doc, Some(&raw_bytes));
        let mut pages = Vec::with_capacity(geoms.len());
        let mut all_pieces = Vec::new();
        let mut page_blocks = Vec::new();

        for geom in &geoms {
            #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
            let mut page_pixel_h: Option<f64> = None;
            let pieces = if xfa_only {
                Vec::new()
            } else {
                let digital = extract_page_digital_pieces(&doc, geom);
                let non_ws: usize = digital
                    .iter()
                    .map(|p| p.text.chars().filter(|c| !c.is_whitespace()).count())
                    .sum();
                if non_ws >= 20 {
                    digital
                } else {
                    #[cfg(target_os = "windows")]
                    {
                        match win_platform::ocr_pdf_page(&raw_bytes, geom.page_index) {
                            Ok((_, h_px, ocr_p)) if !ocr_p.is_empty() => {
                                page_pixel_h = Some(f64::from(h_px));
                                ocr_p
                            }
                            _ => digital,
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        digital
                    }
                }
            };

            let lines = group_pieces_into_lines(&pieces);
            if !lines.is_empty() {
                page_blocks.push(lines.join("\n"));
            }
            let (unsure, line_height, diagnostic) =
                compute_legibility(&pieces, page_pixel_h, !xfa_only && page_pixel_h.is_some());
            all_pieces.extend(pieces.clone());
            pages.push(PageReading {
                index: geom.page_index,
                width: geom.width,
                height: geom.height,
                aspect: geom.width / geom.height.max(1.0),
                unsure,
                line_height,
                diagnostic,
                pieces,
            });
        }

        return Ok(PiecesOutput {
            text: page_blocks.join("\n\n"),
            page_count: geoms.len(),
            pages,
            pieces: all_pieces,
        });
    }

    let (w, h, pieces) = read_image_pieces(path)?;
    let lines = group_pieces_into_lines(&pieces);
    let (unsure, line_height, diagnostic) = compute_legibility(&pieces, Some(f64::from(h)), true);
    let page = PageReading {
        index: 0,
        width: f64::from(w),
        height: f64::from(h),
        aspect: f64::from(w) / f64::from(h.max(1)),
        unsure,
        line_height,
        diagnostic,
        pieces: pieces.clone(),
    };
    Ok(PiecesOutput {
        text: lines.join("\n"),
        page_count: 1,
        pages: vec![page],
        pieces,
    })
}

fn parse_fill_values_json(raw_json: &str) -> Result<HashMap<String, String>> {
    let root: serde_json::Value =
        serde_json::from_str(raw_json).context("invalid JSON fill payload")?;
    let Some(obj) = root.as_object() else {
        bail!("fill payload must be a JSON object");
    };

    let map_source = obj
        .get("values")
        .and_then(serde_json::Value::as_object)
        .or_else(|| obj.get("fields").and_then(serde_json::Value::as_object))
        .unwrap_or(obj);

    let mut out = HashMap::with_capacity(map_source.len());
    for (k, v) in map_source {
        match v {
            serde_json::Value::Null => {}
            serde_json::Value::String(s) => {
                out.insert(k.clone(), s.clone());
            }
            serde_json::Value::Bool(b) => {
                out.insert(k.clone(), b.to_string());
            }
            serde_json::Value::Number(n) => {
                out.insert(k.clone(), n.to_string());
            }
            other => {
                out.insert(k.clone(), other.to_string());
            }
        }
    }
    Ok(out)
}

fn execute_fill(
    in_path: &Path,
    out_path: &Path,
    values: &HashMap<String, String>,
) -> Result<usize> {
    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("cannot create output directory {}", parent.display()))?;
        }
    }

    let raw_bytes = std::fs::read(in_path)
        .with_context(|| format!("cannot read input file {}", in_path.display()))?;

    if is_pdf_file(in_path, Some(&raw_bytes)) {
        let mut doc = load_pdf_bytes(&raw_bytes)?;
        let filled = fill_pdf_document(&mut doc, values, |d, geom| {
            read_pdf_page_pieces(d, &raw_bytes, geom)
        });
        doc.save(out_path)
            .with_context(|| format!("cannot save filled PDF to {}", out_path.display()))?;
        return Ok(filled);
    }

    let img = image::load_from_memory(&raw_bytes)
        .with_context(|| format!("cannot decode input image {}", in_path.display()))?;
    let out_wants_pdf = out_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));

    if out_wants_pdf {
        let (mut doc, filled) = create_filled_pdf_from_image(&img, values)?;
        doc.save(out_path)
            .with_context(|| format!("cannot save filled PDF to {}", out_path.display()))?;
        return Ok(filled);
    }

    #[cfg(target_os = "windows")]
    {
        let (rgba, filled) = win_platform::fill_image_with_gdi(&img, values)?;
        rgba.save(out_path)
            .with_context(|| format!("cannot save filled image to {}", out_path.display()))?;
        Ok(filled)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let (_, filled) = create_filled_pdf_from_image(&img, values)?;
        img.save(out_path)
            .with_context(|| format!("cannot save output image to {}", out_path.display()))?;
        Ok(filled)
    }
}

fn normalize_cli_args(raw: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(raw.len());
    let mut idx = 0;
    while idx < raw.len() {
        if raw.get(idx).is_some_and(|a| a == "--mode") {
            if let Some(mode_val) = raw.get(idx + 1) {
                let mapped = match mode_val.as_str() {
                    "places" | "pieces" => "--pieces",
                    "form" => "--form",
                    "stamp" | "fill" => "--fill",
                    "classify" => "--classify",
                    "front" => "--front",
                    _ => "",
                };
                if !mapped.is_empty() {
                    out.push(mapped.to_string());
                    idx += 2;
                    continue;
                }
            }
        }
        if let Some(arg) = raw.get(idx) {
            out.push(arg.clone());
        }
        idx += 1;
    }
    out
}

fn run() -> Result<()> {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    let args = normalize_cli_args(raw_args);

    let Some(first) = args.first().map(String::as_str) else {
        bail!(
            "usage: vowkey-read [--front | --classify <path> | --form <path> | --pieces <path> | --fill [<spec.json>] <in> <out> | <path>]"
        );
    };

    match first {
        "--front" => {
            #[cfg(target_os = "windows")]
            let front = win_platform::front_window_info();
            #[cfg(not(target_os = "windows"))]
            let front = types::FrontOutput {
                app: String::new(),
                bundle_id: String::new(),
                window_title: String::new(),
                title: String::new(),
                url: String::new(),
                file_path: String::new(),
                document: String::new(),
            };
            write_stdout_line(&serde_json::to_string(&front)?)?;
        }
        "--classify" => {
            let target = args
                .get(1)
                .ok_or_else(|| anyhow!("usage: vowkey-read --classify <path>"))?;
            let path = Path::new(target);
            let raw_bytes = std::fs::read(path)
                .with_context(|| format!("cannot read file {}", path.display()))?;
            let out: ClassifyOutput = if is_pdf_file(path, Some(&raw_bytes)) {
                let doc = load_pdf_bytes(&raw_bytes)?;
                classify_pdf(&doc, Some(&raw_bytes), |d, geom| {
                    read_pdf_page_pieces(d, &raw_bytes, geom)
                })
            } else {
                let (w, h, pieces) = read_image_pieces(path)?;
                classify_from_pieces(&pieces, 1, f64::from(w) / f64::from(h.max(1)))
            };
            write_stdout_line(&serde_json::to_string(&out)?)?;
        }
        "--form" => {
            let target = args
                .get(1)
                .ok_or_else(|| anyhow!("usage: vowkey-read --form <path>"))?;
            let path = Path::new(target);
            let raw_bytes = std::fs::read(path)
                .with_context(|| format!("cannot read file {}", path.display()))?;
            let out: FormOutput = if is_pdf_file(path, Some(&raw_bytes)) {
                let doc = load_pdf_bytes(&raw_bytes)?;
                extract_pdf_form(&doc, Some(&raw_bytes), |d, geom| {
                    read_pdf_page_pieces(d, &raw_bytes, geom)
                })
            } else {
                let (_, _, pieces) = read_image_pieces(path)?;
                let fields = detect_visual_form_fields(&pieces, 0);
                FormOutput {
                    page_count: 1,
                    interactive: false,
                    fields,
                    xfa_only: None,
                }
            };
            write_stdout_line(&serde_json::to_string(&out)?)?;
        }
        "--pieces" => {
            let target = args
                .get(1)
                .ok_or_else(|| anyhow!("usage: vowkey-read --pieces <path>"))?;
            let out = build_pieces_output(Path::new(target))?;
            write_stdout_line(&serde_json::to_string(&out)?)?;
        }
        "--fill" => {
            if args.len() >= 4 {
                let spec_path = args
                    .get(1)
                    .ok_or_else(|| anyhow!("missing fill spec path"))?;
                let in_path = args.get(2).ok_or_else(|| anyhow!("missing input path"))?;
                let out_path = args.get(3).ok_or_else(|| anyhow!("missing output path"))?;
                let spec_raw = std::fs::read_to_string(spec_path)
                    .with_context(|| format!("cannot read fill spec {spec_path}"))?;
                let values = parse_fill_values_json(&spec_raw)?;
                let filled = execute_fill(Path::new(in_path), Path::new(out_path), &values)?;
                let payload = FillOutput {
                    filled,
                    output: out_path.clone(),
                };
                write_stdout_line(&serde_json::to_string(&payload)?)?;
            } else if args.len() == 3 {
                let in_path = args.get(1).ok_or_else(|| anyhow!("missing input path"))?;
                let out_path = args.get(2).ok_or_else(|| anyhow!("missing output path"))?;
                let mut stdin_buf = String::new();
                std::io::stdin()
                    .read_to_string(&mut stdin_buf)
                    .context("failed reading fill JSON from stdin")?;
                let values = parse_fill_values_json(&stdin_buf)?;
                let filled = execute_fill(Path::new(in_path), Path::new(out_path), &values)?;
                write_stdout_line(&filled.to_string())?;
            } else {
                bail!("usage: vowkey-read --fill [<spec.json>] <in-path> <out-path>");
            }
        }
        single_path => {
            let out = build_pieces_output(Path::new(single_path))?;
            if !out.text.trim().is_empty() {
                write_stdout_line(&out.text)?;
            }
        }
    }

    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            write_stderr_line(&format!("vowkey-read: {err}"));
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use lopdf::{dictionary, Document, Object, Stream, StringFormat};

    use crate::pdf_ops::{
        classify_pdf, collect_page_geometries, decode_pdf_string, extract_page_digital_pieces,
        extract_pdf_form, fill_pdf_document, is_xfa_only, load_pdf_bytes,
    };

    fn make_acroform_radio_and_unicode_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });

        let content_ops = concat!(
            "BT /F1 12 Tf 50 744 Td (Full Name:) Tj ET\n",
            "BT /F1 12 Tf 50 704 Td (Address:) Tj ET\n",
            "BT /F1 12 Tf 50 664 Td (Sex:) Tj ET\n",
            "BT /F1 12 Tf 172 664 Td (Male) Tj ET\n",
            "BT /F1 12 Tf 262 664 Td (Female) Tj ET\n",
        );
        let content_id =
            doc.add_object(Stream::new(dictionary! {}, content_ops.as_bytes().to_vec()));

        let ap_off = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 14.into(), 14.into()],
            },
            b"0.7 G 1 w 1 1 12 12 re S".to_vec(),
        ));
        let ap_on = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 14.into(), 14.into()],
            },
            b"0 g 2 2 10 10 re f".to_vec(),
        ));

        let full_name_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::String(b"full_name".to_vec(), StringFormat::Literal),
            "Rect" => vec![150.into(), 740.into(), 380.into(), 760.into()],
        });

        let address_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Tx",
            "T" => Object::String(b"address".to_vec(), StringFormat::Literal),
            "Rect" => vec![150.into(), 700.into(), 420.into(), 720.into()],
        });

        let sex_group_id = doc.new_object_id();
        let male_kid_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Parent" => sex_group_id,
            "Rect" => vec![150.into(), 660.into(), 166.into(), 676.into()],
            "AS" => "M",
            "AP" => dictionary! {
                "N" => dictionary! {
                    "M" => ap_on,
                    "Off" => ap_off,
                }
            },
        });
        let female_kid_id = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "Parent" => sex_group_id,
            "Rect" => vec![240.into(), 660.into(), 256.into(), 676.into()],
            "AS" => "Off",
            "AP" => dictionary! {
                "N" => dictionary! {
                    "F" => ap_on,
                    "Off" => ap_off,
                }
            },
        });

        doc.objects.insert(
            sex_group_id,
            Object::Dictionary(dictionary! {
                "FT" => "Btn",
                "Ff" => 49152_i64,
                "T" => Object::String(b"sex".to_vec(), StringFormat::Literal),
                "V" => "M",
                "Kids" => vec![male_kid_id.into(), female_kid_id.into()],
            }),
        );

        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => dictionary! {
                "Font" => dictionary! { "F1" => font_id },
            },
            "Contents" => content_id,
            "Annots" => vec![
                full_name_id.into(),
                address_id.into(),
                male_kid_id.into(),
                female_kid_id.into(),
            ],
        });

        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![page_id.into()],
                "Count" => 1_i64,
            }),
        );

        let acro_id = doc.add_object(dictionary! {
            "Fields" => vec![
                full_name_id.into(),
                address_id.into(),
                sex_group_id.into(),
            ],
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "AcroForm" => acro_id,
        });
        doc.trailer.set("Root", catalog_id);

        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    fn make_xfa_only_pdf() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let content_id = doc.add_object(Stream::new(
            dictionary! {},
            b"BT /F1 12 Tf 50 750 Td (Please wait... If this message is not eventually replaced by the proper contents of the document, your PDF viewer may not be able to display this type of document. Adobe Reader) Tj ET".to_vec(),
        ));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => dictionary! { "Font" => dictionary! { "F1" => font_id } },
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
        let xfa_stream = doc.add_object(Stream::new(
            dictionary! {},
            b"<xdp:xdp xmlns:xdp=\"http://ns.adobe.com/xdp/\"><template xmlns=\"http://www.xfa.org/schema/xfa-template/3.3/\"/></xdp:xdp>".to_vec(),
        ));
        let acro_id = doc.add_object(dictionary! {
            "Fields" => Vec::<Object>::new(),
            "XFA" => xfa_stream,
        });
        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
            "AcroForm" => acro_id,
        });
        doc.trailer.set("Root", catalog_id);

        let mut buf = Vec::new();
        doc.save_to(&mut buf).unwrap();
        buf
    }

    #[test]
    fn acroform_classify_extract_and_unicode_radio_fill_round_trip() {
        let raw = make_acroform_radio_and_unicode_pdf();
        let mut doc = load_pdf_bytes(&raw).unwrap();

        let cls = classify_pdf(&doc, Some(&raw), extract_page_digital_pieces);
        assert_eq!(cls.kind, "form");
        assert_eq!(cls.interactive_field_count, 4);
        assert_eq!(cls.widgets, 4);
        assert_eq!(cls.xfa_only, None);

        let form = extract_pdf_form(&doc, Some(&raw), extract_page_digital_pieces);
        assert!(form.interactive);
        assert_eq!(form.fields.len(), 4);

        let male = form.fields.iter().find(|f| f.key == "sex#M").unwrap();
        let female = form.fields.iter().find(|f| f.key == "sex#F").unwrap();
        assert_eq!(male.field_type, "radio");
        assert_eq!(female.field_type, "radio");
        assert_eq!(male.label, "Sex:");
        assert_eq!(female.label, "Sex:");
        assert_eq!(male.option_caption.as_deref(), Some("Male"));
        assert_eq!(female.option_caption.as_deref(), Some("Female"));
        assert_eq!(male.export_value.as_deref(), Some("M"));
        assert_eq!(female.export_value.as_deref(), Some("F"));

        let mut values = HashMap::new();
        values.insert("full_name".to_string(), "Nguyễn Thị Linh".to_string());
        values.insert("address".to_string(), "東京都港区六本木1-2-3".to_string());
        values.insert("sex".to_string(), "Female".to_string());

        let filled_count = fill_pdf_document(&mut doc, &values, extract_page_digital_pieces);
        assert_eq!(filled_count, 3);

        let mut saved = Vec::new();
        doc.save_to(&mut saved).unwrap();
        let reloaded = load_pdf_bytes(&saved).unwrap();

        let acro_ref = reloaded
            .catalog()
            .unwrap()
            .get(b"AcroForm")
            .unwrap()
            .as_reference()
            .unwrap();
        let acro_dict = reloaded.get_dictionary(acro_ref).unwrap();
        assert_eq!(
            acro_dict
                .get(b"NeedAppearances")
                .unwrap()
                .as_bool()
                .unwrap(),
            true
        );

        let geoms = collect_page_geometries(&reloaded);
        let page_dict = reloaded.get_dictionary(geoms[0].page_id).unwrap();
        let annots = page_dict.get(b"Annots").unwrap().as_array().unwrap();

        let fn_dict = reloaded
            .get_dictionary(annots[0].as_reference().unwrap())
            .unwrap();
        if let Object::String(v_bytes, _) = fn_dict.get(b"V").unwrap() {
            assert_eq!(decode_pdf_string(v_bytes), "Nguyễn Thị Linh");
        } else {
            panic!("expected String /V for full_name");
        }

        let addr_dict = reloaded
            .get_dictionary(annots[1].as_reference().unwrap())
            .unwrap();
        if let Object::String(v_bytes, _) = addr_dict.get(b"V").unwrap() {
            assert_eq!(decode_pdf_string(v_bytes), "東京都港区六本木1-2-3");
        } else {
            panic!("expected String /V for address");
        }

        let male_dict = reloaded
            .get_dictionary(annots[2].as_reference().unwrap())
            .unwrap();
        let female_dict = reloaded
            .get_dictionary(annots[3].as_reference().unwrap())
            .unwrap();
        assert_eq!(male_dict.get(b"AS").unwrap().as_name().unwrap(), b"Off");
        assert_eq!(female_dict.get(b"AS").unwrap().as_name().unwrap(), b"F");

        let sex_parent_id = female_dict.get(b"Parent").unwrap().as_reference().unwrap();
        let sex_parent = reloaded.get_dictionary(sex_parent_id).unwrap();
        assert_eq!(sex_parent.get(b"V").unwrap().as_name().unwrap(), b"F");
    }

    #[test]
    fn xfa_only_pdf_is_flagged_and_skips_placeholder_ocr() {
        let raw = make_xfa_only_pdf();
        let doc = load_pdf_bytes(&raw).unwrap();
        assert!(is_xfa_only(&doc, Some(&raw)));

        let cls = classify_pdf(&doc, Some(&raw), extract_page_digital_pieces);
        assert_eq!(cls.kind, "form");
        assert_eq!(cls.widgets, 0);
        assert_eq!(cls.xfa_only, Some(true));

        let form = extract_pdf_form(&doc, Some(&raw), extract_page_digital_pieces);
        assert!(!form.interactive);
        assert!(form.fields.is_empty());
        assert_eq!(form.xfa_only, Some(true));
    }

    #[test]
    fn flat_pdf_box_and_choice_overlay_fill_adds_annotations() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
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

        let mut values = HashMap::new();
        values.insert(
            "box:0:0.2000:0.1500:0.4000:0.0300".to_string(),
            "NGUYEN THI LINH".to_string(),
        );
        values.insert(
            "box:0:0.3000:0.2500:0.1200:0.0250:choices:男@0.3000,0.2500,0.0500,0.0250;女@0.3600,0.2500,0.0500,0.0250".to_string(),
            "Female".to_string(),
        );

        let filled = fill_pdf_document(&mut doc, &values, |_, _| Vec::new());
        assert_eq!(filled, 2);

        let page_dict = doc.get_dictionary(page_id).unwrap();
        let annots = page_dict.get(b"Annots").unwrap().as_array().unwrap();
        assert_eq!(annots.len(), 2);
    }
}
