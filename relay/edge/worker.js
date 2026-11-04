// Reading for every Vowkey install without an account: a guest grant, and Decision requests in
// Jev's wire format answered by OpenAI's Decisions API (gpt-6-luna).
const UPSTREAM = "https://api.openai.com/v1/decisions";
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

const text = (v) => (typeof v === "string" ? v : JSON.stringify(v));

/** One Jev question (choice, noul or score) as an OpenAI Decisions question. */
export function toOpenAiQuestion(name, q) {
  const instructions = text(q.instructions ?? "");
  if (q.type === "noul") {
    const criteria = q.criteria == null ? "" : `\n\nCriteria: ${text(q.criteria)}`;
    return { name, type: "predicate", instructions: instructions + criteria };
  }
  if (q.type === "score") {
    const levels = Array.isArray(q.criteria) ? q.criteria : Object.values(q.criteria ?? {});
    return {
      name,
      type: "score",
      instructions,
      levels: levels.map((d, i) => ({ label: String(i), description: text(d) })),
    };
  }
  const criteria = Array.isArray(q.criteria)
    ? Object.fromEntries(q.criteria.map((c) => [text(c), text(c)]))
    : (q.criteria ?? {});
  return {
    name,
    type: "choice",
    instructions,
    choices: Object.entries(criteria).map(([value, about]) => ({ value, description: text(about) })),
  };
}

/** OpenAI Decisions answers, keyed back by question id in Jev's answer shape. */
export function toJevAnswers(answers) {
  const out = {};
  for (const a of answers ?? []) {
    if (a.type === "predicate") {
      out[a.name] = { type: "noul", probability: a.probability };
    } else if (a.type === "score") {
      out[a.name] = {
        type: "score",
        score: a.score,
        probabilities: Object.fromEntries((a.probabilities ?? []).map((p) => [String(p.value), p.probability])),
        confidence: a.confidence,
      };
    } else {
      out[a.name] = {
        type: "choice",
        choice: a.choice,
        probabilities: Object.fromEntries((a.probabilities ?? []).map((p) => [p.value, p.probability])),
        confidence: a.confidence,
      };
    }
  }
  return out;
}

export function toOpenAiRequest(body, model) {
  return {
    model,
    input: text(body.state ?? ""),
    questions: Object.entries(body.questions ?? {}).map(([name, q]) => toOpenAiQuestion(name, q)),
  };
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
      if (body == null || typeof body !== "object" || typeof body.questions !== "object") {
        return json({ error: "Bad request" }, 400);
      }
      const model = env.DECISION_MODEL || "gpt-6-luna";
      const upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_KEY}` },
        body: JSON.stringify(toOpenAiRequest(body, model)),
      });
      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return json({ error: result.error ?? result }, upstream.status);
      return json({ model, answers: toJevAnswers(result.answers), usage: result.usage });
    }
    return json({ error: "Not found" }, 404);
  },
};
