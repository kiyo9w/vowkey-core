import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { _electron, chromium, test } from "@playwright/test";

import { serveForms } from "../../src/browser/fill-forms";
import { popupUrl, reachLoginPage } from "../../src/browser/fixtures";
import { account } from "../../src/credentials";
import { LoginPage } from "../../src/login";
import { BROWSER_BUILD_DIR, DESKTOP_BUILD_DIR, E2E_STATE_DIR } from "../../src/paths";

const DESKTOP_PROFILE = resolve(E2E_STATE_DIR, "demo-desktop-profile");
const CHROME_PROFILE = resolve(E2E_STATE_DIR, "demo-chrome-profile");
const FORM_PAGES = [
  "/demo/koto-ward-procedure",
  "/demo/shinjuku-ward",
  "/demo/mizuho-bank",
  "/demo/tsubame-onboarding",
  "/demo/konin-todoke",
  "/demo/vn-ct01",
  "/demo/en-arrival-card",
];

test("live demo", async () => {
  test.setTimeout(0);
  const who = account();
  rmSync(DESKTOP_PROFILE, { recursive: true, force: true });
  rmSync(CHROME_PROFILE, { recursive: true, force: true });

  // The desktop app, signed in to the demo account. Not in test mode: a filled PDF opens in Preview.
  const app = await _electron.launch({
    args: [DESKTOP_BUILD_DIR, "--no-sandbox", "--ignore-certificate-errors"],
    env: {
      ...process.env,
      VOWKEY_APPDATA_DIR: DESKTOP_PROFILE,
      VOWKEY_IPC_SOCKET_DIR: E2E_STATE_DIR,
      NODE_ENV: "development",
    },
  });
  const window = await app.firstWindow({ timeout: 60_000 });
  await window.waitForLoadState("domcontentloaded");
  await new LoginPage(window).logIn();
  await window.waitForURL(/#\/vault/, { timeout: 60_000 });
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.closeDevTools();
    }
  });

  // Chromium with the extension, signed in to the same account, and the demo forms served locally.
  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    channel: "chromium",
    headless: false,
    viewport: null,
    ignoreHTTPSErrors: true,
    args: [
      `--load-extension=${BROWSER_BUILD_DIR}`,
      `--disable-extensions-except=${BROWSER_BUILD_DIR}`,
      "--ignore-certificate-errors",
    ],
  });
  const dev = await context.newPage();
  await dev.goto("chrome://extensions");
  const toggle = dev.locator("#devMode");
  if ((await toggle.getAttribute("aria-checked")) !== "true") {
    await toggle.click();
  }
  await dev.close();

  await serveForms(context);
  const popup = await context.newPage();
  await popup.goto(await popupUrl(context));
  await reachLoginPage(popup);
  await new LoginPage(popup).logIn();
  await popup.waitForURL(/#\/tabs\//, { timeout: 60_000 });
  await popup.close();

  for (const path of FORM_PAGES) {
    const page = await context.newPage();
    await page.goto(`https://forms.test${path}`);
  }

  console.log("\nREADY. The desktop app and Chromium are signed in as", who.email);
  console.log("Press Ctrl+C here to stop the demo.\n");
  await new Promise<void>(() => undefined);
});
