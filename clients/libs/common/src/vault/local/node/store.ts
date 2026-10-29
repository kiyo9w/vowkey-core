import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { LOCAL_STORES, LocalStoreName, LocalVaultStore, LocalWrite } from "../store";

interface RecordRow { id: string; value: string; }
interface AttachmentValue { cipherId: string; bytes: Blob; }
interface AttachmentPointer { cipherId: string; file: string; }

/** SQLite references commit only after encrypted file bytes and their directory are fsynced. */
export class NativeLocalVaultStore implements LocalVaultStore {
  private database: DatabaseSync | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}

  private async db(): Promise<DatabaseSync> {
    if (this.database != null) {
      return this.database;
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(join(this.directory, "local-vault.sqlite"));
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (store TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(store,id)); CREATE TABLE IF NOT EXISTS blob_intents (file TEXT PRIMARY KEY NOT NULL);");
    const referenced = new Set((database.prepare("SELECT value FROM records WHERE store='attachments'").all() as unknown as { value: string }[])
      .map((row) => (JSON.parse(row.value) as AttachmentPointer).file));
    for (const file of await readdir(this.directory)) {
      if (/^[0-9a-f-]{36}\.blob$/.test(file) && !referenced.has(file)) {
        await unlink(join(this.directory, file));
      }
    }
    database.exec("DELETE FROM blob_intents");
    this.database = database;
    return database;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch((): void => undefined);
    return result;
  }

  private async decode<T>(store: LocalStoreName, value: string): Promise<T> {
    const parsed = JSON.parse(value);
    if (store !== "attachments") {
      return parsed as T;
    }
    const pointer = parsed as AttachmentPointer;
    if (!/^[0-9a-f-]{36}\.blob$/.test(pointer.file)) {
      throw new Error("Invalid local attachment path.");
    }
    const bytes = await readFile(join(this.directory, pointer.file));
    return { cipherId: pointer.cipherId, bytes: new Blob([new Uint8Array(bytes).buffer]) } as T;
  }

  get<T>(store: LocalStoreName, id: string): Promise<T | undefined> {
    return this.enqueue(async () => {
      const row = (await this.db()).prepare("SELECT value FROM records WHERE store=? AND id=?").get(store, id) as { value: string } | undefined;
      return row == null ? undefined : this.decode<T>(store, row.value);
    });
  }

  list<T>(store: LocalStoreName): Promise<{ id: string; value: T }[]> {
    return this.enqueue(async () => {
      const rows = (await this.db()).prepare("SELECT id,value FROM records WHERE store=? ORDER BY id").all(store) as unknown as RecordRow[];
      return Promise.all(rows.map(async (row) => ({ id: row.id, value: await this.decode<T>(store, row.value) })));
    });
  }

  commit(writes: LocalWrite[]): Promise<void> {
    return this.enqueue(async () => {
      const database = await this.db();
      const prepared: LocalWrite[] = [];
      const staged: string[] = [];
      const obsolete: string[] = [];
      try {
        for (const write of writes) {
          if (!LOCAL_STORES.includes(write.store) || typeof write.id !== "string" || write.id.length === 0) {
            throw new Error("Invalid local vault record.");
          }
          if (write.store !== "attachments") {
            prepared.push(write);
            continue;
          }
          const old = database.prepare("SELECT value FROM records WHERE store='attachments' AND id=?").get(write.id) as { value: string } | undefined;
          if (old != null) {
            obsolete.push((JSON.parse(old.value) as AttachmentPointer).file);
          }
          if (write.value === undefined) {
            prepared.push(write);
            continue;
          }
          const value = write.value as AttachmentValue;
          if (!(value.bytes instanceof Blob) || typeof value.cipherId !== "string") {
            throw new Error("Invalid encrypted local attachment.");
          }
          const file = `${randomUUID()}.blob`;
          database.prepare("INSERT INTO blob_intents(file) VALUES(?)").run(file);
          staged.push(file);
          const handle = await open(join(this.directory, file), "wx", 0o600);
          try {
            await handle.writeFile(new Uint8Array(await value.bytes.arrayBuffer()));
            await handle.sync();
          } finally {
            await handle.close();
          }
          prepared.push({ ...write, value: { cipherId: value.cipherId, file } satisfies AttachmentPointer });
        }
        if (staged.length > 0) {
          const directory = await open(this.directory, "r");
          try { await directory.sync(); } finally { await directory.close(); }
        }
        database.exec("BEGIN IMMEDIATE");
        try {
          for (const write of prepared) {
            if (write.value === undefined) {
              database.prepare("DELETE FROM records WHERE store=? AND id=?").run(write.store, write.id);
            } else {
              database.prepare("INSERT INTO records(store,id,value) VALUES(?,?,?) ON CONFLICT(store,id) DO UPDATE SET value=excluded.value")
                .run(write.store, write.id, JSON.stringify(write.value));
            }
          }
          for (const file of staged) {
            database.prepare("DELETE FROM blob_intents WHERE file=?").run(file);
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      } catch (error) {
        for (const file of staged) {
          await unlink(join(this.directory, file)).catch((failure: NodeJS.ErrnoException) => {
            if (failure.code !== "ENOENT") { throw failure; }
          });
          database.prepare("DELETE FROM blob_intents WHERE file=?").run(file);
        }
        throw error;
      }
      // Committed references are authoritative. Interrupted cleanup is recovered at next open.
      for (const file of obsolete) {
        await unlink(join(this.directory, file)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") { throw error; }
        });
      }
    });
  }
}
