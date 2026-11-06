import { SafeInjectionToken } from "@vowkey/ui-common";

export type AiFillAgentId = "claude-code" | "codex" | "gemini";

export interface AiFillAgent {
  id: AiFillAgentId;
  name: string;
  /** Where the command line was found, or null when it is not installed. */
  path: string | null;
}

/**
 * The AI agents a desktop app can start to fill the window in front (AI mode), and which one it
 * uses. Only the desktop app provides it.
 */
export interface AiFillAgents {
  list(): Promise<AiFillAgent[]>;
  selected(): Promise<AiFillAgentId | null>;
  select(id: AiFillAgentId): Promise<void>;
}

export const AI_FILL_AGENTS = new SafeInjectionToken<AiFillAgents>("AI fill agents");
