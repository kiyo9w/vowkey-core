import { AgentSnapshot } from "./executor";

function mergeRows<T>(source: T[], destination: T[], key: (row: T) => string): T[] {
  return [...new Map([...source, ...destination].map((row) => [key(row), row])).values()];
}

/** Both executors must be quiesced before combining their protected state. */
export function mergeAgentSnapshots(source: AgentSnapshot, destination: AgentSnapshot | null): AgentSnapshot {
  if (destination == null) {
    return source;
  }
  return {
    v: 1, localExecutorId: destination.localExecutorId,
    epoch: Math.max(source.epoch, destination.epoch) + 1,
    pairings: mergeRows(source.pairings, destination.pairings, (row) => row.pairingId),
    requests: mergeRows(source.requests, destination.requests, (row) => row.requestId),
    grants: mergeRows(source.grants, destination.grants,
      (row) => JSON.stringify([row.pairingId, row.destinationKey, row.cipherId, row.fieldPath])),
    journal: mergeRows(source.journal, destination.journal, (row) => row.requestId),
    activity: mergeRows(source.activity, destination.activity,
      (row) => JSON.stringify([row.requestId, row.sourceCipherId, row.entryId])),
  };
}
