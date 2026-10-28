#!/usr/bin/env python3
"""Reads a document on any computer the way vowkey-read reads it on a Mac, with PaddleOCR's models
on ONNX Runtime (RapidOCR, CPU) where vowkey-read uses Apple's Vision. It speaks vowkey-read's
command line, so the evaluation measures it in Vision's place:

    VOWKEY_READ_HELPER=scripts/open-read.py scripts/decision-eval.sh --out report.json

Usage:
  open-read.py FILE            the document's text, one printed line per line
  open-read.py --pieces FILE   the printed pieces of each page as JSON, each with its place on the page

A PDF page gives its text layer; a page without one is drawn and read. A photo is turned as its
EXIF orientation says, read as it is and again straightened, and a small picture is read again at
twice its size; the reading the models are surest of is kept. Each script's model reads the
picture, as Vision does, because a model for one script turns another into noise.

Setup (once): uv venv --python 3.12 sdk/target/open-read
              uv pip install --python sdk/target/open-read/bin/python rapidocr onnxruntime pymupdf pillow
The models download on first use into RapidOCR's package folder. VOWKEY_OPEN_READ_SIZE picks the
PP-OCRv6 size (tiny, small, medium; small by default).
"""

import json
import os
import sys
from pathlib import Path

VENV = Path(__file__).resolve().parent.parent / "sdk" / "target" / "open-read" / "bin" / "python"
try:
    import cv2
    import pymupdf as fitz
    import numpy as np
    from PIL import Image, ImageOps
    from rapidocr import LangDet, LangRec, ModelType, OCRVersion, RapidOCR
    from rapidocr.main import RapidOCRError
    from rapidocr.utils.process_img import map_boxes_to_original
except ImportError:
    if VENV.exists() and Path(sys.executable).resolve() != VENV.resolve():
        os.execv(str(VENV), [str(VENV), __file__, *sys.argv[1:]])
    raise

USAGE = "usage: open-read.py FILE | --pieces FILE"
SIZE = {"tiny": ModelType.TINY, "small": ModelType.SMALL, "medium": ModelType.MEDIUM}[
    os.environ.get("VOWKEY_OPEN_READ_SIZE", "small")
]


def fail(message, code=1):
    sys.stderr.write(message + "\n")
    sys.exit(code)


def engine(rec):
    params = {
        "Global.log_level": "error",
        "Det.ocr_version": OCRVersion.PPOCRV6,
        "Det.model_type": SIZE,
        "Det.lang_type": LangDet.CH,
    }
    params.update(rec)
    return RapidOCR(params=params)


# One multilingual PP-OCRv6 model reads Chinese, Japanese, English and the Latin-script languages;
# Korean has its own model. The multilingual model has no letters for Vietnamese tones (ọ, ố, ẵ...).
PASSES = [
    (None, {"Rec.ocr_version": OCRVersion.PPOCRV6, "Rec.model_type": SIZE, "Rec.lang_type": LangRec.CH}),
    ("hangul", {"Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.model_type": ModelType.MOBILE, "Rec.lang_type": LangRec.KOREAN}),
]
_engines = {}


def passes():
    for i, (script, rec) in enumerate(PASSES):
        if i not in _engines:
            _engines[i] = engine(rec)
        yield script, _engines[i]


def hangul(texts):
    """Whether a reading is mostly Hangul. The Korean model reads Latin letters without their
    accents, and does so confidently, so its reading counts only where it reads Korean."""
    letters = [c for t in texts for c in t if c.isalpha()]
    korean = [c for c in letters if "\uac00" <= c <= "\ud7a3" or "\u1100" <= c <= "\u11ff" or "\u3130" <= c <= "\u318f"]
    return len(letters) > 0 and len(korean) / len(letters) >= 0.3


def read_once(image):
    """One reading of a picture: the text is found once, then each script's model reads it, and
    the reading the model is surest of is kept, with its score."""
    h, w = image.shape[:2]
    models = list(passes())
    finder = models[0][1]
    prepared, record = finder.preprocess_img(image)
    try:
        crops, found = finder.detect_and_crop(prepared, record)
        turned, _ = finder.cls_and_rotate(list(crops))
    except RapidOCRError:
        return (0.0, [])
    boxes = map_boxes_to_original(found.boxes, record, h, w)
    # The orientation model sometimes turns an upright line upside down, and the line then reads
    # as noise: a turned line is read both ways and keeps the surer reading.
    flipped = [i for i, (a, b) in enumerate(zip(crops, turned)) if a is not b]
    best = (-1.0, [])
    for script, model in models:
        try:
            read = model.recognize_txt(turned)
            texts, confs = list(read.txts), list(read.scores)
            if flipped:
                upright = model.recognize_txt([crops[i] for i in flipped])
                for i, t, c in zip(flipped, upright.txts, upright.scores):
                    if c > confs[i]:
                        texts[i], confs[i] = t, c
        except RapidOCRError:
            continue
        if script == "hangul" and not hangul(texts):
            continue
        score, pieces = 0.0, []
        for quad, text, conf in zip(boxes, texts, confs):
            text = text.strip()
            if not text or conf < 0.5:
                continue
            score += float(conf) * len("".join(text.split()))
            q = np.array(quad, dtype=float)
            x0, y0, x1, y1 = q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max()
            pieces.append({"text": text, "x": x0 / w, "y": y0 / h, "w": (x1 - x0) / w, "h": (y1 - y0) / h})
        if score > best[0]:
            best = (score, pieces)
    return best


def read_best(image):
    """A picture read at its own size and, when it is small, again at twice the size."""
    best = read_once(image)
    h, w = image.shape[:2]
    if min(h, w) < 1100:
        larger = cv2.resize(image, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        again = read_once(larger)
        if again[0] > best[0]:
            best = again
    return best


def order(corners):
    s = corners.sum(axis=1)
    d = np.diff(corners, axis=1).ravel()
    return np.array([corners[s.argmin()], corners[d.argmin()], corners[s.argmax()], corners[d.argmax()]], dtype=np.float32)


def rectified(image):
    """The page of a photo straightened: the largest four-cornered shape that covers a good part of
    the picture, drawn square on. None when no page stands out from the picture."""
    h, w = image.shape[:2]
    scale = 800 / max(h, w)
    small = cv2.resize(image, (max(1, int(w * scale)), max(1, int(h * scale))))
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 40, 120), np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area = small.shape[0] * small.shape[1]
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        approx = cv2.approxPolyDP(contour, 0.02 * cv2.arcLength(contour, True), True)
        found = cv2.contourArea(approx) / area
        if len(approx) != 4 or not cv2.isContourConvex(approx) or found < 0.3 or found > 0.92:
            continue
        corners = order(approx.reshape(4, 2).astype(np.float32) / scale)
        tl, tr, br, bl = corners
        width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
        height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
        if width < 50 or height < 50:
            return None
        target = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
        return cv2.warpPerspective(image, cv2.getPerspectiveTransform(corners, target), (width, height), flags=cv2.INTER_CUBIC)
    return None


def read_photo(image):
    """A photo read as it is and again straightened; the reading the models are surer of is kept,
    with the shape of the page it was read from."""
    score, pieces = read_best(image)
    aspect = image.shape[1] / image.shape[0]
    flat = rectified(image)
    if flat is not None:
        again, flat_pieces = read_best(flat)
        if again > score:
            return flat_pieces, flat.shape[1] / flat.shape[0]
    return pieces, aspect


def load_image(path):
    try:
        picture = Image.open(path)
        picture = ImageOps.exif_transpose(picture).convert("RGB")
    except Exception as error:  # noqa: BLE001 - any unreadable picture is one failure to report
        fail(f"cannot read the image: {error}")
    return cv2.cvtColor(np.asarray(picture), cv2.COLOR_RGB2BGR)


def page_image(page):
    """A page drawn large enough for text recognition."""
    scale = 2200 / max(page.rect.width, page.rect.height)
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(array, cv2.COLOR_RGB2BGR if pix.n == 3 else cv2.COLOR_GRAY2BGR)


def text_layer_lines(page):
    """The printed lines of a page from its text layer, as pieces placed on the page."""
    width, height = page.rect.width, page.rect.height
    pieces = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if not text:
                continue
            x0, y0, x1, y1 = line["bbox"]
            pieces.append({"text": text, "x": x0 / width, "y": y0 / height, "w": (x1 - x0) / width, "h": (y1 - y0) / height})
    return pieces


def rows(pieces):
    """Pieces that share a printed line, top to bottom, each row left to right."""
    found = []
    for piece in sorted(pieces, key=lambda p: p["y"] + p["h"] / 2):
        mid = piece["y"] + piece["h"] / 2
        if found:
            anchor = found[-1][0]
            if abs(anchor["y"] + anchor["h"] / 2 - mid) < max(anchor["h"], piece["h"]) * 0.5:
                found[-1].append(piece)
                continue
        found.append([piece])
    return [" ".join(p["text"] for p in sorted(row, key=lambda p: p["x"])) for row in found]


def pages_of(path):
    if path.suffix.lower() == ".pdf":
        try:
            document = fitz.open(path)
        except Exception:  # noqa: BLE001
            fail("cannot read the PDF")
        for index, page in enumerate(document):
            layer = page.get_text().strip()
            if len(layer) >= 20:
                yield {"index": index, "aspect": page.rect.width / page.rect.height, "pieces": text_layer_lines(page), "layer": layer}
            else:
                image = page_image(page)
                _, pieces = read_best(image)
                yield {"index": index, "aspect": image.shape[1] / image.shape[0], "pieces": pieces}
    else:
        image = load_image(path)
        pieces, aspect = read_photo(image)
        yield {"index": 0, "aspect": aspect, "pieces": pieces}


def main(arguments):
    if len(arguments) == 2 and arguments[0] == "--pieces":
        pages = [{k: v for k, v in page.items() if k != "layer"} for page in pages_of(Path(arguments[1]))]
        sys.stdout.write(json.dumps({"pages": pages}, ensure_ascii=False))
        return
    if len(arguments) != 1:
        fail(USAGE, 2)
    for page in pages_of(Path(arguments[0])):
        if "layer" in page:
            print(page["layer"])
        else:
            for line in rows(page["pieces"]):
                print(line)


if __name__ == "__main__":
    main(sys.argv[1:])
