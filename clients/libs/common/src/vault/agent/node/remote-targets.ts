import { deferred } from "@vowkey/common/platform/misc/deferred";
import { AgentTarget, AgentTargetAdapter, AgentWrite, AgentWriteResult } from "../targets";

interface Provider {
  send(message: unknown): void;
  scopeId: string;
}

export class RemoteTargets implements AgentTargetAdapter {
  private readonly providers = new Map<string, Provider>();
  private readonly owners = new Map<string, string>();
  private readonly pending = new Map<string, {
    provider: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }>();

  attach(id: string, scopeId: string, send: (message: unknown) => void): void {
    this.providers.set(id, { scopeId, send });
  }

  detach(id: string): void {
    this.providers.delete(id);
    for (const [target, owner] of this.owners) {
      if (owner === id) {
        this.owners.delete(target);
      }
    }
    for (const [requestId, request] of this.pending) {
      if (request.provider === id) {
        request.reject(new Error("executor_unavailable"));
        this.pending.delete(requestId);
      }
    }
  }

  receive(id: string, body: Record<string, unknown>): boolean {
    if (body.type !== "provider_result" || typeof body.requestId !== "string") {
      return false;
    }
    const request = this.pending.get(body.requestId);
    if (request == null || request.provider !== id) {
      return false;
    }
    this.pending.delete(body.requestId);
    if (typeof body.error === "string") {
      request.reject(new Error("executor_unavailable"));
    } else {
      request.resolve(body.result);
    }
    return true;
  }

  async collect(targetId?: string): Promise<AgentTarget[]> {
    const owner = targetId == null ? undefined : this.owners.get(targetId);
    if (targetId != null && owner == null) {
      return [];
    }
    const targets: AgentTarget[] = [];
    for (const [provider] of this.providers) {
      if (owner != null && owner !== provider) {
        continue;
      }
      const result = await this.request(provider, "collect", { targetId });
      if (!Array.isArray(result)) {
        throw new Error("malformed");
      }
      for (const raw of result) {
        if (!validTarget(raw)) {
          throw new Error("malformed");
        }
        const previous = this.owners.get(raw.targetId);
        if (previous != null && previous !== provider) {
          throw new Error("target_changed");
        }
        this.owners.set(raw.targetId, provider);
        targets.push(raw);
      }
    }
    return targets;
  }

  async write(target: AgentTarget, operations: AgentWrite[]): Promise<AgentWriteResult> {
    const owner = this.owners.get(target.targetId);
    if (owner == null) {
      return { entries: operations.map(({ entryId }) => ({ entryId, outcome: "not_written" })) };
    }
    const result = await this.request(owner, "write", { target, operations });
    if (result == null || typeof result !== "object" ||
      !Array.isArray((result as AgentWriteResult).entries)) {
      throw new Error("malformed");
    }
    const entries = (result as AgentWriteResult).entries;
    if (entries.some((entry) => entry == null || typeof entry.entryId !== "string" ||
      !["confirmed", "not_written", "not_confirmed"].includes(entry.outcome))) {
      throw new Error("malformed");
    }
    return { entries };
  }

  private request(provider: string, action: string, body: object): Promise<unknown> {
    const connection = this.providers.get(provider);
    if (connection == null) {
      return Promise.reject(new Error("executor_unavailable"));
    }
    const requestId = crypto.randomUUID();
    const { promise, resolve, reject } = deferred<unknown>();
    const timer = setTimeout(() => {
      this.pending.delete(requestId);
      reject(new Error("executor_unavailable"));
    }, 15_000);
    this.pending.set(requestId, {
      provider,
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    try {
      connection.send({ type: "target_operation", requestId, action, ...body });
    } catch {
      clearTimeout(timer);
      this.pending.delete(requestId);
      reject(new Error("executor_unavailable"));
    }
    return promise;
  }
}

function validTarget(value: unknown): value is AgentTarget {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const target = value as Partial<AgentTarget>;
  return typeof target.targetId === "string" &&
    ["web", "file", "app"].includes(target.kind ?? "") &&
    typeof target.destinationKey === "string" && typeof target.generation === "string" &&
    typeof target.display === "string" && typeof target.formSignature === "string" &&
    Array.isArray(target.sections) && target.sections.every((section) =>
      section != null && typeof section.id === "string" && typeof section.label === "string",
    ) && Array.isArray(target.fields) && target.fields.every((field) =>
      field != null && typeof field.id === "string" && typeof field.label === "string" &&
      typeof field.sectionId === "string" && typeof field.type === "string" &&
      Array.isArray(field.options) && field.options.every((option) => typeof option === "string"),
    ) && new Set(target.fields.map((field) => field.id)).size === target.fields.length;
}
