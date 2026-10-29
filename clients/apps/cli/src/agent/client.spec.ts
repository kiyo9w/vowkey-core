import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { AgentBroker, agentStatePath } from "@vowkey/common/vault/agent/node/broker";

import { agentAuthority } from "../../test/agent-authority";
import { approvePair, listPending, pairAndWait, submitRequest } from "./client";

describe("agent client", () => {
  let directory: string;
  let broker: AgentBroker;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "vowkey-agent-client-"));
    broker = new AgentBroker(directory, agentAuthority());
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("refuses a request that does not already name a reference", async () => {
    const reply = await submitRequest(directory, path.join(directory, "missing.credential"), {
      goal: "Complete the open application",
      reason: "The form asks for a name",
      assignments: [{ fieldId: "entry-1" }],
    });
    const text = JSON.stringify(reply);
    expect(reply).toEqual({ type: "error", code: "invalid_reference" });
    expect(text).not.toContain("/default");
    expect(text).not.toContain("pending_approval");
    expect(text).not.toContain("Complete the open application");
  });

  it("writes a pairing credential only to the requesting client's file", async () => {
    const file = path.join(directory, "editor.credential");
    const pairing = pairAndWait(directory, file, "Editor");
    const pending = await waitForPair(directory);
    const approved = await approvePair(directory, pending.connectionId);
    const stored = await pairing;

    expect(stored).toEqual({ pairingId: approved.pairingId });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const onDisk = fs.readFileSync(file, "utf8");
    const state = fs.readFileSync(agentStatePath(directory, ["local"]), "utf8");
    expect(state).not.toContain(JSON.parse(onDisk).credential as string);

    const reply = await submitRequest(directory, file, {
      goal: "Complete the open application",
      reason: "The form asks for a name",
      assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }],
    });
    const text = JSON.stringify(reply);
    expect(reply).toMatchObject({ type: "error", code: "target_required" });
    expect(text).not.toContain("/default");
    expect(text).not.toContain(JSON.parse(onDisk).credential as string);
    expect(text).not.toContain("Complete the open application");
  });
});

async function waitForPair(directory: string) {
  const started = Date.now();
  while (Date.now() - started < 2000) {
    const pairs = await listPending(directory);
    if (pairs.length === 1) {
      return pairs[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("the pair was not offered");
}
