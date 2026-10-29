import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { mock } from "jest-mock-extended";

import { AgentAccountCoordinator } from "@vowkey/common/vault/agent/account-records";
import { AgentBroker, AgentConnection, agentStatePath, brokerIsLive } from "@vowkey/common/vault/agent/node/broker";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { AgentTarget } from "@vowkey/common/vault/agent/targets";

import { agentAuthority } from "../../test/agent-authority";

describe("agent broker", () => {
  let directory: string;
  let broker: AgentBroker;
  let authority: AgentVaultAuthority;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "vowkey-agent-"));
    authority = agentAuthority();
    broker = new AgentBroker(directory, authority);
    await broker.start();
  });

  afterEach(async () => {
    await broker.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("delivers a pairing credential only on the requesting socket", async () => {
    const client = await AgentConnection.connect(broker.socketPath);
    client.send({ type: "hello", protocol: "vowkey.agent.v1" });
    const hello = (await client.next()) as { vaultScopeIds: string[] };
    expect(hello.vaultScopeIds).toEqual(["local"]);

    client.send({ type: "pair", displayName: "Editor", vaultScopeId: "local" });
    const pending = (await client.next()) as { type: string; connectionId: string };
    expect(pending.type).toBe("pair_pending");

    const token = fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8");
    const control = await AgentConnection.connect(broker.socketPath);
    control.send({ type: "control", token: "wrong-token-value", action: "approve", connectionId: pending.connectionId });
    const rejected = (await control.next()) as { code?: string; credential?: string };
    expect(rejected.code).toBe("credential_rejected");
    expect(rejected.credential).toBeUndefined();

    control.send({
      type: "control",
      token,
      action: "approve",
      connectionId: pending.connectionId,
    });
    const approved = (await control.next()) as { type: string; credential?: string; pairingId: string };
    const paired = (await client.next()) as { type: string; credential?: string; pairingId: string };
    expect(approved.type).toBe("approved");
    expect(approved.credential).toBeUndefined();
    expect(paired.type).toBe("paired");
    expect(paired.credential).toEqual(expect.any(String));
    expect(approved.pairingId).toBe(paired.pairingId);

    const state = fs.readFileSync(agentStatePath(directory, authority.scopeIds), "utf8");
    expect(state).not.toContain(paired.credential);
    client.close();
    control.close();
  });

  it("keeps a live broker and refuses to replace an unrelated file", async () => {
    const second = new AgentBroker(directory, authority);
    await expect(second.start()).rejects.toThrow(/already running/);
    expect(await brokerIsLive(broker.socketPath)).toBe(true);

    const socketPath = broker.socketPath;
    await broker.stop();
    expect(await brokerIsLive(socketPath)).toBe(false);
    fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    fs.writeFileSync(socketPath, "");
    await expect(second.start()).rejects.toThrow(/belongs to another file/);
    expect(fs.readFileSync(socketPath, "utf8")).toBe("");
    fs.unlinkSync(socketPath);
    await second.start();
    expect(await brokerIsLive(socketPath)).toBe(true);
    await second.stop();
    broker = second;
  });

  it("releases the broker after sealing a custody handoff and never overwrites staged account state", async () => {
    const token = fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8");
    const connection = await AgentConnection.connect(broker.socketPath);
    connection.send({ type: "control", token, action: "quiesce" });
    const reply = await connection.next() as { type: string; encryptedState: string };
    expect(reply.type).toBe("quiesced");
    expect(JSON.parse(await authority.open(reply.encryptedState)).v).toBe(1);
    for (let attempt = 0; attempt < 50 && await brokerIsLive(broker.socketPath); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(await brokerIsLive(broker.socketPath)).toBe(false);
    const staged = await authority.seal("account-state");
    fs.writeFileSync(agentStatePath(directory, authority.scopeIds), staged);
    await broker.stop();
    expect(fs.readFileSync(agentStatePath(directory, authority.scopeIds), "utf8")).toBe(staged);
    connection.close();
  });

  it("fills from a local rule while account refresh never answers", async () => {
    await broker.stop();
    const coordination = mock<AgentAccountCoordinator>();
    coordination.sync.mockReturnValue(new Promise(() => undefined));
    coordination.receive.mockReturnValue(new Promise(() => undefined));
    const offline = new AgentBroker(directory, {
      ...authority,
      coordination,
      resolve: async () => ({
        cipherId: "cipher-1", fieldPath: "detail.detail-1", revisionDate: "2026-04-02T00:00:00.000Z",
        accessible: true, agentRule: "fill", draft: false,
      }),
      value: async () => "Ada",
      targets: {
        collect: async (): Promise<AgentTarget[]> => [{
          targetId: "target-1", kind: "web", destinationKey: "web:https://forms.example",
          generation: "g1", display: "Application", formSignature: "form-1",
          sections: [{ id: "s1", label: "Applicant" }],
          fields: [{ id: "f1", sectionId: "s1", label: "Name", type: "text", options: [] }],
        }],
        write: async (_target, operations) => ({
          entries: operations.map((operation) => ({ entryId: operation.entryId, outcome: "confirmed" as const })),
        }),
      },
    });
    broker = offline;
    await offline.start();
    const client = await AgentConnection.connect(offline.socketPath);
    client.send({ type: "pair", displayName: "Editor", vaultScopeId: "local" });
    const pending = (await client.next()) as { connectionId: string };
    const token = fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8");
    const control = await AgentConnection.connect(offline.socketPath);
    control.send({ type: "control", token, action: "approve", connectionId: pending.connectionId });
    const approved = (await control.next()) as { pairingId: string };
    const paired = (await client.next()) as { credential: string };
    client.send({
      type: "fill_request", pairingId: approved.pairingId, credential: paired.credential,
      vaultScopeId: "local",
      body: { goal: "Fill the form", reason: "A name is required",
        assignments: [{ fieldId: "f1", reference: "@vk:cipher-1/detail.detail-1" }] },
    });
    const receipt = (await client.next()) as { status?: string };
    expect(receipt.status).toBe("confirmed");
    client.close();
    control.close();
  });

  it("resolves a secret for the owner token and refuses a paired agent", async () => {
    await broker.stop();
    authority = {
      ...authority,
      resolve: async () => ({ cipherId: "k1", fieldPath: "key.value", revisionDate: "1", accessible: true, draft: false }),
      value: async (_itemId, fieldPath) => fieldPath === "key.value" ? "sk-live" : "[]",
    };
    broker = new AgentBroker(directory, authority);
    await broker.start();
    const client = await AgentConnection.connect(broker.socketPath);
    client.send({ type: "pair", displayName: "Editor", vaultScopeId: "local" });
    const pending = (await client.next()) as { connectionId: string };
    const token = fs.readFileSync(path.join(directory, "agent", "control.token"), "utf8");
    const control = await AgentConnection.connect(broker.socketPath);
    control.send({ type: "control", token, action: "approve", connectionId: pending.connectionId });
    await control.next();
    const paired = (await client.next()) as { credential?: string };
    client.send({
      type: "control", token, action: "secrets", op: "value", itemId: "k1", fieldPath: "key.value",
      pairingId: "forged", credential: paired.credential,
    });
    expect(((await client.next()) as { value?: string }).value).toBeUndefined();
    control.send({ type: "control", token: "not-the-owner", action: "secrets", op: "value", itemId: "k1", fieldPath: "key.value" });
    expect(((await control.next()) as { code?: string }).code).toBe("credential_rejected");
    control.send({ type: "control", token, action: "secrets", op: "value", itemId: "k1", fieldPath: "key.value" });
    expect(await control.next()).toMatchObject({ type: "secrets", value: "sk-live" });
    client.close();
    control.close();
  });
});
