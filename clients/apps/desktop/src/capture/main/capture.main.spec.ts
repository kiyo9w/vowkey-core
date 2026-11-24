import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

import { CaptureMain } from "./capture.main";

jest.mock("child_process", () => ({ execFile: jest.fn(), spawn: jest.fn() }));
jest.mock("electron", () => ({ app: {}, ipcMain: {}, shell: {} }));
jest.mock("./decision-manager", () => ({
  DecisionModelManager: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
}));

function helperProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    exitCode: null,
    killed: false,
    unref: jest.fn(),
    kill: jest.fn(() => true),
  });
  return child;
}

describe("CaptureMain OCR helper lifecycle", () => {
  it("keeps a replacement helper's requests alive when the previous process closes late", async () => {
    const first = helperProcess();
    const replacement = helperProcess();
    (spawn as jest.Mock).mockReturnValueOnce(first).mockReturnValueOnce(replacement);
    const capture = new CaptureMain();
    const firstRequest = capture["callServeHelper"]("vowkey-read", { cmd: "ping" });
    const rejectedFirst = expect(firstRequest).rejects.toThrow("helper exited");
    first.emit("error", new Error("helper exited"));
    await rejectedFirst;

    const next = capture["callServeHelper"]("vowkey-read", { cmd: "ping" });
    const successfulNext = expect(next).resolves.toBe("pong");
    first.emit("close", 1);
    replacement.stdout!.emit("data", JSON.stringify({ id: 2, ok: true, result: "pong" }) + "\n");
    await successfulNext;
    await capture.dispose();
  });
});
