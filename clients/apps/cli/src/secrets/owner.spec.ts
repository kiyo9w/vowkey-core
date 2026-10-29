import { spawn } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";

import { EnvironmentSnapshot } from "./env-files";
import { OwnerVault, SecretsOwner, sendToOwner } from "./owner";
import { ReferenceError } from "@vowkey/common/vault/reference"
import type { KeyItem } from "./vault-resolver";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

class FakeVault implements OwnerVault {
  environments = new Map<string, EnvironmentSnapshot>();
  keys = new Map<string, KeyItem>();
  async scopeId() {
    return "user-1";
  }
  async environment(idOrName: string) {
    const found = [...this.environments.values()].find(
      (e) => e.id === idOrName || e.name === idOrName,
    );
    if (found == null) {
      throw new ReferenceError("not-found", "not-found");
    }
    return found;
  }
  async resolve({ itemId }: { itemId: string; fieldPath: string }) {
    const key = this.keys.get(itemId);
    if (key == null) {
      throw new ReferenceError("not-found", "not-found");
    }
    return key.value;
  }
  async revisionOf(itemId: string) {
    return this.keys.get(itemId)?.revision ?? null;
  }
  async keyItems(ids: string[]) {
    return ids.map((id) => this.keys.get(id)).filter((k): k is KeyItem => k != null);
  }
}

function vault(): FakeVault {
  const v = new FakeVault();
  v.keys.set("k1", {
    itemId: "k1",
    name: "OpenAI",
    value: "sk-live-0123456789",
    sendStyle: "bearer",
    allowedHosts: ["api.openai.com"],
    revision: "1",
  });
  v.environments.set("env-1", {
    id: "env-1",
    name: "production",
    members: [{ name: "OPENAI_API_KEY", itemId: "k1" }],
    revision: "r1",
    deleted: false,
  });
  return v;
}

posixOnly("SecretsOwner", () => {
  let directory: string;
  let owner: SecretsOwner | null = null;

  beforeEach(() => {
    // A short path: unix socket paths are limited to about a hundred characters.
    directory = fs.mkdtempSync(path.join("/tmp", "vso-"));
  });
  afterEach(async () => {
    await owner?.shutdown();
    owner = null;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const ask = (message: Record<string, unknown>) =>
    sendToOwner(path.join(directory, "secrets.sock"), message);

  it("listens on an owner-only socket and answers status without any secret", async () => {
    owner = new SecretsOwner(directory);
    await owner.start(vault());

    const mode = fs.statSync(path.join(directory, "secrets.sock")).mode & 0o777;
    expect(mode).toBe(0o600);
    const reply = await ask({ type: "status" });
    expect(reply).toMatchObject({
      ok: true,
      v: 1,
      locked: false,
      proxy: { listening: false, host: "127.0.0.1" },
    });
    expect(JSON.stringify(reply)).not.toMatch(/sk-live|credential|session/i);
  });

  it("refuses a second owner while one is live, and replaces a stale socket", async () => {
    owner = new SecretsOwner(directory);
    await owner.start(vault());
    const second = new SecretsOwner(directory);
    await expect(second.start(vault())).rejects.toMatchObject({ code: "unavailable" });

    // A socket path left by a crashed owner is removed once nothing answers on it.
    await owner.shutdown();
    owner = null;
    const socketPath = path.join(directory, "secrets.sock");
    const crashed = spawn(process.execPath, [
      "-e",
      `require("net").createServer().listen(${JSON.stringify(socketPath)}, () => console.log("up"))`,
    ]);
    await new Promise<void>((resolve) => crashed.stdout.once("data", () => resolve()));
    crashed.kill("SIGKILL");
    await new Promise<void>((resolve) => crashed.once("close", () => resolve()));
    expect(fs.lstatSync(socketPath).isSocket()).toBe(true);
    owner = new SecretsOwner(directory);
    await owner.start(vault());
    expect((await ask({ type: "status" })).ok).toBe(true);
  });

  it("does not take over a path that is not a socket", async () => {
    fs.writeFileSync(path.join(directory, "secrets.sock"), "not a socket");
    const blocked = new SecretsOwner(directory);
    await expect(blocked.start(vault())).rejects.toMatchObject({ code: "refused" });
    expect(fs.readFileSync(path.join(directory, "secrets.sock"), "utf8")).toBe("not a socket");
  });

  it("writes an environment file on enable and removes it on lock, then writes it again on unlock", async () => {
    const target = path.join(directory, "project.env");
    owner = new SecretsOwner(directory);
    const v = vault();
    await owner.start(v);

    const enabled = await ask({ type: "enable", environment: "production", path: target });
    expect(enabled).toMatchObject({ ok: true, environment: { enabled: true, state: "written" } });
    expect(fs.readFileSync(target, "utf8")).toContain("OPENAI_API_KEY=sk-live-0123456789");

    await ask({ type: "lock" });
    expect(fs.existsSync(target)).toBe(false);
    expect(await ask({ type: "status" })).toMatchObject({ locked: true });
    expect(await ask({ type: "enable", environment: "production", path: target })).toMatchObject({
      ok: false,
      code: "locked",
    });

    await owner.setVault(v);
    expect(fs.readFileSync(target, "utf8")).toContain("OPENAI_API_KEY=sk-live-0123456789");
  });

  it("returns a code and no key value when a member does not resolve", async () => {
    owner = new SecretsOwner(directory);
    const v = vault();
    v.keys.delete("k1");
    await owner.start(v);
    const reply = await ask({
      type: "enable",
      environment: "production",
      path: path.join(directory, "x.env"),
    });
    expect(reply).toMatchObject({ ok: false, code: "missing-ref" });
    expect(JSON.stringify(reply)).not.toContain("sk-live");
  });

  it("starts the proxy for enabled keys, rotates its credential on lock, and stops listening", async () => {
    owner = new SecretsOwner(directory);
    const v = vault();
    await owner.start(v);

    expect(await ask({ type: "proxy-info" })).toMatchObject({ ok: false, code: "not-listening" });
    const enabled = await ask({ type: "proxy-enable-key", itemId: "k1" });
    expect(enabled).toMatchObject({ ok: true, enabledItemIds: ["k1"] });
    const started = await ask({ type: "proxy-start", port: 0 });
    expect(started).toMatchObject({ ok: true, proxy: { listening: true } });
    const info = await ask({ type: "proxy-info" });
    expect(info).toMatchObject({ ok: true, host: "127.0.0.1" });
    const firstCredential = info.credential as string;
    const port = info.port as number;
    expect(firstCredential.length).toBeGreaterThanOrEqual(32);

    // Lock closes the listener.
    await ask({ type: "lock" });
    await expect(
      new Promise((resolve, reject) => {
        const s = net.connect(port, "127.0.0.1");
        s.once("connect", () => resolve("connected"));
        s.once("error", reject);
      }),
    ).rejects.toBeDefined();

    // Unlock brings it back with a new credential: the old HTTPS_PROXY cannot revive.
    await owner.setVault(v);
    const again = await ask({ type: "proxy-info" });
    expect(again.credential).not.toBe(firstCredential);
  });

  it("keeps a key's placeholder across lock and drops it when the key is deleted", async () => {
    owner = new SecretsOwner(directory);
    const v = vault();
    await owner.start(v);
    await ask({ type: "proxy-enable-key", itemId: "k1" });
    const placeholder = owner.state.proxy.scopes["user-1"].placeholders["k1"];
    expect(placeholder).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await ask({ type: "lock" });
    await owner.setVault(v);
    expect(owner.state.proxy.scopes["user-1"].placeholders["k1"]).toBe(placeholder);

    v.keys.delete("k1");
    await ask({ type: "refresh" });
    expect(owner.state.proxy.scopes["user-1"].placeholders["k1"]).toBeUndefined();
    expect(owner.state.proxy.scopes["user-1"].enabledItemIds).toEqual([]);
  });

  it("stores no key value in the state file", async () => {
    owner = new SecretsOwner(directory);
    await owner.start(vault());
    await ask({ type: "proxy-enable-key", itemId: "k1" });
    await ask({ type: "enable", environment: "production", path: path.join(directory, "p.env") });
    const saved = fs.readFileSync(path.join(directory, "developer-secrets.json"), "utf8");
    expect(saved).not.toContain("sk-live");
    expect(os.platform()).not.toBe("win32");
    expect(fs.statSync(path.join(directory, "developer-secrets.json")).mode & 0o777).toBe(0o600);
  });

  it("rejects a message with the wrong protocol version", async () => {
    owner = new SecretsOwner(directory);
    await owner.start(vault());
    const reply = await sendToOwner(path.join(directory, "secrets.sock"), {
      type: "status",
      v: 99,
    });
    expect(reply).toMatchObject({ ok: false, code: "bad-request" });
  });
});
