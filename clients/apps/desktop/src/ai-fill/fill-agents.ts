import { execFile } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

const run = promisify(execFile);

export type FillAgentId = "claude-code" | "codex" | "gemini";

export interface FillAgentInfo {
  id: FillAgentId;
  name: string;
  /** Where the command line was found, or null when it is not installed. */
  path: string | null;
}

export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentLaunch {
  agentId: FillAgentId;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: string;
}

const AGENTS: Array<{ id: FillAgentId; name: string; binary: string }> = [
  { id: "claude-code", name: "Claude Code", binary: "claude" },
  { id: "codex", name: "Codex", binary: "codex" },
  { id: "gemini", name: "Gemini CLI", binary: "gemini" },
];

let shellPath: Promise<string> | null = null;

/** The PATH of the person's login shell; apps opened from Finder start with a bare one. */
export function loginShellPath(): Promise<string> {
  shellPath ??= (async () => {
    const fallback = [
      path.join(os.homedir(), ".local", "bin"),
      path.join(os.homedir(), ".claude", "local"),
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), ".bun", "bin"),
      path.join(os.homedir(), ".volta", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];
    let fromShell = "";
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const { stdout } = await run(shell, ["-ilc", 'printf "__VK__%s__VK__" "$PATH"'], {
        timeout: 4_000,
      });
      fromShell = /__VK__(.*)__VK__/.exec(stdout)?.[1] ?? "";
    } catch {
      // Keep the well-known folders.
    }
    const parts = [...fromShell.split(":"), ...(process.env.PATH ?? "").split(":"), ...fallback];
    return [...new Set(parts.filter(Boolean))].join(":");
  })();
  return shellPath;
}

async function which(binary: string): Promise<string | null> {
  const dirs = (await loginShellPath()).split(":");
  for (const dir of dirs) {
    const candidate = path.join(dir, binary);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function detectFillAgents(): Promise<FillAgentInfo[]> {
  return Promise.all(
    AGENTS.map(async (agent) => ({ id: agent.id, name: agent.name, path: await which(agent.binary) })),
  );
}

const toml = (value: string) => JSON.stringify(value);

/** How to start each agent with Vowkey's MCP server and the prompt on stdin. */
export async function buildLaunch(
  agent: FillAgentInfo,
  prompt: string,
  mcp: McpLaunch,
  workdir: string,
): Promise<AgentLaunch> {
  if (!agent.path) {
    throw new Error(`${agent.name} is not installed.`);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: await loginShellPath() };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  switch (agent.id) {
    case "claude-code": {
      const config = path.join(workdir, "mcp.json");
      await fs.writeFile(
        config,
        JSON.stringify({ mcpServers: { vowkey: { type: "stdio", ...mcp } } }),
        { mode: 0o600 },
      );
      return {
        agentId: agent.id,
        command: agent.path,
        args: [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--mcp-config",
          config,
          "--strict-mcp-config",
          "--tools",
          "",
          "--allowedTools",
          "mcp__vowkey",
          "--no-session-persistence",
        ],
        cwd: workdir,
        env,
        stdin: prompt,
      };
    }
    case "codex": {
      const envToml = `{${Object.entries(mcp.env)
        .map(([k, v]) => `${k}=${toml(v)}`)
        .join(",")}}`;
      return {
        agentId: agent.id,
        command: agent.path,
        args: [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--json",
          "-s",
          "read-only",
          "-C",
          workdir,
          "-c",
          'approval_policy="never"',
          "-c",
          `mcp_servers.vowkey.command=${toml(mcp.command)}`,
          "-c",
          `mcp_servers.vowkey.args=[${mcp.args.map(toml).join(",")}]`,
          "-c",
          `mcp_servers.vowkey.env=${envToml}`,
          "-c",
          'mcp_servers.vowkey.default_tools_approval_mode="approve"',
          "-c",
          "mcp_servers.vowkey.tool_timeout_sec=120",
          "-",
        ],
        cwd: workdir,
        env,
        stdin: prompt,
      };
    }
    case "gemini": {
      await fs.mkdir(path.join(workdir, ".gemini"), { recursive: true });
      await fs.writeFile(
        path.join(workdir, ".gemini", "settings.json"),
        JSON.stringify({ mcpServers: { vowkey: { ...mcp, trust: true, timeout: 120_000 } } }),
        { mode: 0o600 },
      );
      return {
        agentId: agent.id,
        command: agent.path,
        args: [
          "--yolo",
          "--allowed-mcp-server-names",
          "vowkey",
          "-p",
          "Follow the instructions given on standard input.",
        ],
        cwd: workdir,
        env,
        stdin: prompt,
      };
    }
  }
}
