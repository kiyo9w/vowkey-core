const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 2048) => typeof value === "string" && value.length <= max && !value.includes("\0");
const id = (value) => text(value, 256) && value.length > 0;
const keys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const list = (value, max, validate) => Array.isArray(value) && value.length <= max && value.every(validate);
const texts = (value, max = 100, width = 2048) => list(value, max, (item) => text(item, width));
const optional = (value, validate) => value === undefined || validate(value);
const unique = (rows) => new Set(rows.map((row) => row.id)).size === rows.length;
const nullableText = (value) => value === null || text(value);

export const LIMITS = Object.freeze({ pieces: 1000, fields: 300, sections: 100, questions: 100, criteria: 1000 });

export function validGraph(graph) {
  if (!keys(graph, ["v", "targetId", "formSignature", "sections", "fields"]) || graph.v !== 1 ||
      !id(graph.targetId) || !id(graph.formSignature) ||
      !list(graph.sections, LIMITS.sections, (section) => keys(section, ["id", "label"]) && id(section.id) && text(section.label)) ||
      !unique(graph.sections) || graph.sections.length === 0 ||
      !list(graph.fields, LIMITS.fields, (field) => keys(field, ["id", "sectionId", "label", "type", "options", "format"]) &&
        id(field.id) && id(field.sectionId) && text(field.label) && text(field.type, 100) &&
        texts(field.options, 200) && optional(field.format, text)) || !unique(graph.fields) || graph.fields.length === 0) return false;
  const sections = new Set(graph.sections.map((section) => section.id));
  return graph.fields.every((field) => sections.has(field.sectionId));
}

export function validFormAsks(asks, graph) {
  if (!keys(asks, ["v", "targetId", "formSignature", "sections", "fields"]) || asks.v !== 1 ||
      asks.targetId !== graph.targetId || asks.formSignature !== graph.formSignature ||
      !list(asks.sections, LIMITS.sections, (section) => keys(section, ["id", "label", "profileHint"]) &&
        id(section.id) && text(section.label) && nullableText(section.profileHint)) || !unique(asks.sections) ||
      asks.sections.length !== graph.sections.length ||
      !list(asks.fields, LIMITS.fields, (field) => keys(field, ["id", "sectionId", "what", "whose", "format"]) &&
        id(field.id) && id(field.sectionId) && text(field.what) && text(field.whose) &&
        keys(field.format, ["label", "options"]) && text(field.format.label) && texts(field.format.options, 200)) ||
      !unique(asks.fields) || asks.fields.length !== graph.fields.length) return false;
  const sections = new Set(graph.sections.map((section) => section.id));
  const fields = new Map(graph.fields.map((field) => [field.id, field]));
  return asks.sections.every((section) => sections.has(section.id)) && asks.fields.every((field) => {
    const observed = fields.get(field.id);
    return observed?.sectionId === field.sectionId && field.format.options.length === observed.options.length &&
      field.format.options.every((option, i) => option === observed.options[i]);
  });
}

function validAsks(value) {
  if (!object(value) || !Array.isArray(value.sections) || !Array.isArray(value.fields)) return false;
  const graph = {
    v: value.v, targetId: value.targetId, formSignature: value.formSignature,
    sections: value.sections.map((section) => ({ id: section?.id, label: section?.label })),
    fields: value.fields.map((field) => ({ id: field?.id, sectionId: field?.sectionId, label: field?.what,
      type: "text", options: field?.format?.options })),
  };
  return validGraph(graph) && validFormAsks(value, graph);
}

function validState(state) {
  if (!object(state) || !optional(state.about, (value) => text(value, 4096))) return false;
  if (Object.hasOwn(state, "pieces")) {
    return keys(state, ["about", "pieces", "document_kind"]) && optional(state.document_kind, text) &&
      list(state.pieces, LIMITS.pieces, (piece) => keys(piece, ["id", "text", "near", "group"]) && id(piece.id) &&
        text(piece.text, 8192) && optional(piece.near, (value) => texts(value, 32)) && optional(piece.group, text)) && unique(state.pieces);
  }
  if (Object.hasOwn(state, "parts")) {
    return keys(state, ["about", "parts"]) && list(state.parts, LIMITS.pieces, (part) => keys(part, ["id", "text", "of", "near"]) &&
      id(part.id) && text(part.text, 8192) && text(part.of, 8192) && optional(part.near, (value) => texts(value, 32))) && unique(state.parts);
  }
  if (Object.hasOwn(state, "fields")) {
    return keys(state, ["about", "fields"]) && list(state.fields, LIMITS.fields, (field) => keys(field, ["id", "asks", "near", "control", "group"]) &&
      id(field.id) && text(field.asks) && texts(field.near, 32) && text(field.control, 100) && optional(field.group, text)) && unique(state.fields);
  }
  return keys(state, ["about", "asks", "details", "profiles"]) && validAsks(state.asks) &&
    list(state.details, LIMITS.criteria, (detail) => keys(detail, ["id", "label", "profileId", "attribute", "script", "format", "variantId"]) &&
      id(detail.id) && text(detail.label) && id(detail.profileId) &&
      [detail.attribute, detail.script, detail.format, detail.variantId].every((value) => optional(value, nullableText))) &&
    optional(state.profiles, (profiles) => list(profiles, LIMITS.sections, (profile) => keys(profile, ["id", "label"]) && id(profile.id) && text(profile.label)) && unique(profiles));
}

export function validDecision(request) {
  return keys(request, ["model", "state", "questions"]) && optional(request.model, (value) => text(value, 256)) &&
    validState(request.state) && object(request.questions) && Object.keys(request.questions).length <= LIMITS.questions &&
    Object.entries(request.questions).every(([name, question]) => id(name) && keys(question, ["type", "instructions", "criteria"]) &&
      question.type === "choice" && text(question.instructions, 4096) && object(question.criteria) &&
      Object.keys(question.criteria).length > 0 && Object.keys(question.criteria).length <= LIMITS.criteria &&
      Object.entries(question.criteria).every(([key, value]) => id(key) && text(value, 4096)));
}

export function formResponseSchema(graph) {
  const string = { type: "string" };
  return {
    type: "object", additionalProperties: false, required: ["v", "targetId", "formSignature", "sections", "fields"],
    properties: {
      v: { type: "integer", enum: [1] }, targetId: { type: "string", enum: [graph.targetId] },
      formSignature: { type: "string", enum: [graph.formSignature] },
      sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "profileHint"], properties: {
        id: { type: "string", enum: graph.sections.map((section) => section.id) }, label: string, profileHint: { type: ["string", "null"] },
      } } },
      fields: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "sectionId", "what", "whose", "format"], properties: {
        id: { type: "string", enum: graph.fields.map((field) => field.id) },
        sectionId: { type: "string", enum: graph.sections.map((section) => section.id) }, what: string, whose: string,
        format: { type: "object", additionalProperties: false, required: ["label", "options"], properties: { label: string, options: { type: "array", items: string } } },
      } } },
    },
  };
}
