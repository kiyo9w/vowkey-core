import { assertValidName, parseDotenv } from "./dotenv";
import { parseVkReference, ReferenceError, VkReference } from "@vowkey/common/vault/reference"

/** Variables that authenticate this CLI. A child never receives them. */
export const RESERVED_ENV = Object.freeze([
  "VOWKEY_SESSION",
  "VOWKEY_SESSION_KEY",
  "VOWKEY_PASSWORD",
  "VOWKEY_CLIENTID",
  "VOWKEY_CLIENTSECRET",
  "VOWKEY_DECISION_KEY",
]);

export interface EnvironmentMemberDescriptor {
  name: string;
  itemId: string;
}

export type ReferenceResolver = (reference: VkReference) => Promise<string>;

export class RunEnvironmentError extends Error {
  constructor(readonly failures: { variable: string; reference: string; reason: string }[]) {
    super(
      failures
        .map((f) => `${f.variable}: ${f.reference} does not resolve (${f.reason})`)
        .join("\n"),
    );
    this.name = "RunEnvironmentError";
  }
}

export function sanitizeParentEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value != null && !RESERVED_ENV.includes(name)) {
      clean[name] = value;
    }
  }
  return clean;
}

interface Candidate {
  /** The text a variable was given; a reference is resolved only if this candidate wins. */
  raw: string;
  reference: VkReference | null;
}

export interface ResolvedRunEnvironment {
  env: Record<string, string>;
  /** Every value that came from a reference, for masking. */
  secrets: string[];
}

/**
 * Builds the child's environment. Precedence follows `op run`: the parent shell, overlaid by each
 * `--env-file` in order, overlaid by each `--environment` in order. Only the winning value for a
 * variable is resolved, so a stale reference that something overrode cannot fail the run.
 */
export async function resolveRunEnvironment(input: {
  parentEnv: NodeJS.ProcessEnv;
  envFileTexts: string[];
  environments: EnvironmentMemberDescriptor[][];
  resolve: ReferenceResolver;
}): Promise<ResolvedRunEnvironment> {
  const parent = sanitizeParentEnv(input.parentEnv);
  const candidates = new Map<string, Candidate>();

  const offer = (name: string, raw: string) => {
    candidates.set(name, { raw, reference: parseVkReference(raw) });
  };

  for (const [name, value] of Object.entries(parent)) {
    offer(name, value);
  }
  for (const text of input.envFileTexts) {
    for (const [name, value] of parseDotenv(text, parent)) {
      offer(name, value);
    }
  }
  for (const members of input.environments) {
    for (const member of members) {
      assertValidName(member.name);
      candidates.set(member.name, {
        raw: `@vk:${member.itemId}/key.value`,
        reference: { itemId: member.itemId, fieldPath: "key.value" },
      });
    }
  }

  const env: Record<string, string> = {};
  const secrets: string[] = [];
  const failures: { variable: string; reference: string; reason: string }[] = [];

  for (const [name, candidate] of candidates) {
    if (RESERVED_ENV.includes(name)) {
      continue;
    }
    if (candidate.reference == null) {
      if (candidate.raw.includes("\0")) {
        failures.push({ variable: name, reference: "(value)", reason: "the value contains NUL" });
        continue;
      }
      env[name] = candidate.raw;
      continue;
    }
    try {
      const value = await input.resolve(candidate.reference);
      if (value.includes("\0")) {
        failures.push({
          variable: name,
          reference: candidate.raw,
          reason: "the value contains NUL",
        });
        continue;
      }
      env[name] = value;
      secrets.push(value);
    } catch (e) {
      failures.push({
        variable: name,
        reference: candidate.raw,
        reason: e instanceof ReferenceError ? e.reason : "unavailable",
      });
    }
  }

  if (failures.length > 0) {
    throw new RunEnvironmentError(failures);
  }
  return { env, secrets };
}
