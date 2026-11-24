import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { mock } from "jest-mock-extended";
import { AgentAccountCoordinator, AgentAccountSnapshot } from "./account-records";
import { AgentTarget } from "./targets";
import { AgentExecutor, AgentReply, AgentTargetAdapter, ReferenceFacts, REQUEST_WINDOW_MS } from "./executor";

class Clock {
  wallMs = 1_700_000_000_000;
  monoMs = 0;
  wall = () => this.wallMs;
  mono = () => this.monoMs;
}

const key = randomBytes(32);
const protector = {
  seal: async (plain: string) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const bytes = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString("base64");
  },
  open: async (sealed: string) => {
    const bytes = Buffer.from(sealed, "base64");
    const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString("utf8");
  },
};

function target(display = "Application"): AgentTarget {
  return {
    targetId: "target-1", kind: "web", destinationKey: "web:https://forms.example",
    generation: "g1", display, formSignature: "form-1",
    sections: [{ id: "s1", label: "Applicant" }],
    fields: ["f1", "f17"].map((id) => ({
      id, sectionId: "s1", label: "Name", type: "text", options: [],
    })),
  };
}

function facts(rule?: "ask" | "fill" | "never", revision = "2026-04-02T00:00:00.000Z"): ReferenceFacts {
  return {
    cipherId: "cipher-1",
    fieldPath: "detail.detail-1",
    revisionDate: revision,
    accessible: true,
    agentRule: rule,
    draft: false,
  };
}

function executor(clock: Clock, rule?: "ask" | "fill" | "never") {
  return new AgentExecutor({
    localExecutorId: "executor-1",
    vaultScopeIds: ["local:scope"],
    protector,
    clock,
    resolve: () => facts(rule),
    newId: sequentialIds(),
  });
}

function sequentialIds() {
  let n = 0;
  return () => `id-${++n}`;
}

async function paired(agent: AgentExecutor, connectionId: string) {
  await agent.receive(connectionId, {
    type: "pair",
    displayName: "Editor",
    vaultScopeId: "local:scope",
  });
  const approved = await agent.approve(connectionId);
  if (approved == null) {
    throw new Error("pair was not approved");
  }
  return approved;
}

function auth(approved: AgentReply, body: Record<string, unknown>) {
  return {
    pairingId: approved.pairingId,
    credential: approved.credential,
    vaultScopeId: "local:scope",
    ...body,
  };
}

describe("agent executor", () => {
  it("attempts later durable outcomes even when an older outcome cannot be published", async () => {
    const clock = new Clock();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.receive.mockResolvedValue({
      receivedAt: new Date(clock.wallMs).toISOString(),
      deadline: new Date(clock.wallMs + REQUEST_WINDOW_MS).toISOString(), revision: 0,
    });
    const agent = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts(), newId: sequentialIds(), coordination,
    });
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    for (let i = 0; i < 2; i++) {
      await agent.receive("a", auth(approved, {
        type: "fill_request", body: { goal: "Fill the form", reason: "A name is required",
          assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
      }));
    }
    clock.wallMs += REQUEST_WINDOW_MS + 1;
    clock.monoMs += REQUEST_WINDOW_MS + 1;
    agent.expire();
    coordination.result.mockRejectedValueOnce(new Error("old request unavailable"));
    await expect(agent.publishAccount()).rejects.toThrow("old request unavailable");
    expect(coordination.result).toHaveBeenCalledTimes(2);
    expect(coordination.activity).toHaveBeenCalled();
  });

  it("persists a standing grant from an answer made on another client before dispatch", async () => {
    const clock = new Clock();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.receive.mockResolvedValue({
      receivedAt: new Date(clock.wallMs).toISOString(),
      deadline: new Date(clock.wallMs + REQUEST_WINDOW_MS).toISOString(), revision: 0,
    });
    const agent = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts(), newId: sequentialIds(), coordination,
    });
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const receipt = await agent.receive("a", auth(approved, {
      type: "fill_request", body: { goal: "Fill the form", reason: "A name is required",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    }));
    const request = agent.snapshot().requests[0];
    coordination.sync.mockResolvedValue({
      revision: 1, fullSnapshot: true, pairings: [], grants: [], activity: [],
      formBindings: [], tombstones: [], requests: [{
        requestId: request.requestId, deadline: new Date(clock.wallMs + REQUEST_WINDOW_MS).toISOString(),
        answer: { v: 1, requestId: request.requestId, answer: "always_allow",
          selectedEntryIds: [request.entries[0].entryId], sectionProfiles: {},
          answeredAt: new Date(clock.wallMs).toISOString() }, result: null,
      } as Awaited<ReturnType<AgentAccountCoordinator["sync"]>>["requests"][number]],
    });
    await agent.refreshAccount();
    expect(coordination.grant).toHaveBeenCalledWith(expect.objectContaining({
      pairingId: approved.pairingId, fieldPath: "detail.detail-1", revokedAt: null,
    }), receipt.requestId);
    expect(agent.readyRequests()).toEqual([receipt.requestId]);
  });

  it("uses the server's winning denial when another client answered first", async () => {
    const clock = new Clock();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.receive.mockResolvedValue({
      receivedAt: new Date(clock.wallMs).toISOString(),
      deadline: new Date(clock.wallMs + REQUEST_WINDOW_MS).toISOString(), revision: 0,
    });
    const agent = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts(), newId: sequentialIds(), coordination,
    });
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const receipt = await agent.receive("a", auth(approved, {
      type: "fill_request", body: { targetId: "target-1", goal: "Fill the form",
        reason: "The form asks for a name",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    }));
    const requestId = String(receipt.requestId);
    const entryId = agent.snapshot().requests[0].entries[0].entryId;
    coordination.answer.mockResolvedValue({ revision: 1, answer: {
      v: 1, requestId, answer: "deny", selectedEntryIds: [], sectionProfiles: {},
      answeredAt: new Date(clock.wallMs).toISOString(),
    } });
    const result = await agent.answerFromPerson(requestId, "allow_once", [entryId]);
    expect(result.status).toBe("not_allowed");
    expect(agent.takeDispatch(requestId)).toBeNull();
    expect(agent.snapshot().requests[0].note).toBeNull();
    expect(coordination.answer).toHaveBeenCalledWith(requestId, "allow_once", [entryId]);
  });

  it("keeps the request pending when its authoritative answer cannot be reached", async () => {
    const clock = new Clock();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.receive.mockResolvedValue({
      receivedAt: new Date(clock.wallMs).toISOString(),
      deadline: new Date(clock.wallMs + REQUEST_WINDOW_MS).toISOString(), revision: 0,
    });
    const agent = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts(), newId: sequentialIds(), coordination,
    });
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const receipt = await agent.receive("a", auth(approved, {
      type: "fill_request", body: { goal: "Fill the form", reason: "A name is required",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    }));
    const requestId = String(receipt.requestId);
    coordination.answer.mockRejectedValue(new Error("offline"));
    await expect(agent.answerFromPerson(requestId, "allow_once",
      [agent.snapshot().requests[0].entries[0].entryId])).rejects.toThrow("offline");
    expect(agent.snapshot().requests[0].answer).toBeNull();
    expect(agent.takeDispatch(requestId)).toBeNull();
  });

  it("fills once from a local fill rule when the account cannot be reached", async () => {
    const clock = new Clock();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.sync.mockRejectedValue(new Error("offline"));
    coordination.receive.mockRejectedValue(new Error("offline"));
    coordination.result.mockRejectedValue(new Error("offline"));
    coordination.activity.mockRejectedValue(new Error("offline"));
    const agent = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts("fill"), newId: sequentialIds(), coordination,
    });
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const receipt = await agent.receive("a", auth(approved, {
      type: "fill_request", body: { goal: "Fill the form", reason: "A name is required",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    }));
    expect(receipt.status).toBe("dispatching");
    const writes: string[][] = [];
    const adapter: AgentTargetAdapter = {
      collect: async () => [target()],
      write: async (_target, operations) => {
        writes.push(operations.map((operation) => operation.value));
        return { entries: operations.map((operation) => ({ entryId: operation.entryId, outcome: "confirmed" as const })) };
      },
    };
    const filled = await agent.dispatch(String(receipt.requestId), adapter, async () => "Ada", async () => undefined);
    expect(filled.status).toBe("confirmed");
    expect(writes).toEqual([["Ada"]]);
    coordination.result.mockResolvedValue(undefined);
    coordination.activity.mockResolvedValue(undefined);
    coordination.receive.mockResolvedValue({
      receivedAt: new Date(clock.wallMs).toISOString(),
      deadline: new Date(clock.wallMs + REQUEST_WINDOW_MS).toISOString(), revision: 0,
    });
    await agent.refreshAccount();
    await agent.publishAccount();
    const published = JSON.stringify([
      coordination.result.mock.calls, coordination.activity.mock.calls,
    ]);
    expect(published).toContain("confirmed");
    expect(published).not.toContain("Ada");
    expect(published).not.toContain(String(approved.credential));
    coordination.sync.mockResolvedValue({
      revision: 1, fullSnapshot: true, pairings: [], grants: [], activity: [],
      formBindings: [], tombstones: [],
      requests: [{
        requestId: String(receipt.requestId), deadline: new Date(clock.wallMs).toISOString(),
        answer: { v: 1, requestId: String(receipt.requestId), answer: "deny", selectedEntryIds: [],
          sectionProfiles: {}, answeredAt: new Date(clock.wallMs).toISOString() },
        result: { v: 1, requestId: String(receipt.requestId), status: "not_allowed", entries: [],
          finishedAt: new Date(clock.wallMs).toISOString() },
      } as AgentAccountSnapshot["requests"][number]],
    });
    await agent.refreshAccount();
    expect(agent.snapshot().requests[0].status).toBe("confirmed");
    const replay = await agent.dispatch(String(receipt.requestId), adapter, async () => "Ada", async () => undefined);
    expect(replay.code).toBe("already_resolved");
    expect(writes).toEqual([["Ada"]]);
  });

  it("does not approve an ask or a never rule while the account is offline", async () => {
    const clock = new Clock();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.receive.mockRejectedValue(new Error("offline"));
    const ask = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts("ask"), newId: sequentialIds(), coordination,
    });
    const approved = await paired(ask, "a");
    ask.observeTarget(target());
    const waiting = await ask.receive("a", auth(approved, {
      type: "fill_request", body: { goal: "Fill the form", reason: "A name is required",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    }));
    expect(waiting.status).toBe("pending");
    expect(ask.readyRequests()).toEqual([]);
    expect(ask.takeDispatch(String(waiting.requestId))).toBeNull();

    const denied = new AgentExecutor({
      localExecutorId: "executor-1", vaultScopeIds: ["local:scope"], protector, clock,
      resolve: () => facts("never"), newId: sequentialIds(), coordination,
    });
    const second = await paired(denied, "b");
    denied.observeTarget(target());
    const receipt = await denied.receive("b", auth(second, {
      type: "fill_request", body: { goal: "Fill the form", reason: "A name is required",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    }));
    expect(receipt.status).toBe("not_allowed");
    expect(denied.pendingForPerson()).toEqual([]);
    expect(denied.readyRequests()).toEqual([]);
  });

  it("gives two clients different credentials, and one cannot read the other's request", async () => {
    const clock = new Clock();
    const agent = executor(clock);
    const hello = await agent.receive("a", { type: "hello", protocol: "vowkey.agent.v1" });
    expect(hello.localExecutorId).toBe("executor-1");
    expect(hello.vaultScopeIds).toEqual(["local:scope"]);

    const first = await paired(agent, "a");
    const second = await paired(agent, "b");
    expect(first.credential).not.toBe(second.credential);
    expect(first.pairingId).not.toBe(second.pairingId);

    agent.observeTarget(target("https://forms.example/private/path?token=secret"));
    const pending = await agent.receive(
      "a",
      auth(first, {
        type: "fill_request",
        body: {
          targetId: "target-1",
          goal: "Complete the open application",
          reason: "The form asks for the selected person's details",
          assignments: [
            { fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" },
          ],
        },
      }),
    );
    expect(pending.status).toBe("pending");
    expect(pending.targetDisplay).toBe("https://forms.example");
    expect(JSON.stringify(pending)).not.toContain("secret");
    expect(JSON.stringify(pending)).not.toContain("Complete the open application");

    const stolen = await agent.receive(
      "b",
      auth(second, { type: "access_result", requestId: pending.requestId }),
    );
    expect(stolen.code).toBe("invalid_reference");
    expect(JSON.stringify(stolen)).not.toContain("Complete the open application");

    const forged = await agent.receive("b", {
      type: "access_result",
      pairingId: first.pairingId,
      credential: second.credential,
      vaultScopeId: "local:scope",
      requestId: pending.requestId,
    });
    expect(forged.code).toBe("credential_rejected");
    expect(JSON.stringify(forged)).not.toContain(String(pending.requestId));
  });

  it("cancels a pair when the socket drops before it is approved", async () => {
    const agent = executor(new Clock());
    await agent.receive("a", {
      type: "pair",
      displayName: "Editor",
      vaultScopeId: "local:scope",
    });
    agent.disconnect("a");
    expect(await agent.approve("a")).toBeNull();
  });

  it("does not invent a reference when no form is open", async () => {
    const agent = executor(new Clock());
    const approved = await paired(agent, "a");
    const reply = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    expect(reply.code).toBe("target_required");
    expect(JSON.stringify(reply)).not.toContain("@vk:");
    expect(JSON.stringify(reply)).not.toContain("/default");
  });

  it("refuses a gallery name that is not a reference", async () => {
    const agent = executor(new Clock());
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const reply = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f1", reference: "@vk:key.openai" }],
        },
      }),
    );
    expect(reply.code).toBe("invalid_reference");
  });

  it("lets the person answer once, and does not let the agent answer or report the fill", async () => {
    const clock = new Clock();
    const agent = executor(clock);
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const pending = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    const shown = agent.pendingForPerson();
    expect(shown).toHaveLength(1);
    expect(shown[0].goal).toBe("Complete the open application");
    expect(shown[0].reason).toBe("The form asks for a name");

    const fromAgent = await agent.receive(
      "a",
      auth(approved, {
        type: "answer",
        requestId: pending.requestId,
        answer: "allow_once",
        selectedEntryIds: [shown[0].entries[0].entryId],
      }),
    );
    expect(fromAgent.code).toBe("not_executor");

    const first = await agent.answerFromPerson(String(pending.requestId), "allow_once", [
      shown[0].entries[0].entryId,
    ]);
    expect(first.type).toBe("dispatch");
    expect(JSON.stringify(first)).not.toContain("Complete the open application");
    expect(agent.completeDispatch(String(pending.requestId), "confirmed")?.status).toBe("confirmed");
    expect(JSON.stringify(agent.snapshot().activity)).not.toContain("Complete the open application");
    expect(JSON.stringify(agent.snapshot().activity)).not.toContain("The form asks for a name");
    const second = await agent.answerFromPerson(String(pending.requestId), "deny", []);
    expect(second.code).toBe("already_resolved");
    expect(agent.pendingForPerson()).toEqual([]);

    clock.wallMs += REQUEST_WINDOW_MS + 1;
    const later = executor(clock);
    const laterApproved = await paired(later, "a");
    later.observeTarget(target());
    const waiting = await later.receive(
      "a",
      auth(laterApproved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    clock.wallMs += REQUEST_WINDOW_MS + 1;
    const expired = await later.answerFromPerson(String(waiting.requestId), "allow_once", ["id-x"]);
    expect(expired.code).toBe("deadline_passed");
    expect(later.pendingForPerson()).toEqual([]);
  });

  it("does not let Don't allow or a site row override Don't fill, and a value edit does not ask again", async () => {
    const clock = new Clock();
    let rule: "ask" | "fill" | "never" | undefined = "ask";
    let revision = "rev-1";
    const agent = new AgentExecutor({
      localExecutorId: "executor-1",
      vaultScopeIds: ["local:scope"],
      protector,
      clock,
      resolve: () => facts(rule, revision),
      newId: sequentialIds(),
    });
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const open = () =>
      agent.receive(
        "a",
        auth(approved, {
          type: "fill_request",
          body: {
            targetId: "target-1",
            goal: "Complete the open application",
            reason: "The form asks for a name",
            assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
          },
        }),
      );

    const first = await open();
    const denied = await agent.answerFromPerson(String(first.requestId), "deny", []);
    expect(denied.status).toBe("not_allowed");
    expect(agent.snapshot().grants).toEqual([]);

    const second = await open();
    const allowed = await agent.answerFromPerson(String(second.requestId), "always_allow", [
      agent.pendingForPerson()[0].entries[0].entryId,
    ]);
    expect(allowed.type).toBe("dispatch");
    expect(agent.snapshot().grants).toHaveLength(1);

    revision = "rev-2";
    const afterEdit = await open();
    expect(afterEdit.type).toBe("receipt");
    expect(afterEdit.status).toBe("dispatching");
    expect(agent.pendingForPerson()).toEqual([]);

    rule = "never";
    const blocked = await open();
    expect(blocked.status).toBe("not_allowed");
    expect(agent.snapshot().grants).toHaveLength(1);
  });

  it("writes a reload of the same destination and refuses a different one", async () => {
    const agent = executor(new Clock());
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const pending = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    const entryId = agent.pendingForPerson()[0].entries[0].entryId;
    await agent.answerFromPerson(String(pending.requestId), "allow_once", [entryId]);
    expect(agent.snapshot().grants).toEqual([]);
    expect(agent.writeDecision(String(pending.requestId), "web:https://forms.example", "g1")).toBe(
      "write",
    );
    expect(agent.writeDecision(String(pending.requestId), "web:https://other.example", "g1")).toBe(
      "refuse",
    );
    expect(agent.writeDecision(String(pending.requestId), "web:https://forms.example", "g2")).toBe(
      "recollect",
    );
    agent.recollect(String(pending.requestId), "g2");
    expect(agent.writeDecision(String(pending.requestId), "web:https://forms.example", "g2")).toBe(
      "write",
    );
  });

  it("dispatches a request once, and a restart after that does not dispatch it again", async () => {
    const clock = new Clock();
    const agent = executor(clock, "fill");
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const dispatch = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    expect(dispatch.type).toBe("receipt");
    expect(dispatch.status).toBe("dispatching");
    expect(JSON.stringify(dispatch)).not.toContain("Complete the open application");
    expect(agent.takeDispatch(String(dispatch.requestId))).toBeNull();

    const resumed = AgentExecutor.resume(agent.snapshot(), {
      vaultScopeIds: ["local:scope"],
      protector,
      clock,
      resolve: () => facts("fill"),
      newId: sequentialIds(),
    });
    expect(resumed.takeDispatch(String(dispatch.requestId))).toBeNull();
    const result = await resumed.receive(
      "a",
      auth(approved, { type: "access_result", requestId: dispatch.requestId }),
    );
    expect(result.status).toBe("not_confirmed");
    expect(resumed.completeDispatch(String(dispatch.requestId), "confirmed")).toBeNull();
    expect(JSON.stringify(resumed.snapshot().activity)).not.toContain("Complete the open application");
  });

  it("keeps a pending request across a restart, and a clock set backward does not extend it", async () => {
    const clock = new Clock();
    const agent = executor(clock);
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const pending = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    clock.monoMs += 100_000;
    const snap = agent.snapshot();
    expect(snap.requests[0].deadline.remainingMs).toBe(REQUEST_WINDOW_MS - 100_000);

    const restarted = new Clock();
    restarted.wallMs = clock.wallMs - 60 * 60 * 1000;
    const resumed = AgentExecutor.resume(snap, {
      vaultScopeIds: ["local:scope"],
      protector,
      clock: restarted,
      resolve: () => facts(),
      newId: sequentialIds(),
    });
    const entryId = snap.requests[0].entries[0].entryId;
    expect((await resumed.answerFromPerson(String(pending.requestId), "allow_once", [entryId])).code).toBe(
      "deadline_passed",
    );
  });

  it("seals an in-flight dispatch when the account changes and does not replay it", async () => {
    const agent = executor(new Clock(), "fill");
    const approved = await paired(agent, "a");
    agent.observeTarget(target());
    const dispatch = await agent.receive(
      "a",
      auth(approved, {
        type: "fill_request",
        body: {
          goal: "Complete the open application",
          reason: "The form asks for a name",
          assignments: [{ fieldId: "f17", reference: "@vk:cipher-1/detail.detail-1" }],
        },
      }),
    );
    agent.quiesce();
    expect(agent.completeDispatch(String(dispatch.requestId), "confirmed")).toBeNull();
    expect(agent.takeDispatch(String(dispatch.requestId))).toBeNull();
    const result = await agent.receive(
      "a",
      auth(approved, { type: "access_result", requestId: dispatch.requestId }),
    );
    expect(result.status).toBe("not_confirmed");
  });

  it("asks once for a whole form and writes an allowed field only once", async () => {
    const fields = Array.from({ length: 8 }, (_, index) => ({
      id: `f${index}`, sectionId: "s1", label: `Field ${index}`, type: "text", options: [],
    }));
    const form = { ...target(), fields };
    const agent = executor(new Clock());
    const approved = await paired(agent, "a");
    agent.observeTarget(form);
    const receipt = await agent.receive("a", auth(approved, {
      type: "fill_request",
      body: {
        goal: "Open the account",
        reason: "The form asks for the selected person",
        assignments: fields.map((field, index) => ({
          fieldId: field.id,
          reference: `@vk:cipher-1/detail.detail-${index}`,
        })),
      },
    }));
    expect(receipt.status).toBe("pending");
    expect(agent.pendingForPerson()).toHaveLength(1);
    const answered = await agent.answerFromPerson(
      String(receipt.requestId),
      "allow_once",
      agent.snapshot().requests[0].entries.map((entry) => entry.entryId),
    );
    expect(answered.type).toBe("dispatch");
    const writes: string[][] = [];
    await agent.dispatch(String(receipt.requestId), {
      collect: async () => [form],
      write: async (_target, operations) => {
        writes.push(operations.map((operation) => operation.value));
        return { entries: operations.map((operation) => ({ entryId: operation.entryId, outcome: "confirmed" as const })) };
      },
    }, async () => "Ada", async () => undefined);
    const replay = await agent.dispatch(String(receipt.requestId), {
      collect: async () => [form],
      write: async () => { throw new Error("replayed"); },
    }, async () => "Ada", async () => undefined);
    expect(replay.code).toBe("already_resolved");
    expect(writes).toEqual([Array(8).fill("Ada")]);
  });
});
