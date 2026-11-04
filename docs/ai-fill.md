# AI fill

AI mode hands the window in front to an AI agent the person already uses. The agent reads the form, fills it with the person's saved details and checks the result, in any app: web pages, native forms, Word, Excel, PowerPoint, PDF viewers and custom-drawn UI. Without AI mode, Fill stays the instant fill.

## Where it lives

| Piece | File |
| --- | --- |
| Quick Bar switch beside Fill, progress line and Stop | `clients/apps/desktop/src/quick-bar/pill/` |
| Run orchestration and the MCP server the agent talks to | `clients/apps/desktop/src/ai-fill/ai-fill-runner.ts` |
| Agent detection and headless launch (Claude Code, Codex, Gemini CLI) | `clients/apps/desktop/src/ai-fill/fill-agents.ts` |
| Tools the agent gets | `clients/apps/desktop/src/ai-fill/fill-tools.ts` |
| Instructions the agent gets | `clients/apps/desktop/src/ai-fill/fill-prompt.ts` |
| Window reading and input (Accessibility, CoreGraphics events, `screencapture`) | `clients/apps/desktop/src/ai-fill/fill-bridge*.ts` |
| Agent choice in AI agents › Agents | `clients/libs/vault/src/agent-management/` |
| Extension switch beside Fill this page | `clients/apps/browser/src/vault/popup/components/vault/vault-header/` |

## How a run works

1. Fill (or `⌘\`) with AI mode on reads the window through Accessibility and collects the person's details, logins and cards from the unlocked vault.
2. Vowkey opens a Unix socket in a fresh 0700 temp folder and starts the agent headless (`claude -p`, `codex exec`, `gemini -p`) with one MCP server, `/usr/bin/nc -U <socket>`, so the agent's MCP traffic reaches Vowkey directly. Vowkey speaks MCP on that socket; every window action runs inside Vowkey's own Accessibility and Screen Recording grants.
3. The prompt carries the target, the saved details with their values and the first window scan. The agent fills every field it can in one `fill_fields` call, checks with a screenshot, and switches to `screenshot` + `screen_steps` (clicks, typing, keys) when the app exposes no fields.
4. The agent calls `finish` with what it filled and what it left empty; Vowkey stops the agent and shows the result in the Quick Bar.

The agent gets the values it needs; the instructions put correctness first. It never presses Submit, Send, Pay or anything that sends, books, pays or deletes.

## Agent choice

AI agents › Agents lists the agents installed on the Mac, found on the login shell's `PATH` and the usual install folders. The chosen one is stored in the shell preferences (`aiAgent`); without a choice, the first installed agent is used. AI mode itself is `aiMode` in the same preferences.

## Extension

The extension's AI switch sits beside Fill this page. With it on, Fill this page runs the instant fill, then opens `vowkey://ai-fill`; the desktop app runs the same AI fill on the browser tab in front. Chrome asks once whether the extension may open Vowkey.

## Not built yet

- Vowkey's own agent for people without Claude Code, Codex or Gemini CLI.
- Windows and Linux.
