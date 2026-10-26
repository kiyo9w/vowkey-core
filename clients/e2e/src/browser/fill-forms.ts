import { BrowserContext } from "@playwright/test";

/** Host the fill pages are served from; the seeded login is for this host. */
export const FORMS_ORIGIN = "https://forms.test";

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><form action="#" onsubmit="return false">${body}</form></body></html>`;

const field = (label: string, input: string) => `<p><label>${label} ${input}</label></p>`;

const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const years = Array.from({ length: 10 }, (_, i) => String(2026 + i));
const options = (values: string[]) => values.map((v) => `<option value="${v}">${v}</option>`).join("");

export const FORMS: Record<string, string> = {
  "/login": page(
    "Sign in",
    field("Username", '<input type="text" id="username" name="username" autocomplete="username">') +
      field("Password", '<input type="password" id="password" name="password" autocomplete="current-password">') +
      "<button>Sign in</button>",
  ),
  "/checkout": page(
    "Payment",
    field("Name on card", '<input type="text" id="cc-name" name="ccname" autocomplete="cc-name">') +
      field("Card number", '<input type="text" id="cc-number" name="cardnumber" autocomplete="cc-number">') +
      field("Expiry month", `<select id="cc-exp-month" name="exp-month" autocomplete="cc-exp-month">${options(months)}</select>`) +
      field("Expiry year", `<select id="cc-exp-year" name="exp-year" autocomplete="cc-exp-year">${options(years)}</select>`) +
      field("Security code", '<input type="text" id="cc-csc" name="cvc" autocomplete="cc-csc">') +
      "<button>Pay</button>",
  ),
  "/profile": page(
    "Your details",
    field("First name", '<input type="text" id="first-name" name="firstname" autocomplete="given-name">') +
      field("Middle name", '<input type="text" id="middle-name" name="middlename" autocomplete="additional-name">') +
      field("Last name", '<input type="text" id="last-name" name="lastname" autocomplete="family-name">') +
      field("Email", '<input type="email" id="email" name="email" autocomplete="email">') +
      field("Phone", '<input type="tel" id="phone" name="phone" autocomplete="tel">') +
      field("Address", '<input type="text" id="address" name="address1" autocomplete="address-line1">') +
      field("City", '<input type="text" id="city" name="city" autocomplete="address-level2">') +
      field("State", '<input type="text" id="state" name="state" autocomplete="address-level1">') +
      field("Postal code", '<input type="text" id="postal-code" name="zip" autocomplete="postal-code">') +
      field("Country", '<input type="text" id="country" name="country" autocomplete="country">') +
      field("Company", '<input type="text" id="company" name="company" autocomplete="organization">') +
      field("Passport number", '<input type="text" id="passport-number" name="passport_number">') +
      field("Driver licence number", '<input type="text" id="licence-number" name="licence_number">') +
      "<button>Save</button>",
  ),
};

/** Serves the pages at FORMS_ORIGIN without a network. */
export async function serveForms(context: BrowserContext) {
  await context.route(`${FORMS_ORIGIN}/**`, (route) => {
    const body = FORMS[new URL(route.request().url()).pathname];
    return body == null
      ? route.fulfill({ status: 404, body: "not found" })
      : route.fulfill({ status: 200, contentType: "text/html", body });
  });
}
