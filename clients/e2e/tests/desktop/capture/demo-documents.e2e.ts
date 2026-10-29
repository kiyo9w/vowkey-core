import { expect, test } from "../../../src/desktop/fixtures";
import { demoDocument } from "../../../src/documents";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;
// Decision names the person as the documents print it: with or without the middle name.
const PROFILE = /LINH NGUYEN/;

test("four documents dropped into the bar end up as the details of one profile", async ({
  window,
}) => {
  const login = new LoginPage(window);
  await login.logIn();
  await login.waitForVault(VAULT_URL);
  for (const file of [
    "residence_card.pdf",
    "bank_passbook.pdf",
    "employment_contract.pdf",
    "payslip_2026_09.pdf",
  ]) {
    await window.getByTestId("vowkey-new").click();
    await window.getByTestId("vowkey-new-document").click();
    await window.getByTestId("quick-bar-file-input").setInputFiles(demoDocument(file));
    // The reader opens on the profile the document was added to.
    const reader = window.locator(".vk-reader-dialog");
    await expect(reader).toContainText(/Added \d+ details? to/, { timeout: 90_000 });
    await expect(reader).toContainText(PROFILE);
    await window.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
  }

  // Reopen the bar and look a detail of each document up.
  await window.getByTestId("vowkey-new").click();
  await window.getByTestId("vowkey-new-document").click();
  const search = window.getByTestId("quick-bar-search-input");
  const sheet = window.getByTestId("quick-bar-sheet");
  for (const [value, label] of [
    ["AB12345678CD", "Residence card number"],
    ["4821903", "Account number"],
    ["TC-0418", "Employee number"],
    ["398887", "Monthly pay after deductions"],
  ]) {
    await search.fill(value);
    await expect(sheet).toContainText(new RegExp(`${label} · .*${PROFILE.source}`));
    await expect(sheet).toContainText(value);
  }
});
