import { expect, test } from "../../../src/desktop/fixtures";
import { specimen } from "../../../src/documents";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;

test("a photo of a passport is read on this computer into a new profile", async ({ window }) => {
  const login = new LoginPage(window);
  await login.logIn();
  await login.waitForVault(VAULT_URL);
  await window.getByTestId("vowkey-new").click();
  await window.getByTestId("vowkey-new-document").click();

  await window
    .getByTestId("quick-bar-file-input")
    .setInputFiles(specimen("nl/passport-2014-specimen.jpg"));

  const reader = window.locator(".vk-reader-dialog");
  await expect(reader).toContainText("to a new profile, WILLEKE LISELOTTE DE BRUIJN", {
    timeout: 90_000,
  });
  await expect(reader).toContainText("SPECI2014");
  await expect(reader).toContainText("1965-03-10");
});
