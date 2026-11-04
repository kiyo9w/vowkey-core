#!/usr/bin/env node
// Records a real website while a person browses to its form, and plays the recording back offline at
// the site's own address, so a form can be filled and rehearsed without the network, a login or a
// bot check.
//
//   node scripts/site-capture.mjs record <name> <url>      browse to the form, then close the window
//   node scripts/site-capture.mjs replay <name> [url]      open the recording (default: the page with the most fields)
//        [--extension]   load the Vowkey extension build (clients/apps/browser/build)
//        [--snapshot]    serve the page as it was on screen, scripts removed, instead of re-running the site
//        [--live]        let requests the recording lacks go to the network
//   node scripts/site-capture.mjs list
// VOWKEY_CAPTURE_SECONDS=<n> closes a recording by itself after n seconds.
// VOWKEY_CAPTURE_STEPS=<file.mjs> walks from the start page to the form before that.
//
// Recordings go to $VOWKEY_SITES or ~/Documents/Projects/vowkey/Demo/sites/<name>/:
//   site.har.zip       every request and response of the visit
//   pages.json         each page visited: address, title, how many fields it shows, its snapshot
//   pages/<n>.html     the page as it was on screen (after scripts ran), and pages/<n>.png
// The browser profile that keeps sign-ins between recordings is ~/.vowkey/site-capture-profile.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(join(root, "clients/e2e/package.json"))("playwright");
const SITES = process.env.VOWKEY_SITES ?? resolve(root, "../vowkey/Demo/sites");
const PROFILE = join(homedir(), ".vowkey/site-capture-profile");
const EXTENSION = join(root, "clients/apps/browser/build");
const VIEWPORT = { width: 1440, height: 900 };

const [command, name, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const positional = rest.filter((a) => !a.startsWith("--"));

const fieldCount = () =>
  [...document.querySelectorAll("input, select, textarea")].filter((el) => {
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }).length;

async function record(siteName, url) {
  if (!siteName || !url) throw new Error("record needs a name and a url");
  const dir = join(SITES, siteName);
  mkdirSync(join(dir, "pages"), { recursive: true });
  mkdirSync(PROFILE, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chromium",
    headless: false,
    viewport: VIEWPORT,
    serviceWorkers: "block",
    recordHar: { path: join(dir, "site.har.zip"), mode: "full", content: "attach" },
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  const saved = new Map(); // url -> entry
  const snapshot = async (page) => {
    try {
      const pageUrl = page.url();
      if (!/^https?:/.test(pageUrl)) return;
      const fields = await page.evaluate(fieldCount);
      let entry = saved.get(pageUrl);
      if (!entry) {
        entry = { n: saved.size + 1, url: pageUrl };
        saved.set(pageUrl, entry);
      }
      // Keep the moment the page showed the most fields: the form, not its loading state.
      if (entry.fields != null && fields < entry.fields) return;
      entry.fields = fields;
      entry.title = await page.title();
      entry.html = `pages/${entry.n}.html`;
      writeFileSync(join(dir, entry.html), await page.content());
      await page.screenshot({ path: join(dir, `pages/${entry.n}.png`), fullPage: true });
      writeFileSync(join(dir, "pages.json"), JSON.stringify([...saved.values()], null, 1));
    } catch {
      // The page navigated away mid-snapshot; the next tick catches the new one.
    }
  };
  const watch = (page) => {
    page.on("load", () => void snapshot(page));
  };
  context.pages().forEach(watch);
  context.on("page", watch);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url);
  console.log(`Recording ${siteName}. Sign in if asked, go to the form, wait a moment on it, then close the window.`);
  if (process.env.VOWKEY_CAPTURE_STEPS) {
    // Steps that walk from the start page to the form: export default async (page, snap) => {...}
    const steps = (await import(resolve(process.env.VOWKEY_CAPTURE_STEPS))).default;
    await steps(page, () => snapshot(page));
    await snapshot(page);
  }
  const auto = Number(process.env.VOWKEY_CAPTURE_SECONDS ?? 0);
  if (auto > 0) setTimeout(() => void context.close(), auto * 1000);
  const timer = setInterval(() => context.pages().forEach((p) => void snapshot(p)), 3000);
  await new Promise((done) => {
    context.on("close", done);
    const check = setInterval(() => {
      if (context.pages().length === 0) {
        clearInterval(check);
        done();
      }
    }, 500);
  });
  clearInterval(timer);
  await context.close().catch(() => {});
  writeFileSync(join(dir, "pages.json"), JSON.stringify([...saved.values()], null, 1));
  console.log(`Saved ${saved.size} pages to ${dir}`);
  for (const p of saved.values()) console.log(`  ${p.n}. ${p.fields} fields  ${p.title}  ${p.url}`);
}

function stripScripts(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/\son[a-z]+="[^"]*"/gi, "");
}

async function replay(siteName, pageUrl) {
  const dir = join(SITES, siteName ?? "");
  if (!siteName || !existsSync(join(dir, "site.har.zip"))) throw new Error(`no recording named ${siteName}`);
  const pages = JSON.parse(readFileSync(join(dir, "pages.json"), "utf8"));
  const target =
    (pageUrl && pages.find((p) => p.url === pageUrl || String(p.n) === pageUrl)) ??
    [...pages].sort((a, b) => (b.fields ?? 0) - (a.fields ?? 0))[0];
  const profile = mkdtempSync(join(tmpdir(), "vk-replay-"));
  const args = flags.has("--extension")
    ? [`--load-extension=${EXTENSION}`, `--disable-extensions-except=${EXTENSION}`]
    : [];
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: VIEWPORT,
    serviceWorkers: "block",
    args,
  });
  await context.routeFromHAR(join(dir, "site.har.zip"), {
    notFound: flags.has("--live") ? "fallback" : "abort",
  });
  if (flags.has("--snapshot")) {
    const html = stripScripts(readFileSync(join(dir, target.html), "utf8"));
    await context.route(target.url, (route) =>
      route.request().resourceType() === "document"
        ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
        : route.fallback(),
    );
  }
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(target.url, { waitUntil: "domcontentloaded" });
  const fields = await page.evaluate(fieldCount).catch(() => 0);
  console.log(`Replaying ${siteName}: ${target.title} (${fields} fields on screen, ${target.fields} when recorded)`);
  console.log(`  ${target.url}`);
  console.log(`PID ${context.browser()?.process?.()?.pid ?? ""}`);
  await new Promise((done) => context.on("close", done));
  rmSync(profile, { recursive: true, force: true });
}

function list() {
  if (!existsSync(SITES)) return console.log("No recordings yet.");
  for (const site of readdirSync(SITES)) {
    const file = join(SITES, site, "pages.json");
    if (!existsSync(file)) continue;
    const pages = JSON.parse(readFileSync(file, "utf8"));
    const best = [...pages].sort((a, b) => (b.fields ?? 0) - (a.fields ?? 0))[0];
    console.log(`${site.padEnd(28)} ${pages.length} pages, form: ${best?.fields ?? 0} fields  ${best?.title ?? ""}`);
  }
}

if (command === "record") await record(name, positional[0]);
else if (command === "replay") await replay(name, positional[0]);
else if (command === "list") list();
else {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 19).join("\n"));
  process.exit(command ? 1 : 0);
}
