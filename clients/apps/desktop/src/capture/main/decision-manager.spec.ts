import { createHash } from "crypto";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as http from "http";
import * as os from "os";
import * as path from "path";

import { DecisionModelManager } from "./decision-manager";
import {
  DECISION_MODEL_CATALOG,
  findCachedCatalogModel,
  hasVerifiedReceiptSync,
  validateGgufFile,
  writeVerificationReceipt,
} from "./decision-models";
import { streamVerifiedDownload } from "./decision-runtime";

jest.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  dialog: {
    showOpenDialog: jest.fn(),
  },
}));

function validGgufBuffer(extraPayload = "model-weights-tensor-metadata"): Buffer {
  const header = Buffer.alloc(96);
  header.write("GGUF", 0, "ascii");
  header.writeUInt32LE(3, 4);
  return Buffer.concat([header, Buffer.from(extraPayload, "utf8")]);
}

describe("Decision models catalog, downloader, and runtime supervisor", () => {
  let tempDir: string;
  const originalLlamaServer = process.env.VOWKEY_LLAMA_SERVER;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-decision-mgr-"));
  });

  afterEach(async () => {
    if (originalLlamaServer === undefined) {
      delete process.env.VOWKEY_LLAMA_SERVER;
    } else {
      process.env.VOWKEY_LLAMA_SERVER = originalLlamaServer;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("pins every catalog model to an immutable revision, 64-hex SHA-256, and permissive license", () => {
    expect(DECISION_MODEL_CATALOG.length).toBeGreaterThanOrEqual(10);
    const ids = new Set<string>();
    const roles = new Map<string, string>();
    for (const spec of DECISION_MODEL_CATALOG) {
      expect(ids.has(spec.id)).toBe(false);
      ids.add(spec.id);
      expect(spec.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(spec.bytes).toBeGreaterThan(100_000_000);
      expect(spec.memoryBytes).toBeGreaterThanOrEqual(spec.bytes);
      expect(["apache-2.0", "mit"]).toContain(spec.license);
      if (spec.role) {
        roles.set(spec.role, spec.id);
      }
    }
    expect(roles.get("recommended")).toBe("vllm-d3-mini");
    expect(roles.get("most_accurate")).toBe("elephant-1");
    expect(roles.get("fastest")).toBe("vllm-d3-edge");
  });

  it("streams verified downloads atomically, rejects tampered digests, and cleans .part on cancel", async () => {
    const payload = Buffer.alloc(64 * 1024, 0x5a);
    const expectedSha = createHash("sha256").update(payload).digest("hex");
    let slowStream = false;

    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(payload.length),
      });
      if (!slowStream) {
        res.write(payload.subarray(0, 32 * 1024));
        res.end(payload.subarray(32 * 1024));
        return;
      }
      res.write(payload.subarray(0, 8 * 1024));
      const timer = setTimeout(() => {
        res.end(payload.subarray(8 * 1024));
      }, 5_000);
      res.on("close", () => clearTimeout(timer));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/model.gguf`;

    try {
      const destOk = path.join(tempDir, "ok", "model.gguf");
      const seenProgress: number[] = [];
      await streamVerifiedDownload({
        url,
        destinationPath: destOk,
        expectedBytes: payload.length,
        expectedSha256: expectedSha,
        onProgress: (done) => seenProgress.push(done),
      });
      expect(existsSync(destOk)).toBe(true);
      expect(existsSync(`${destOk}.part`)).toBe(false);
      expect(seenProgress[seenProgress.length - 1]).toBe(payload.length);

      await writeVerificationReceipt(destOk, expectedSha);
      expect(hasVerifiedReceiptSync(destOk, payload.length, expectedSha)).toBe(true);
      await fs.appendFile(destOk, Buffer.from([1]));
      expect(hasVerifiedReceiptSync(destOk, payload.length, expectedSha)).toBe(false);

      const destTampered = path.join(tempDir, "bad", "model.gguf");
      await expect(
        streamVerifiedDownload({
          url,
          destinationPath: destTampered,
          expectedBytes: payload.length,
          expectedSha256: "0".repeat(64),
        }),
      ).rejects.toThrow(/SHA-256|verification/i);
      expect(existsSync(destTampered)).toBe(false);
      expect(existsSync(`${destTampered}.part`)).toBe(false);

      slowStream = true;
      const destCancelled = path.join(tempDir, "cancel", "model.gguf");
      const ac = new AbortController();
      const promise = streamVerifiedDownload({
        url,
        destinationPath: destCancelled,
        expectedBytes: payload.length,
        expectedSha256: expectedSha,
        signal: ac.signal,
        onProgress: (done) => {
          if (done > 0) {
            ac.abort();
          }
        },
      });
      await expect(promise).rejects.toThrow();
      expect(existsSync(destCancelled)).toBe(false);
      expect(existsSync(`${destCancelled}.part`)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("discovers matching Hugging Face Hub cached snapshots without copying gigabytes", async () => {
    const julia = DECISION_MODEL_CATALOG.find((m) => m.id === "julia-1")!;
    const cacheRoot = path.join(tempDir, "hf-hub");
    const repoDir = path.join(cacheRoot, `models--${julia.repository.replace(/\//g, "--")}`);
    const snapDir = path.join(repoDir, "snapshots", julia.revision);
    await fs.mkdir(snapDir, { recursive: true });
    const snapFile = path.join(snapDir, julia.filename);
    const handle = await fs.open(snapFile, "w");
    await handle.truncate(julia.bytes);
    await handle.close();

    expect(findCachedCatalogModel(julia, [cacheRoot])).toBe(snapFile);
  });

  it("validates custom GGUF files, supervises the local server, stops it when deactivated, and forgets custom files non-destructively", async () => {
    const fakeServerScript = path.join(tempDir, "fake-llama-server.mjs");
    await fs.writeFile(
      fakeServerScript,
      [
        'import http from "node:http";',
        "const args = process.argv.slice(2);",
        'const portIdx = args.indexOf("--port");',
        "const port = Number(args[portIdx + 1]);",
        "const server = http.createServer((req, res) => {",
        '  if (req.url === "/health") {',
        '    res.writeHead(200, { "Content-Type": "application/json" });',
        '    res.end(JSON.stringify({ status: "ok" }));',
        "    return;",
        "  }",
        "  res.writeHead(404); res.end();",
        "});",
        'server.listen(port, "127.0.0.1");',
        'process.on("SIGTERM", () => server.close(() => process.exit(0)));',
      ].join("\n"),
      "utf8",
    );
    const wrapperSh = path.join(tempDir, "fake-llama-server.sh");
    await fs.writeFile(
      wrapperSh,
      `#!/bin/sh\nexec "${process.execPath}" "${fakeServerScript}" "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    process.env.VOWKEY_LLAMA_SERVER = wrapperSh;

    const badFile = path.join(tempDir, "not-a-model.gguf");
    await fs.writeFile(badFile, "plain text", "utf8");
    await expect(validateGgufFile(badFile)).rejects.toThrow(/GGUF/i);

    const customGguf = path.join(tempDir, "My-Custom-Decision.gguf");
    await fs.writeFile(customGguf, validGgufBuffer("weights-payload"));

    const userDataDir = path.join(tempDir, "userdata");
    const manager = new DecisionModelManager(
      () => userDataDir,
      () => [],
    );
    try {
      const imported = await manager.importModelFile(customGguf);
      expect(imported.customModels.length).toBe(1);
      const customId = imported.customModels[0].id;
      expect(customId.startsWith("custom-")).toBe(true);
      expect(imported.activeModelId).toBe(customId);
      expect(imported.serverReady).toBe(true);

      const endpoint = await manager.activeEndpoint();
      expect(endpoint?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1\/systemone$/);
      const baseOrigin = endpoint!.url.replace(/\/v1\/systemone$/, "");
      const statusBefore = await new Promise<number>((resolve, reject) => {
        http
          .get(`${baseOrigin}/health`, (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          })
          .on("error", reject);
      });
      expect(statusBefore).toBe(200);

      const deactivated = await manager.setLocalActive(false);
      expect(deactivated.activeModelId).toBeNull();
      expect(deactivated.serverReady).toBe(false);
      await expect(
        new Promise<number>((resolve, reject) => {
          http
            .get(`${baseOrigin}/health`, (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            })
            .on("error", reject);
        }),
      ).rejects.toThrow();

      const afterForget = await manager.deleteModel(customId);
      expect(afterForget.customModels).toEqual([]);
      expect(existsSync(customGguf)).toBe(true);
    } finally {
      await manager.dispose();
    }
  });
});
