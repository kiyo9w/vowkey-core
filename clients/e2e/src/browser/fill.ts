import { BrowserContext, Page, Worker, expect } from "@playwright/test";

import { FORMS_ORIGIN } from "./fill-forms";

const EXTENSION_SCHEME = "chrome-extension://";
export const FILL_TIMEOUT_MS = 15_000;

/** The extension's background, which keeps its main instance on `self` for debugging. */
async function backgroundWorker(context: BrowserContext): Promise<Worker> {
  return (
    context.serviceWorkers().find((w) => w.url().startsWith(EXTENSION_SCHEME)) ??
    (await context.waitForEvent("serviceworker"))
  );
}

/** Runs the autofill command the browser shortcut would run, on the page in front. */
export async function runCommand(context: BrowserContext, page: Page, command: string) {
  await page.bringToFront();
  const worker = await backgroundWorker(context);
  await expect
    .poll(
      async () =>
        worker.evaluate(async () => {
          const main = (self as any).vowkeyMain;
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) {return 0;}
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

export async function openForm(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FORMS_ORIGIN}${path}`);
  return page;
}
