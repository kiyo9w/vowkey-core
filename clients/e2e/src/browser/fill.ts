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

async function clickMenuListButton(page: Page, selector: string, optional = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    if (!frame) {
      await page.waitForTimeout(30);
      continue;
    }
    const handle = await frame.evaluateHandle((target) => {
      const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
        shadowDom: ShadowRoot;
      };
      const element = host?.shadowDom?.querySelector<HTMLButtonElement>(target);
      element?.scrollIntoView({ block: "nearest" });
      return element ?? null;
    }, selector);
    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      if (optional) {
        return;
      }
      await page.waitForTimeout(30);
      continue;
    }
    try {
      await element.click({ timeout: 3000 });
      await handle.dispose();
      return;
    } catch (err) {
      await handle.dispose();
      if (attempt === 3) {
        throw err;
      }
      await page.waitForTimeout(30);
    }
  }
}

async function focusFieldForInlineMenu(page: Page, field: string) {
  const blurredDifferentControl = await page.evaluate((selector) => {
    const target = document.querySelector(selector);
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== target && active !== document.body && active !== document.documentElement) {
      active.blur?.();
      return true;
    }
    return false;
  }, field);
  if (blurredDifferentControl) {
    await expect.poll(async () => {
      const listFrame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
      if (!listFrame) {
        return true;
      }
      try {
        return await listFrame.evaluate(() => window.innerHeight === 0);
      } catch {
        return true;
      }
    }, { timeout: FILL_TIMEOUT_MS }).toBe(true);
  }

  const locator = page.locator(field);
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await locator.click();

  await expect.poll(async () => {
    const buttonFrame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-button.html"));
    if (!buttonFrame) {
      return false;
    }
    try {
      return await buttonFrame.evaluate(() => window.innerHeight > 0 && window.innerWidth > 0);
    } catch {
      return false;
    }
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);

  await locator.press("ArrowDown");

  await expect.poll(async () => {
    const listFrame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    if (!listFrame) {
      return false;
    }
    try {
      return await listFrame.evaluate(() => window.innerHeight > 0 && document.hasFocus());
    } catch {
      return false;
    }
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);
}

export async function selectProfileAction(
  page: Page,
  field: string,
  scope: "field" | "form",
) {
  await focusFieldForInlineMenu(page, field);
  const selector = `[data-profile-${scope}]`;
  await expect.poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    return frame ? frame.evaluate((target) => {
      if (window.innerHeight <= 0) {
        return false;
      }
      const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
        shadowDom: ShadowRoot;
      };
      const button = host?.shadowDom?.querySelector<HTMLButtonElement>(target);
      if (!button || button.disabled) {
        return false;
      }
      button.scrollIntoView({ block: "nearest" });
      const rect = button.getBoundingClientRect();
      return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
    }, selector) : false;
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);

  await clickMenuListButton(page, selector);
}

export async function selectProfileDetail(
  page: Page,
  field: string,
  detailKey: string,
) {
  await focusFieldForInlineMenu(page, field);
  const selector = `[data-profile-detail="${detailKey}"]`;
  await expect.poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    return frame ? frame.evaluate((target) => {
      if (window.innerHeight <= 0) {
        return false;
      }
      const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
        shadowDom: ShadowRoot;
      };
      const chooseBtn = host?.shadowDom?.querySelector<HTMLButtonElement>("[data-profile-choose-detail]");
      if (chooseBtn) {
        chooseBtn.scrollIntoView({ block: "nearest" });
        const rect = chooseBtn.getBoundingClientRect();
        return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
      }
      const button = host?.shadowDom?.querySelector<HTMLButtonElement>(target);
      if (!button || button.disabled || button.closest("[hidden]")) {
        return false;
      }
      button.scrollIntoView({ block: "nearest" });
      const rect = button.getBoundingClientRect();
      return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
    }, selector) : false;
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);

  await clickMenuListButton(page, '[data-profile-choose-detail][aria-expanded="false"]', true);

  await expect.poll(async () => {
    const frame = page.frames().find((candidate) => candidate.url().endsWith("/overlay/menu-list.html"));
    return frame ? frame.evaluate((target) => {
      if (window.innerHeight <= 0) {
        return false;
      }
      const host = document.querySelector("autofill-inline-menu-list") as HTMLElement & {
        shadowDom: ShadowRoot;
      };
      const button = host?.shadowDom?.querySelector<HTMLButtonElement>(target);
      if (!button || button.disabled || button.closest("[hidden]")) {
        return false;
      }
      button.scrollIntoView({ block: "nearest" });
      const rect = button.getBoundingClientRect();
      return rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight;
    }, selector) : false;
  }, { timeout: FILL_TIMEOUT_MS }).toBe(true);

  await clickMenuListButton(page, selector);
}

export async function openForm(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${FORMS_ORIGIN}${path}`);
  return page;
}
