import { BrowserContext, Page, Worker, expect } from "@playwright/test";

import { FORMS_ORIGIN, serveForms } from "../../../src/browser/fill-forms";
import { popupUrl, test } from "../../../src/browser/fixtures";
import { LoginPage } from "../../../src/login";

const EXTENSION_SCHEME = "chrome-extension://";
const FILL_TIMEOUT_MS = 15_000;

/** The extension's background, which keeps its main instance on `self` for debugging. */
async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  return (
    context.serviceWorkers().find((w) => w.url().startsWith(EXTENSION_SCHEME)) ??
    (await context.waitForEvent("serviceworker"))
  );
}

/** Runs the autofill command the browser shortcut would run, on the page in front. */
async function runCommand(context: BrowserContext, page: Page, command: string) {
  await page.bringToFront();
  const worker = await backgroundWorker(context);
  await expect
    .poll(
      async () =>
        worker.evaluate(async () => {
          const main = (self as any).vowkeyMain;
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) return 0;
          const details = await main.autofillOrchestrator.collectPageDetails(tab);
          return details.length;
        }),
      { timeout: FILL_TIMEOUT_MS },
    )
    .toBeGreaterThan(0);
  await worker.evaluate(
    (name) => (self as any).vowkeyMain.commandsBackground.processCommand(name),
    command,
  );
}

async function openForm(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FORMS_ORIGIN}${path}`);
  return page;
}

test.describe("fills from the vault in the extension", () => {
  test.beforeEach(async ({ context, popup }) => {
    await serveForms(context);
    const login = new LoginPage(popup);
    await login.logIn();
    await login.waitForVault(/#\/tabs\//);
    // The vault is synced once the seeded items are listed.
    await popup.goto(`${await popupUrl(context)}#/tabs/vault`);
    await expect(popup.getByText("Forms login")).toBeVisible({ timeout: 30_000 });
  });

  test("a login fills the username and the password", async ({ context }) => {
    const page = await openForm(context, "/login");
    await runCommand(context, page, "autofill_login");

    await expect(page.locator("#username")).toHaveValue("linh.nguyen", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#password")).toHaveValue("hunter2-example");
  });

  test("a card fills the name, the number, the expiry and the code", async ({ context }) => {
    const page = await openForm(context, "/checkout");
    await runCommand(context, page, "autofill_card");

    await expect(page.locator("#cc-name")).toHaveValue("Linh Nguyen", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#cc-number")).toHaveValue("4111111111111111");
    await expect(page.locator("#cc-exp-month")).toHaveValue("12");
    await expect(page.locator("#cc-exp-year")).toHaveValue("2030");
    await expect(page.locator("#cc-csc")).toHaveValue("123");
  });

  test("an identity fills the name, the contact details and the address", async ({ context }) => {
    const page = await openForm(context, "/profile");
    await runCommand(context, page, "autofill_identity");

    await expect(page.locator("#first-name")).toHaveValue("Linh", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#middle-name")).toHaveValue("Thuy");
    await expect(page.locator("#last-name")).toHaveValue("Nguyen");
    await expect(page.locator("#email")).toHaveValue("linh@example.com");
    await expect(page.locator("#phone")).toHaveValue("+81 90 1234 5678");
    await expect(page.locator("#address")).toHaveValue("1-2-3 Shinjuku");
    await expect(page.locator("#city")).toHaveValue("Shinjuku-ku");
    await expect(page.locator("#state")).toHaveValue("Tokyo");
    await expect(page.locator("#postal-code")).toHaveValue("160-0022");
    await expect(page.locator("#country")).toHaveValue("JP");
    await expect(page.locator("#company")).toHaveValue("Tsubame Cloud");
  });

  test("an identity fills the passport number and the licence number", async ({ context }) => {
    const page = await openForm(context, "/profile");
    await runCommand(context, page, "autofill_identity");

    await expect(page.locator("#first-name")).toHaveValue("Linh", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#passport-number")).toHaveValue("B1234567");
    await expect(page.locator("#licence-number")).toHaveValue("D9999");
  });
});
