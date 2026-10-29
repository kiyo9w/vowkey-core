import type { AgentAccountCoordinator } from "./account-records";
import type { ResolveReference } from "./executor";
import type { OwnerSecretsQuery, OwnerSecretsResult } from "./owner-secrets";
import { AgentTargetAdapter } from "./targets";

export interface AgentRecordProtector {
  seal(plain: string): Promise<string>;
  open(ciphertext: string): Promise<string>;
}

/** Supplied by the client holding the unlocked vault, never by an MCP caller. */
export interface AgentVaultAuthority extends AgentRecordProtector {
  scopeIds: string[];
  resolve: ResolveReference;
  value(itemId: string, fieldPath: string): Promise<string>;
  targets: AgentTargetAdapter;
  coordination?: AgentAccountCoordinator;
  secrets?(query: OwnerSecretsQuery): Promise<OwnerSecretsResult>;
}
