import { expect } from "@playwright/test";

import { FILL_TIMEOUT_MS, openForm, runCommand } from "../../../src/browser/fill";
import { serveForms } from "../../../src/browser/fill-forms";
import { popupUrl, test } from "../../../src/browser/fixtures";
import { LoginPage } from "../../../src/login";

test.describe("fills from the vault in the extension", () => {
  test.beforeEach(async ({ context, popup }) => {
    await serveForms(context);
    const login = new LoginPage(popup);
    await login.logIn();
    await login.waitForVault(/#\/tabs\//);
    // The vault is synced once the seeded items are listed.
    await popup.goto(`${await popupUrl(context)}#/tabs/vault`);
    await expect(popup.getByText("Forms login")).toBeVisible({ timeout: 30_000 });
  });

  test("a login fills the username and the password", async ({ context }) => {
    const page = await openForm(context, "/login");
    await runCommand(context, page, "autofill_login");

    await expect(page.locator("#username")).toHaveValue("linh.nguyen", {
      timeout: FILL_TIMEOUT_MS,
    });
    await expect(page.locator("#password")).toHaveValue("hunter2-example");
  });

  test("a card fills the name, the number, the expiry and the code", async ({ context }) => {
    const page = await openForm(context, "/checkout");
    await runCommand(context, page, "autofill_card");

    await expect(page.locator("#cc-name")).toHaveValue("Linh Nguyen", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#cc-number")).toHaveValue("4111111111111111");
    await expect(page.locator("#cc-exp-month")).toHaveValue("12");
    await expect(page.locator("#cc-exp-year")).toHaveValue("2030");
    await expect(page.locator("#cc-csc")).toHaveValue("123");
  });

  test("an identity fills the name, the contact details and the address", async ({ context }) => {
    const page = await openForm(context, "/profile");
    await runCommand(context, page, "autofill_identity");

    await expect(page.locator("#first-name")).toHaveValue("Linh", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#middle-name")).toHaveValue("Thuy");
    await expect(page.locator("#last-name")).toHaveValue("Nguyen");
    await expect(page.locator("#email")).toHaveValue("linh@example.com");
    await expect(page.locator("#phone")).toHaveValue("+81 90 1234 5678");
    await expect(page.locator("#address")).toHaveValue("1-2-3 Shinjuku");
    await expect(page.locator("#city")).toHaveValue("Shinjuku-ku");
    await expect(page.locator("#state")).toHaveValue("Tokyo");
    await expect(page.locator("#postal-code")).toHaveValue("160-0022");
    await expect(page.locator("#country")).toHaveValue("JP");
    await expect(page.locator("#company")).toHaveValue("Tsubame Cloud");
  });

  test("an identity fills the passport number and the licence number", async ({ context }) => {
    const page = await openForm(context, "/profile");
    await runCommand(context, page, "autofill_identity");

    await expect(page.locator("#first-name")).toHaveValue("Linh", { timeout: FILL_TIMEOUT_MS });
    await expect(page.locator("#passport-number")).toHaveValue("B1234567");
    await expect(page.locator("#licence-number")).toHaveValue("D9999");
  });

  test("an identity fills Mizuho Bank, Shinjuku Ward and Tsubame HR Demo forms with Zengin, Wareki and controlled state", async ({
    context,
  }) => {
    const mizuho = await openForm(context, "/demo/mizuho-bank");
    await runCommand(context, mizuho, "autofill_identity");
    await expect(mizuho.locator("#applicant_name_kanji")).toHaveValue("NGUYEN THI LINH", {
      timeout: FILL_TIMEOUT_MS,
    });
    await expect(mizuho.locator("#applicant_name_kana")).toHaveValue("グエン ティ リン");
    await expect(mizuho.locator("#birth_date_wareki")).toHaveValue("平成12年3月12日");
    await expect(mizuho.locator("#postal_code")).toHaveValue("160-0022");
    await expect(mizuho.locator("#address_full")).toHaveValue(
      "東京都新宿区西新宿3-7-12 西新宿パレス305号",
    );
    await expect(mizuho.locator("#mobile_phone")).toHaveValue("080-4129-8831");
    await expect(mizuho.locator("#bank_name")).toHaveValue("みずほ銀行");
    await expect(mizuho.locator("#bank_code")).toHaveValue("0001");
    await expect(mizuho.locator("#branch_name")).toHaveValue("新宿支店");
    await expect(mizuho.locator("#branch_code")).toHaveValue("210");
    await expect(mizuho.locator("#account_type")).toHaveValue("普通");
    await expect(mizuho.locator("#account_number")).toHaveValue("7412893");
    await expect(mizuho.locator("#account_holder_zengin")).toHaveValue("ｸﾞｴﾝ ﾃｲ ﾘﾝ");
    await expect(mizuho.locator("#employer_name")).toHaveValue("Tsubame Cloud");
    await expect(mizuho.locator("#employee_id")).toHaveValue("TR-2026-0418");
    await expect(mizuho.locator("#employer_phone")).toHaveValue("03-6412-7700");

    const shinjuku = await openForm(context, "/demo/shinjuku-ward");
    await runCommand(context, shinjuku, "autofill_identity");
    await expect(shinjuku.locator("#romaji_name")).toHaveValue("NGUYEN THI LINH", {
      timeout: FILL_TIMEOUT_MS,
    });
    await expect(shinjuku.locator("#kanji_name")).toHaveValue("NGUYEN THI LINH");
    await expect(shinjuku.locator("#kana_name")).toHaveValue("グエン ティ リン");
    await expect(shinjuku.locator("#nationality")).toHaveValue("ベトナム");
    await expect(shinjuku.locator("#dob_iso")).toHaveValue("2000-03-12");
    await expect(shinjuku.locator("#gender")).toHaveValue("女性");
    await expect(shinjuku.locator("#current_address")).toHaveValue(
      "東京都新宿区西新宿3-7-12 西新宿パレス305号",
    );
    await expect(shinjuku.locator("#visa_status")).toHaveValue("技術・人文知識・国際業務");
    await expect(shinjuku.locator("#visa_period")).toHaveValue("3年");
    await expect(shinjuku.locator("#visa_expiry")).toHaveValue("2028-04-01");
    await expect(shinjuku.locator("#residence_card_no")).toHaveValue("AB12345678CD");
    await expect(shinjuku.locator("#my_number_input")).toHaveValue("");
    await expect(shinjuku.locator("#emerg_name")).toHaveValue("NGUYEN VAN MINH");
    await expect(shinjuku.locator("#emerg_relation")).toHaveValue("父");
    await expect(shinjuku.locator("#emerg_phone")).toHaveValue("090-7712-3304");

    const tsubame = await openForm(context, "/demo/tsubame-onboarding");
    await runCommand(context, tsubame, "autofill_identity");
    await expect(tsubame.locator("#emp_name")).toHaveValue("NGUYEN THI LINH", {
      timeout: FILL_TIMEOUT_MS,
    });
    await expect(tsubame.locator("#emp_email")).toHaveValue("linh@example.com");
    await expect(tsubame.locator("#emp_dept")).toHaveValue("ロボティクス開発本部");
    await expect(tsubame.locator("#emp_title")).toHaveValue("シニア組み込みエンジニア");
    await expect(tsubame.locator("#emp_gross_pay")).toHaveValue("410000");
    await expect(tsubame.locator("#emp_net_pay")).toHaveValue("328450");
    await expect(tsubame.locator("#motivation_note")).toHaveValue("");

    const controlledCount = await tsubame.evaluate(
      () => Object.keys((window as any).__controlledFormState || {}).length,
    );
    expect(controlledCount).toBe(6);
  });
});
