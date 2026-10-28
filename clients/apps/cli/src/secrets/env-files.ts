import * as path from "path";

import { formatDotenvLine } from "./dotenv";
import { SecretsError } from "./errors";
import {
  createManagedFile,
  newManagedToken,
  probe,
  removeManagedFile,
  replaceManagedFile,
} from "./managed-file";
import { ReferenceError, VkReference } from "./references";
import type { DeveloperSecretsState, EnvironmentFileState, StateStore } from "./state";

export interface EnvironmentSnapshot {
  id: string;
  name: string;
  members: { name: string; itemId: string }[];
  /** The environment cipher's revision. */
  revision: string;
  deleted: boolean;
}

/** What the file manager needs from the unlocked vault. */
export interface VaultPort {
  scopeId(): Promise<string>;
  environment(idOrName: string): Promise<EnvironmentSnapshot>;
  resolve(reference: VkReference): Promise<string>;
  /** A member item's revision, or null when it is absent, trashed or no longer readable. */
  revisionOf(itemId: string): Promise<string | null>;
}

export interface EnvironmentFileStatusRow {
  environmentId: string;
  path: string;
  enabled: boolean;
  state: EnvironmentFileState["state"];
  writtenRevision: string | null;
}

/**
 * Keeps each enabled environment's regular `.env` file in step with the vault. A file exists only
 * while it is enabled and the vault is unlocked, and only this owner removes it, and only while the
 * stored file id and ownership token still match what is on disk.
 */
export class EnvironmentFileManager {
  private vault: VaultPort | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: StateStore,
    private readonly state: DeveloperSecretsState,
  ) {}

  /** Runs one operation at a time, so two control messages never interleave their writes. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch((): void => undefined);
    return run;
  }

  status(): EnvironmentFileStatusRow[] {
    return Object.entries(this.state.environments).map(([environmentId, e]) => ({
      environmentId,
      path: e.path,
      enabled: e.enabled,
      state: e.state,
      writtenRevision: e.writtenRevision,
    }));
  }

  enable(idOrName: string, target: string): Promise<EnvironmentFileStatusRow> {
    return this.serialize(async () => {
      const vault = this.requireVault();
      const environment = await this.lookupEnvironment(vault, idOrName);
      const scope = await vault.scopeId();
      const resolved = path.resolve(target);

      for (const [id, other] of Object.entries(this.state.environments)) {
        if (id !== environment.id && other.enabled && other.path === resolved) {
          throw new SecretsError("refused", `Another environment already writes ${resolved}.`);
        }
      }

      const body = await this.render(vault, environment);
      const existing = this.state.environments[environment.id];
      const token = existing?.managedToken ?? newManagedToken();

      // Moving to a new path removes the old managed file first.
      if (existing != null && existing.path !== resolved) {
        removeManagedFile(existing.path, existing.fileId, existing.managedToken);
      }

      const found = probe(resolved, existing?.path === resolved ? existing.fileId : null, token);
      const entry: EnvironmentFileState = {
        vaultScopeId: scope,
        path: resolved,
        fileId: null,
        managedToken: token,
        enabled: true,
        writtenRevision: null,
        state: "written",
      };
      try {
        if (found.kind === "foreign") {
          entry.enabled = false;
          entry.state = "refused";
          this.state.environments[environment.id] = entry;
          this.store.save(this.state);
          throw new SecretsError(
            "refused",
            `${resolved} already exists and is not a file Vowkey wrote; it was left as it is.`,
          );
        }
        entry.fileId =
          found.kind === "absent"
            ? createManagedFile(resolved, token, body)
            : replaceManagedFile(resolved, found.identity, token, body);
        entry.writtenRevision = await this.signature(vault, environment);
      } catch (e) {
        if (e instanceof SecretsError && e.code === "refused") {
          throw e;
        }
        entry.enabled = false;
        entry.state = "write-failed";
        this.state.environments[environment.id] = entry;
        this.store.save(this.state);
        throw e instanceof SecretsError
          ? e
          : new SecretsError("write-failed", "The environment file could not be written.");
      }
      this.state.environments[environment.id] = entry;
      this.store.save(this.state);
      return this.row(environment.id);
    });
  }

  disable(idOrName: string): Promise<EnvironmentFileStatusRow> {
    return this.serialize(async () => {
      const id = await this.idFor(idOrName);
      const entry = this.state.environments[id];
      if (entry == null) {
        throw new SecretsError("unavailable", "That environment has no file on this device.");
      }
      removeManagedFile(entry.path, entry.fileId, entry.managedToken);
      entry.enabled = false;
      entry.fileId = null;
      entry.state = "removed";
      this.store.save(this.state);
      return this.row(id);
    });
  }

  /** Lock or logout: the files go, the intent to have them stays. */
  lock(): Promise<void> {
    return this.serialize(async () => {
      this.vault = null;
      this.removeAllManaged("locked");
    });
  }

  /** Switching scope removes the files of every other scope before the new one is written. */
  unlock(vault: VaultPort): Promise<void> {
    return this.serialize(async () => {
      this.vault = vault;
      const scope = await vault.scopeId();
      for (const entry of Object.values(this.state.environments)) {
        if (entry.vaultScopeId !== scope && entry.enabled && entry.fileId != null) {
          removeManagedFile(entry.path, entry.fileId, entry.managedToken);
          entry.fileId = null;
          entry.state = "locked";
        }
      }
      for (const [id, entry] of Object.entries(this.state.environments)) {
        if (entry.enabled && entry.vaultScopeId === scope) {
          await this.rewrite(vault, id, entry);
        }
      }
      this.store.save(this.state);
    });
  }

  /** Called on a timer and after a sync: rewrites, or removes, what changed. */
  refresh(): Promise<void> {
    return this.serialize(async () => {
      const vault = this.vault;
      if (vault == null) {
        return;
      }
      const scope = await vault.scopeId();
      for (const [id, entry] of Object.entries(this.state.environments)) {
        if (!entry.enabled || entry.vaultScopeId !== scope || entry.state === "refused") {
          continue;
        }
        let environment: EnvironmentSnapshot;
        try {
          environment = await vault.environment(id);
        } catch {
          this.makeUnavailable(entry);
          continue;
        }
        if (environment.deleted) {
          this.makeUnavailable(entry);
          continue;
        }
        const accessible = await this.membersAccessible(vault, environment);
        if (!accessible) {
          this.makeUnavailable(entry);
          continue;
        }
        if ((await this.signature(vault, environment)) !== entry.writtenRevision) {
          await this.rewrite(vault, id, entry);
        }
      }
      this.store.save(this.state);
    });
  }

  /** On owner start: a locked start removes managed files; an unlocked one rewrites them. */
  recover(vault: VaultPort | null): Promise<void> {
    return vault == null ? this.lock() : this.unlock(vault);
  }

  private requireVault(): VaultPort {
    if (this.vault == null) {
      throw new SecretsError("locked", "The vault is locked.");
    }
    return this.vault;
  }

  private async lookupEnvironment(vault: VaultPort, idOrName: string) {
    try {
      const environment = await vault.environment(idOrName);
      if (environment.deleted) {
        throw new SecretsError("missing-ref", `The environment "${idOrName}" is in the trash.`);
      }
      return environment;
    } catch (e) {
      if (e instanceof SecretsError) {
        throw e;
      }
      throw new SecretsError("missing-ref", `No environment "${idOrName}" in this vault.`);
    }
  }

  private async idFor(idOrName: string): Promise<string> {
    if (this.state.environments[idOrName] != null) {
      return idOrName;
    }
    if (this.vault != null) {
      try {
        return (await this.vault.environment(idOrName)).id;
      } catch {
        // Fall through to the not-found error below.
      }
    }
    return idOrName;
  }

  private async render(vault: VaultPort, environment: EnvironmentSnapshot): Promise<string> {
    const lines: string[] = [];
    for (const member of environment.members) {
      try {
        const value = await vault.resolve({ itemId: member.itemId, fieldPath: "key.value" });
        lines.push(formatDotenvLine(member.name, value));
      } catch (e) {
        throw new SecretsError(
          "missing-ref",
          `${member.name}: @vk:${member.itemId}/key.value does not resolve (${
            e instanceof ReferenceError ? e.reason : "unavailable"
          })`,
        );
      }
    }
    return lines.length === 0 ? "" : lines.join("\n") + "\n";
  }

  private async signature(vault: VaultPort, environment: EnvironmentSnapshot): Promise<string> {
    const parts = [environment.revision];
    for (const member of environment.members) {
      parts.push(`${member.itemId}:${(await vault.revisionOf(member.itemId)) ?? "-"}`);
    }
    return parts.join("|");
  }

  private async membersAccessible(vault: VaultPort, environment: EnvironmentSnapshot) {
    for (const member of environment.members) {
      if ((await vault.revisionOf(member.itemId)) == null) {
        return false;
      }
    }
    return true;
  }

  /** Rewrites one enabled file. A failure removes the managed file and records why. */
  private async rewrite(vault: VaultPort, id: string, entry: EnvironmentFileState) {
    try {
      const environment = await vault.environment(id);
      const body = await this.render(vault, environment);
      const found = probe(entry.path, entry.fileId, entry.managedToken);
      if (found.kind === "foreign") {
        entry.enabled = false;
        entry.fileId = null;
        entry.state = "refused";
        return;
      }
      entry.fileId =
        found.kind === "absent"
          ? createManagedFile(entry.path, entry.managedToken, body)
          : replaceManagedFile(entry.path, found.identity, entry.managedToken, body);
      entry.writtenRevision = await this.signature(vault, environment);
      entry.state = "written";
    } catch (e) {
      removeManagedFile(entry.path, entry.fileId, entry.managedToken);
      entry.fileId = null;
      entry.state =
        e instanceof SecretsError && e.code === "missing-ref" ? "missing-ref" : "write-failed";
    }
  }

  private makeUnavailable(entry: EnvironmentFileState) {
    removeManagedFile(entry.path, entry.fileId, entry.managedToken);
    entry.enabled = false;
    entry.fileId = null;
    entry.state = "unavailable";
  }

  private removeAllManaged(state: EnvironmentFileState["state"]) {
    for (const entry of Object.values(this.state.environments)) {
      if (entry.enabled || entry.fileId != null) {
        removeManagedFile(entry.path, entry.fileId, entry.managedToken);
        entry.fileId = null;
        if (entry.enabled) {
          entry.state = state;
        }
      }
    }
    this.store.save(this.state);
  }

  private row(id: string): EnvironmentFileStatusRow {
    const e = this.state.environments[id];
    return {
      environmentId: id,
      path: e.path,
      enabled: e.enabled,
      state: e.state,
      writtenRevision: e.writtenRevision,
    };
  }
}
