#!/usr/bin/env python3
"""Writes Vowkey's Android launcher icon, splash icon, autofill icon and wordmark from brand/.

    python3 scripts/brand-android.py ANDROID_DIR

ANDROID_DIR is the Android project (`android/` in this repository). The wordmark's letters come from
Be Vietnam Pro Bold, the font of the desktop app, so this needs fontTools with brotli
(`pip install fonttools brotli`).
"""
import pathlib
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = ROOT / "clients/libs/components/src/webfonts/vowkey/be-vietnam-pro/be-vietnam-pro-latin-700-normal.woff2"

PAPER = "#F6F5F1"
INK = "#1E2430"
BLUE = "#2563EB"
EDGE = "#E2E0D8"

# The mark in brand/vowkey-icon.svg, in its 120-unit box, before the icon's own transform.
OUTLINE = "M70,40H93a9,9 0,0 1,9 9v28a9,9 0,0 1,-9 9H27a9,9 0,0 1,-9 -9V49a9,9 0,0 1,9 -9h1"
TAG = "M36,28H60A5,5 0,0 1,65 33V46A5,5 0,0 1,60 51H36A5,5 0,0 1,31 46V33A5,5 0,0 1,36 28Z"
TAG_BAR = "M39.25,37.75H56.75A1.75,1.75 0,0 1,56.75 41.25H39.25A1.75,1.75 0,0 1,39.25 37.75Z"
DOTS = "".join(f"M{x - 5},65a5,5 0,1 0,10 0a5,5 0,1 0,-10 0Z" for x in (35, 51, 67))
CURSOR = "M82.75,54A2.75,2.75 0,0 1,85.5 56.75V73.25A2.75,2.75 0,0 1,80 73.25V56.75A2.75,2.75 0,0 1,82.75 54Z"
TILE = "M27,0H93A27,27 0,0 1,120 27V93A27,27 0,0 1,93 120H27A27,27 0,0 1,0 93V27A27,27 0,0 1,27 0Z"


def mark(ink=INK, blue=BLUE, bar="#FFFFFF", scale=1.0, dx=0.0):
    """The mark as vector-drawable groups: the icon's placement, then an outer scale."""
    bar_path = f'<path android:pathData="{TAG_BAR}" android:fillColor="{bar}"/>' if bar else ""
    return f"""<group android:pivotX="60" android:pivotY="60" android:scaleX="{scale}" android:scaleY="{scale}" android:translateX="{dx}">
    <group android:pivotX="60" android:pivotY="57" android:scaleX="0.88" android:scaleY="0.88" android:translateY="4">
      <path android:pathData="{OUTLINE}" android:strokeColor="{ink}" android:strokeWidth="7" android:strokeLineCap="round" android:fillColor="#00000000"/>
      <path android:pathData="{TAG}" android:fillColor="{blue}"/>
      {bar_path}
      <path android:pathData="{DOTS}" android:fillColor="{ink}"/>
      <path android:pathData="{CURSOR}" android:fillColor="{blue}"/>
    </group>
  </group>"""


def vector(width, height, vw, vh, body):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/brand-android.py from brand/. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
  android:width="{width}dp" android:height="{height}dp"
  android:viewportWidth="{vw}" android:viewportHeight="{vh}">
  {body}
</vector>
"""


def wordmark_letters(text, size, x, baseline):
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    paths, cursor = [], x
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        paths.append(pen.getCommands())
        cursor += glyphs[name].width * scale
    return "".join(paths), cursor


def main(android):
    android = pathlib.Path(android)
    ui = android / "ui/src/main/res/drawable"
    app = android / "app/src"

    tile = f'<path android:pathData="{TILE}" android:fillColor="{PAPER}"/>'
    (ui / "logo_vowkey_icon.xml").write_text(vector(1024, 1024, 120, 120, tile + mark()))
    (ui / "logo_shield_icon.xml").write_text(vector(108, 108, 120, 120, mark(scale=0.7)))

    letters, end = wordmark_letters("Vowkey", 64, 140, 84)
    edge = f'<path android:pathData="{TILE}" android:fillColor="{PAPER}" android:strokeColor="{EDGE}" android:strokeWidth="3"/>'
    word = f'<path android:pathData="{letters}" android:fillColor="{INK}"/>'
    width = round(end + 6)
    (ui / "logo_vowkey.xml").write_text(vector(round(34 * width / 120), 34, width, 120, edge + mark() + word))

    foreground = vector(108, 108, 120, 120, mark(scale=0.72))
    monochrome = vector(108, 108, 120, 120, mark(ink="#000000", blue="#000000", bar=None, scale=0.72))
    for flavor in ("main", "beta", "release"):
        drawable = app / flavor / "res/drawable"
        if (drawable / "ic_launcher_foreground.xml").exists() or flavor == "main":
            drawable.mkdir(parents=True, exist_ok=True)
            (drawable / "ic_launcher_foreground.xml").write_text(foreground)
            (drawable / "ic_launcher_monochrome.xml").write_text(monochrome)

    colors = app / "main/res/values/ic_launcher_background.xml"
    text = colors.read_text()
    text = text.replace("#FF175DDC", "#FFF6F5F1").replace(
        "<!-- This is the apps Primary Blue color an exists here for launcher and splash theme only -->",
        "<!-- Vowkey paper, behind the launcher icon and the splash icon. -->",
    )
    colors.write_text(text)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ROOT / "android")
