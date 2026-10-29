import { spawn } from "child_process";

import { resolveCliDataDirectory } from "@vowkey/common/platform/misc/node/cli-data-directory";
import { SecretsError } from "./errors";
import { liveOwnerAnswers, OwnerReply, sendToOwner, socketPathFor } from "./owner";

function socket(): string {
  return socketPathFor(resolveCliDataDirectory());
}

/** Tells a running owner the vault was locked or the account logged out. Never throws. */
export async function notifyOwner(type: "lock" | "logout"): Promise<void> {
  try {
    if (await liveOwnerAnswers(socket())) {
      await sendToOwner(socket(), { type }, 3000);
    }
  } catch {
    // No owner, or one that cannot be reached: there is nothing running to tell.
  }
}

export async function ownerStatus(): Promise<OwnerReply | null> {
  try {
    const reply = await sendToOwner(socket(), { type: "status" }, 3000);
    return reply.ok ? reply : null;
  } catch {
    return null;
  }
}

/**
 * Makes sure an owner is running with the vault unlocked. This process is unlocked (its command
 * checked), so a new owner is started with this process's session in its environment, never in
 * its arguments. A running owner that is locked is replaced.
 */
export async function ensureUnlockedOwner(): Promise<void> {
  const status = await ownerStatus();
  if (status != null && status.locked === false) {
    return;
  }
  if (status != null) {
    try {
      await sendToOwner(socket(), { type: "stop" }, 3000);
    } catch {
      // It may have closed before replying.
    }
    for (let i = 0; i < 40 && (await liveOwnerAnswers(socket())); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const entry = process.argv[1];
  const child = spawn(process.execPath, [entry, "--nointeraction", "secrets", "serve"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  let exited = false;
  child.once("exit", () => (exited = true));
  child.unref();

  for (let i = 0; i < 150; i++) {
    const now = await ownerStatus();
    if (now != null && now.locked === false) {
      return;
    }
    if (exited) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new SecretsError(
    "locked",
    "The secrets owner could not start with the vault unlocked. Unlock the vault and pass its session.",
  );
}

/** Sends a control message to the running owner and returns its reply, or throws its code. */
export async function askOwner(message: Record<string, unknown>): Promise<OwnerReply> {
  const reply = await sendToOwner(socket(), message);
  if (!reply.ok) {
    throw new SecretsError(
      (reply.code as SecretsError["code"] | undefined) ?? "unavailable",
      reply.message ?? "The request failed.",
    );
  }
  return reply;
}
