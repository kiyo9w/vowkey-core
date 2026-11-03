"""Reads the fields of a PDF form and the printed label of each, as JSON on stdout."""
import json, math, pathlib, re, sys, warnings, logging
warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)
import pypdf


def text_width(text, size):
    return sum(1.0 if ord(c) >= 0x2E80 else 0.5 for c in text) * size


def page_lines(page):
    """The printed text of a page as lines of (x_start, x_end, baseline_y, text)."""
    runs = []

    def visitor(text, cm, tm, font_dict, font_size):
        t = text.strip()
        if t:
            x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
            y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
            size = float(font_size or 1) * math.hypot(tm[2], tm[3]) * math.hypot(cm[2], cm[3])
            runs.append((float(x), float(y), size if size >= 2 else 8.0, t))

    try:
        page.extract_text(visitor_text=visitor)
    except Exception:
        pass
    rows = []
    for run in runs:
        for row in rows:
            if abs(row[0] - run[1]) <= 1.5:
                row[1].append(run)
                break
        else:
            rows.append([run[1], [run]])
    rows.sort(key=lambda row: -row[0])
    lines = []
    for _, row_runs in rows:
        row_runs.sort(key=lambda r: r[0])
        current = None
        for x, y, size, t in row_runs:
            if current is not None and abs(x - current[0]) < 0.5:
                # Text shown by the same operation starts at the same point: it follows in order.
                current = (current[0], current[1] + text_width(t, size), current[2], current[3] + " " + t)
                lines[-1] = current
            elif current is not None and 0 <= x - current[1] <= size * 1.2:
                current = (current[0], x + text_width(t, size), current[2], current[3] + " " + t)
                lines[-1] = current
            else:
                current = (x, x + text_width(t, size), y, t)
                lines.append(current)
    return lines


def label_near(lines, rect):
    """The printed line that names a box: the closest one above it or to its left."""
    x0, x1 = sorted((rect[0], rect[2]))
    y0, y1 = sorted((rect[1], rect[3]))
    ymid = (y0 + y1) / 2
    band = max(6.0, 0.7 * (y1 - y0))
    above = left = None
    for lx0, lx1, ly, text in lines:
        if y1 - 2 <= ly <= y1 + 26 and lx1 >= x0 - 4 and lx0 <= x1 + 4:
            if above is None or ly - y1 < above[0]:
                above = (ly - y1, text)
        if abs(ly - ymid) <= band and lx1 <= x0 + 4 and x0 - lx1 <= 220:
            if left is None or x0 - lx1 < left[0]:
                left = (x0 - lx1, text)
    if above and left:
        return above[1] if above[0] < left[0] else left[1]
    return (above or left or (0, ""))[1]


OPAQUE_NAME = re.compile(r"(?i)^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$")
SECTION_BANNER = re.compile(
    r"(?i)^(?:(?:part|section|step|item|block|box)\s*[0-9a-zivx]+[.:)\s—–-]+)?"
    r"(?:"
    r"enter\s+personal\s+information"
    r"|(?:applicant|employee|taxpayer|holder|your)\s*(?:'s)?\s*(?:information|details|particulars|data)"
    r"|(?:information|details|particulars)\s+(?:about|of)\s+(?:you|the\s+applicant|your\s+spouse|spouse|child(?:ren)?|dependent(?:s)?|employer|preparer|representative)"
    r"|spouse(?:'s)?\s*(?:information|details|particulars|section)"
    r"|dependent(?:s)?\s*(?:information|details|particulars|section)"
    r"|employer(?:s)?\s+only|employer(?:'s)?\s*(?:information|details|section)"
    r"|(?:paid\s+)?preparer(?:'s)?\s+use\s+only|preparer(?:'s)?\s*(?:information|section)"
    r"|for\s+(?:official|office|agency| departmental)\s+use(?:\s+only)?"
    r"|do\s+not\s+write\s+(?:in\s+this|below)"
    r"|申請人(?:情報|欄)?|本人(?:情報|欄)?|配偶者(?:情報|欄|について)|扶養(?:家族|親族)(?:欄|情報)?|勤務先(?:情報|欄)?|雇用主(?:欄|情報)?|代理人(?:欄|情報)?|公用欄|官公庁記入欄"
    r")\b"
)


def section_above(lines, rect):
    """The nearest section banner printed above a widget on the same page."""
    y1 = max(rect[1], rect[3])
    best = None
    for lx0, lx1, ly, text in lines:
        if ly >= y1 - 2 and len(text) <= 96 and SECTION_BANNER.search(text.strip()):
            dist = ly - y1
            if best is None or dist < best[0]:
                best = (dist, text.strip())
    return best[1] if best else None

path = pathlib.Path(sys.argv[1])
reader = pypdf.PdfReader(path)
if reader.is_encrypted:
    reader.decrypt("")
root = reader.trailer["/Root"].get_object()
acroform = root.get("/AcroForm")
acroform_obj = acroform.get_object() if acroform is not None else {}
fields = (reader.get_fields() or {}) if acroform is not None else {}
has_xfa = "/XFA" in acroform_obj

xfa_template = ""
xfa_dynamic_pi = False
if has_xfa:
    xfa = acroform_obj["/XFA"].get_object()
    if isinstance(xfa, list):
        for i in range(0, len(xfa), 2):
            if str(xfa[i]) == "template":
                xfa_template = xfa[i + 1].get_object().get_data().decode("utf-8", "ignore")
                xfa_dynamic_pi = "dynamic?>" in xfa_template[:800]

text_sample = "".join(p.extract_text() or "" for p in reader.pages[:2])
is_dynamic_xfa = (
    has_xfa
    and len(reader.pages) == 1
    and len(fields) <= 2
    and (xfa_dynamic_pi or "Please wait..." in text_sample or "requires Adobe Reader" in text_sample)
)

candidates = []
if is_dynamic_xfa:
    kind = "pdf-xfa-dynamic"
    # Extract <field name="..."> from XFA template (closing tags in XFA often have a newline before >)
    for m in re.finditer(r"<field\b([^>]*?)>(.*?)</field\s*>", xfa_template, re.S):
        attrs, body = m.group(1), m.group(2)
        nm_m = re.search(r'\bname="([^"]+)"', attrs)
        if not nm_m: continue
        fname = nm_m.group(1)
        if re.search(r"Button|CurrentPage|PageCount|ReaderInfo|FormNumber|totPage", fname, re.I):
            continue
        tips = re.findall(r"<(?:speak|toolTip|text)\b[^>]*>(.*?)</(?:speak|toolTip|text)\s*>", body, re.S)
        clean_tips = [re.sub(r"<[^>]+>", " ", t).strip() for t in tips if t.strip()]
        label = " / ".join(dict.fromkeys(clean_tips)) if clean_tips else fname
        candidates.append({
            "target": fname,
            "id": fname,
            "name": fname,
            "label": label[:240],
            "section_label": None,
            "max_length": None,
            "is_checkbox": "<checkButton" in body,
            "export_values": [],
        })
elif fields:
    kind = "pdf-xfa-hybrid" if has_xfa else "pdf-acroform"
    for p_idx, page in enumerate(reader.pages):
        lines = page_lines(page)
        for annot_ref in (page.get("/Annots") or []):
            try:
                a = annot_ref.get_object()
            except Exception:
                continue
            if a.get("/Subtype") != "/Widget":
                continue
            parent = a.get("/Parent").get_object() if a.get("/Parent") else {}
            t_name = str(a.get("/T") or parent.get("/T") or "")
            tu_tip = str(a.get("/TU") or parent.get("/TU") or "")
            ft = str(a.get("/FT") or parent.get("/FT") or "")
            max_len = a.get("/MaxLen") or parent.get("/MaxLen")
            rect = a.get("/Rect")
            rect_vals = [float(v) for v in rect] if rect and len(rect) == 4 else None
            nearby_label = label_near(lines, rect_vals) if rect_vals else ""
            sec_label = section_above(lines, rect_vals) if rect_vals else None
            label_parts = [p for p in (tu_tip, nearby_label, t_name) if p and not OPAQUE_NAME.match(p)]
            label = " — ".join(dict.fromkeys(label_parts)) if label_parts else (nearby_label or t_name)
            export_vals = []
            ap = a.get("/AP")
            if ap and "/N" in ap.get_object():
                n_obj = ap.get_object()["/N"].get_object()
                if isinstance(n_obj, dict):
                    export_vals = [str(k).lstrip("/") for k in n_obj.keys() if str(k) != "/Off"]
            candidates.append({
                "target": f"p{p_idx}:{t_name}",
                "id": t_name,
                "name": t_name,
                "label": label[:240],
                "section_label": sec_label,
                "max_length": int(max_len) if max_len is not None else None,
                "is_checkbox": ft == "/Btn",
                "export_values": export_vals,
            })
else:
    kind = "pdf-flat"

print(json.dumps({"kind": kind, "candidates": candidates}))
