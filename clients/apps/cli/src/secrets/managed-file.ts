import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { SecretsError } from "./errors";
import type { FileIdentity } from "./state";

const MARKER = "# Vowkey managed: ";

export function newManagedToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function managedHeader(token: string): string {
  return `${MARKER}${token}\n`;
}

function identityOf(stat: fs.Stats): FileIdentity {
  return {
    platform: "posix",
    device: String(stat.dev),
    inode: String(stat.ino),
    links: stat.nlink,
  };
}

function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return (
    a.platform === "posix" && b.platform === "posix" && a.device === b.device && a.inode === b.inode
  );
}

function requireSupportedPlatform(): void {
  if (process.platform === "win32") {
    // The file's owner-only access list has to be set when the file is created, before any secret
    // byte is written. That needs a native helper this build does not carry, and the contract is
    // to write nothing rather than fall back to a file anyone can read.
    throw new SecretsError(
      "write-failed",
      "Writing an environment file on Windows needs the owner-only file helper, which is not installed.",
    );
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export type Probe =
  { kind: "absent" } | { kind: "managed"; identity: FileIdentity } | { kind: "foreign" };

/**
 * Looks at what is at `target`. A file is ours only when it is a regular file, its identity is the
 * one stored for it, and it carries this environment's ownership token.
 */
export function probe(target: string, stored: FileIdentity | null, token: string): Probe {
  const stat = lstatOrNull(target);
  if (stat == null) {
    return { kind: "absent" };
  }
  if (!stat.isFile() || stored == null || !sameFile(identityOf(stat), stored)) {
    return { kind: "foreign" };
  }
  try {
    const head = fs.readFileSync(target, "utf8").slice(0, 200);
    if (!head.startsWith(managedHeader(token))) {
      return { kind: "foreign" };
    }
  } catch {
    return { kind: "foreign" };
  }
  return { kind: "managed", identity: identityOf(stat) };
}

/** Creates a file that does not exist: exclusive, no symlink followed, mode 0600 from the start. */
export function createManagedFile(target: string, token: string, body: string): FileIdentity {
  requireSupportedPlatform();
  let fd: number;
  try {
    fd = fs.openSync(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch (e) {
    throw new SecretsError("write-failed", `Could not create ${target}: ${(e as Error).message}`);
  }
  try {
    fs.writeFileSync(fd, managedHeader(token) + body);
    fs.fsyncSync(fd);
    return identityOf(fs.fstatSync(fd));
  } catch (e) {
    fs.closeSync(fd);
    fd = -1;
    try {
      fs.unlinkSync(target);
    } catch {
      // Nothing more can be done for a file that could not be removed.
    }
    throw new SecretsError("write-failed", `Could not write ${target}: ${(e as Error).message}`);
  } finally {
    if (fd !== -1) {
      fs.closeSync(fd);
    }
  }
}

/**
 * Replaces a managed file through a same-directory temporary file with the same protection, after
 * checking again that the entry is the one this owner wrote.
 */
export function replaceManagedFile(
  target: string,
  stored: FileIdentity,
  token: string,
  body: string,
): FileIdentity {
  requireSupportedPlatform();
  const before = probe(target, stored, token);
  if (before.kind !== "managed") {
    throw new SecretsError("refused", `${target} is not the file Vowkey wrote there.`);
  }
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.vowkey-${crypto.randomBytes(6).toString("hex")}`,
  );
  let fd: number;
  try {
    fd = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
  } catch (e) {
    throw new SecretsError("write-failed", `Could not update ${target}: ${(e as Error).message}`);
  }
  try {
    fs.writeFileSync(fd, managedHeader(token) + body);
    fs.fsyncSync(fd);
    const identity = identityOf(fs.fstatSync(fd));
    fs.closeSync(fd);
    fd = -1;
    // Recheck the directory entry right before the rename.
    if (probe(target, stored, token).kind !== "managed") {
      throw new SecretsError("refused", `${target} changed while it was being updated.`);
    }
    fs.renameSync(temp, target);
    return identity;
  } catch (e) {
    if (fd !== -1) {
      fs.closeSync(fd);
    }
    try {
      fs.unlinkSync(temp);
    } catch {
      // The temporary file may already be gone.
    }
    if (e instanceof SecretsError) {
      throw e;
    }
    throw new SecretsError("write-failed", `Could not update ${target}: ${(e as Error).message}`);
  }
}

/** Unlinks the entry only when it is verifiably ours. Returns whether it was removed. */
export function removeManagedFile(
  target: string,
  stored: FileIdentity | null,
  token: string,
): boolean {
  const found = probe(target, stored, token);
  if (found.kind !== "managed") {
    return false;
  }
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}
