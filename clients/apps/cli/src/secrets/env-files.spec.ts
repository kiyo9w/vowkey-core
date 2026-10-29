import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { EnvironmentFileManager, EnvironmentSnapshot, VaultPort } from "./env-files";
import { ReferenceError } from "@vowkey/common/vault/reference"
import { emptyState, StateStore } from "./state";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

class FakeVault implements VaultPort {
  scope = "user-1";
  environments = new Map<string, EnvironmentSnapshot>();
  values = new Map<string, string>();
  revisions = new Map<string, string>();

  async scopeId() {
    return this.scope;
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
    const v = this.values.get(itemId);
    if (v == null) {
      throw new ReferenceError("not-found", "not-found");
    }
    return v;
  }
  async revisionOf(itemId: string) {
    return this.revisions.get(itemId) ?? null;
  }
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vowkey-env-"));
  const state = emptyState();
  const store = new StateStore(path.join(dir, "data"));
  const vault = new FakeVault();
  vault.environments.set("env-1", {
    id: "env-1",
    name: "production",
    members: [
      { name: "OPENAI_API_KEY", itemId: "k1" },
      { name: "NOTE", itemId: "k2" },
    ],
    revision: "r1",
    deleted: false,
  });
  vault.values.set("k1", "sk-live-0123456789");
  vault.values.set("k2", 'has space # and "quote"');
  vault.revisions.set("k1", "1");
  vault.revisions.set("k2", "1");
  const manager = new EnvironmentFileManager(store, state);
  return { dir, state, store, vault, manager, target: path.join(dir, "project", ".env") };
}

posixOnly("EnvironmentFileManager", () => {
  it("writes a 0600 regular file with resolved dotenv text and an ownership comment", async () => {
    const { manager, vault, target } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);

    const row = await manager.enable("production", target);

    expect(row).toMatchObject({ enabled: true, state: "written" });
    const stat = fs.lstatSync(target);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
    const text = fs.readFileSync(target, "utf8");
    expect(text).toMatch(/^# Vowkey managed: [0-9a-f]{32}\n/);
    expect(text).toContain("OPENAI_API_KEY=sk-live-0123456789\n");
    expect(text).toContain('NOTE="has space # and \\"quote\\""\n');
  });

  it("refuses to write while the vault is locked", async () => {
    const { manager, target } = setup();
    await expect(manager.enable("production", target)).rejects.toMatchObject({ code: "locked" });
    expect(fs.existsSync(target)).toBe(false);
  });

  it("writes nothing when a member does not resolve", async () => {
    const { manager, vault, target } = setup();
    vault.values.delete("k2");
    await manager.unlock(vault);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await expect(manager.enable("production", target)).rejects.toMatchObject({
      code: "missing-ref",
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it("leaves an existing entry it did not write untouched and records refused", async () => {
    const { manager, vault, target, state } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "MINE=1\n");
    await manager.unlock(vault);

    await expect(manager.enable("production", target)).rejects.toMatchObject({ code: "refused" });

    expect(fs.readFileSync(target, "utf8")).toBe("MINE=1\n");
    expect(state.environments["env-1"]).toMatchObject({ enabled: false, state: "refused" });
  });

  it("leaves a symlink alone, even when it points at a file", async () => {
    const { manager, vault, target, dir } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const real = path.join(dir, "real.env");
    fs.writeFileSync(real, "REAL=1\n");
    fs.symlinkSync(real, target);
    await manager.unlock(vault);

    await expect(manager.enable("production", target)).rejects.toMatchObject({ code: "refused" });

    expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, "utf8")).toBe("REAL=1\n");
  });

  it("refuses a path another environment already uses", async () => {
    const { manager, vault, target } = setup();
    vault.environments.set("env-2", {
      id: "env-2",
      name: "staging",
      members: [],
      revision: "r1",
      deleted: false,
    });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);
    await expect(manager.enable("staging", target)).rejects.toMatchObject({ code: "refused" });
  });

  it("removes the managed file on lock, keeps the intent, and rewrites it on unlock", async () => {
    const { manager, vault, target, state } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);

    await manager.lock();
    expect(fs.existsSync(target)).toBe(false);
    expect(state.environments["env-1"]).toMatchObject({ enabled: true, state: "locked" });

    await manager.unlock(vault);
    expect(fs.readFileSync(target, "utf8")).toContain("OPENAI_API_KEY=sk-live-0123456789");
    expect(state.environments["env-1"].state).toBe("written");
  });

  it("does not remove a file that is no longer the one it wrote", async () => {
    const { manager, vault, target } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);
    // Someone replaces the managed file with their own.
    fs.unlinkSync(target);
    fs.writeFileSync(target, "THEIRS=1\n");

    await manager.lock();

    expect(fs.readFileSync(target, "utf8")).toBe("THEIRS=1\n");
  });

  it("rewrites the file when a member's value changes", async () => {
    const { manager, vault, target } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);

    vault.values.set("k1", "sk-live-rotated-9999");
    vault.revisions.set("k1", "2");
    await manager.refresh();

    expect(fs.readFileSync(target, "utf8")).toContain("OPENAI_API_KEY=sk-live-rotated-9999");
    expect(fs.readFileSync(target, "utf8")).not.toContain("0123456789");
  });

  it("removes the file and disables it when a member is trashed or access is lost", async () => {
    const { manager, vault, target, state } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);

    vault.revisions.delete("k1");
    await manager.refresh();

    expect(fs.existsSync(target)).toBe(false);
    expect(state.environments["env-1"]).toMatchObject({ enabled: false, state: "unavailable" });
  });

  it("disable removes the managed file and records removed", async () => {
    const { manager, vault, target, state } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);

    await manager.disable("production");

    expect(fs.existsSync(target)).toBe(false);
    expect(state.environments["env-1"]).toMatchObject({ enabled: false, state: "removed" });
  });

  it("removes the previous scope's files when the active scope changes", async () => {
    const { manager, vault, target } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);

    vault.scope = "user-2";
    await manager.unlock(vault);

    expect(fs.existsSync(target)).toBe(false);
  });

  it("on an unlocked start rewrites enabled files, and on a locked start removes them", async () => {
    const { manager, vault, target, state, store } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);

    // A crashed owner leaves the file. A new owner that starts locked removes it.
    const restarted = new EnvironmentFileManager(store, JSON.parse(JSON.stringify(state)));
    await restarted.recover(null);
    expect(fs.existsSync(target)).toBe(false);

    // One that starts unlocked writes it again.
    const again = new EnvironmentFileManager(store, JSON.parse(JSON.stringify(state)));
    await again.recover(vault);
    expect(fs.readFileSync(target, "utf8")).toContain("OPENAI_API_KEY");
  });

  it("keeps the state file free of key values", async () => {
    const { manager, vault, target, store } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await manager.unlock(vault);
    await manager.enable("production", target);
    const saved = fs.readFileSync(store.file, "utf8");
    expect(saved).not.toContain("sk-live");
    expect(fs.statSync(store.file).mode & 0o777).toBe(0o600);
  });
});
