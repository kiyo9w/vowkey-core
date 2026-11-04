#!/usr/bin/env node
// Clones real websites' form pages into self-contained local copies: each page exactly as the
// browser rendered it (styles, images and fonts inlined, scripts removed), with its form controls
// working, so forms can be filled and rehearsed without the network, a sign-in or a bot check.
//
//   node scripts/site-capture.mjs clone <name> <url> [--steps file.mjs] [--wait seconds] [--blank]
//        opens <url> in the capture browser, runs the steps (export default async (page) => {...})
//        and clones the page it ends on
//   node scripts/site-capture.mjs browse <name> [url] [--blank]
//        opens the capture browser for you to sign in and click through; press Enter in this
//        terminal on each page to clone it, type q and Enter to finish
//        --blank empties every field before cloning, so the copy starts as a blank form
//   node scripts/site-capture.mjs serve [port]
//        serves the clones at http://localhost:<port>/<name>/<page>.html (default 8790)
//   node scripts/site-capture.mjs list
//
// Clones go to $VOWKEY_SITES or ~/Documents/Projects/vowkey/Demo/sites/<name>/:
//   <page>.html     the page, self-contained; open it from the server or straight from disk
//   <page>.mhtml    Chrome's own archive of the page, which Chrome opens as it was
//   <page>.png      what it looked like
//   pages.json      each cloned page: original address, title, fields
// The capture browser keeps its sign-ins in ~/.vowkey/site-capture-profile.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve, normalize } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "clients/e2e/package.json"))("playwright");
const SITES = process.env.VOWKEY_SITES ?? resolve(root, "../vowkey/Demo/sites");
const PROFILE = process.env.VOWKEY_CAPTURE_PROFILE ?? join(homedir(), ".vowkey/site-capture-profile");
const VIEWPORT = { width: 1440, height: 900 };

const args = process.argv.slice(2);
const BLANK = args.includes("--blank") && Boolean(args.splice(args.indexOf("--blank"), 1));
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};

function launch() {
  mkdirSync(PROFILE, { recursive: true });
  return chromium.launchPersistentContext(PROFILE, {
    channel: "chromium",
    headless: false,
    viewport: VIEWPORT,
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

const fieldCount = () =>
  [...document.querySelectorAll("input, select, textarea")].filter((el) => {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }).length;

/** A file name for a page: the last part of its route, e.g. vjwppr005 or 0080. */
function slugOf(url) {
  const u = new URL(url);
  const route = (u.hash.replace(/^#\/?/, "") || u.pathname).split(/[/?]/).filter(Boolean).pop() ?? "index";
  return route.replace(/\.[a-z]+$/i, "").replace(/[^\w-]+/g, "-") || "index";
}

// ---- MHTML to one self-contained HTML file ----

function decodeQuotedPrintable(text) {
  const out = [];
  const body = text.replace(/=\r?\n/g, "");
  let i = 0;
  while (i < body.length) {
    if (body[i] === "=" && /^[0-9A-F]{2}$/i.test(body.slice(i + 1, i + 3))) {
      out.push(parseInt(body.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const cp = body.codePointAt(i);
      const ch = String.fromCodePoint(cp);
      out.push(...Buffer.from(ch, "utf8"));
      i += ch.length;
    }
  }
  return Buffer.from(out);
}

function parseMhtml(mhtml) {
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(mhtml)?.[1];
  if (!boundary) throw new Error("not an MHTML archive");
  return mhtml
    .split(`--${boundary}`)
    .slice(1)
    .filter((part) => !part.startsWith("--"))
    .map((part) => {
      const split = part.search(/\r?\n\r?\n/);
      const head = part.slice(0, split);
      const raw = part.slice(split).replace(/^\r?\n\r?\n/, "");
      const header = (name) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head)?.[1]?.trim();
      const encoding = (header("Content-Transfer-Encoding") ?? "").toLowerCase();
      const body =
        encoding === "base64"
          ? Buffer.from(raw.replace(/\s+/g, ""), "base64")
          : encoding === "quoted-printable"
            ? decodeQuotedPrintable(raw)
            : Buffer.from(raw, "utf8");
      return {
        type: (header("Content-Type") ?? "application/octet-stream").split(";")[0].trim(),
        location: header("Content-Location"),
        id: header("Content-ID")?.replace(/^<|>$/g, ""),
        body,
      };
    });
}

function stripScripts(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*rel="?(?:module)?preload"?[^>]*>/gi, "")
    .replace(/\son(?:click|change|input|submit|load|focus|blur|key\w+|mouse\w+)="[^"]*"/gi, "")
    // A date picker script fills read-only date boxes on the site; without scripts they take typing.
    .replace(/(<input\b[^>]*?)\sreadonly(?:="[^"]*")?/gi, "$1");
}

/**
 * Turns Chrome's archive of a page into one HTML file that needs no network: every stylesheet,
 * image and font is inlined as a data URL, stylesheets with their own url() references resolved
 * against their original address. What the archive lacks is fetched with the capture browser's
 * cookies, and scripts are removed so the page stays as it was rendered.
 */
async function toStandaloneHtml(mhtml, request) {
  const [page, ...resources] = parseMhtml(mhtml);
  const archived = new Map();
  for (const part of resources) {
    if (part.location) archived.set(part.location, part);
    if (part.id) archived.set(`cid:${part.id}`, part);
  }
  const memo = new Map();
  const dataUri = (type, buf) => `data:${type};base64,${buf.toString("base64")}`;
  const inlineCss = async (css, base) => {
    const refs = new Set([...css.matchAll(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/g)].map((m) => m[2]));
    for (const ref of refs) {
      let abs;
      try {
        abs = new URL(ref.trim(), base).href;
      } catch {
        continue;
      }
      const data = await resolveUrl(abs);
      if (data) css = css.split(ref).join(data);
    }
    return css;
  };
  const resolveUrl = (url) => {
    if (!memo.has(url)) {
      memo.set(url, (async () => {
        const part = archived.get(url) ?? archived.get(url.split("#")[0]);
        if (part) {
          if (part.type === "text/css") return dataUri("text/css", Buffer.from(await inlineCss(part.body.toString("utf8"), url)));
          if (part.type === "text/html") return dataUri("text/html", Buffer.from(stripScripts(part.body.toString("utf8"))));
          return dataUri(part.type, part.body);
        }
        if (!/^https?:/.test(url)) return null;
        const res = await request.get(url, { timeout: 20000 }).catch(() => null);
        if (!res?.ok()) return null;
        const type = (res.headers()["content-type"] ?? "application/octet-stream").split(";")[0].trim();
        const body = await res.body();
        return type === "text/css"
          ? dataUri(type, Buffer.from(await inlineCss(body.toString("utf8"), url)))
          : dataUri(type, body);
      })());
    }
    return memo.get(url);
  };

  let html = stripScripts(page.body.toString("utf8"));
  const base = page.location ?? "about:blank";
  // Attribute references: stylesheets, images, icons, frames.
  const attrs = [
    ...html.matchAll(/<link\b[^>]*>/gi),
    ...html.matchAll(/<(?:img|iframe|source|input)\b[^>]*>/gi),
  ].flatMap((m) => [...m[0].matchAll(/\s(?:href|src)="([^"]+)"/gi)].map((a) => a[1]));
  for (const ref of new Set(attrs)) {
    if (ref.startsWith("data:")) continue;
    let abs;
    try {
      abs = new URL(ref.replace(/&amp;/g, "&"), base).href;
    } catch {
      continue;
    }
    const data = await resolveUrl(abs);
    if (data) html = html.split(`"${ref}"`).join(`"${data}"`);
  }
  // srcset lists are dropped in favour of the src already inlined.
  html = html.replace(/\ssrcset="[^"]*"/gi, "");
  // url() inside <style> blocks and style attributes.
  return inlineCss(html, base);
}

// ---- cloning ----

/**
 * Writes typed values and ticks into attributes, which is what the archive keeps, and returns
 * which option each dropdown shows (-1 for none), in page order. Dropdowns are written into the
 * saved HTML afterwards (selectDropdowns), since frameworks redraw options on the live page.
 * With blank, every field is emptied first; the site never sees it, as nothing is sent.
 */
function readControls(blank) {
  if (blank) {
    for (const select of document.querySelectorAll("select")) {
      select.selectedIndex = [...select.options].findIndex((o) => o.value === "" || /^\s*-?\s*$/.test(o.text));
    }
    for (const input of document.querySelectorAll("input, textarea")) {
      if (input.type === "checkbox" || input.type === "radio") input.checked = false;
      else if (!["hidden", "submit", "button", "image", "reset", "file"].includes(input.type)) input.value = "";
    }
  }
  for (const input of document.querySelectorAll("input, textarea")) {
    if (input.type === "checkbox" || input.type === "radio") input.toggleAttribute("checked", input.checked);
    else if (input.type !== "file" && input.type !== "password") {
      if (input.tagName === "TEXTAREA") input.textContent = input.value;
      else input.setAttribute("value", input.value);
    }
  }
  return [...document.querySelectorAll("select")].map((select) => select.selectedIndex);
}

/** Marks the shown option of each dropdown in the saved HTML; none shown gets a hidden blank one. */
function selectDropdowns(html, chosen) {
  let n = 0;
  return html.replace(/(<select\b[^>]*>)([\s\S]*?)(<\/select>)/gi, (whole, open, body, close) => {
    const index = chosen[n++];
    if (index === undefined) return whole;
    let i = -1;
    body = body.replace(/<option\b[^>]*>/gi, (tag) => {
      i++;
      const plain = tag.replace(/\sselected(?:="[^"]*")?/gi, "");
      return i === index ? plain.replace(/^<option/i, "<option selected") : plain;
    });
    return index < 0 ? `${open}<option value="" hidden selected></option>${body}${close}` : `${open}${body}${close}`;
  });
}

async function clonePage(page, name, blank = BLANK) {
  const dir = join(SITES, name);
  mkdirSync(dir, { recursive: true });
  await page.waitForLoadState("networkidle").catch(() => {});
  const url = page.url();
  const slug = slugOf(url);
  const chosen = await page.evaluate(readControls, blank);
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" });
  await cdp.detach();
  writeFileSync(join(dir, `${slug}.mhtml`), data);
  writeFileSync(join(dir, `${slug}.html`), selectDropdowns(await toStandaloneHtml(data, page.context().request), chosen));
  await page.screenshot({ path: join(dir, `${slug}.png`), fullPage: true });
  const entry = { page: `${slug}.html`, url, title: await page.title(), fields: await page.evaluate(fieldCount) };
  const index = join(dir, "pages.json");
  const pages = existsSync(index) ? JSON.parse(readFileSync(index, "utf8")).filter((p) => p.page !== entry.page) : [];
  writeFileSync(index, JSON.stringify([...pages, entry], null, 1));
  console.log(`cloned ${name}/${entry.page}  ${entry.fields} fields  ${entry.title}`);
  return entry;
}

async function clone(name, url) {
  if (!name || !url) throw new Error("clone needs a name and a url");
  const steps = option("--steps");
  const wait = Number(option("--wait") ?? 2);
  const context = await launch();
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (steps) await (await import(resolve(steps))).default(page);
    await page.waitForTimeout(wait * 1000);
    await clonePage(page, name);
  } finally {
    await context.close();
  }
}

async function browse(name, url) {
  if (!name) throw new Error("browse needs a name");
  const context = await launch();
  const page = context.pages()[0] ?? (await context.newPage());
  if (url) await page.goto(url);
  console.log("Sign in and go to a form. Press Enter here to clone the page in front; q and Enter to finish.");
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.trim() === "q") break;
    const front = context.pages().at(-1);
    if (front) await clonePage(front, name).catch((e) => console.log(`could not clone: ${e.message}`));
  }
  await context.close();
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
  ".mhtml": "multipart/related",
};

function serve(port) {
  createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(SITES, path);
    if (!file.startsWith(SITES) || !existsSync(file)) return void res.writeHead(404).end("Not found");
    if (statSync(file).isDirectory()) {
      const links = readdirSync(file)
        .filter((f) => f.endsWith(".html") || statSync(join(file, f)).isDirectory())
        .map((f) => `<li><a href="${join(path, f)}">${f}</a></li>`)
        .join("");
      return void res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(`<ul>${links}</ul>`);
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  }).listen(port, () => console.log(`Clones at http://localhost:${port}/`));
}

function list() {
  if (!existsSync(SITES)) return console.log("No clones yet.");
  for (const site of readdirSync(SITES)) {
    const index = join(SITES, site, "pages.json");
    if (!existsSync(index)) continue;
    for (const p of JSON.parse(readFileSync(index, "utf8"))) {
      if (p.page) console.log(`${site}/${p.page}`.padEnd(40), `${String(p.fields).padStart(3)} fields  ${p.title}`);
    }
  }
}

const [command, name, url] = args;
if (command === "clone") await clone(name, url);
else if (command === "browse") await browse(name, url);
else if (command === "serve") serve(Number(name) || 8790);
else if (command === "list") list();
else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 21).join("\n"));
  process.exit(command ? 1 : 0);
}
