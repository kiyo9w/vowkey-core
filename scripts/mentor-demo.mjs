#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_ROOT = path.resolve(__dirname, "..");
const DEMO_FORMS_DIR = path.resolve(
  process.env.VOWKEY_DEMO_FORMS ?? path.join(CORE_ROOT, "../vowkey/Demo/forms"),
);
const BROWSER_BUILD_DIR = path.join(CORE_ROOT, "clients/apps/browser/build");

const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(CORE_ROOT, "clients/node_modules/@playwright/test/index.js"),
);

const PORT = Number(process.env.VOWKEY_DEMO_PORT ?? 4310);
const PUBLIC_DEMO_EMAIL = "demo@vowkey.app";
const PUBLIC_DEMO_PASSWORD = "123456"; // intentionally public practice account
const DEMO_EMAIL = process.env.VOWKEY_DEMO_EMAIL ?? PUBLIC_DEMO_EMAIL;
const DEMO_PASSWORD =
  process.env.VOWKEY_DEMO_PASSWORD ?? (DEMO_EMAIL === PUBLIC_DEMO_EMAIL ? PUBLIC_DEMO_PASSWORD : null);
if (!DEMO_PASSWORD) {
  throw new Error("Set VOWKEY_DEMO_PASSWORD for non-public accounts (e.g. presenter@vowkey.app).");
}
const VERIFY_MODE = process.argv.includes("--verify");
const SCREENSHOT_DIR =
  process.env.VOWKEY_SCREENSHOT_DIR ??
  path.join(CORE_ROOT, "clients/e2e/.state/mentor-demo-screenshots");

const FORM_FILES = {
  "/demo/koto-ward-procedure": "koto-ward-procedure.html",
  "/demo/shinjuku-ward": "shinjuku-ward.html",
  "/demo/mizuho-bank": "mizuho-bank.html",
  "/demo/tsubame-onboarding": "tsubame-onboarding.html",
  "/demo/konin-todoke": "konin-todoke.html",
  "/demo/khai-sinh": "khai-sinh.html",
  "/demo/hospital-intake": "hospital-intake.html",
  "/demo/vn-ct01": "vn-ct01.html",
  "/demo/en-arrival-card": "en-arrival-card.html",
};

function readFormHtml(fileName) {
  return fs
    .readFileSync(path.join(DEMO_FORMS_DIR, fileName), "utf8")
    .replace('<script src="../../Extension/chrome/content.js"></script>', "");
}

function buildIndexHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>Vowkey Demo Forms</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 780px; margin: 40px auto; padding: 0 20px; color: #0f172a; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    p { color: #475569; font-size: 14px; }
    ul { list-style: none; padding: 0; margin-top: 20px; display: grid; gap: 10px; }
    a { display: block; padding: 12px 16px; border: 1px solid #cbd5e1; border-radius: 8px; text-decoration: none; color: #0f172a; font-weight: 600; }
    a:hover { background: #f8fafc; border-color: #1d4ed8; }
    .primary { border-color: #14365d; background: #f0f7ff; }
    small { display: block; font-weight: 400; color: #64748b; margin-top: 3px; }
  </style>
</head>
<body>
  <h1>Vowkey — 한국 유학생 서류 체험</h1>
  <p>베트남에서 한국으로 유학 온 Nguyễn Thị Linh의 저장 정보로 서류를 작성해 보세요. 아래 양식은 모두 체험용입니다.</p>
  <ul>
    <li><a class="primary" href="/demo/koto-ward-procedure">유학생 체류·학적 정보 등록<small>Linh의 신원, 체류, 주소, 재학 및 계좌 정보</small></a></li>
    <li><a class="primary" href="/demo/mizuho-bank">외국인 유학생 금융거래 신청<small>Linh의 저장 정보를 사용하는 한국어 은행 체험 양식</small></a></li>
    <li><a href="/demo/konin-todoke">Scene 7 Challenge · 婚姻届（夫・妻 2名同時入力）<small>Marriage registration across Husband + Wife profiles</small></a></li>
    <li><a href="/demo/khai-sinh">Scene 7 Challenge · Tờ khai đăng ký khai sinh (Mẫu TP/HT-2024-KS)<small>Vietnamese birth registration across Father + Child + Mother</small></a></li>
    <li><a href="/demo/shinjuku-ward">Scene 7 Challenge · 新宿区 住民異動届・転入手続<small>Moving / ward address change declaration</small></a></li>
    <li><a href="/demo/hospital-intake">Scene 7 Challenge · 東京臨海総合病院 初診受付・問診票<small>Hospital first-visit intake + health insurance + medical symptom boundary</small></a></li>
    <li><a href="/demo/vn-ct01">Scene 5 · Tờ khai thay đổi thông tin cư trú (Mẫu CT01 - Việt Nam)<small>Vietnamese administrative residence declaration</small></a></li>
    <li><a href="/demo/tsubame-onboarding">株式会社カワセミ・システムズ 入社手続（React Controlled Input）<small>HR onboarding portal</small></a></li>
    <li><a href="/demo/en-arrival-card">International Disembarkation / Arrival Card (English)<small>Cross-language fill from the same profile</small></a></li>
  </ul>
</body>
</html>`;
}

async function startFormServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", `http://localhost:${PORT}`).pathname;
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildIndexHtml());
      return;
    }
    const fileName = FORM_FILES[pathname];
    if (!fileName) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(readFormHtml(fileName));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
  return server;
}

async function pollUntil(fn, { timeoutMs = 45_000, intervalMs = 150, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ""}`);
}

async function getBackgroundWorker(context) {
  return (
    context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://")) ??
    (await context.waitForEvent("serviceworker", { timeout: 30_000 }))
  );
}

async function signInExtension(context, profileDir) {
  const dev = await context.newPage();
  await dev.goto("chrome://extensions");
  const toggle = dev.locator("#devMode");
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
  }
  await dev.close();

  const worker = await getBackgroundWorker(context);
  const extId = new URL(worker.url()).hostname;

  const realAgentHost = path.join(
    process.env.HOME ?? "",
    "Library/Application Support/Vowkey/vowkey-agent-host",
  );
  if (profileDir && fs.existsSync(realAgentHost)) {
    const nativeManifest = JSON.stringify(
      {
        name: "com.vowkey.agent",
        description: "Vowkey desktop <-> agent bridge",
        path: realAgentHost,
        type: "stdio",
        allowed_origins: [
          `chrome-extension://${extId}/`,
          "chrome-extension://aoophmcfjaolmjghdloedcnckodcjipg/",
        ],
      },
      null,
      2,
    );
    const nmDir = path.join(profileDir, "NativeMessagingHosts");
    fs.mkdirSync(nmDir, { recursive: true });
    fs.writeFileSync(path.join(nmDir, "com.vowkey.agent.json"), nativeManifest);
    const sysChromiumNm = path.join(
      process.env.HOME ?? "",
      "Library/Application Support/Chromium/NativeMessagingHosts",
    );
    if (fs.existsSync(sysChromiumNm)) {
      fs.writeFileSync(path.join(sysChromiumNm, "com.vowkey.agent.json"), nativeManifest);
    }
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(BROWSER_BUILD_DIR, "manifest.json"), "utf8"),
  );
  const popupUrl = `chrome-extension://${extId}/${manifest.action.default_popup}`;

  const popup = await context.newPage();
  await popup.goto(popupUrl);

  const email = popup.getByTestId("login-email-input");
  const skipDefaultPrompt = popup.locator("#default-password-manager-prompt_button_skip-for-now");
  const carouselLogIn = popup
    .locator("app-intro-carousel")
    .getByRole("button", { name: "Log in", exact: true });
  const localVaultLogIn = popup.getByRole("link", { name: "Log in", exact: true });
  const signInButton = popup.getByRole("button", { name: /^sign in/i }).first();

  await pollUntil(
    async () => {
      if (await email.isVisible()) return true;
      if (await skipDefaultPrompt.isVisible()) {
        await skipDefaultPrompt.click();
        return false;
      }
      if (await localVaultLogIn.isVisible()) {
        await localVaultLogIn.click();
        return false;
      }
      if (await carouselLogIn.isVisible()) {
        await carouselLogIn.click();
        return false;
      }
      if (await signInButton.isVisible()) {
        await signInButton.click();
        return false;
      }
      const url = popup.url();
      if (url.includes("#/tabs/")) {
        return "already_signed_in";
      }
      if (url.includes("#/local")) {
        await popup.evaluate(() => {
          window.location.hash = "#/login";
        });
      }
      return false;
    },
    { timeoutMs: 45_000, label: "extension login screen" },
  );

  if (!popup.url().includes("#/tabs/")) {
    await email.fill(DEMO_EMAIL);
    await popup.getByTestId("login-continue-button").click();
    const password = popup.getByTestId("login-master-password-input");
    await password.waitFor({ state: "visible", timeout: 20_000 });
    await password.fill(DEMO_PASSWORD);
    await popup.getByTestId("login-submit-button").click();
    await popup.waitForURL(/#\/tabs\//, { timeout: 60_000 });
  }

  await pollUntil(
    async () => {
      const count = await worker.evaluate(async () => {
        const main = self.vowkeyMain;
        if (!main?.cipherService) return 0;
        const activeId = await new Promise((resolve) => {
          let sub;
          sub = main.accountService.activeAccount$.subscribe((acc) => {
            if (sub) sub.unsubscribe();
            resolve(acc?.id ?? null);
          });
        });
        if (!activeId) return 0;
        const ciphers = await main.cipherService.getAllDecrypted(activeId);
        return Array.isArray(ciphers) ? ciphers.filter((c) => !c.deletedDate).length : 0;
      });
      return count >= 3 ? count : false;
    },
    { timeoutMs: 45_000, label: "synced Gia đình Trần profiles (>= 3 ciphers)" },
  );

  await popup.close();
}

async function openInlineMenu(page, selector) {
  const input = page.locator(selector);
  await input.scrollIntoViewIfNeeded();
  await input.click();

  await pollUntil(
    async () => {
      const btnFrame = page.frames().find((f) => f.url().endsWith("/overlay/menu-button.html"));
      if (!btnFrame) return false;
      return btnFrame.evaluate(() => window.innerHeight > 0 && window.innerWidth > 0);
    },
    { timeoutMs: 15_000, label: "Vowkey inline field icon" },
  );

  await input.press("ArrowDown");

  return pollUntil(
    async () => {
      const listFrame = page.frames().find((f) => f.url().endsWith("/overlay/menu-list.html"));
      if (!listFrame) return false;
      const ready = await listFrame.evaluate(() => {
        if (window.innerHeight <= 0) return null;
        const host = document.querySelector("autofill-inline-menu-list");
        const buttons = Array.from(
          host?.shadowDom?.querySelectorAll("[data-profile-form]") ?? [],
        );
        if (buttons.length === 0) return null;
        return buttons.map((b) => ({
          label: b.getAttribute("aria-label") || b.textContent?.trim() || "",
          cardText: b.closest("li, div")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
        }));
      });
      return ready;
    },
    { timeoutMs: 15_000, label: "Vowkey inline menu profile list" },
  );
}

async function clickFillWholeFormByIndex(page, index) {
  await pollUntil(
    async () => {
      const listFrame = page.frames().find((f) => f.url().endsWith("/overlay/menu-list.html"));
      if (!listFrame) return false;
      const handle = await listFrame.evaluateHandle((idx) => {
        const host = document.querySelector("autofill-inline-menu-list");
        const buttons = Array.from(host?.shadowDom?.querySelectorAll("[data-profile-form]") ?? []);
        const target = buttons[idx] ?? null;
        target?.scrollIntoView({ block: "nearest" });
        return target;
      }, index);
      const el = handle.asElement();
      if (!el) {
        await handle.dispose();
        return false;
      }
      try {
        await el.click({ timeout: 1_500 });
        await handle.dispose();
        return true;
      } catch {
        await handle.dispose().catch(() => {});
        return false;
      }
    },
    { timeoutMs: 10_000, label: `[data-profile-form] click at index ${index}` },
  );
}

async function waitForFillIdle(context) {
  const worker = await getBackgroundWorker(context);
  await pollUntil(
    async () => {
      const filling = await worker.evaluate(() => {
        return Boolean(self.vowkeyMain?.overlayBackground?.checkIsFieldCurrentlyFilling?.());
      });
      return !filling;
    },
    { timeoutMs: 25_000, label: "autofill completion" },
  );
}

async function runVerification(context) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const linhDirectory = path.resolve(DEMO_FORMS_DIR, "../live/linh");
  const record = JSON.parse(fs.readFileSync(path.join(linhDirectory, "linh.json"), "utf8"));
  const contract = JSON.parse(fs.readFileSync(path.join(linhDirectory, "korea/form-contract.json"), "utf8"));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 960 });

  for (const [index, form] of contract.forms.entries()) {
    const url = new URL(form.url);
    if (url.port === "4310") url.port = String(PORT);
    // Practice forms poll the demo bridge every 350ms, so networkidle never settles.
    // Wait for DOM + the first factual control (real readiness; still fails on 404/blank).
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`#${form.fields[0].id}`, { state: "attached" });
    const factual = form.fields.filter((field) => !field.manual);
    const expectedCount = form.counterMode.startsWith("all")
      ? factual.length
      : factual.filter((field) => field.required).length;
    const readFields = () => page.evaluate((fields) => Object.fromEntries(fields.map(({ id }) => {
      const element = document.getElementById(id);
      return [id, { value: element.value, checked: element.type === "checkbox" && element.checked }];
    })), form.fields);

    for (let pass = 0; pass < 2; pass++) {
      const entries = await openInlineMenu(page, "#applicant_name_hangul");
      const linhIndex = entries.findIndex((entry) => /Nguyễn Thị Linh|Nguyen Thi Linh/i.test(entry.cardText));
      assert(linhIndex >= 0, "Expected the saved Korean Linh profile in the inline menu");
      const started = Date.now();
      await clickFillWholeFormByIndex(page, linhIndex);
      await pollUntil(async () => (await page.locator("#applicant_name_latin").inputValue()) !== "", {
        timeoutMs: 25_000, label: "Linh's name populated",
      });
      await waitForFillIdle(context);
      const snapshot = await readFields();
      for (const field of factual) {
        assert.equal(snapshot[field.id].value, record.profile[field.attribute],
          `${url.pathname} #${field.id}: expected current saved ${field.attribute}`);
      }
      for (const field of form.fields.filter((field) => field.manual)) {
        assert.equal(snapshot[field.id].value, field.format.startsWith("checkbox") ? "on" : "",
          `${field.id} must not acquire a signature or user decision`);
        assert.equal(snapshot[field.id].checked, false, `${field.id} must not be accepted automatically`);
      }
      assert.equal(Number(await page.locator(form.counter).textContent()), expectedCount);
      console.log(JSON.stringify({
        url: url.href, pass: pass + 1, elapsedMs: Date.now() - started,
        accurateSavedFields: factual.length, manualControlsUntouched: true,
      }));
      if (pass === 0) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `korean-${index + 1}-filled.png`), fullPage: true });
      }
      await page.click(form.clearButtons[0]);
      const cleared = await readFields();
      assert(factual.every((field) => cleared[field.id].value === ""), "Clear must reset every factual control");
      assert.equal(Number(await page.locator(form.counter).textContent()), 0);
    }
  }
  console.log("[verify] PASS: Both Korean forms match saved Linh data; signatures and consent stay manual; clear and refill work.");
}

async function main() {
  const server = await startFormServer();
  const profileDir = path.join(
    CORE_ROOT,
    "clients/e2e/.state",
    VERIFY_MODE ? "mentor-verify-chrome" : "mentor-live-chrome",
  );
  fs.rmSync(profileDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: "chromium",
    headless: false,
    viewport: VERIFY_MODE ? { width: 1440, height: 960 } : null,
    args: [
      `--load-extension=${BROWSER_BUILD_DIR}`,
      `--disable-extensions-except=${BROWSER_BUILD_DIR}`,
      ...(VERIFY_MODE ? [] : ["--window-size=1480,980"]),
    ],
  });

  try {
    await signInExtension(context, profileDir);

    if (VERIFY_MODE) {
      await runVerification(context);
      await context.close();
      server.close();
      process.exit(0);
    }

    // Live interactive mode for user & mentor rehearsal
    const existingPages = context.pages();
    const formPage = existingPages[0] ?? (await context.newPage());
    await formPage.goto(`http://localhost:${PORT}/demo/koto-ward-procedure`, {
      waitUntil: "domcontentloaded",
    });

    for (const extra of existingPages.slice(1)) {
      await extra.close().catch(() => {});
    }

    const indexPage = await context.newPage();
    await indexPage.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });

    await formPage.bringToFront();

    console.log(`\n[mentor-demo] READY on http://localhost:${PORT}/demo/koto-ward-procedure`);
    console.log(`[mentor-demo] Signed into Vowkey Cloud as ${DEMO_EMAIL}. Select Nguyễn Thị Linh for the Korean forms.`);
    console.log("[mentor-demo] Click a field -> Fill whole form. Other profiles remain available for separate challenges.\n");

    const shutdown = async () => {
      await context.close().catch(() => {});
      server.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => {});
  } catch (err) {
    console.error("[mentor-demo] ERROR:", err);
    await context.close().catch(() => {});
    server.close();
    process.exit(1);
  }
}

main();
