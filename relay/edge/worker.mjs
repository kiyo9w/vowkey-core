import { validGraph, validVisionRead, validImageFill } from "../protocol.mjs";
import { describeForm, readDocumentVision, planImageFill, readBody, TooLarge, ReaderProviderError } from "../readers.mjs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Vowkey-Organization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

const text = (value) => typeof value === "string" ? value : JSON.stringify(value);

export function toOpenAiQuestion(name, question) {
  const instructions = text(question.instructions ?? "");
  if (question.type === "noul") {
    return {
      name, type: "predicate",
      instructions: instructions + (question.criteria == null ? "" : `\n\nCriteria: ${text(question.criteria)}`),
    };
  }
  if (question.type === "score") {
    const criteria = Array.isArray(question.criteria) ? question.criteria : Object.values(question.criteria ?? {});
    return { name, type: "score", instructions, levels: criteria.map((value, i) => ({ label: String(i), description: text(value) })) };
  }
  const criteria = Array.isArray(question.criteria)
    ? Object.fromEntries(question.criteria.map((value) => [text(value), text(value)]))
    : question.criteria ?? {};
  return {
    name, type: "choice", instructions,
    choices: Object.entries(criteria).map(([value, description]) => ({ value, description: text(description) })),
  };
}

export function toJevAnswers(answers) {
  return Object.fromEntries((answers ?? []).map((answer) => {
    if (answer.type === "predicate") return [answer.name, { type: "noul", probability: answer.probability }];
    const probabilities = Object.fromEntries((answer.probabilities ?? []).map((item) => [String(item.value), item.probability]));
    return [answer.name, answer.type === "score"
      ? { type: "score", score: answer.score, probabilities, confidence: answer.confidence }
      : { type: "choice", choice: answer.choice, probabilities, confidence: answer.confidence }];
  }));
}

async function decide(body, env) {
  if (body == null || typeof body !== "object" || body.questions == null || typeof body.questions !== "object" || Array.isArray(body.questions)) {
    return json({ error: "Bad request" }, 400);
  }
  const questions = Object.entries(body.questions);
  if (!questions.length || questions.some(([, question]) => !question || !["choice", "noul", "score"].includes(question.type))) {
    return json({ error: "Bad request" }, 400);
  }
  const model = env.DECISION_MODEL || "gpt-6-luna";
  const response = await fetch("https://api.openai.com/v1/decisions", {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_KEY}` },
    body: JSON.stringify({ model, input: text(body.state ?? ""), questions: questions.map(([name, question]) => toOpenAiQuestion(name, question)) }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return json({ error: "The reading service is unavailable. Try again." }, response.status === 429 ? 429 : 502);
  }
  const result = JSON.parse(await readBody(response.body, 2_000_000));
  return json({ model, answers: toJevAnswers(result.answers), usage: result.usage });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "GET" && (path === "/alive" || path === "/healthz")) return json({ ok: true });
    if (request.method !== "POST") return json({ error: "Not found" }, 404);
    if (path.endsWith("/guest-decision/grant")) return json({ token: `guest.${crypto.randomUUID()}`, expiresIn: 3600 });
    if (!["/v1/systemone", "/v1/forms/describe", "/v1/forms/fill-image", "/v1/documents/read-vision"].includes(path)) return json({ error: "Not found" }, 404);
    let body;
    try {
      body = JSON.parse(await readBody(request.body, 10_000_000));
    } catch (error) {
      return json({ error: error instanceof TooLarge ? "The image is too large. Choose a smaller copy." : "Bad request" }, error instanceof TooLarge ? 413 : 400);
    }
    if (!env.OPENAI_KEY) return json({ error: "The reading service is unavailable. Try again." }, 503);
    try {
      if (path === "/v1/systemone") return await decide(body, env);
      const config = {
        formReaderUrl: "https://api.openai.com/v1/chat/completions",
        formReaderKey: env.OPENAI_KEY,
        formReaderModel: env.READER_MODEL || "gpt-6.1-terra",
        timeoutMs: 120_000,
      };
      if (path === "/v1/forms/describe") {
        if (!validGraph(body)) return json({ error: "Invalid form" }, 400);
        return json(await describeForm(config, body));
      }
      if (path === "/v1/forms/fill-image") {
        if (!validImageFill(body)) {
          return json({ error: "Choose a form image and saved profile details." }, 400);
        }
        return json(await planImageFill(config, body));
      }
      if (!validVisionRead(body)) return json({ error: "Choose a JPEG, PNG or WebP image." }, 400);
      return json(await readDocumentVision(config, body));
    } catch (error) {
      if (error instanceof ReaderProviderError) {
        return json({ error: "The reading service is unavailable. Try again.", code: error.code }, 502);
      }
      return json({ error: "Couldn't read this document or form. Try again with a clearer image." }, 502);
    }
  },
};
