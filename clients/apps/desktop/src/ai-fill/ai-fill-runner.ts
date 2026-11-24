import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as net from "net";
import * as os from "os";
import * as path from "path";

import { buildLaunch, detectFillAgents, FillAgentId, FillAgentInfo } from "./fill-agents";
import { FillBridge, WindowScan } from "./fill-bridge";
import { buildFillPrompt } from "./fill-prompt";
import { FILL_TOOLS, FillOutcome, FillProgress, FillToolSession, VaultDetail } from "./fill-tools";

export interface AiFillRequest {
  pid: number;
  appName: string;
  windowTitle?: string;
  url?: string;
  locale: string;
  vault: VaultDetail[];
  withheld?: string[];
  agentId?: FillAgentId | null;
  onProgress?: (progress: FillProgress & { agent: string }) => void;
}

export interface AiFillResult extends FillOutcome {
  agent: string;
  toolCalls: number;
  seconds: number;
}

const RUN_LIMIT_MS = 8 * 60_000;

/**
 * Runs one AI fill: hands the window, the person's details and Vowkey's tools to the chosen agent
 * (Claude Code, Codex or Gemini CLI) and carries out what it asks for. Codex runs in Terminal on macOS.
 */
export class AiFillRunner {
  readonly bridge: FillBridge;
  private active: { cancel: () => void } | null = null;

  constructor(userDataPath: string) {
    this.bridge = new FillBridge(userDataPath);
  }

  get running(): boolean {
    return this.active != null;
  }

  cancel(): void {
    this.active?.cancel();
  }

  detect(): Promise<FillAgentInfo[]> {
    return detectFillAgents();
  }

  /** The chosen agent when it is installed, otherwise the first installed one. */
  async pickAgent(agentId?: FillAgentId | null): Promise<FillAgentInfo | null> {
    const agents = await this.detect();
    return (
      agents.find((a) => a.id === agentId && a.path) ?? agents.find((a) => a.path != null) ?? null
    );
  }

  async run(request: AiFillRequest): Promise<AiFillResult> {
    if (this.active) {
      throw new Error("A fill is already running.");
    }
    const started = Date.now();
    const agent = await this.pickAgent(request.agentId);
    if (!agent) {
      throw new Error(
        "No AI agent found. Install Claude Code, Codex or Gemini CLI, then choose it in Settings › AI agents.",
      );
    }
    const progress = (p: FillProgress) => request.onProgress?.({ ...p, agent: agent.name });
    progress({ step: "starting" });

    let scan: WindowScan | null = null;
    let scanError: string | undefined;
    try {
      scan = await this.bridge.scan(request.pid);
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error);
    }

    // mkdtemp makes the folder 0700, so only this user reaches the socket inside it.
    const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-fill-"));
    const socketPath = path.join(workdir, "s");
    const session = new FillToolSession(this.bridge, request.pid, request.vault, progress);
    const server = await this.serve(socketPath, session);

    try {
      const prompt = buildFillPrompt({
        appName: request.appName || scan?.appName || "the app in front",
        windowTitle: request.windowTitle || scan?.windowTitle,
        url: request.url,
        locale: request.locale,
        today: new Date().toISOString().slice(0, 10),
        vault: request.vault,
        withheld: request.withheld,
        scan,
        scanError,
      });
      const launch = await buildLaunch(
        agent,
        prompt,
        // The agent's MCP stdio is piped straight into this run's socket; Vowkey speaks MCP there.
        { command: "/usr/bin/nc", args: ["-U", socketPath], env: {} },
        workdir,
      );
      progress({ step: "thinking" });
      const exit = await this.spawnAgent(launch, () => session.outcome != null);
      const seconds = Math.round((Date.now() - started) / 1000);
      if (session.outcome) {
        return { ...session.outcome, agent: agent.name, toolCalls: session.calls, seconds };
      }
      if (exit.cancelled) {
        return {
          status: "failed",
          summary: "Stopped.",
          filled: 0,
          skipped: [],
          agent: agent.name,
          toolCalls: session.calls,
          seconds,
        };
      }
      return {
        status: session.calls > 1 ? "partial" : "failed",
        summary:
          exit.message ||
          (session.calls > 1
            ? `${agent.name} stopped without reporting back. Check the window.`
            : `${agent.name} did not start filling.`),
        filled: 0,
        skipped: [],
        agent: agent.name,
        toolCalls: session.calls,
        seconds,
      };
    } finally {
      server.close();
      await fs.rm(workdir, { recursive: true, force: true }).catch((): void => undefined);
    }
  }

  /** A minimal MCP server (JSON-RPC over newline-delimited JSON) for the agent's connection. */
  private serve(socketPath: string, session: FillToolSession): Promise<net.Server> {
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let i: number;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (!line) continue;
          void this.answer(line, session).then((reply) => {
            if (reply && !socket.destroyed) socket.write(JSON.stringify(reply) + "\n");
          });
        }
      });
      socket.on("error", (): void => undefined);
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        void fs.chmod(socketPath, 0o600).catch((): void => undefined);
        resolve(server);
      });
    });
  }

  private async answer(line: string, session: FillToolSession): Promise<unknown> {
    let req: { id?: number | string | null; method?: string; params?: Record<string, any> };
    try {
      req = JSON.parse(line);
    } catch {
      return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    const { id, method, params } = req;
    if (id === undefined || id === null) {
      return null;
    }
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    switch (method) {
      case "initialize":
        return ok({
          protocolVersion: params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "vowkey", version: "1.0.0" },
          instructions: "Vowkey's tools to read and fill the window the person asked to fill.",
        });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: FILL_TOOLS });
      case "tools/call":
        return ok(await session.call(String(params?.name ?? ""), params?.arguments ?? {}));
      case "resources/list":
        return ok({ resources: [] });
      case "prompts/list":
        return ok({ prompts: [] });
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
    }
  }

  private spawnAgent(
    launch: Awaited<ReturnType<typeof buildLaunch>>,
    finished: () => boolean,
  ): Promise<{ code: number | null; cancelled: boolean; message?: string }> {
    if (process.platform === "darwin" && launch.agentId === "codex") {
      return this.spawnCodexInTerminal(launch, finished);
    }
    return new Promise((resolve) => {
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      let cancelled = false;
      let stderrTail = "";
      let lastText = "";
      let lineBuffer = "";
      const kill = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            // Already gone.
          }
        }, 1500);
      };
      const limit = setTimeout(() => {
        lastText = "The agent took longer than 8 minutes and was stopped.";
        kill();
      }, RUN_LIMIT_MS);
      // Once finish arrives the agent has nothing left to do; do not wait for its wrap-up.
      const watcher = setInterval(() => {
        if (finished()) {
          clearInterval(watcher);
          setTimeout(kill, 1500);
        }
      }, 250);
      this.active = {
        cancel: () => {
          cancelled = true;
          kill();
        },
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        lineBuffer += chunk;
        let i: number;
        while ((i = lineBuffer.indexOf("\n")) >= 0) {
          const line = lineBuffer.slice(0, i).trim();
          lineBuffer = lineBuffer.slice(i + 1);
          const said = agentText(line);
          if (said) lastText = said;
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-2000);
      });
      child.on("error", (error) => {
        lastText = error.message;
      });
      child.on("close", (code) => {
        clearTimeout(limit);
        clearInterval(watcher);
        this.active = null;
        const message = finished()
          ? undefined
          : (lastText || stderrTail.trim().split("\n").slice(-3).join(" ")).slice(0, 400) || undefined;
        resolve({ code, cancelled, message });
      });
      child.stdin.on("error", (): void => undefined);
      child.stdin.end(launch.stdin);
    });
  }

  /** Shows Codex's live MCP/tool activity in Terminal while Vowkey keeps the fill session. */
  private async spawnCodexInTerminal(
    launch: Awaited<ReturnType<typeof buildLaunch>>,
    finished: () => boolean,
  ): Promise<{ code: number | null; cancelled: boolean; message?: string }> {
    const promptPath = path.join(launch.cwd, "prompt.txt");
    const outputPath = path.join(launch.cwd, "codex.ndjson");
    const statusPath = path.join(launch.cwd, "exit-code");
    const pidPath = path.join(launch.cwd, "agent-pid");
    const commandPath = path.join(launch.cwd, "codex-fill.command");
    const command = [launch.command, ...launch.args].map(shellQuote).join(" ");
    const env = Object.entries(launch.env)
      .filter(([key, value]) => value != null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, value]) => `export ${key}=${shellQuote(value as string)}`)
      .join("\n");
    const script = [
      "#!/bin/zsh",
      "umask 077",
      "set +x",
      env,
      `cd ${shellQuote(launch.cwd)} || exit 1`,
      `${command} < ${shellQuote(promptPath)} > >(tee ${shellQuote(outputPath)}) 2> >(tee -a ${shellQuote(outputPath)} >&2) &`,
      "agent_pid=$!",
      `print -r -- \"$agent_pid\" > ${shellQuote(pidPath)}`,
      "wait \"$agent_pid\"",
      "agent_status=$?",
      `print -r -- \"$agent_status\" > ${shellQuote(statusPath)}`,
      "print -r -- ''",
      "print -r -- 'Codex finished this Vowkey fill. Close this Terminal tab when ready.'",
      "read -k 1 -s \"_vk_done?\" 2>/dev/null",
      "exit \"$agent_status\"",
      "",
    ].join("\n");
    await fs.writeFile(promptPath, launch.stdin, { mode: 0o600 });
    await fs.writeFile(commandPath, script, { mode: 0o700 });

    return new Promise((resolve) => {
      let cancelled = false;
      let lastText = "";
      let readLength = 0;
      let carry = "";
      let checking = false;
      let stopAttempts = 0;
      let stopping = false;
      const stop = () => {
        void fs
          .readFile(pidPath, "utf8")
          .then((value) => Number.parseInt(value, 10))
          .then((pid) => {
            if (!Number.isInteger(pid) || pid <= 0) {
              if (stopAttempts++ < 10) setTimeout(stop, 250);
              return;
            }
            try {
              process.kill(-pid, "SIGTERM");
            } catch {
              try {
                process.kill(pid, "SIGTERM");
              } catch {
                // The terminal session already exited.
              }
            }
            setTimeout(() => {
              try {
                process.kill(-pid, "SIGKILL");
              } catch {
                // Already gone.
              }
            }, 1500);
          })
          .catch((): void => undefined);
      };
      let settled = false;
      const finish = (result: { code: number | null; cancelled: boolean; message?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(limit);
        clearInterval(watcher);
        clearInterval(poll);
        this.active = null;
        resolve(result);
      };
      const poll = setInterval(() => {
        if (checking || settled) return;
        checking = true;
        void (async () => {
          try {
            const output = await fs.readFile(outputPath, "utf8").catch(() => "");
            const added = output.slice(readLength);
            readLength = output.length;
            carry += added;
            let index: number;
            while ((index = carry.indexOf("\n")) >= 0) {
              const line = carry.slice(0, index).trim();
              carry = carry.slice(index + 1);
              lastText = agentText(line) ?? lastText;
            }
            const status = await fs.readFile(statusPath, "utf8").catch(() => "");
            if (status.trim() !== "") {
              spawn("open", ["-a", "Terminal"], { stdio: "ignore" });
              finish({
                code: Number.parseInt(status.trim(), 10),
                cancelled,
                message: finished() ? undefined : lastText || undefined,
              });
            }
          } finally {
            checking = false;
          }
        })();
      }, 250);
      const limit = setTimeout(() => {
        lastText = "The agent took longer than 8 minutes and was stopped.";
        stop();
        setTimeout(() => finish({ code: null, cancelled: true, message: lastText }), 2_000);
      }, RUN_LIMIT_MS);
      const watcher = setInterval(() => {
        if (finished() && !stopping) {
          stopping = true;
          clearInterval(watcher);
          setTimeout(stop, 1500);
        }
      }, 250);
      this.active = {
        cancel: () => {
          cancelled = true;
          stop();
        },
      };

      const opener = spawn("open", [commandPath], {
        cwd: launch.cwd,
        env: launch.env,
        stdio: "ignore",
      });
      opener.once("error", (error) => finish({ code: null, cancelled: false, message: error.message }));
      opener.once("close", (code) => {
        if (code !== 0) finish({ code, cancelled: false, message: "Couldn't open the Codex Terminal session." });
      });
    });
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The agent's last words in its JSON event stream, for a useful message when it stops early. */
function agentText(line: string): string | null {
  if (!line.startsWith("{")) return null;
  try {
    const event = JSON.parse(line);
    if (event.type === "result" && typeof event.result === "string") {
      return event.is_error ? event.result : null;
    }
    if (event.type === "assistant") {
      const parts = (event.message?.content ?? []) as Array<{ type: string; text?: string }>;
      const t = parts.filter((p) => p.type === "text").map((p) => p.text).join(" ").trim();
      return t || null;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return event.item.text ?? null;
    }
    if (event.type === "error" || event.type === "turn.failed") {
      return event.message ?? event.error?.message ?? null;
    }
  } catch {
    return null;
  }
  return null;
}
