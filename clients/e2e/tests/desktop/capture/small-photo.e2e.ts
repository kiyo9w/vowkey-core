import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "../../../src/desktop/fixtures";
import { demoDocument } from "../../../src/documents";
import { LoginPage } from "../../../src/login";

const VAULT_URL = /#\/vault/;

test("a photo whose print is too small to read saves nothing and asks for a closer one", async ({
  window,
}) => {
  // A whole payslip photographed from across a room: the page is 400 pixels tall.
  const photo = join(mkdtempSync(join(tmpdir(), "vowkey-small-")), "payslip.jpg");
  execFileSync("sips", [
    "-s", "format", "jpeg",
    "-s", "formatOptions", "30",
    "-Z", "400",
    demoDocument("payslip_2026_09.pdf"),
    "--out", photo,
  ]);

  const login = new LoginPage(window);
  await login.logIn();
  await login.waitForVault(VAULT_URL);
  await window.getByTestId("vowkey-new").click();
  await window.getByTestId("vowkey-new-document").click();

  await window.getByTestId("quick-bar-file-input").setInputFiles(photo);

  const status = window.getByTestId("quick-bar-status");
  await expect(status).toContainText("Couldn't read payslip.jpg", { timeout: 60_000 });
  await expect(window.getByTestId("quick-bar-notice")).toHaveText(
    "The print is too small in this photo. Retake it closer, or add the original file.",
  );
  await expect(window.getByTestId("quick-bar-added")).toHaveCount(0);
});
