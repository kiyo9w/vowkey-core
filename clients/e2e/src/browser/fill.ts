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

/** Call after observing a filled value, so the content script has started the batch. */
export async function waitForFillToFinish(context: BrowserContext) {
  const worker = await backgroundWorker(context);
  await expect.poll(
    () => worker.evaluate(() => {
      const background = self as unknown as {
        vowkeyMain: { overlayBackground: { checkIsFieldCurrentlyFilling(): boolean } };
      };
      return background.vowkeyMain.overlayBackground.checkIsFieldCurrentlyFilling();
    }),
    { timeout: FILL_TIMEOUT_MS },
  ).toBe(false);
}

export async function selectProfileAction(
  page: Page,
  field: string,
  scope: "field" | "form",
) {
  await page.locator(field).click();
  await expect.poll(
    () => page.frames().some((frame) => frame.url().endsWith("/overlay/menu-button.html")),
    { timeout: FILL_TIMEOUT_MS },
  ).toBe(true);
  await page.locator(field).press("ArrowDown");
  const selector = `[data-profile-${scope}]`;
  await expect.poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    return frame ? frame.evaluate((target) => {
      const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
        shadowDom: ShadowRoot;
      };
      const button = host?.shadowDom?.querySelector<HTMLButtonElement>(target);
      return !!button && !button.disabled;
    }, selector) : false;
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);

  const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
  const button = await frame.evaluateHandle((target) => {
    const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
      shadowDom: ShadowRoot;
    };
    const element = host.shadowDom.querySelector<HTMLButtonElement>(target);
    element?.scrollIntoView({ block: "nearest" });
    return element;
  }, selector);
  await button.asElement().click();
  await button.dispose();
}

export async function selectProfileDetail(
  page: Page,
  field: string,
  detailKey: string,
) {
  await page.locator(field).click();
  await expect.poll(
    () => page.frames().some((frame) => frame.url().endsWith("/overlay/menu-button.html")),
    { timeout: FILL_TIMEOUT_MS },
  ).toBe(true);
  await page.locator(field).press("ArrowDown");
  const selector = `[data-profile-detail="${detailKey}"]`;
  await expect.poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    return frame ? frame.evaluate((target) => {
      const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
        shadowDom: ShadowRoot;
      };
      const button = host?.shadowDom?.querySelector<HTMLButtonElement>(target);
      return !!button && !button.disabled;
    }, selector) : false;
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);

  const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
  const button = await frame.evaluateHandle((target) => {
    const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
      shadowDom: ShadowRoot;
    };
    const element = host.shadowDom.querySelector<HTMLButtonElement>(target);
    element?.scrollIntoView({ block: "nearest" });
    return element;
  }, selector);
  await button.asElement().click();
  await button.dispose();
}

export async function openForm(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FORMS_ORIGIN}${path}`);
  return page;
}
