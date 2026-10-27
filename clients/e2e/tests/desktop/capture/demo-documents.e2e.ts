import { expect, test } from "../../../src/desktop/fixtures";
import { demoDocument } from "../../../src/documents";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;
const PROFILE = "THI LINH NGUYEN";

test("four documents dropped into the bar end up as the details of one profile", async ({
  window,
}) => {
  const login = new LoginPage(window);
  await login.logIn();
  await login.waitForVault(VAULT_URL);
  await window.getByTestId("vowkey-quick-bar-trigger").click();

  const added = window.getByTestId("quick-bar-added");
  for (const file of [
    "residence_card.pdf",
    "bank_passbook.pdf",
    "employment_contract.pdf",
    "payslip_2026_09.pdf",
  ]) {
    await window.getByTestId("quick-bar-file-input").setInputFiles(demoDocument(file));
    await expect(added).toContainText(`Read from ${file}`, { timeout: 30_000 });
    await expect(added).not.toContainText("could not be attached");
  }

  // The first document started the profile and the rest joined it.
  await expect(window.getByTestId("quick-bar-status")).toContainText(`to ${PROFILE}`);

  // Reopen the bar and look a detail of each document up.
  await window.keyboard.press("Escape");
  await window.getByTestId("vowkey-quick-bar-trigger").click();
  const search = window.getByTestId("quick-bar-search-input");
  const sheet = window.getByTestId("quick-bar-sheet");
  for (const [value, label] of [
    ["AB12345678CD", "Residence card number"],
    ["4821903", "Account number"],
    ["TC-0418", "Employee number"],
    ["398887", "Monthly pay after deductions"],
  ]) {
    await search.fill(value);
    await expect(sheet).toContainText(`${label} · ${PROFILE}`);
    await expect(sheet).toContainText(value);
  }
});
