import { expect, test } from "../../../src/desktop/fixtures";
import { specimen } from "../../../src/documents";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;

test("a photo of a passport is read on this computer into a new profile", async ({ window }) => {
  const login = new LoginPage(window);
  await login.logIn();
  await login.waitForVault(VAULT_URL);
  await window.getByTestId("vowkey-quick-bar-trigger").click();

  await window
    .getByTestId("quick-bar-file-input")
    .setInputFiles(specimen("nl/passport-2014-specimen.jpg"));

  const added = window.getByTestId("quick-bar-added");
  await expect(added).toContainText("Read from passport-2014-specimen.jpg", { timeout: 30_000 });
  await expect(window.getByTestId("quick-bar-status")).toContainText(
    "to a new profile, WILLEKE LISELOTTE DE BRUIJN",
  );
  await expect(added).toContainText("SPECI2014");
  await expect(added).toContainText("1965-03-10");
});
