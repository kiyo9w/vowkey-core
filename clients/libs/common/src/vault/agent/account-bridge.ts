import { AgentAccountCoordinator } from "./account-records";

export function accountCoordinatorBridge(
  call: (method: keyof AgentAccountCoordinator, args: unknown[]) => Promise<unknown>,
): AgentAccountCoordinator {
  const invoke = <K extends keyof AgentAccountCoordinator>(
    method: K, args: Parameters<AgentAccountCoordinator[K]>,
  ): ReturnType<AgentAccountCoordinator[K]> => call(method, args) as ReturnType<AgentAccountCoordinator[K]>;
  return {
    pairing: (...args) => invoke("pairing", args),
    receive: (...args) => invoke("receive", args),
    answer: (...args) => invoke("answer", args),
    result: (...args) => invoke("result", args),
    grant: (...args) => invoke("grant", args),
    activity: (...args) => invoke("activity", args),
    proxyActivity: (...args) => invoke("proxyActivity", args),
    revokePairing: (...args) => invoke("revokePairing", args),
    revokeGrant: (...args) => invoke("revokeGrant", args),
    sync: () => invoke("sync", []),
  };
}

export async function invokeAccountCoordinator(
  coordinator: AgentAccountCoordinator, method: unknown, args: unknown,
): Promise<unknown> {
  if (!Array.isArray(args) || args.length > 4) {
    throw new Error("malformed");
  }
  switch (method) {
    case "pairing": return coordinator.pairing(...args as Parameters<AgentAccountCoordinator["pairing"]>);
    case "receive": return coordinator.receive(...args as Parameters<AgentAccountCoordinator["receive"]>);
    case "answer": return coordinator.answer(...args as Parameters<AgentAccountCoordinator["answer"]>);
    case "result": return coordinator.result(...args as Parameters<AgentAccountCoordinator["result"]>);
    case "grant": return coordinator.grant(...args as Parameters<AgentAccountCoordinator["grant"]>);
    case "activity": return coordinator.activity(...args as Parameters<AgentAccountCoordinator["activity"]>);
    case "proxyActivity": return coordinator.proxyActivity(...args as Parameters<AgentAccountCoordinator["proxyActivity"]>);
    case "revokePairing": return coordinator.revokePairing(...args as Parameters<AgentAccountCoordinator["revokePairing"]>);
    case "revokeGrant": return coordinator.revokeGrant(...args as Parameters<AgentAccountCoordinator["revokeGrant"]>);
    case "sync": return coordinator.sync();
    default: throw new Error("malformed");
  }
}
