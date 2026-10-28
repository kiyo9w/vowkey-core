import * as fs from "fs";
import * as path from "path";

export type FileIdentity =
  | { platform: "posix"; device: string; inode: string; links: number }
  | { platform: "windows"; volume: string; index: string; links: number };

export type EnvironmentFileStatus =
  "written" | "removed" | "locked" | "unavailable" | "missing-ref" | "refused" | "write-failed";

export interface EnvironmentFileState {
  vaultScopeId: string;
  path: string;
  fileId: FileIdentity | null;
  managedToken: string;
  enabled: boolean;
  /** Identifies the cipher revisions the file was written from. */
  writtenRevision: string | null;
  state: EnvironmentFileStatus;
}

export interface ProxyScopeState {
  enabledItemIds: string[];
  /** The credential in HTTPS_PROXY. Rotated on lock, logout and scope change. */
  credential: string;
  /** Per key item: the stand-in a client may put where the key belongs. */
  placeholders: Record<string, string>;
}

export interface DeveloperSecretsState {
  version: 1;
  environments: Record<string, EnvironmentFileState>;
  proxy: {
    port: number;
    enabled: boolean;
    activeVaultScopeId: string | null;
    scopes: Record<string, ProxyScopeState>;
  };
}

export const DEFAULT_PROXY_PORT = 47623;

export function emptyState(): DeveloperSecretsState {
  return {
    version: 1,
    environments: {},
    proxy: { port: DEFAULT_PROXY_PORT, enabled: false, activeVaultScopeId: null, scopes: {} },
  };
}

/**
 * `developer-secrets.json` in the CLI data directory. Only the secrets owner writes it. It holds
 * no key value and no session; the proxy credential is the one secret in it, and it is rotated on
 * every lock.
 */
export class StateStore {
  readonly file: string;

  constructor(readonly directory: string) {
    this.file = path.join(directory, "developer-secrets.json");
  }

  load(): DeveloperSecretsState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as DeveloperSecretsState;
      if (parsed?.version === 1 && parsed.environments != null && parsed.proxy != null) {
        return parsed;
      }
    } catch {
      // A missing or unreadable file means no recorded paths.
    }
    return emptyState();
  }

  save(state: DeveloperSecretsState): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, this.file);
  }
}
