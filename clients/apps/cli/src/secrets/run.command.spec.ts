import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Writable } from "stream";

import { Response } from "../models/response";

import { ReferenceError } from "@vowkey/common/vault/reference"
import { RunCommand, RunDependencies } from "./run.command";

const SECRET = "sk-live-0123456789";

function sink() {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString() };
}

function build(overrides: Partial<RunDependencies> = {}) {
  const out = sink();
  const err = sink();
  const deps: RunDependencies = {
    resolve: async ({ itemId, fieldPath }) => {
      if (itemId === "k1" && fieldPath === "key.value") {
        return SECRET;
      }
      throw new ReferenceError("not-found", "not-found");
    },
    environmentMembers: async (id) => {
      if (id === "env1") {
        return [{ name: "FROM_ENV", itemId: "k1" }];
      }
      throw new ReferenceError("not-found", "not-found");
    },
    parentEnv: {
      PATH: process.env.PATH,
      VOWKEY_SESSION: "must-not-reach-the-child",
      VOWKEY_PASSWORD: "nor-this",
    },
    stdout: out.stream,
    stderr: err.stream,
    // A signal source of our own, so a test never receives a real signal.
    signalSource: new EventEmitter() as unknown as NodeJS.Process,
    ...overrides,
  };
  return { command: new RunCommand(deps), out, err };
}

const node = process.execPath;
const print = (expr: string) => [node, "-e", `process.stdout.write(String(${expr}))`];

describe("RunCommand", () => {
  it("does not spawn without a command", async () => {
    const { command } = build();
    const result = await command.run([], {});
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).success).toBe(false);
  });

  it("gives the child the value and none of the vault's own credentials", async () => {
    const { command, out } = build();
    const result = await command.run(
      [
        node,
        "-e",
        "process.stdout.write(JSON.stringify([process.env.VOWKEY_SESSION,process.env.VOWKEY_PASSWORD,process.env.FROM_ENV&&process.env.FROM_ENV.length]))",
      ],
      { environment: ["env1"] },
    );
    expect(result).toEqual({ exitCode: 0 });
    expect(JSON.parse(out.text())).toEqual([null, null, SECRET.length]);
  });

  it("conceals a resolved secret the child prints, across stdout and stderr", async () => {
    const { command, out, err } = build();
    const result = await command.run(
      [
        node,
        "-e",
        "process.stdout.write('key='+process.env.FROM_ENV+'\\n');process.stderr.write(process.env.FROM_ENV)",
      ],
      { environment: ["env1"] },
    );
    expect(result).toEqual({ exitCode: 0 });
    expect(out.text()).toBe("key=<concealed by Vowkey>\n");
    expect(err.text()).toBe("<concealed by Vowkey>");
  });

  it("does not conceal a file the child writes itself", async () => {
    const { command, out } = build();
    const file = path.join(os.tmpdir(), `vowkey-run-${process.pid}.txt`);
    const result = await command.run(
      [node, "-e", `require('fs').writeFileSync(${JSON.stringify(file)}, process.env.FROM_ENV)`],
      { environment: ["env1"] },
    );
    expect(result).toEqual({ exitCode: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe(SECRET);
    expect(out.text()).toBe("");
    fs.unlinkSync(file);
  });

  it("returns the child's exit code", async () => {
    const { command } = build();
    expect(await command.run([node, "-e", "process.exit(7)"], {})).toEqual({ exitCode: 7 });
  });

  it("reports death by signal as 128 plus the signal number", async () => {
    const { command } = build();
    const result = await command.run([node, "-e", "process.kill(process.pid,'SIGTERM')"], {});
    expect(result).toEqual({ exitCode: 128 + 15 });
  });

  it("exits 127 when the command does not exist", async () => {
    const { command, err } = build();
    expect(await command.run(["/no/such/command-vowkey"], {})).toEqual({ exitCode: 127 });
    expect(err.text()).toContain("command not found");
  });

  it("refuses before spawning when a reference does not resolve", async () => {
    const { command, out } = build({
      environmentMembers: async () => [{ name: "BROKEN", itemId: "gone" }],
    });
    const result = (await command.run(print("'ran'"), { environment: ["x"] })) as Response;
    expect(result).toBeInstanceOf(Response);
    expect(result.success).toBe(false);
    expect((result as { message?: string }).message).toContain("BROKEN: @vk:gone/key.value");
    expect(out.text()).toBe("");
  });

  it("refuses when an env file is missing or malformed", async () => {
    const { command } = build();
    const missing = (await command.run(print("1"), { envFile: ["/no/such/.env"] })) as Response;
    expect(missing.success).toBe(false);
  });

  it("forwards a signal to the child and waits for it", async () => {
    const source = new EventEmitter();
    const { command, out } = build({ signalSource: source as unknown as NodeJS.Process });
    const running = command.run(
      [
        node,
        "-e",
        "process.on('SIGTERM',()=>{process.stdout.write('got term');process.exit(3)});process.stdout.write('ready');setInterval(()=>{},1000)",
      ],
      {},
    );
    // Wait until the child reports ready.
    for (let i = 0; i < 100 && !out.text().includes("ready"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    source.emit("SIGTERM");
    expect(await running).toEqual({ exitCode: 3 });
    expect(out.text()).toContain("got term");
  });
});
