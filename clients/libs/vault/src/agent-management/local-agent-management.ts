import { SafeInjectionToken } from "@vowkey/ui-common";
import { AgentExecutor, AgentSnapshot, AnswerKind } from "@vowkey/common/vault/agent/executor";

export interface LocalAgentState {
  pairs: ReturnType<AgentExecutor["waitingPairs"]>;
  requests: ReturnType<AgentExecutor["pendingForPerson"]>;
  pairings: ReturnType<AgentExecutor["publicPairings"]>;
  activity: AgentSnapshot["activity"];
}

/** The person's client controls its elected executor; this is not an external-agent channel. */
export interface LocalAgentManagement {
  pending(): Promise<LocalAgentState>;
  approve(connectionId: string): Promise<void>;
  answer(requestId: string, answer: AnswerKind, selectedEntryIds: string[]): Promise<void>;
  revoke(pairingId: string): Promise<void>;
}

export const LOCAL_AGENT_MANAGEMENT = new SafeInjectionToken<LocalAgentManagement>("Local agent management");
