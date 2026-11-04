import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { buildLaunch } from "./fill-agents";
import type { FillBridge } from "./fill-bridge";
import { compactScan, FillToolSession } from "./fill-tools";

const mcp = { command: "/usr/bin/nc", args: ["-U", "/tmp/vk/s"], env: {} };

describe("buildLaunch", () => {
  let workdir: string;
  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-fill-spec-"));
  });
  afterEach(() => fs.rm(workdir, { recursive: true, force: true }));

  it("starts Claude Code headless with only Vowkey's MCP tools and the prompt on stdin", async () => {
    const launch = await buildLaunch(
      { id: "claude-code", name: "Claude Code", path: "/bin/claude" },
      "PROMPT",
      mcp,
      workdir,
    );
    expect(launch.command).toBe("/bin/claude");
    expect(launch.args).toEqual(
      expect.arrayContaining(["-p", "--strict-mcp-config", "--allowedTools", "mcp__vowkey"]),
    );
    expect(launch.args[launch.args.indexOf("--tools") + 1]).toBe("");
    expect(launch.stdin).toBe("PROMPT");
    const config = JSON.parse(await fs.readFile(path.join(workdir, "mcp.json"), "utf8"));
    expect(config.mcpServers.vowkey).toEqual({ type: "stdio", ...mcp });
  });

  it("passes the MCP server to Codex as config overrides", async () => {
    const launch = await buildLaunch(
      { id: "codex", name: "Codex", path: "/bin/codex" },
      "PROMPT",
      mcp,
      workdir,
    );
    expect(launch.args.slice(0, 1)).toEqual(["exec"]);
    expect(launch.args).toContain('mcp_servers.vowkey.command="/usr/bin/nc"');
    expect(launch.args).toContain('mcp_servers.vowkey.args=["-U","/tmp/vk/s"]');
    expect(launch.args[launch.args.length - 1]).toBe("-");
  });

  it("refuses an agent that is not installed", async () => {
    await expect(
      buildLaunch({ id: "gemini", name: "Gemini CLI", path: null }, "P", mcp, workdir),
    ).rejects.toThrow("Gemini CLI is not installed.");
  });
});

describe("FillToolSession", () => {
  const bridge = {
    act: jest.fn(async (_pid: number, ops: Array<{ op: string }>) => ops.map((o) => ({ op: o.op, ok: true }))),
    screenshot: jest.fn(async () => ({
      png: Buffer.from("png"),
      width: 800,
      height: 600,
      origin: { x: 100, y: 50 },
      scale: 2,
    })),
  } as unknown as FillBridge;
  const session = () =>
    new FillToolSession(
      bridge,
      42,
      [
        { kind: "detail", label: "Passport number", value: "TR1234567" },
        { kind: "login", label: "Shop", value: "", username: "me", password: "pw", uris: ["shop.example"] },
      ],
      () => undefined,
    );

  it("asks for a screenshot before clicking by image coordinates", async () => {
    const result = await session().call("click", { x: 10, y: 10 });
    expect(result.isError).toBe(true);
  });

  it("maps screenshot pixels to screen points", async () => {
    const s = session();
    await s.call("screenshot", {});
    await s.call("click", { x: 10, y: 20 });
    expect(bridge.act).toHaveBeenLastCalledWith(42, [{ op: "click", x: 120, y: 90, count: 1 }]);
  });

  it("finds saved details by label or site", async () => {
    const result = await session().call("search_vault", { query: "shop.example" });
    expect(result.content[0].text).toContain('"password":"pw"');
  });

  it("records the agent's report on finish", async () => {
    const s = session();
    await s.call("finish", { status: "partial", summary: "Two left", filled: 3, skipped: [] });
    expect(s.outcome).toEqual({ status: "partial", summary: "Two left", filled: 3, skipped: [] });
  });
});

describe("compactScan", () => {
  it("drops empty keys, the AX prefix and the secure value", () => {
    const out = compactScan({
      pid: 1,
      appName: "App",
      truncated: false,
      elements: [
        { id: "w.0", role: "AXTextField", subrole: "AXSecureTextField", secure: true, label: "Password" },
        { id: "w.1", role: "AXPopUpButton", label: "Country", options: ["Japan"], frame: { x: 1.4, y: 2.6, w: 3, h: 4 } },
      ],
    }) as { elements: Array<Record<string, unknown>> };
    expect(out.elements[0]).toEqual({ id: "w.0", role: "TextField", label: "Password", secure: true });
    expect(out.elements[1]).toEqual({ id: "w.1", role: "PopUpButton", label: "Country", options: ["Japan"], frame: [1, 3, 3, 4] });
  });
});
