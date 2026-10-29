import { AgentField, AgentWrite, AgentWriteResult } from "@vowkey/common/vault/agent/targets";

import { FormFieldElement } from "../types";
import { CollectAutofillContentService } from "../services/collect-autofill-content.service";
import InsertAutofillContentService from "../services/insert-autofill-content.service";

export interface CollectedAgentFrame {
  generation: string;
  origin: string;
  href: string;
  formSignature: string;
  sections: { id: string; label: string }[];
  fields: AgentField[];
}

/** Keeps actual element references; a replaced element cannot inherit a previous write. */
export class AgentForm {
  private generation = crypto.randomUUID();
  private href = location.href;
  private elements = new Map<string, FormFieldElement>();

  constructor(
    private readonly collectService: CollectAutofillContentService,
    private readonly insertService: InsertAutofillContentService,
  ) {}

  async collect(): Promise<CollectedAgentFrame> {
    this.collectService.prepareForExplicitCollection();
    const collectedHref = location.href;
    const page = await this.collectService.getPageDetails();
    const fields: AgentField[] = [];
    const elements = new Map<string, FormFieldElement>();
    const sections = new Map<string, string>();
    const occurrences = new Map<string, number>();
    const sectionInstances = new Map<Element | null, number>();
    for (const field of page.fields) {
      if (!field.viewable || field.disabled || field.readonly ||
        ["hidden", "submit", "button", "reset"].includes(field.type ?? "")) {
        continue;
      }
      const element = this.collectService.getAutofillFieldElementByOpid(field.opid);
      if (element == null || !element.isConnected) {
        continue;
      }
      const section = element.closest("fieldset,form");
      const sectionLabel = section?.querySelector("legend")?.textContent?.trim() ||
        section?.getAttribute("aria-label") || "";
      if (!sectionInstances.has(section)) {
        sectionInstances.set(section, sectionInstances.size);
      }
      const sectionId = await digest(JSON.stringify([
        field.section ?? "", sectionLabel, sectionInstances.get(section),
      ]));
      sections.set(sectionId, sectionLabel);
      const label = field["label-tag"] || field["label-aria"] || field["label-left"] ||
        field["label-top"] || field.placeholder || field.htmlName || "";
      const type = field.type ?? field.tagName ?? "text";
      const options = element instanceof HTMLSelectElement
        ? Array.from(element.options, (option) => option.text) : [];
      const signature = await digest(JSON.stringify([
        sectionLabel, type, label.normalize("NFKC").replace(/\s+/g, " ").trim(),
        field.htmlName ?? "", field.autoCompleteType ?? "", options,
      ]));
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);
      const id = `${signature}.${occurrence}`;
      fields.push({ id, sectionId, label, type, options });
      elements.set(id, element);
    }
    if (collectedHref !== location.href ||
      [...elements.values()].some((element) => !element.isConnected)) {
      this.generation = crypto.randomUUID();
      this.elements.clear();
      throw new Error("target_changed");
    }
    if (this.href !== location.href || this.elements.size !== elements.size ||
      [...elements].some(([id, element]) => this.elements.get(id) !== element)) {
      this.generation = crypto.randomUUID();
    }
    this.href = location.href;
    this.elements = elements;
    return {
      generation: this.generation,
      origin: location.origin,
      href: this.href,
      formSignature: await digest(JSON.stringify(fields)),
      sections: [...sections].map(([id, label]) => ({ id, label })),
      fields,
    };
  }

  async write(message: {
    generation: string;
    origin: string;
    operations: AgentWrite[];
  }): Promise<AgentWriteResult> {
    if (message == null || !Array.isArray(message.operations) || message.operations.length > 1000 ||
      message.operations.some((operation) => operation == null ||
        typeof operation.entryId !== "string" || typeof operation.fieldId !== "string" ||
        typeof operation.value !== "string")) {
      throw new Error("malformed");
    }
    const entries: AgentWriteResult["entries"] = [];
    for (const operation of message.operations) {
      const valid = message.generation === this.generation &&
        message.origin === location.origin && this.href === location.href;
      const element = this.elements.get(operation.fieldId);
      const outcome = valid && element != null && element.isConnected
        ? await this.insertService.fillObservedField(element, operation.value) : "not_written";
      entries.push({ entryId: operation.entryId, outcome });
    }
    return { entries };
  }
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
