"""Writes values into the fields of a PDF form."""
import json, pathlib, re, sys, warnings, logging
warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)
import pypdf
from pypdf.generic import (
    ArrayObject, BooleanObject, DecodedStreamObject, DictionaryObject,
    FloatObject, NameObject, NumberObject, TextStringObject
)

src_path = pathlib.Path(sys.argv[1])
dst_path = pathlib.Path(sys.argv[2])
kind = sys.argv[3]
write_map = json.loads(sys.argv[4])

reader = pypdf.PdfReader(src_path)
if reader.is_encrypted:
    reader.decrypt("")
writer = pypdf.PdfWriter()
writer.clone_document_from_reader(reader)
root = writer._root_object

def xml_esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

if kind == "pdf-xfa-dynamic":
    acro = root.get("/AcroForm").get_object()
    xfa = acro.get("/XFA").get_object()
    # Find top-level template subform name (e.g. form1 or IMM_5406)
    top_subform = "form1"
    for i in range(0, len(xfa), 2):
        if str(xfa[i]) == "template":
            tdata = xfa[i + 1].get_object().get_data().decode("utf-8", "ignore")
            m = re.search(r'<subform\b[^>]*name="([^"]+)"', tdata)
            if m:
                top_subform = m.group(1)
            break

    ds_index = None
    for i in range(0, len(xfa), 2):
        if str(xfa[i]) == "datasets":
            ds_index = i + 1
            break

    if ds_index is not None:
        ds_obj = xfa[ds_index].get_object()
        ds_xml = ds_obj.get_data().decode("utf-8", "ignore")
        for fname, val in write_map.items():
            esc = xml_esc(val)
            # Replace empty self-closing <fname/> or <fname></fname>
            new_xml, n = re.subn(rf"<{re.escape(fname)}\s*/>", f"<{fname}>{esc}</{fname}>", ds_xml, count=1)
            if n == 0:
                new_xml, n = re.subn(rf"<{re.escape(fname)}></{re.escape(fname)}>", f"<{fname}>{esc}</{fname}>", ds_xml, count=1)
            if n == 0 and f"</{top_subform}" in ds_xml:
                new_xml = ds_xml.replace(f"</{top_subform}", f"<{fname}>{esc}</{fname}></{top_subform}", 1)
            ds_xml = new_xml
        new_stream = DecodedStreamObject()
        new_stream.set_data(ds_xml.encode("utf-8"))
        xfa[ds_index] = writer._add_object(new_stream)
    else:
        # Forms like ca-imm5406 and ca-imm5669 have no datasets packet; insert one!
        fields_xml = "".join(f"<{k}>{xml_esc(v)}</{k}>" for k, v in write_map.items())
        ds_xml = f'<xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><{top_subform}>{fields_xml}</{top_subform}></xfa:data></xfa:datasets>'
        new_stream = DecodedStreamObject()
        new_stream.set_data(ds_xml.encode("utf-8"))
        stream_ref = writer._add_object(new_stream)
        insert_pos = len(xfa) - 2 if len(xfa) >= 2 else len(xfa)
        xfa.insert(insert_pos, TextStringObject("datasets"))
        xfa.insert(insert_pos + 1, stream_ref)

elif kind in ("pdf-acroform", "pdf-xfa-hybrid"):
    if "/AcroForm" in root:
        acro = root["/AcroForm"].get_object()
        if kind == "pdf-xfa-hybrid" and "/XFA" in acro:
            del acro[NameObject("/XFA")]
        acro[NameObject("/NeedAppearances")] = BooleanObject(True)

    for p_idx, page in enumerate(writer.pages):
        for annot_ref in (page.get("/Annots") or []):
            try:
                a = annot_ref.get_object()
            except Exception:
                continue
            if a.get("/Subtype") != "/Widget":
                continue
            parent = a.get("/Parent").get_object() if a.get("/Parent") else None
            t_name = str(a.get("/T") or (parent.get("/T") if parent else "") or "")
            key = f"p{p_idx}:{t_name}"
            if key not in write_map:
                continue
            val = write_map[key]
            ft = str(a.get("/FT") or (parent.get("/FT") if parent else "") or "")
            if ft == "/Btn":
                name_val = NameObject("/" + val.lstrip("/"))
                a[NameObject("/V")] = name_val
                a[NameObject("/AS")] = name_val
                if parent is not None:
                    parent[NameObject("/V")] = name_val
            else:
                txt_val = TextStringObject(val)
                a[NameObject("/V")] = txt_val
                if parent is not None:
                    parent[NameObject("/V")] = txt_val


with open(dst_path, "wb") as f:
    writer.write(f)
