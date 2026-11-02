export interface AgentField {
  id: string;
  sectionId: string;
  label: string;
  type: string;
  options: string[];
  format?: string;
}

export interface AgentTarget {
  targetId: string;
  kind: "web" | "file" | "app";
  destinationKey: string;
  generation: string;
  display: string;
  formSignature: string;
  sections: { id: string; label: string }[];
  fields: AgentField[];
}

export interface AgentWrite {
  entryId: string;
  fieldId: string;
  value: string;
}

export type WriteOutcome = "confirmed" | "not_written" | "not_confirmed";

export interface AgentWriteResult {
  entries: { entryId: string; outcome: WriteOutcome }[];
}

/** Only the client that acquired the target implements this boundary. */
export interface AgentTargetAdapter {
  collect(targetId?: string): Promise<AgentTarget[]>;
  write(target: AgentTarget, operations: AgentWrite[]): Promise<AgentWriteResult>;
}

export interface FormAsksV1 {
  v: 1;
  targetId: string;
  formSignature: string;
  sections: { id: string; label: string; profileHint: string | null }[];
  fields: {
    id: string;
    sectionId: string;
    what: string;
    whose: string;
    attribute?: string;
    owner?: string;
    format: { label: string; options: string[] };
  }[];
}

/** A reader may describe the collected graph; it cannot add a target or a field. */
export function validateFormAsks(value: unknown, target: AgentTarget): value is FormAsksV1 {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const asks = value as Partial<FormAsksV1>;
  if (
    asks.v !== 1 || asks.targetId !== target.targetId ||
    asks.formSignature !== target.formSignature ||
    !Array.isArray(asks.sections) || !Array.isArray(asks.fields)
  ) {
    return false;
  }
  const sections = new Set(target.sections.map((section) => section.id));
  const fields = new Map(target.fields.map((field) => [field.id, field]));
  const seen = new Set<string>();
  return asks.sections.every((section) =>
    section != null && sections.has(section.id) && typeof section.label === "string" &&
    (section.profileHint === null || typeof section.profileHint === "string"),
  ) && asks.fields.every((field) => {
    if (field == null || seen.has(field.id)) {
      return false;
    }
    seen.add(field.id);
    const observed = fields.get(field.id);
    return observed != null && field.sectionId === observed.sectionId &&
      typeof field.what === "string" && typeof field.whose === "string" &&
      (field.attribute === undefined || typeof field.attribute === "string") &&
      (field.owner === undefined || typeof field.owner === "string") &&
      field.format != null && typeof field.format.label === "string" &&
      Array.isArray(field.format.options) &&
      field.format.options.every((option) => typeof option === "string");
  });
}
