// Reading for every Vowkey install without an account: a guest grant, and Decision requests
// forwarded to Jev through the Experiential Labs gateway with Vowkey's key.
const UPSTREAM = "https://api.experientiallabs.ai/v1/systemone";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method === "GET" && url.pathname === "/alive") return json({ ok: true });
    if (request.method !== "POST") return json({ error: "Not found" }, 404);

    if (url.pathname.endsWith("/guest-decision/grant")) {
      return json({ token: `guest.${crypto.randomUUID()}`, expiresIn: 3600 });
    }

    if (url.pathname === "/v1/systemone") {
      const body = await request.json().catch(() => null);
      if (body == null || typeof body !== "object") return json({ error: "Bad request" }, 400);
      body.model = env.DECISION_MODEL || "jev-latest";
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.DECISION_KEY}` },
        body: JSON.stringify(body),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    return json({ error: "Not found" }, 404);
  },
};
