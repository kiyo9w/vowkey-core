import { AgentTarget, AgentTargetAdapter, AgentWrite, AgentWriteResult } from "@vowkey/common/vault/agent/targets";

import { CollectedAgentFrame } from "../autofill/content/agent-form";
import { BrowserApi } from "../platform/browser/browser-api";

interface Binding {
  tabId: number;
  frameId: number;
  href: string;
  topOrigin: string;
  frameOrigin: string;
  documentId?: string;
  target: AgentTarget;
}

/** Browser-owned bindings never use a caller-supplied URL, selector, or foreground window. */
export class BrowserAgentTargets implements AgentTargetAdapter {
  private readonly bindings = new Map<string, Binding>();

  async collect(targetId?: string): Promise<AgentTarget[]> {
    const previous = targetId == null ? null : this.bindings.get(targetId);
    if (targetId != null && previous == null) {
      return [];
    }
    const tabs = await BrowserApi.tabsQuery({});
    const result: AgentTarget[] = [];
    const alive = new Set<string>();
    for (const tab of tabs) {
      if (tab.id == null || (previous != null && tab.id !== previous.tabId)) {
        continue;
      }
      const topOrigin = webOrigin(tab.url);
      if (topOrigin == null) {
        continue;
      }
      const frames = await BrowserApi.getAllFrameDetails(tab.id);
      for (const frame of frames ?? []) {
        if (previous != null && frame.frameId !== previous.frameId) {
          continue;
        }
        const frameOrigin = webOrigin(frame.url);
        if (frameOrigin == null) {
          continue;
        }
        const collected = await BrowserApi.tabSendMessage<unknown, CollectedAgentFrame>(
          tab, { command: "collectAgentForm" }, { frameId: frame.frameId },
        );
        if (!validFrame(collected) || collected.origin !== frameOrigin ||
          collected.href !== frame.url || collected.fields.length === 0) {
          continue;
        }
        const existing = [...this.bindings].find(([, binding]) =>
          binding.tabId === tab.id && binding.frameId === frame.frameId &&
          binding.href === frame.url && binding.topOrigin === topOrigin &&
          binding.frameOrigin === frameOrigin,
        );
        if (previous != null && existing?.[0] !== targetId) {
          continue;
        }
        const id = existing?.[0] ?? crypto.randomUUID();
        const target: AgentTarget = {
          targetId: id,
          kind: "web",
          destinationKey: topOrigin === frameOrigin
            ? `web:${topOrigin}` : `web:${topOrigin}|${frameOrigin}`,
          generation: collected.generation,
          display: topOrigin === frameOrigin ? topOrigin : `${topOrigin} → ${frameOrigin}`,
          formSignature: collected.formSignature,
          sections: collected.sections,
          fields: collected.fields,
        };
        this.bindings.set(id, {
          tabId: tab.id, frameId: frame.frameId, href: frame.url,
          topOrigin, frameOrigin, documentId: frame.documentId, target,
        });
        alive.add(id);
        result.push(target);
      }
    }
    for (const [id, binding] of this.bindings) {
      if ((previous == null || binding === previous) && !alive.has(id)) {
        this.bindings.delete(id);
      }
    }
    return result;
  }

  async write(target: AgentTarget, operations: AgentWrite[]): Promise<AgentWriteResult> {
    const denied = (): AgentWriteResult => ({
      entries: operations.map(({ entryId }) => ({ entryId, outcome: "not_written" })),
    });
    const binding = this.bindings.get(target.targetId);
    if (binding == null || binding.target.generation !== target.generation ||
      binding.target.destinationKey !== target.destinationKey) {
      return denied();
    }
    const tab = (await BrowserApi.tabsQuery({})).find((tab) => tab.id === binding.tabId);
    if (tab == null || webOrigin(tab.url) !== binding.topOrigin) {
      return denied();
    }
    const frame = (await BrowserApi.getAllFrameDetails(binding.tabId))?.find((frame) =>
      frame.frameId === binding.frameId,
    );
    if (frame == null || frame.url !== binding.href || webOrigin(frame.url) !== binding.frameOrigin ||
      (binding.documentId != null && frame.documentId !== binding.documentId)) {
      return denied();
    }
    const options: chrome.tabs.MessageSendOptions = { frameId: binding.frameId };
    if (binding.documentId != null) {
      options.documentId = binding.documentId;
    }
    // From this point delivery may have happened even if the frame disappears before its reply.
    const reply = await BrowserApi.tabSendMessage<unknown, AgentWriteResult>(tab, {
      command: "writeAgentForm",
      agentWrite: { generation: target.generation, origin: binding.frameOrigin, operations },
    }, options);
    return {
      entries: operations.map(({ entryId }) => {
        const rows = reply?.entries?.filter((entry) => entry.entryId === entryId);
        const outcome = rows?.length === 1 &&
          ["confirmed", "not_written", "not_confirmed"].includes(rows[0].outcome)
          ? rows[0].outcome : "not_confirmed";
        return { entryId, outcome };
      }),
    };
  }
}

function webOrigin(url: string | undefined): string | null {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function validFrame(frame: CollectedAgentFrame | undefined): frame is CollectedAgentFrame {
  if (frame == null || typeof frame.generation !== "string" || typeof frame.href !== "string" ||
    typeof frame.origin !== "string" || typeof frame.formSignature !== "string" ||
    !Array.isArray(frame.sections) || !Array.isArray(frame.fields) || frame.fields.length > 1000) {
    return false;
  }
  const sections = new Set<string>();
  const fields = new Set<string>();
  return frame.sections.every((section) => section != null && typeof section.id === "string" &&
    !sections.has(section.id) && !!sections.add(section.id) && typeof section.label === "string") &&
    frame.fields.every((field) => field != null && typeof field.id === "string" &&
      !fields.has(field.id) && !!fields.add(field.id) && sections.has(field.sectionId) &&
      typeof field.label === "string" && typeof field.type === "string" &&
      Array.isArray(field.options) && field.options.every((option) => typeof option === "string"));
}
