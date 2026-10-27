import { expect } from "@playwright/test";

import { FILL_TIMEOUT_MS, openForm, runCommand } from "../../src/browser/fill";
import { serveForms } from "../../src/browser/fill-forms";
import { popupUrl, test } from "../../src/browser/fixtures";
import { LoginPage } from "../../src/login";

const PROFILE = "THI LINH NGUYEN";

test("the demo forms fill from what the dropped documents said", async ({ context, popup }) => {
  await serveForms(context);
  const login = new LoginPage(popup);
  await login.logIn();
  await login.waitForVault(/#\/tabs\//);
  await popup.goto(`${await popupUrl(context)}#/tabs/vault`);
  await expect(popup.getByRole("button", { name: `View item - ${PROFILE}`, exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const fillIdentity = async (path: string) => {
    const page = await openForm(context, path);
    await runCommand(context, page, "autofill_identity");
    return page;
  };
  const filled = (page: Awaited<ReturnType<typeof openForm>>, id: string, value: string) =>
    expect(page.locator(id)).toHaveValue(value, { timeout: FILL_TIMEOUT_MS });
  const address = "東京都新宿区高田馬場4-18-9 メゾン高田馬場302";

  // 銀行: the residence card, the passbook, the contract and the payslip all contribute.
  const mizuho = await fillIdentity("/demo/mizuho-bank");
  await filled(mizuho, "#applicant_name_kanji", "阮 氏玲");
  await filled(mizuho, "#applicant_name_kana", "グエン ティ リン");
  await filled(mizuho, "#birth_date_wareki", "平成10年3月14日");
  await filled(mizuho, "#postal_code", "169-0075");
  await filled(mizuho, "#address_full", address);
  await filled(mizuho, "#mobile_phone", "080-3921-6640");
  await filled(mizuho, "#bank_name", "みずほ銀行");
  await filled(mizuho, "#bank_code", "0001");
  await filled(mizuho, "#branch_name", "新宿支店");
  await filled(mizuho, "#branch_code", "210");
  await filled(mizuho, "#account_type", "普通");
  await filled(mizuho, "#account_number", "4821903");
  await filled(mizuho, "#account_holder_zengin", "ｸﾞｴﾝ ﾃｲ ﾘﾝ");
  await filled(mizuho, "#employer_name", "ツバメクラウド株式会社");
  await filled(mizuho, "#employee_id", "TC-0418");
  await filled(mizuho, "#employer_phone", "03-6418-5500");

  // 区役所: the residence card's own fields, and the one the form asks not to autofill, which a Fill the person asked for still fills.
  const shinjuku = await fillIdentity("/demo/shinjuku-ward");
  await filled(shinjuku, "#romaji_name", "NGUYEN THI LINH");
  await filled(shinjuku, "#kanji_name", "阮 氏玲");
  await filled(shinjuku, "#kana_name", "グエン ティ リン");
  await filled(shinjuku, "#nationality", "ベトナム");
  await filled(shinjuku, "#dob_iso", "1998-03-14");
  await filled(shinjuku, "#gender", "女性");
  await filled(shinjuku, "#current_address", address);
  await filled(shinjuku, "#visa_status", "技術・人文知識・国際業務");
  await filled(shinjuku, "#visa_period", "5年");
  await filled(shinjuku, "#visa_expiry", "2030-04-01");
  await filled(shinjuku, "#residence_card_no", "AB12345678CD");
  await filled(shinjuku, "#emerg_name", "グエン ヴァン ミン");
  await filled(shinjuku, "#emerg_relation", "兄");
  await filled(shinjuku, "#emerg_phone", "080-9182-3301");
  await filled(shinjuku, "#my_number_input", "491820394814");

  // 入社手続: the contract and the payslip, into a form that keeps its state in script.
  const tsubame = await fillIdentity("/demo/tsubame-onboarding");
  await filled(tsubame, "#emp_name", "阮 氏玲");
  await filled(tsubame, "#emp_email", "linh.nguyen@tsubame.jp");
  await filled(tsubame, "#emp_dept", "プロダクト開発本部");
  await filled(tsubame, "#emp_title", "シニアソフトウェアエンジニア");
  await filled(tsubame, "#emp_gross_pay", "507400");
  await filled(tsubame, "#emp_net_pay", "398887");
  await expect(tsubame.locator("#motivation_note")).toHaveValue("");
  const controlled = await tsubame.evaluate(
    () => (window as Window & { __controlledFormState: Record<string, string> }).__controlledFormState,
  );
  expect(controlled).toEqual({
    emp_name: "阮 氏玲",
    emp_email: "linh.nguyen@tsubame.jp",
    emp_dept: "プロダクト開発本部",
    emp_title: "シニアソフトウェアエンジニア",
    emp_gross_pay: "507400",
    emp_net_pay: "398887",
  });
});
