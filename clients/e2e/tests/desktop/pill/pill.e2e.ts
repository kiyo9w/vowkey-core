import { ElectronApplication, Page } from "@playwright/test";

import { expect, test } from "../../../src/desktop/fixtures";
import { demoDocument } from "../../../src/documents";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;

/** Opens the pill the way a click on the Vowkey icon does, and returns its window. */
async function openPill(app: ElectronApplication): Promise<Page> {
  await app.evaluate(async () => {
    await (globalThis as any).vowkeyQuickBar.toggle({ x: 1200, y: 0, width: 24, height: 24 });
  });
  await expect
    .poll(() => app.windows().find((w) => w.url().includes("quick-pill/pill.html")))
    .toBeTruthy();
  const pill = app.windows().find((w) => w.url().includes("quick-pill/pill.html"))!;
  await pill.waitForLoadState("domcontentloaded");
  return pill;
}

test("the icon opens the pill, which finds a detail from a dropped document and copies it", async ({
  app,
  window,
}) => {
  const login = new LoginPage(window);
  await login.logIn();
  await login.waitForVault(VAULT_URL);

  // Add a document in the Hub so the vault has details.
  await window.getByTestId("vowkey-new").click();
  await window.getByTestId("vowkey-new-document").click();
  await window
    .getByTestId("quick-bar-file-input")
    .setInputFiles(demoDocument("residence_card.pdf"));
  await expect(window.locator(".vk-reader-dialog").first()).toContainText("AB12345678CD", {
    timeout: 90_000,
  });
  // Escape closes the reader that opens on the profile.
  await window.keyboard.press("Escape");

  const pill = await openPill(app);
  const search = pill.locator("#q");
  await expect(search).toBeFocused();
  const profilePicker = pill.getByRole("combobox", { name: "Profile", exact: true });
  await expect(profilePicker.or(pill.locator(".qrow.sel")).first()).toBeVisible();
  if (await profilePicker.isVisible()) {
    const profileId = await profilePicker
      .getByRole("option", { name: /LINH.*NGUYEN/ })
      .getAttribute("value");
    await profilePicker.selectOption(profileId!);
  }

  await search.fill("AB1234");
  const row = pill.locator(".qrow.sel");
  await expect(row).toContainText("Residence card number");
  await expect(row).toContainText("AB12345678CD");

  await row.locator("summary").click();
  await row.getByRole("button", { name: "Copy", exact: true }).click();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("AB12345678CD");

  // Esc puts it away; the icon brings it back with an empty search.
  await pill.keyboard.press("Escape");
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (w) => w.webContents.getURL().includes("quick-pill") && w.isVisible(),
        ),
      ),
    )
    .toBe(false);
  await openPill(app);
  await expect(pill.locator("#q")).toHaveValue("");
});
