import { createHash } from "node:crypto";
import * as path from "node:path";

import { app, ipcMain, IpcMainInvokeEvent } from "electron";

import { passwords } from "@vowkey/desktop-napi";
import { NativeLocalVaultStore } from "@vowkey/common/vault/local/node/store";
import { LOCAL_STORES, LocalStoreName, LocalWrite } from "@vowkey/common/vault/local/store";

import { WindowMain } from "../main/window.main";

export class LocalVaultMain {
  private readonly store = new NativeLocalVaultStore(path.join(app.getPath("userData"), "local-vault"));
  private readonly keyAccount =
    process.env.VOWKEY_APPDATA_DIR ||
    path.resolve(app.getPath("userData")) !==
      path.resolve(path.join(app.getPath("appData"), "Vowkey"))
      ? `localUserKey:${createHash("sha256").update(path.resolve(app.getPath("userData"))).digest("hex")}`
      : "localUserKey";

  constructor(private readonly window: WindowMain) {}

  init(): void {
    const guard = (event: IpcMainInvokeEvent, store?: LocalStoreName) => {
      if (event.sender !== this.window.win?.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        (store != null && !LOCAL_STORES.includes(store))) {
        throw new Error("Unauthorized local vault request.");
      }
    };
    ipcMain.handle("localVault.get", async (event, store: LocalStoreName, id: string) => {
      guard(event, store);
      const value = await this.store.get(store, id);
      return toWire(store, value);
    });
    ipcMain.handle("localVault.list", async (event, store: LocalStoreName) => {
      guard(event, store);
      return Promise.all((await this.store.list(store)).map(async (row) => ({
        id: row.id, value: await toWire(store, row.value),
      })));
    });
    ipcMain.handle("localVault.commit", async (event, writes: LocalWrite[]) => {
      guard(event);
      if (!Array.isArray(writes) || writes.some((write) => write == null ||
        !LOCAL_STORES.includes(write.store) || typeof write.id !== "string" || write.id === "")) {
        throw new Error("Invalid local vault transaction.");
      }
      const decoded = writes.map((write) => {
        if (write.store !== "attachments" || write.value == null) {
          return write;
        }
        const value = write.value as { cipherId: string; bytes: Uint8Array };
        if (!(value.bytes instanceof Uint8Array) || typeof value.cipherId !== "string") {
          throw new Error("Invalid encrypted attachment.");
        }
        return { ...write, value: { cipherId: value.cipherId, bytes: new Blob([Uint8Array.from(value.bytes).buffer]) } };
      });
      await this.store.commit(decoded);
    });
    ipcMain.handle("localVault.readKey", async (event) => {
      guard(event);
      try {
        const value = await passwords.getPassword("Vowkey", this.keyAccount);
        if (value == null) {
          return null;
        }
        const key = Buffer.from(value, "base64");
        if (key.length !== 64) {
          throw new Error("Invalid local vault key.");
        }
        return new Uint8Array(key);
      } catch (error) {
        if (error instanceof Error && error.message === passwords.PASSWORD_NOT_FOUND) {
          return null;
        }
        throw error;
      }
    });
    ipcMain.handle("localVault.writeKey", async (event, key: Uint8Array) => {
      guard(event);
      if (!(key instanceof Uint8Array) || key.byteLength !== 64) {
        throw new Error("Invalid local vault key.");
      }
      await passwords.setPassword("Vowkey", this.keyAccount, Buffer.from(key).toString("base64"));
    });
    ipcMain.handle("localVault.clearKey", async (event) => {
      guard(event);
      await passwords.deletePassword("Vowkey", this.keyAccount);
    });
  }
}

async function toWire(store: LocalStoreName, value: unknown): Promise<unknown> {
  if (store !== "attachments" || value == null) {
    return value;
  }
  const attachment = value as { cipherId: string; bytes: Blob };
  return { cipherId: attachment.cipherId, bytes: new Uint8Array(await attachment.bytes.arrayBuffer()) };
}
