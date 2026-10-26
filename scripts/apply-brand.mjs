#!/usr/bin/env node
// Writes Vowkey's icons and logos into the apps from the marks in brand/.
//   node scripts/apply-brand.mjs
// Needs clients/node_modules (Playwright's Chromium draws the SVG), ImageMagick (`magick`, for
// .ico files and grey states) and `iconutil` (macOS, for .icns files).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "clients/package.json"));
const { chromium } = require("@playwright/test");

const INK = "#1E2430";
const BLUE = "#2563EB";
const PAPER = "#F6F5F1";

const at = (...p) => path.join(root, ...p);
const brand = (name) => readFileSync(at("brand", name), "utf8");
const tileSvg = brand("vowkey-icon.svg");

/** The mark's drawing, without the tile, in the given colours. */
function markBody({ ink = INK, accent = BLUE, bar = "#fff" } = {}) {
  return `<path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>
<rect x="31" y="28" width="34" height="23" rx="5" fill="${accent}"/>
<rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="${bar}"/>
<g fill="${ink}"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
<rect x="80" y="54" width="5.5" height="22" rx="2.75" fill="${accent}"/>`;
}

const MARK_VIEWBOX = "12 22 96 72";
const markSvg = (colors) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">${markBody(colors)}</svg>`;
const monoMark = (color) => markSvg({ ink: color, accent: color, bar: "none" });

const FONT = `-apple-system, 'SF Pro Display', 'Helvetica Neue', Inter, Arial, sans-serif`;
/** Mark and the name beside it. */
function wordmarkSvg(width, height, { text, colors }) {
  const markHeight = height * 0.86;
  const markWidth = markHeight * (96 / 72);
  const fontSize = height * 0.72;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<g transform="translate(0 ${(height - markHeight) / 2})"><svg width="${markWidth}" height="${markHeight}" viewBox="${MARK_VIEWBOX}">${markBody(colors)}</svg></g>
<text x="${markWidth + height * 0.18}" y="${height * 0.74}" font-family="${FONT}" font-size="${fontSize}" font-weight="700" letter-spacing="-0.5" fill="${text}">Vowkey</text>
</svg>`;
}
const WORDMARK_DARK = { text: INK, colors: { ink: INK, accent: BLUE } };
const WORDMARK_WHITE = { text: "#FFFFFF", colors: { ink: "#FFFFFF", accent: "#FFFFFF", bar: BLUE } };
const WORDMARK_BLUE = { text: BLUE, colors: { ink: BLUE, accent: BLUE, bar: "#fff" } };

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, width, height, out) {
  mkdirSync(path.dirname(out), { recursive: true });
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><div style="width:${width}px;height:${height}px;display:flex">${svg.replace(
      "<svg ",
      `<svg style="width:${width}px;height:${height}px" `,
    )}</div></body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

const tile = (size, out) => render(tileSvg, size, size, out);
const grey = (file) => execFileSync("magick", [file, "-colorspace", "Gray", "-alpha", "on", "-channel", "A", "-evaluate", "multiply", "0.9", "+channel", file]);
const size = (file) => execFileSync("magick", ["identify", "-format", "%wx%h", file]).toString().split("x").map(Number);
const exists = existsSync;

// Desktop app: icons, installers, tray ---------------------------------------------------------
const desktop = at("clients/apps/desktop");
for (const name of ["icon.png", "icon.beta.png"]) await tile(1024, path.join(desktop, "resources", name));
for (const dir of ["icons", "icons_beta"]) {
  for (const s of [16, 32, 64, 128, 256, 512, 1024]) await tile(s, path.join(desktop, "resources", dir, `${s}x${s}.png`));
}

async function makeIconset(dir) {
  const target = path.join(desktop, "resources", dir);
  for (const f of readdirSync(target).filter((n) => n.endsWith(".png"))) {
    const m = /^icon_(\d+)x\d+(@2x)?\.png$/.exec(f);
    if (m) await tile(Number(m[1]) * (m[2] ? 2 : 1), path.join(target, f));
  }
}
function makeIcns(iconsetDir, out) {
  const work = mkdtempSync(path.join(tmpdir(), "iconset-")) + "/icon.iconset";
  mkdirSync(work);
  for (const f of readdirSync(iconsetDir).filter((n) => /^icon_(16|32|128|256|512)x\1(@2x)?\.png$/.test(n))) {
    writeFileSync(path.join(work, f), readFileSync(path.join(iconsetDir, f)));
  }
  execFileSync("iconutil", ["-c", "icns", work, "-o", out]);
  rmSync(path.dirname(work), { recursive: true });
}
for (const dir of ["icon.iconset", "dmg.iconset"]) await makeIconset(dir);
for (const name of ["icon.icns", "icon.beta.icns"]) makeIcns(path.join(desktop, "resources/icon.iconset"), path.join(desktop, "resources", name));
for (const name of ["dmg.icns", "dmg.beta.icns"]) makeIcns(path.join(desktop, "resources/dmg.iconset"), path.join(desktop, "resources", name));

async function makeIco(out, sizes = [16, 32, 48, 256]) {
  const work = mkdtempSync(path.join(tmpdir(), "ico-"));
  const files = [];
  for (const s of sizes) {
    const f = path.join(work, `${s}.png`);
    await tile(s, f);
    files.push(f);
  }
  execFileSync("magick", [...files, out]);
  rmSync(work, { recursive: true });
}
for (const name of ["icon.ico", "icon.beta.ico"]) await makeIco(path.join(desktop, "resources", name));
for (const f of ["icon.png", "icon.beta.png"]) await tile(512, path.join(desktop, "resources", f)).catch(() => {});

const appx = path.join(desktop, "resources/appx");
await tile(44, path.join(appx, "Square44x44Logo.png"));
await tile(50, path.join(appx, "StoreLogo.png"));
await tile(150, path.join(appx, "Square150x150Logo.png"));
for (const [name, w, h] of [["Wide310x150Logo.png", 310, 150], ["SplashScreen.png", 620, 300]]) {
  await render(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${PAPER}"/><svg x="${(w - h * 0.7) / 2}" y="${h * 0.15}" width="${h * 0.7}" height="${h * 0.7}" viewBox="0 0 120 120">${tileSvg.replace(/<\/?svg[^>]*>/g, "")}</svg></svg>`, w, h, path.join(appx, name));
}
for (const f of readdirSync(path.join(desktop, "resources")).filter((n) => /^windows_plugin_authenticator_logo_(dark|light)\.(beta|stable)\.svg$/.test(n))) {
  writeFileSync(path.join(desktop, "resources", f), markSvg(f.includes("_dark.") ? { ink: "#FFFFFF", accent: "#FFFFFF", bar: "none" } : {}));
}

const images = path.join(desktop, "src/images");
await tile(512, path.join(images, "icon.png"));
await tile(512, path.join(images, "icon_beta.png"));
await tile(512, path.join(images, "icon_dev.png"));
await makeIco(path.join(images, "icon.ico"));
await makeIco(path.join(images, "icon_beta.ico"));
await render(monoMark("#000000"), 16, 12, path.join(images, "icon-template.png"));
await render(monoMark("#000000"), 32, 24, path.join(images, "icon-template@2x.png"));
await render(monoMark("#FFFFFF"), 16, 12, path.join(images, "icon-highlight.png"));
await render(monoMark("#FFFFFF"), 32, 24, path.join(images, "icon-highlight@2x.png"));
await render(wordmarkSvg(568, 86, WORDMARK_DARK), 568, 86, path.join(images, "logo-dark@2x.png"));
await render(wordmarkSvg(568, 86, WORDMARK_WHITE), 568, 86, path.join(images, "logo-white@2x.png"));
if (exists(at("clients/apps/desktop/macos/autofill-extension/vowkey-icon.png"))) {
  const [w] = size(at("clients/apps/desktop/macos/autofill-extension/vowkey-icon.png"));
  await tile(w, at("clients/apps/desktop/macos/autofill-extension/vowkey-icon.png"));
}

// Browser extension -----------------------------------------------------------------------------
const bimages = at("clients/apps/browser/src/images");
for (const f of readdirSync(bimages).filter((n) => /^(icon\d+|berry\d+).*\.png$/.test(n))) {
  const file = path.join(bimages, f);
  const [w, h] = size(file);
  await tile(Math.min(w, h), file);
  if (/gray|locked/.test(f)) grey(file);
}

// Web app ---------------------------------------------------------------------------------------
const web = at("clients/apps/web/src");
for (const [name, s] of [["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["apple-touch-icon.png", 180], ["android-chrome-192x192.png", 192], ["android-chrome-512x512.png", 512], ["mstile-150x150.png", 150]]) {
  await tile(s, path.join(web, "images/icons", name));
}
writeFileSync(path.join(web, "images/icons/safari-pinned-tab.svg"), monoMark("#000000"));
await makeIco(path.join(web, "favicon.ico"), [16, 32, 48]);
await render(wordmarkSvg(580, 90, WORDMARK_BLUE), 580, 90, path.join(web, "images/logo-primary@2x.png"));
await render(wordmarkSvg(568, 86, WORDMARK_DARK), 568, 86, path.join(web, "images/logo-dark@2x.png"));
await render(wordmarkSvg(568, 86, WORDMARK_WHITE), 568, 86, path.join(web, "images/logo-white@2x.png"));
writeFileSync(path.join(web, "images/logo.svg"), wordmarkSvg(290, 45, WORDMARK_BLUE));
writeFileSync(path.join(web, "images/logo-white.svg"), wordmarkSvg(290, 45, WORDMARK_WHITE));
const reg = path.join(web, "images/register-layout");
if (exists(path.join(reg, "logo-horizontal-white.png"))) {
  const [w, h] = size(path.join(reg, "logo-horizontal-white.png"));
  await render(wordmarkSvg(w, h, WORDMARK_WHITE), w, h, path.join(reg, "logo-horizontal-white.png"));
}
if (exists(path.join(reg, "logo-horizontal-white.svg"))) writeFileSync(path.join(reg, "logo-horizontal-white.svg"), wordmarkSvg(290, 45, WORDMARK_WHITE));

// Shared logos used by every app ----------------------------------------------------------------
const svgs = at("clients/libs/assets/src/svg/svgs");
const themedWordmark = (w, h, fillStyle, markStyle) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <title>Vowkey</title>
    <g transform="translate(0 ${(h - h * 0.86) / 2})"><svg width="${h * 0.86 * (96 / 72)}" height="${h * 0.86}" viewBox="${MARK_VIEWBOX}">
      <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke-width="7" stroke-linecap="round" style="${markStyle.stroke}"/>
      <rect x="31" y="28" width="34" height="23" rx="5" style="${markStyle.accent}"/>
      <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff"/>
      <g style="${markStyle.fill}"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
      <rect x="80" y="54" width="5.5" height="22" rx="2.75" style="${markStyle.accent}"/>
    </svg></g>
    <text x="${h * 0.86 * (96 / 72) + h * 0.18}" y="${h * 0.74}" font-family="${FONT}" font-size="${h * 0.72}" font-weight="700" letter-spacing="-0.5" style="${fillStyle}">Vowkey</text>
  </svg>`;
const LOGO_STYLE = {
  stroke: "stroke: rgb(var(--color-text-main))",
  accent: `fill: ${BLUE}`,
  fill: "fill: rgb(var(--color-text-main))",
};
const NAV_STYLE = {
  stroke: "stroke: var(--color-nav-fg-body)",
  accent: "fill: var(--color-nav-fg-body)",
  fill: "fill: var(--color-nav-fg-body)",
};
const navMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}" fill="none">
    <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" stroke-width="7" stroke-linecap="round" style="stroke: var(--color-nav-fg-body)"/>
    <g style="fill: var(--color-nav-fg-body)"><rect x="31" y="28" width="34" height="23" rx="5"/><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/><rect x="80" y="54" width="5.5" height="22" rx="2.75"/></g>
  </svg>`;
/** Replaces the SVG inside `const NAME = svg\`...\`` and leaves the rest of the module alone. */
function rewriteSvgModule(file, markup) {
  const old = readFileSync(file, "utf8");
  const m = /(export )?const (\w+) = svg`/.exec(old);
  const open = old.indexOf("svg`", m.index) + 4;
  const close = old.indexOf("`;", open) + 2;
  writeFileSync(file, `${old.slice(0, m.index)}${m[1] ?? ""}const ${m[2]} = svg\`\n  ${markup}\n\`;${old.slice(close)}`);
}
const tileInline = tileSvg.replace("<svg ", '<svg width="20" height="20" ');
rewriteSvgModule(path.join(svgs, "vowkey-logo.icon.ts"), themedWordmark(290, 45, LOGO_STYLE.fill, LOGO_STYLE));
rewriteSvgModule(path.join(svgs, "vowkey-logo-beta.icon.ts"), themedWordmark(290, 45, LOGO_STYLE.fill, LOGO_STYLE));
rewriteSvgModule(path.join(svgs, "vowkey-icon.ts"), tileInline);
rewriteSvgModule(path.join(svgs, "shield.ts"), navMark);
rewriteSvgModule(path.join(svgs, "side-nav-logo.ts"), themedWordmark(153, 24, NAV_STYLE.fill, NAV_STYLE));
rewriteSvgModule(path.join(svgs, "side-nav-logo-beta.ts"), themedWordmark(153, 24, NAV_STYLE.fill, NAV_STYLE));

await browser.close();
console.log("brand applied");
