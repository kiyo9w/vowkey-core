import { expect, test } from "../../../src/desktop/fixtures";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;

test("logs into the vault with a master password and opens the Quick layer bar", async ({
  window,
}) => {
  // Given the user is on the login page
  const login = new LoginPage(window);

  // When the user logs in with a master password
  await login.logIn();

  // Then the user should be redirected to the vault page
  await login.waitForVault(VAULT_URL);

  // And the Quick layer bar opens and shows the search input and sheet
  const trigger = window.getByTestId("vowkey-quick-bar-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();

  await expect(window.getByTestId("vowkey-quick-bar-pill")).toBeVisible();
  await expect(window.getByTestId("quick-bar-search-input")).toBeVisible();
  await expect(window.getByTestId("quick-bar-sheet")).toBeVisible();
});
