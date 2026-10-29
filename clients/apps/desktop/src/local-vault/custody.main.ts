import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { ipcMain, IpcMainInvokeEvent } from "electron";

import { resolveCliDataDirectory } from "@vowkey/common/platform/misc/node/cli-data-directory";
import { AgentConnection, agentDirectory, agentSocketPath, agentStatePath, brokerIsLive, writeOwnerFile } from "@vowkey/common/vault/agent/node/broker";

import { WindowMain } from "../main/window.main";

interface CustodyIntent { v: 1; oldScope: string; accountUserId: string; stateHash: string; }

/** The main process handles ciphertext only; re-protection happens in the unlocked renderer. */
export class LocalVaultCustodyMain {
  private readonly directory = resolveCliDataDirectory();
  constructor(private readonly window: WindowMain) {}

  init(): void {
    const guard = (event: IpcMainInvokeEvent, migrationId: string) => {
      if (event.sender !== this.window.win?.webContents || event.senderFrame !== event.sender.mainFrame ||
        !/^[a-zA-Z0-9-]{1,128}$/.test(migrationId)) {
        throw new Error("Unauthorized vault migration.");
      }
    };
    ipcMain.handle("agentCustody.quiesce", async (event, migrationId: string, scope: string) => {
      guard(event, migrationId);
      this.vaultScope(scope);
      if (await brokerIsLive(agentSocketPath(this.directory))) {
        const connection = await AgentConnection.connect(agentSocketPath(this.directory));
        try {
          connection.send({ type: "hello", protocol: "vowkey.agent.v1" });
          const hello = await connection.next() as { vaultScopeIds?: string[] };
          if (hello.vaultScopeIds?.includes(scope)) {
            connection.send({ type: "control", action: "quiesce",
              token: fs.readFileSync(path.join(agentDirectory(this.directory), "control.token"), "utf8") });
            const reply = await connection.next(30_000) as { type: string; encryptedState?: string };
            if (reply.type !== "quiesced") { throw new Error("The agent executor could not stop."); }
            for (let attempt = 0; attempt < 100 && await brokerIsLive(agentSocketPath(this.directory)); attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            if (await brokerIsLive(agentSocketPath(this.directory))) {
              throw new Error("The agent executor has not released its state.");
            }
            return reply.encryptedState ?? null;
          }
        } finally { connection.close(); }
      }
      return this.readState(scope);
    });
    ipcMain.handle("agentCustody.stage", (event, migrationId: string, oldScope: string,
      accountUserId: string, encryptedState: string | null, expected: string | null) => {
      guard(event, migrationId);
      this.vaultScope(oldScope);
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(accountUserId) || accountUserId.startsWith("local:")) {
        throw new Error("Invalid destination vault.");
      }
      if (!oldScope.startsWith("local:") && oldScope !== accountUserId) {
        throw new Error("The local agent state belongs to another account.");
      }
      if (encryptedState !== null && (typeof encryptedState !== "string" || !/^[027]\./.test(encryptedState)) ||
        expected !== null && typeof expected !== "string") {
        throw new Error("Invalid encrypted agent state.");
      }
      fs.mkdirSync(agentDirectory(this.directory), { recursive: true, mode: 0o700 });
      const lockFile = path.join(agentDirectory(this.directory), "owner.lock");
      const lock = fs.openSync(lockFile, "wx", 0o600);
      try {
        fs.writeFileSync(lock, String(process.pid));
        const current = this.readState(accountUserId);
        if (current !== expected && current !== encryptedState) {
          throw new Error("The account agent state changed. Retry attaching this vault.");
        }
        if (encryptedState === null) { return; }
        writeOwnerFile(agentStatePath(this.directory, [accountUserId]), encryptedState);
        writeOwnerFile(this.intent(migrationId), JSON.stringify({ v: 1, oldScope, accountUserId,
          stateHash: crypto.createHash("sha256").update(encryptedState).digest("hex") } satisfies CustodyIntent));
      } finally {
        fs.closeSync(lock);
        fs.unlinkSync(lockFile);
      }
    });
    ipcMain.handle("agentCustody.finalize", (event, migrationId: string, accountUserId: string) => {
      guard(event, migrationId);
      const file = this.intent(migrationId);
      if (!fs.existsSync(file)) { return; }
      const intent = JSON.parse(fs.readFileSync(file, "utf8")) as CustodyIntent;
      this.vaultScope(intent.oldScope);
      const state = this.readState(accountUserId);
      if (intent.v !== 1 || intent.accountUserId !== accountUserId || state == null ||
        crypto.createHash("sha256").update(state).digest("hex") !== intent.stateHash) {
        throw new Error("The account agent state has not been verified.");
      }
      const old = agentStatePath(this.directory, [intent.oldScope]);
      if (intent.oldScope !== accountUserId && fs.existsSync(old)) { fs.unlinkSync(old); }
      fs.unlinkSync(file);
    });
  }

  private vaultScope(scope: string): void {
    if (typeof scope !== "string" || !/^(?:local:)?[a-zA-Z0-9-]{1,128}$/.test(scope)) {
      throw new Error("Invalid vault.");
    }
  }
  private intent(id: string): string { return path.join(agentDirectory(this.directory), `migration.${id}.json`); }
  private readState(scope: string): string | null {
    const file = agentStatePath(this.directory, [scope]);
    try {
      if (!fs.lstatSync(file).isFile()) { throw new Error("Invalid agent state file."); }
      return fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { return null; }
      throw error;
    }
  }
}
