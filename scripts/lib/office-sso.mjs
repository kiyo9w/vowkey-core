// A tiny "browser" for the Keycloak login chain used by the office end-to-end harness:
// it follows redirects, keeps cookies per origin, fills Keycloak's username/password form
// and posts SAML POST-binding forms, until the chain redirects somewhere it is not allowed
// to follow (the client's own callback). No Playwright, no fake assertions: the SAML
// response is produced by the real Keycloak realm that acts as the identity provider.

// Keycloak sets its session cookies with Path=/realms/<realm>/, and the office and workforce
// realms live on the same origin, so cookies are kept per origin and realm path.
function cookieKey(url) {
  const parts = url.pathname.split("/").filter(Boolean);
  return `${url.origin}/${parts.slice(0, 2).join("/")}`;
}

export function newCookieJar() {
  const jars = new Map(); // cookieKey -> Map(cookie name -> value)
  return {
    header(url) {
      const jar = jars.get(cookieKey(url));
      if (!jar || jar.size === 0) return undefined;
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    store(url, response) {
      const key = cookieKey(url);
      for (const cookie of response.headers.getSetCookie?.() ?? []) {
        const [pair] = cookie.split(";");
        const eq = pair.indexOf("=");
        if (eq < 0) continue;
        const name = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        let jar = jars.get(key);
        if (!jar) jars.set(key, (jar = new Map()));
        if (value === "" && cookie.includes("Max-Age=0")) jar.delete(name);
        else jar.set(name, value);
      }
    },
  };
}

function unescapeHtml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inputFields(html) {
  const fields = [];
  const inputRe = /<input\b[^>]*>/gi;
  for (const tag of html.match(inputRe) ?? []) {
    const name = /name="([^"]*)"/i.exec(tag)?.[1];
    if (!name) continue;
    const value = unescapeHtml(/value="([^"]*)"/i.exec(tag)?.[1] ?? "");
    fields.push({ name: unescapeHtml(name), value });
  }
  return fields;
}

function formAction(html) {
  const form = /<form\b[^>]*>/i.exec(html)?.[0] ?? "";
  return unescapeHtml(/action="([^"]*)"/i.exec(form)?.[1] ?? "");
}

/**
 * Drives the login chain starting at `startUrl`.
 *
 * `follow` lists the origins the chain may continue on (the Vowkey server and Keycloak);
 * the first redirect to any other origin is returned as the client callback.
 * `profile` holds the directory user's fields; any form input whose name matches a key
 * (username, password, email, firstName, lastName, ...) is filled with it, so both the
 * directory login form and Keycloak's first-broker-login profile form are completed.
 */
export async function browseLogin(startUrl, { profile = {}, follow, maxSteps = 30 } = {}) {
  const { username, password, ...rest } = profile;
  const jar = newCookieJar();
  let url = new URL(startUrl);
  let method = "GET";
  let body = null;

  for (let step = 0; step < maxSteps; step += 1) {
    const headers = {};
    const cookie = jar.header(url);
    if (cookie) headers.cookie = cookie;
    if (body !== null) headers["content-type"] = "application/x-www-form-urlencoded";

    const response = await fetch(url, { method, redirect: "manual", headers, body });
    jar.store(url, response);
    if (process.env.OFFICE_E2E_TRACE) {
      console.error(`[sso] ${method} ${url.pathname}${url.search.slice(0, 60)} -> ${response.status} ${response.headers.get("location")?.slice(0, 80) ?? ""}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`redirect without a Location header at ${url}`);
      const next = new URL(location, url);
      if (!follow.includes(next.origin)) return { location: next, jar };
      url = next;
      method = "GET";
      body = null;
      continue;
    }

    if (response.status !== 200) {
      throw new Error(`${method} ${url} answered ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }

    // The web client's registered callback is the vault's sso-connector page, which carries
    // the code in its query string; that is where this chain ends.
    if (url.pathname.endsWith("/sso-connector.html") && url.searchParams.has("code")) {
      return { location: url, jar };
    }
    const html = await response.text();
    const fields = inputFields(html);
    const samlField = fields.find((field) => /^(SAMLResponse|SAMLRequest)$/.test(field.name));
    const hasLoginForm = fields.some((field) => field.name === "username");

    if (samlField) {
      // A SAML POST-binding page: submit the assertion/response exactly as posted.
      url = new URL(formAction(html) || url, url);
      method = "POST";
      body = new URLSearchParams(fields.map((field) => [field.name, field.value])).toString();
      continue;
    }
    if (hasLoginForm) {
      for (const field of fields) {
        if (field.name === "username" && username !== undefined) field.value = username;
        if (field.name === "password" && password !== undefined) field.value = password;
        if (rest[field.name] !== undefined) field.value = rest[field.name];
      }
      url = new URL(formAction(html) || url, url);
      method = "POST";
      body = new URLSearchParams(fields.map((field) => [field.name, field.value])).toString();
      continue;
    }
    throw new Error(`unexpected page at ${url}: ${html.replace(/\s+/g, " ").slice(0, 400)}`);
  }
  throw new Error(`the login chain did not finish within ${maxSteps} steps`);
}

/**
 * Runs one full OIDC authorization-code login against the office realm, forced through the
 * SAML identity provider with `kc_idp_hint`, and returns the authorization code Keycloak
 * issued. `redirectUri` is where the provider sends the browser back (the client callback).
 */
export async function keycloakAuthorizationCode({
  keycloak,
  realm,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  idpHint,
  profile,
}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (idpHint) params.set("kc_idp_hint", idpHint);
  const start = `${keycloak}/realms/${realm}/protocol/openid-connect/auth?${params}`;
  const { location } = await browseLogin(start, {
    profile,
    follow: [new URL(keycloak).origin],
  });
  const code = location.searchParams.get("code");
  const error = location.searchParams.get("error");
  if (!code) throw new Error(`Keycloak returned no code (${error ?? location.search}): ${location}`);
  return { code, state: location.searchParams.get("state") ?? state };
}
