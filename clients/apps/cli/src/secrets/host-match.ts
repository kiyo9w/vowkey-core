export interface HostPattern {
  host: string;
  wildcard: boolean;
  port: number | null;
}

export interface RequestTarget {
  hostname: string;
  port: number;
  scheme: "http" | "https";
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** Parses `api.example.com`, `api.example.com:8443`, `*.example.com` or `[::1]:8080`. */
export function parseHostPattern(pattern: string): HostPattern {
  let rest = pattern.trim().toLowerCase();
  let port: number | null = null;
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
  if (bracket != null) {
    rest = bracket[1];
    port = bracket[2] != null ? Number(bracket[2]) : null;
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon !== -1 && rest.indexOf(":") === colon) {
      port = Number(rest.slice(colon + 1));
      rest = rest.slice(0, colon);
    }
  }
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid port in host pattern "${pattern}"`);
  }
  const wildcard = rest.startsWith("*.");
  const host = wildcard ? rest.slice(2) : rest;
  if (host === "" || host.includes("*") || host.includes("/") || host.includes(" ")) {
    throw new Error(`Invalid host pattern "${pattern}"`);
  }
  return { host, wildcard, port };
}

export function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function portMatches(pattern: HostPattern, target: RequestTarget, hostname: string): boolean {
  if (pattern.port != null) {
    return pattern.port === target.port;
  }
  return (
    target.port === 443 ||
    (target.port === 80 && target.scheme === "http" && LOOPBACK.has(hostname))
  );
}

/**
 * Returns 2 for an exact host match, 1 for a wildcard match (one label, never more), and 0 when
 * the pattern does not match this host and port.
 */
export function matchRank(pattern: HostPattern, target: RequestTarget): 0 | 1 | 2 {
  const hostname = normalizeHostname(target.hostname);
  if (!portMatches(pattern, target, hostname)) {
    return 0;
  }
  if (!pattern.wildcard) {
    return hostname === pattern.host ? 2 : 0;
  }
  const suffix = "." + pattern.host;
  if (!hostname.endsWith(suffix)) {
    return 0;
  }
  const label = hostname.slice(0, hostname.length - suffix.length);
  return label !== "" && !label.includes(".") ? 1 : 0;
}

export interface HostBoundKey {
  itemId: string;
  allowedHosts: string[];
}

export type KeySelection =
  { kind: "none" } | { kind: "key"; itemId: string } | { kind: "ambiguous"; itemIds: string[] };

/** An exact host beats a wildcard; two keys at the same rank are ambiguous. */
export function selectKey(keys: readonly HostBoundKey[], target: RequestTarget): KeySelection {
  let best = 0;
  let winners: string[] = [];
  for (const key of keys) {
    let rank = 0;
    for (const raw of key.allowedHosts) {
      try {
        rank = Math.max(rank, matchRank(parseHostPattern(raw), target));
      } catch {
        // A pattern that does not parse never matches.
      }
    }
    if (rank === 0) {
      continue;
    }
    if (rank > best) {
      best = rank;
      winners = [key.itemId];
    } else if (rank === best) {
      winners.push(key.itemId);
    }
  }
  if (winners.length === 0) {
    return { kind: "none" };
  }
  return winners.length === 1
    ? { kind: "key", itemId: winners[0] }
    : { kind: "ambiguous", itemIds: winners };
}
