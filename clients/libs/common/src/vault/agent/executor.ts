import { CipherType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { readEnvelope, resolveProfileReference, ProfileMigrationRequiredError } from "../profile/vk-meta";
import { formatVkReference, parseVkReference, readFieldPath } from "../reference";
import type { AgentRecordProtector } from "./authority";
import type { AgentAccountCoordinator, AgentAccountSnapshot, AnswerPayload } from "./account-records";
import { AgentTarget, AgentTargetAdapter, AgentWrite, AgentWriteResult, WriteOutcome } from "./targets";

/** How long a person has to answer. Clients cannot extend it. */
export const REQUEST_WINDOW_MS = 600_000;

export const AGENT_PROTOCOL = "vowkey.agent.v1";

/** One collected form. A larger request is malformed. */
const MAX_ASSIGNMENTS = 200;
const FILL_ACTIVITY_CAP = 200;
const ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type AgentErrorCode =
  | "unpaired"
  | "pairing_mismatch"
  | "credential_rejected"
  | "pairing_revoked"
  | "invalid_reference"
  | "no_access"
  | "unmatched"
  | "nothing_selected"
  | "target_required"
  | "target_changed"
  | "revision_changed"
  | "already_resolved"
  | "deadline_passed"
  | "not_executor"
  | "revision_mismatch"
  | "malformed"
  | "migration-required"
  | "executor_unavailable";

export type AgentRule = "ask" | "fill" | "never";
export type AnswerKind = "allow_once" | "always_allow" | "deny";

/** Wall time and a clock that only moves forward inside one process. */
export interface AgentClock {
  wall(): number;
  mono(): number;
}

export interface AgentReply {
  type: string;
  [key: string]: unknown;
}

/** What resolving a reference may tell the executor. Never a saved value. */
export interface ReferenceFacts {
  cipherId: string;
  fieldPath: string;
  revisionDate: string;
  accessible: boolean;
  /** Absent when the detail has no stored rule. That reads as ask. */
  agentRule?: AgentRule;
  /** A draft profile is not filled from. */
  draft: boolean;
  profileId?: string | null;
  policyFieldPath?: string;
  resolvePath?: string;
}

export type ResolveReference = (
  itemId: string,
  fieldPath: string,
) => ReferenceFacts | null | Promise<ReferenceFacts | null>;


interface Deadline {
  wallDeadline: number;
  remainingMs: number;
  stampedMono: number;
  stampedWall: number;
}

export interface PairingRecord {
  pairingId: string;
  vaultScopeId: string;
  displayName: string;
  encryptedVerifier: string;
  createdAt: string;
  revokedAt: string | null;
  previousVaultScopeIds?: string[];
  accountRegistered?: boolean;
}

interface RequestEntry {
  entryId: string;
  fieldId: string;
  reference: string;
  cipherId: string;
  fieldPath: string;
  revisionDate: string;
  policyFieldPath: string;
  resolvePath: string;
  profileId: string | null;
  sectionId: string;
  label: string;
  decision: "deny" | "allow" | "ask";
  askReason: "site_not_listed" | "rule_ask" | null;
  outcome?: WriteOutcome;
}

export interface RequestRecord {
  requestId: string;
  pairingId: string;
  vaultScopeId: string;
  targetId: string;
  destinationKey: string;
  generation: string;
  targetDisplay: string;
  sections: { id: string; label: string }[];
  deadline: Deadline;
  entries: RequestEntry[];
  note: { goal: string; reason: string } | null;
  answer: AnswerKind | null;
  selectedEntryIds: string[] | null;
  status: string;
  /** Set once the account has this request. Local policy does not wait for it. */
  accountRegistered?: boolean;
  /** Local unconditional policy. Account sync must not replace this outcome. */
  localPolicy?: "allow" | "deny";
}

interface GrantRow {
  pairingId: string;
  destinationKey: string;
  cipherId: string;
  fieldPath: string;
  revokedAt: string | null;
  revision: number;
}

interface JournalRecord {
  requestId: string;
  phase: "pending" | "dispatching" | "confirmed" | "not_written" | "not_confirmed";
  epoch: number;
}

interface ActivityRow {
  kind: "fill";
  requestId: string;
  sourceCipherId: string;
  entryId: string;
  reference: string;
  destinationKey: string;
  pairingId: string;
  answer: AnswerKind | null;
  outcome: string;
  askReason: "site_not_listed" | "rule_ask" | null;
  at: number;
}

export interface AgentSnapshot {
  v: 1;
  localExecutorId: string;
  epoch: number;
  pairings: PairingRecord[];
  requests: RequestRecord[];
  grants: GrantRow[];
  journal: JournalRecord[];
  activity: ActivityRow[];
}

interface PendingPair {
  displayName: string;
  vaultScopeId: string;
}

/**
 * Facts a reference contributes to a request. The saved value is not one of them.
 * A detail with no stored rule leaves `agentRule` unset.
 */
export function referenceFacts(cipher: CipherView, fieldPath: string): ReferenceFacts | null {
  const envelope = readEnvelope(cipher);
  let agentRule: AgentRule | undefined;
  let profileId: string | null = null;
  let policyFieldPath = fieldPath;
  let resolvePath = fieldPath;
  if (cipher.type === CipherType.Identity && /^(detail|identity|field)\./.test(fieldPath)) {
    const reference = resolveProfileReference(cipher, fieldPath);
    if (reference == null) {
      return null;
    }
    const explicitVariant = /^detail\.[^.]+\.[^.]+$/.test(fieldPath);
    const projection = fieldPath.startsWith("identity.");
    fieldPath = explicitVariant ? reference.fieldPath : reference.fieldPath.split(".").slice(0, 2).join(".");
    policyFieldPath = reference.fieldPath.split(".").slice(0, 2).join(".");
    resolvePath = projection ? resolvePath : fieldPath;
    agentRule = reference.agentRule;
    profileId = reference.profileId;
  } else {
    try {
      readFieldPath(cipher, fieldPath);
    } catch {
      return null;
    }
  }
  return {
    cipherId: cipher.id,
    fieldPath,
    revisionDate: cipher.revisionDate?.toISOString() ?? "",
    accessible: !cipher.isDeleted,
    agentRule,
    draft: envelope?.status === "draft",
    profileId,
    policyFieldPath,
    resolvePath,
  };
}

function decide(
  rule: AgentRule | undefined,
  alwaysAllow: boolean,
): { decision: "deny" | "allow" | "ask"; askReason: RequestEntry["askReason"] } {
  if (rule === "never") {
    return { decision: "deny", askReason: null };
  }
  if (rule === "fill") {
    return { decision: "allow", askReason: null };
  }
  if (alwaysAllow) {
    return { decision: "allow", askReason: null };
  }
  return {
    decision: "ask",
    askReason: rule === "ask" ? "rule_ask" : "site_not_listed",
  };
}

function left(deadline: Deadline, clock: AgentClock): number {
  const byMono = deadline.remainingMs - (clock.mono() - deadline.stampedMono);
  const byWall = deadline.wallDeadline - clock.wall();
  return Math.min(byMono, byWall);
}

function error(code: AgentErrorCode, extra: Record<string, unknown> = {}): AgentReply {
  return { type: "error", code, ...extra };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i] ^ right[i];
  }
  return diff === 0;
}

function stripQuery(display: string): string {
  return display.replace(/https?:\/\/[^\s|→]+/g, (value) => {
    try { return new URL(value).origin; } catch { return ""; }
  });
}

/**
 * The vault authority for one OS user: pairing, one answer per request, and at most one dispatch.
 * A saved value never enters a reply, a journal row, or an activity row.
 */
export class AgentExecutor {
  readonly localExecutorId: string;
  private epoch: number;
  private readonly pairings = new Map<string, PairingRecord>();
  private readonly requests = new Map<string, RequestRecord>();
  private readonly grants: GrantRow[] = [];
  private readonly journal = new Map<string, JournalRecord>();
  private readonly activity: ActivityRow[] = [];
  private readonly targets = new Map<string, AgentTarget>();
  private readonly pendingPairs = new Map<string, PendingPair>();
  private readonly options: {
    vaultScopeIds: string[];
    protector: AgentRecordProtector;
    clock: AgentClock;
    resolve: ResolveReference;
    newId: () => string;
    coordination?: AgentAccountCoordinator;
    persist?: () => Promise<void>;
  };

  constructor(options: {
    localExecutorId: string;
    vaultScopeIds: string[];
    protector: AgentRecordProtector;
    clock: AgentClock;
    resolve: ResolveReference;
    newId?: () => string;
    epoch?: number;
    coordination?: AgentAccountCoordinator;
    persist?: () => Promise<void>;
  }) {
    this.localExecutorId = options.localExecutorId;
    this.epoch = options.epoch ?? 1;
    this.options = {
      vaultScopeIds: options.vaultScopeIds,
      protector: options.protector,
      clock: options.clock,
      resolve: options.resolve,
      newId: options.newId ?? (() => crypto.randomUUID()),
      coordination: options.coordination,
      persist: options.persist,
    };
  }

  /** Restores a flushed journal. A dispatch that had already started is not started again. */
  static resume(
    snapshot: AgentSnapshot,
    options: {
      vaultScopeIds: string[];
      protector: AgentRecordProtector;
      clock: AgentClock;
      resolve: ResolveReference;
      newId?: () => string;
      coordination?: AgentAccountCoordinator;
      persist?: () => Promise<void>;
    },
  ): AgentExecutor {
    const executor = new AgentExecutor({
      localExecutorId: snapshot.localExecutorId,
      epoch: snapshot.epoch,
      ...options,
    });
    for (const pairing of snapshot.pairings) {
      executor.pairings.set(pairing.pairingId, pairing);
    }
    for (const request of snapshot.requests) {
      request.deadline = {
        wallDeadline: request.deadline.wallDeadline,
        remainingMs: options.clock.wall() < request.deadline.stampedWall
          ? 0 : Math.min(REQUEST_WINDOW_MS, request.deadline.remainingMs),
        stampedMono: options.clock.mono(),
        stampedWall: options.clock.wall(),
      };
      executor.requests.set(request.requestId, request);
    }
    executor.grants.push(...snapshot.grants);
    for (const row of snapshot.journal) {
      if (row.phase === "dispatching") {
        row.phase = "not_confirmed";
        const request = executor.requests.get(row.requestId);
        if (request != null && request.status === "dispatching") {
          request.status = "not_confirmed";
          request.note = null;
        }
      }
      executor.journal.set(row.requestId, row);
    }
    executor.activity.push(...snapshot.activity);
    return executor;
  }

  observeTarget(target: AgentTarget): void {
    this.targets.set(target.targetId, { ...target, display: stripQuery(target.display) });
  }

  invalidateTarget(targetId: string): void {
    this.targets.delete(targetId);
  }

  async receive(connectionId: string, message: unknown): Promise<AgentReply> {
    const body = asRecord(message);
    if (body == null || typeof body.type !== "string") {
      return error("malformed");
    }
    if (body.type === "hello") {
      if (body.protocol !== AGENT_PROTOCOL) {
        return error("malformed");
      }
      return {
        type: "hello",
        protocol: AGENT_PROTOCOL,
        localExecutorId: this.localExecutorId,
        vaultScopeIds: this.options.vaultScopeIds,
      };
    }
    if (body.type === "pair") {
      return this.pair(connectionId, body);
    }
    const pairing = await this.authenticate(body);
    if ("code" in pairing) {
      return error(pairing.code);
    }
    if (body.type === "read_form") {
      const target = this.selectTarget(typeof body.targetId === "string" ? body.targetId : undefined);
      return target instanceof Error
        ? error("target_required", {
            candidates: [...this.targets.values()].map(({ targetId, display }) => ({ targetId, display })),
          })
        : { type: "form", ...target };
    }
    if (body.type === "fill_request") {
      return await this.openRequest(pairing, body);
    }
    if (body.type === "access_result") {
      return this.accessResult(pairing, body);
    }
    // The paired agent asks and reads the outcome. It does not answer, and it does not report
    // that a fill was written. The person's screen does that.
    if (body.type === "answer" || body.type === "result") {
      return error("not_executor");
    }
    return error("malformed");
  }

  /** Pairs waiting for the person. The credential is not included. */
  waitingPairs(): { connectionId: string; displayName: string; vaultScopeId: string }[] {
    return [...this.pendingPairs.entries()].map(([connectionId, pending]) => ({
      connectionId,
      displayName: pending.displayName,
      vaultScopeId: pending.vaultScopeId,
    }));
  }

  /** Approves the pair waiting on this socket and returns the credential once, on this socket only. */
  async approve(connectionId: string): Promise<AgentReply | null> {
    const pending = this.pendingPairs.get(connectionId);
    this.pendingPairs.delete(connectionId);
    if (pending == null) {
      return null;
    }
    const credential = crypto.getRandomValues(new Uint8Array(32));
    const pairingId = this.options.newId();
    this.pairings.set(pairingId, {
      pairingId,
      vaultScopeId: pending.vaultScopeId,
      displayName: pending.displayName,
      encryptedVerifier: await this.options.protector.seal(encodeBase64(credential)),
      createdAt: new Date(this.options.clock.wall()).toISOString(),
      revokedAt: null,
      accountRegistered: false,
    });
    try {
      await this.options.persist?.();
    } catch (failure) {
      this.pairings.delete(pairingId);
      throw failure;
    }
    return {
      type: "paired",
      pairingId,
      credential: encodeBase64(credential),
      vaultScopeId: pending.vaultScopeId,
    };
  }

  publicPairings(): Omit<PairingRecord, "encryptedVerifier">[] {
    return [...this.pairings.values()].map(({ encryptedVerifier: _, ...pairing }) => pairing);
  }

  /**
   * Pulls account state when the network answers. A failure leaves the last
   * local policy and journal untouched. Unconditional local allow and deny
   * are not waiting on this call.
   */
  async refreshAccount(): Promise<void> {
    const coordination = this.options.coordination;
    if (coordination == null) {
      return;
    }
    let remote: AgentAccountSnapshot;
    try {
      remote = await coordination.sync();
    } catch {
      return;
    }
    let registered = false;
    for (const pairing of this.pairings.values()) {
      const row = remote.pairings.find((candidate) => candidate.pairingId === pairing.pairingId);
      if (row != null && row.revokedAt != null) {
        pairing.revokedAt = row.revokedAt;
      } else if (pairing.revokedAt == null && pairing.accountRegistered === false && row == null) {
        try {
          const { encryptedVerifier: _, ...metadata } = pairing;
          await coordination.pairing(metadata, this.localExecutorId);
          pairing.accountRegistered = true;
          registered = true;
        } catch {
          // Pairing metadata can be published on the next successful refresh.
        }
      }
    }
    for (const request of this.requests.values()) {
      if (request.accountRegistered !== false) {
        continue;
      }
      try {
        const received = await coordination.receive(request);
        if (request.localPolicy == null && request.answer != null) {
          const winner = await coordination.answer(
            request.requestId, request.answer, request.selectedEntryIds ?? [],
          );
          if (winner.answer.answer === "always_allow") {
            for (const grant of this.grants.filter((grant) => grant.pairingId === request.pairingId &&
              grant.destinationKey === request.destinationKey && request.entries.some((entry) =>
                entry.cipherId === grant.cipherId && entry.policyFieldPath === grant.fieldPath &&
                winner.answer.selectedEntryIds.includes(entry.entryId)))) {
              await coordination.grant(grant, request.requestId);
            }
          }
        }
        request.accountRegistered = true;
        if (request.localPolicy == null && request.answer == null && request.status === "pending") {
          request.deadline.wallDeadline = Math.min(
            request.deadline.wallDeadline, Date.parse(received.deadline),
          );
        }
        registered = true;
      } catch {
        // The local request stays. The next refresh retries this registration.
      }
    }
    if (registered) {
      try {
        remote = await coordination.sync();
      } catch {
        this.expire();
        return;
      }
    }
    const pending = this.grants.filter((grant) => grant.revision < 0);
    const remoteGrants = remote.grants.map(({ grant, revokedAt, revision }) => ({
      pairingId: grant.pairingId, destinationKey: grant.destinationKey,
      cipherId: grant.cipherId, fieldPath: grant.fieldPath, revokedAt, revision,
    }));
    for (const grant of pending) {
      if (!remoteGrants.some((row) => row.pairingId === grant.pairingId &&
        row.destinationKey === grant.destinationKey && row.cipherId === grant.cipherId &&
        row.fieldPath === grant.fieldPath)) {
        remoteGrants.push(grant);
      }
    }
    this.grants.splice(0, this.grants.length, ...remoteGrants);
    for (const row of remote.requests) {
      const request = this.requests.get(row.requestId);
      if (request?.localPolicy != null) {
        continue;
      }
      if (request == null || this.journal.get(row.requestId)?.phase !== "pending") {
        continue;
      }
      request.deadline.wallDeadline = Date.parse(row.deadline);
      if (row.result != null) {
        request.status = row.result.status;
        request.note = null;
        this.journal.get(row.requestId)!.phase = "not_written";
      } else if (row.answer != null && request.answer == null) {
        await this.acceptAccountAnswer(row.requestId, row.answer);
      } else if (row.status === "timed_out") {
        request.deadline.remainingMs = 0;
      }
    }
    this.expire();
  }

  async publishAccount(): Promise<void> {
    const coordination = this.options.coordination;
    if (coordination == null) {
      return;
    }
    const outcomes = await Promise.allSettled([
      ...[...this.requests.values()].filter((request) => !["pending", "dispatching"].includes(request.status))
      .map((request) => coordination.result(request.requestId, {
        type: "result", requestId: request.requestId, status: request.status,
        entries: request.entries.map((entry) => ({
          entryId: entry.entryId, reference: entry.reference, outcome: this.outcomeOf(request, entry),
        })),
      })),
      ...this.activity.map((activity) => coordination.activity(activity)),
    ]);
    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    if (failure != null) { throw failure.reason; }
  }

  readyRequests(): string[] {
    return [...this.requests.values()]
      .filter((request) => request.status === "dispatching")
      .map((request) => request.requestId);
  }

  /** A local fill rule already decided this request. Account refresh must not delay its one write. */
  localAllow(requestId: string): boolean {
    const request = this.requests.get(requestId);
    return request?.localPolicy === "allow" && request.status === "dispatching";
  }

  expire(): void {
    for (const request of this.requests.values()) {
      if (request.status !== "pending" || left(request.deadline, this.options.clock) > 0) {
        continue;
      }
      request.status = request.answer == null ? "timed_out" : "executor_unavailable";
      request.note = null;
      const row = this.journal.get(request.requestId);
      if (row?.phase === "pending") {
        row.phase = "not_written";
      }
      this.recordActivity(request, request.status);
    }
  }

  /** Dropping the socket before approval cancels the pair. No credential is issued. */
  disconnect(connectionId: string): void {
    this.pendingPairs.delete(connectionId);
  }

  revoke(pairingId: string): void {
    const pairing = this.pairings.get(pairingId);
    if (pairing != null) {
      pairing.revokedAt = new Date(this.options.clock.wall()).toISOString();
    }
  }

  /**
   * Hands a request to the writer once. A second call, a restart, or a late callback does not
   * hand it out again.
   */
  takeDispatch(requestId: string): AgentReply | null {
    const request = this.requests.get(requestId);
    const row = this.journal.get(requestId);
    if (request == null || row == null || row.phase !== "pending") {
      return null;
    }
    if (left(request.deadline, this.options.clock) <= 0) {
      request.status = request.answer == null ? "timed_out" : "executor_unavailable";
      request.note = null;
      row.phase = "not_written";
      this.recordActivity(request, request.status);
      return null;
    }
    if (request.answer == null) {
      const automatic = request.entries.every((entry) => entry.decision !== "ask");
      if (!automatic) {
        return null;
      }
    } else if (request.answer === "deny") {
      return null;
    }
    const writable = new Set(this.writableEntries(request));
    for (const entry of request.entries) {
      if (!writable.has(entry) && entry.decision !== "deny") {
        entry.outcome = "not_written";
      }
    }
    row.phase = "dispatching";
    request.status = "dispatching";
    request.note = null;
    return {
      type: "dispatch",
      requestId,
      destinationKey: request.destinationKey,
      generation: request.generation,
      entries: this.writableEntries(request).map((entry) => ({
        entryId: entry.entryId,
        fieldId: entry.fieldId,
        reference: entry.reference,
        cipherId: entry.cipherId,
        fieldPath: entry.fieldPath,
      })),
    };
  }

  completeDispatch(
    requestId: string,
    outcome: "confirmed" | "not_written" | "not_confirmed",
  ): AgentReply | null {
    const row = this.journal.get(requestId);
    const request = this.requests.get(requestId);
    if (row == null || request == null || row.phase !== "dispatching") {
      return null;
    }
    row.phase = outcome;
    request.status = outcome;
    this.recordActivity(request, outcome);
    return { type: "result", requestId, status: outcome };
  }

  /** Flush dispatch intent before handing values to another process. An uncertain write is never retried. */
  async dispatch(
    requestId: string,
    adapter: AgentTargetAdapter,
    resolveValue: (itemId: string, fieldPath: string) => Promise<string>,
    persist: (snapshot: AgentSnapshot) => Promise<void>,
  ): Promise<AgentReply> {
    const request = this.requests.get(requestId);
    const row = this.journal.get(requestId);
    if (request == null || row == null || row.phase !== "dispatching") {
      return error("already_resolved");
    }

    const epoch = this.epoch;
    const pairing = this.pairings.get(request.pairingId);
    if (pairing == null || pairing.revokedAt != null) {
      this.completeDispatch(requestId, "not_written");
      await persist(this.snapshot());
      return error("pairing_revoked");
    }
    const targets = await adapter.collect(request.targetId);
    const target = targets.find((candidate) => candidate.targetId === request.targetId);
    if (target == null || target.destinationKey !== request.destinationKey) {
      this.completeDispatch(requestId, "not_written");
      await persist(this.snapshot());
      return error("target_changed");
    }
    request.generation = target.generation;
    this.observeTarget(target);
    const entries = this.writableEntries(request);
    if (left(request.deadline, this.options.clock) <= 0) {
      this.completeDispatch(requestId, "not_written");
      await persist(this.snapshot());
      return error("deadline_passed");
    }
    await persist(this.snapshot());
    const operations: AgentWrite[] = [];
    for (const entry of entries) {
      if (!target.fields.some((field) => field.id === entry.fieldId)) {
        entry.outcome = "not_written";
        continue;
      }
      try {
        const facts = await this.options.resolve(entry.cipherId, entry.resolvePath);
        if (facts == null || !facts.accessible || facts.draft || facts.agentRule === "never") {
          entry.decision = "deny";
          continue;
        }
        operations.push({
          entryId: entry.entryId,
          fieldId: entry.fieldId,
          value: await resolveValue(facts.cipherId, facts.resolvePath ?? facts.fieldPath),
        });
      } catch {
        entry.outcome = "not_written";
      }
    }
    if (epoch !== this.epoch || row.phase !== "dispatching" || pairing.revokedAt != null) {
      return error("already_resolved");
    }
    if (left(request.deadline, this.options.clock) <= 0 || operations.length === 0) {
      this.completeDispatch(requestId, "not_written");
      await persist(this.snapshot());
      return error(operations.length === 0 ? "nothing_selected" : "deadline_passed");
    }
    let result: AgentWriteResult;
    try {
      result = await adapter.write(target, operations);
    } catch {
      result = { entries: operations.map(({ entryId }) => ({ entryId, outcome: "not_confirmed" })) };
    }
    if (epoch !== this.epoch || row.phase !== "dispatching") {
      return error("already_resolved");
    }
    for (const operation of operations) {
      const entry = entries.find((candidate) => candidate.entryId === operation.entryId)!;
      entry.outcome = result.entries.find((candidate) => candidate.entryId === operation.entryId)?.outcome
        ?? "not_confirmed";
    }
    const outcomes = entries.filter((entry) => entry.decision !== "deny")
      .map((entry) => entry.outcome ?? "not_written");
    const outcome = outcomes.every((value) => value === "confirmed")
      ? "confirmed"
      : outcomes.every((value) => value === "not_written")
        ? "not_written"
        : "not_confirmed";
    this.completeDispatch(requestId, outcome);
    await persist(this.snapshot());
    return { type: "result", requestId, status: outcome };
  }

  /**
   * A reload of the same destination is written after the target is collected again.
   * A different destination is not. A stale generation is not written onto the new control.
   */
  writeDecision(
    requestId: string,
    destinationKey: string,
    generation: string,
  ): "write" | "recollect" | "refuse" {
    const request = this.requests.get(requestId);
    if (request == null || request.destinationKey !== destinationKey) {
      return "refuse";
    }
    if (request.answer === "deny" || request.status === "not_allowed") {
      return "refuse";
    }
    if (generation !== request.generation) {
      return "recollect";
    }
    return "write";
  }

  /** Adopts the generation collected for a reload, without asking again. */
  recollect(requestId: string, generation: string): void {
    const request = this.requests.get(requestId);
    const target = request == null ? undefined : this.targets.get(request.targetId);
    if (request == null || target == null || target.destinationKey !== request.destinationKey) {
      return;
    }
    request.generation = generation;
    target.generation = generation;
  }

  /** Invalidates late callbacks without changing durable answers or pending deadlines. */
  suspend(): void {
    this.epoch += 1;
  }

  /** Stops new work for an account change. An in-flight dispatch is not replayed or rewritten. */
  quiesce(): void {
    this.epoch += 1;
    for (const request of this.requests.values()) {
      const row = this.journal.get(request.requestId);
      if (row?.phase === "dispatching") {
        row.phase = "not_confirmed";
        request.status = "not_confirmed";
      } else if (row?.phase === "pending" || request.status === "pending") {
        request.status = "account_changed";
        if (row != null) {
          row.phase = "not_written";
        }
      }
      request.note = null;
    }
  }

  /** What the person's own screen shows for a request that is still waiting. No saved values. */
  pendingForPerson(): {
    requestId: string;
    displayName: string;
    goal: string;
    reason: string;
    targetDisplay: string;
    deadline: string;
    entries: { entryId: string; reference: string; label: string; profileId: string | null; sectionId: string }[];
  }[] {
    this.expire();
    return [...this.requests.values()]
      .filter((request) => request.status === "pending" && request.note != null)
      .map((request) => ({
        requestId: request.requestId,
        displayName: this.pairings.get(request.pairingId)?.displayName ?? "",
        goal: request.note!.goal,
        reason: request.note!.reason,
        targetDisplay: request.targetDisplay,
        deadline: new Date(request.deadline.wallDeadline).toISOString(),
        entries: request.entries
          .filter((entry) => entry.decision !== "deny")
          .map((entry) => ({
            entryId: entry.entryId, reference: entry.reference, label: entry.label,
            profileId: entry.profileId, sectionId: entry.sectionId,
          })),
      }));
  }

  snapshot(): AgentSnapshot {
    this.expire();
    const now = this.options.clock;
    return {
      v: 1,
      localExecutorId: this.localExecutorId,
      epoch: this.epoch,
      pairings: [...this.pairings.values()],
      requests: [...this.requests.values()].map((request) => ({
        ...request,
        deadline: {
          wallDeadline: request.deadline.wallDeadline,
          remainingMs: Math.max(0, left(request.deadline, now)),
          stampedMono: now.mono(),
          stampedWall: now.wall(),
        },
        entries: request.entries.map((entry) => ({ ...entry })),
        note: request.note == null ? null : { ...request.note },
      })),
      grants: this.grants.map((grant) => ({ ...grant })),
      journal: [...this.journal.values()].map((row) => ({ ...row })),
      activity: this.activity.map((row) => ({ ...row })),
    };
  }

  private pair(connectionId: string, body: Record<string, unknown>): AgentReply {
    const displayName = body.displayName;
    const vaultScopeId = body.vaultScopeId;
    if (typeof displayName !== "string" || displayName.trim() === "") {
      return error("malformed");
    }
    if (typeof vaultScopeId !== "string" || !this.options.vaultScopeIds.includes(vaultScopeId)) {
      return error("malformed");
    }
    this.pendingPairs.set(connectionId, { displayName: displayName.trim(), vaultScopeId });
    return { type: "pair_pending", displayName: displayName.trim(), vaultScopeId };
  }

  private async authenticate(
    body: Record<string, unknown>,
  ): Promise<PairingRecord | { code: AgentErrorCode }> {
    if (typeof body.pairingId !== "string" || typeof body.credential !== "string") {
      return { code: "unpaired" };
    }
    if (typeof body.vaultScopeId !== "string") {
      return { code: "pairing_mismatch" };
    }
    const pairing = this.pairings.get(body.pairingId);
    if (pairing == null || !this.options.vaultScopeIds.includes(pairing.vaultScopeId) ||
      (pairing.vaultScopeId !== body.vaultScopeId && !pairing.previousVaultScopeIds?.includes(body.vaultScopeId))) {
      return { code: "pairing_mismatch" };
    }
    if (pairing.revokedAt != null) {
      return { code: "pairing_revoked" };
    }
    const credential = decodeBase64(body.credential);
    let opened: Uint8Array | null;
    try {
      opened = decodeBase64(await this.options.protector.open(pairing.encryptedVerifier));
    } catch {
      return { code: "credential_rejected" };
    }
    if (credential == null || opened == null || !sameBytes(credential, opened)) {
      return { code: "credential_rejected" };
    }
    return pairing;
  }

  private async openRequest(pairing: PairingRecord, body: Record<string, unknown>): Promise<AgentReply> {
    const requestBody = asRecord(body.body);
    if (requestBody == null) {
      return error("malformed");
    }
    const goal = requestBody.goal;
    const reason = requestBody.reason;
    if (typeof goal !== "string" || goal.length < 1 || goal.length > 140) {
      return error("malformed");
    }
    if (typeof reason !== "string" || reason.length < 1 || reason.length > 100) {
      return error("malformed");
    }
    const target = this.selectTarget(
      typeof requestBody.targetId === "string" ? requestBody.targetId : undefined,
    );
    if (target instanceof Error) {
      return error(target.message as AgentErrorCode, {
        candidates: [...this.targets.values()].map((item) => ({
          targetId: item.targetId,
          display: item.display,
        })),
      });
    }
    const assignments = requestBody.assignments;
    if (!Array.isArray(assignments) || assignments.length < 1 || assignments.length > MAX_ASSIGNMENTS) {
      return error("malformed");
    }
    const entries: RequestEntry[] = [];
    const observedFields = new Set(target.fields.map((field) => field.id));
    const assignedFields = new Set<string>();
    for (const raw of assignments) {
      const assignment = asRecord(raw);
      if (
        assignment == null ||
        typeof assignment.fieldId !== "string" ||
        typeof assignment.reference !== "string" ||
        !observedFields.has(assignment.fieldId) ||
        assignedFields.has(assignment.fieldId)
      ) {
        return error("malformed");
      }
      assignedFields.add(assignment.fieldId);
      const parsed = parseVkReference(assignment.reference);
      if (parsed == null) {
        return error("invalid_reference");
      }
      let facts: ReferenceFacts | null;
      try {
        facts = await this.options.resolve(parsed.itemId, parsed.fieldPath);
      } catch (failure) {
        return error(failure instanceof ProfileMigrationRequiredError ? "migration-required" : "no_access");
      }
      if (facts == null) {
        return error("invalid_reference");
      }
      if (!facts.accessible || facts.draft) {
        entries.push({
          entryId: this.options.newId(),
          fieldId: assignment.fieldId,
          reference: formatVkReference(facts.cipherId, facts.fieldPath),
          cipherId: facts.cipherId,
          fieldPath: facts.fieldPath,
          revisionDate: facts.revisionDate,
          policyFieldPath: facts.policyFieldPath ?? facts.fieldPath,
          resolvePath: facts.resolvePath ?? facts.fieldPath,
          profileId: facts.profileId ?? null,
          sectionId: target.fields.find((field) => field.id === assignment.fieldId)!.sectionId,
          label: target.fields.find((field) => field.id === assignment.fieldId)!.label,
          decision: "deny",
          askReason: null,
        });
        continue;
      }
      const grant = this.grants.some(
        (row) =>
          row.revokedAt == null &&
          row.pairingId === pairing.pairingId &&
          row.destinationKey === target.destinationKey &&
          row.cipherId === facts.cipherId &&
          row.fieldPath === (facts.policyFieldPath ?? facts.fieldPath),
      );
      const decision = decide(facts.agentRule, grant);
      entries.push({
        entryId: this.options.newId(),
        fieldId: assignment.fieldId,
        reference: formatVkReference(facts.cipherId, facts.fieldPath),
        cipherId: facts.cipherId,
        fieldPath: facts.fieldPath,
        revisionDate: facts.revisionDate,
        policyFieldPath: facts.policyFieldPath ?? facts.fieldPath,
        resolvePath: facts.resolvePath ?? facts.fieldPath,
        profileId: facts.profileId ?? null,
        sectionId: target.fields.find((field) => field.id === assignment.fieldId)!.sectionId,
        label: target.fields.find((field) => field.id === assignment.fieldId)!.label,
        decision: decision.decision,
        askReason: decision.askReason,
      });
    }
    const request = this.makeRequest(pairing, target, entries, goal, reason);
    const writable = entries.filter((entry) => entry.decision !== "deny");
    const unconditional = writable.length === 0 || writable.every((entry) => entry.decision === "allow");
    if (unconditional) {
      request.localPolicy = writable.length === 0 ? "deny" : "allow";
    }
    await this.options.persist?.();
    if (!unconditional && this.options.coordination != null) {
      try {
        if (!pairing.accountRegistered) {
          const { encryptedVerifier: _, ...metadata } = pairing;
          await this.options.coordination.pairing(metadata, this.localExecutorId);
          pairing.accountRegistered = true;
        }
        const received = await this.options.coordination.receive(request);
        request.accountRegistered = true;
        request.deadline.wallDeadline = Date.parse(received.deadline);
        request.deadline.remainingMs = Math.min(left(request.deadline, this.options.clock),
          request.deadline.wallDeadline - this.options.clock.wall());
      } catch {
        // The person still has to answer. Offline registration does not approve the ask.
      }
    }
    if (writable.length === 0) {
      request.answer = "deny";
      request.selectedEntryIds = [];
      request.status = "not_allowed";
      request.note = null;
      this.journal.get(request.requestId)!.phase = "not_written";
      this.recordActivity(request, "not_allowed");
      await this.options.persist?.();
      return {
        type: "receipt",
        requestId: request.requestId,
        status: "not_allowed",
        deadline: new Date(request.deadline.wallDeadline).toISOString(),
        targetDisplay: request.targetDisplay,
      };
    }
    if (writable.every((entry) => entry.decision === "allow")) {
      const dispatch = this.takeDispatch(request.requestId);
      if (dispatch == null) {
        return error("executor_unavailable");
      }
      await this.options.persist?.();
      return {
        type: "receipt",
        requestId: request.requestId,
        status: "dispatching",
        deadline: new Date(request.deadline.wallDeadline).toISOString(),
        targetDisplay: request.targetDisplay,
      };
    }
    return {
      type: "receipt",
      requestId: request.requestId,
      status: "pending",
      deadline: new Date(request.deadline.wallDeadline).toISOString(),
      targetDisplay: request.targetDisplay,
    };
  }

  private selectTarget(targetId: string | undefined): AgentTarget | Error {
    if (targetId != null) {
      const target = this.targets.get(targetId);
      if (target == null) {
        return new Error("target_required");
      }
      return target;
    }
    if (this.targets.size !== 1) {
      return new Error("target_required");
    }
    return [...this.targets.values()][0];
  }

  private makeRequest(
    pairing: PairingRecord,
    target: AgentTarget,
    entries: RequestEntry[],
    goal: string,
    reason: string,
  ): RequestRecord {
    const now = this.options.clock;
    const request: RequestRecord = {
      requestId: this.options.newId(),
      pairingId: pairing.pairingId,
      vaultScopeId: pairing.vaultScopeId,
      targetId: target.targetId,
      destinationKey: target.destinationKey,
      generation: target.generation,
      targetDisplay: target.display,
      sections: target.sections,
      deadline: {
        wallDeadline: now.wall() + REQUEST_WINDOW_MS,
        remainingMs: REQUEST_WINDOW_MS,
        stampedMono: now.mono(),
        stampedWall: now.wall(),
      },
      entries,
      note: { goal, reason },
      answer: null,
      selectedEntryIds: null,
      status: "pending",
      accountRegistered: false,
    };
    this.requests.set(request.requestId, request);
    this.journal.set(request.requestId, {
      requestId: request.requestId,
      phase: "pending",
      epoch: this.epoch,
    });
    return request;
  }

  /** The person's answer. One winner; a second answer, or one after the deadline, does not replace it. */
  async answerFromPerson(
    requestId: string,
    answer: AnswerKind,
    selectedEntryIds: string[],
  ): Promise<AgentReply> {
    if (this.options.coordination != null) {
      const winner = await this.options.coordination.answer(requestId, answer, selectedEntryIds);
      return this.acceptAccountAnswer(requestId, winner.answer);
    }
    return this.answer(requestId, answer, selectedEntryIds);
  }

  private async acceptAccountAnswer(requestId: string, answer: AnswerPayload): Promise<AgentReply> {
    const request = this.requests.get(requestId);
    if (request == null) {
      return error("invalid_reference");
    }
    if (answer.answer === "always_allow") {
      for (const entry of request.entries) {
        if (entry.decision !== "deny" && answer.selectedEntryIds.includes(entry.entryId)) {
          await this.options.coordination!.grant({
            pairingId: request.pairingId, destinationKey: request.destinationKey,
            cipherId: entry.cipherId, fieldPath: entry.policyFieldPath,
            revokedAt: null, revision: 1,
          }, requestId);
        }
      }
    }
    return this.answer(requestId, answer.answer, answer.selectedEntryIds);
  }

  private answer(requestId: string, kind: AnswerKind, selectedEntryIds: string[]): AgentReply {
    const request = this.requests.get(requestId);
    if (request == null) {
      return error("invalid_reference");
    }
    if (request.answer != null || request.status !== "pending") {
      return error("already_resolved");
    }
    if (left(request.deadline, this.options.clock) <= 0) {
      request.status = "timed_out";
      request.note = null;
      this.journal.get(requestId)!.phase = "not_written";
      this.recordActivity(request, "timed_out");
      return error("deadline_passed");
    }
    if (kind !== "deny" && selectedEntryIds.length === 0) {
      return error("nothing_selected");
    }
    const permitted = new Set(
      request.entries.filter((entry) => entry.decision !== "deny").map((entry) => entry.entryId),
    );
    if (
      new Set(selectedEntryIds).size !== selectedEntryIds.length ||
      selectedEntryIds.some((entryId) => !permitted.has(entryId))
    ) {
      return error("invalid_reference");
    }
    request.answer = kind;
    request.selectedEntryIds = selectedEntryIds;
    request.note = null;
    if (kind === "deny") {
      request.status = "not_allowed";
      this.journal.get(requestId)!.phase = "not_written";
      this.recordActivity(request, "not_allowed");
      return { type: "answered", requestId, status: "not_allowed" };
    }
    if (kind === "always_allow") {
      for (const entry of this.writableEntries(request)) {
        const previous = this.grants.find((grant) => grant.pairingId === request.pairingId &&
          grant.destinationKey === request.destinationKey && grant.cipherId === entry.cipherId &&
          grant.fieldPath === entry.policyFieldPath);
        if (previous != null) {
          previous.revokedAt = null;
          previous.revision += 1;
        } else {
          this.grants.push({
            pairingId: request.pairingId, destinationKey: request.destinationKey,
            cipherId: entry.cipherId, fieldPath: entry.policyFieldPath,
            revokedAt: null, revision: 1,
          });
        }
      }
    }
    const dispatch = this.takeDispatch(requestId);
    return dispatch ?? error("executor_unavailable");
  }

  private accessResult(pairing: PairingRecord, body: Record<string, unknown>): AgentReply {
    this.expire();
    const requestId = body.requestId;
    if (typeof requestId !== "string") {
      return error("malformed");
    }
    const request = this.requests.get(requestId);
    if (request == null || request.pairingId !== pairing.pairingId) {
      return error("invalid_reference");
    }
    return {
      type: "access_result",
      requestId,
      status: request.status,
      entries: request.entries.map((entry) => ({
        entryId: entry.entryId,
        reference: entry.reference,
        outcome: this.outcomeOf(request, entry),
      })),
    };
  }

  private writableEntries(request: RequestRecord): RequestEntry[] {
    const selected = new Set(request.selectedEntryIds ?? []);
    return request.entries.filter((entry) => {
      if (entry.decision === "deny") {
        return false;
      }
      if (request.selectedEntryIds == null) {
        return entry.decision === "allow";
      }
      return selected.has(entry.entryId);
    });
  }

  private outcomeOf(request: RequestRecord, entry: RequestEntry): string {
    if (entry.decision === "deny") {
      return "not_allowed";
    }
    if (request.status === "pending") {
      return "pending";
    }
    return entry.outcome ?? request.status;
  }

  private recordActivity(request: RequestRecord, outcome: string): void {
    const at = this.options.clock.wall();
    for (const entry of request.entries) {
      this.activity.push({
        kind: "fill",
        requestId: request.requestId,
        sourceCipherId: entry.cipherId,
        entryId: entry.entryId,
        reference: entry.reference,
        destinationKey: request.destinationKey,
        pairingId: request.pairingId,
        answer: request.answer,
        outcome: entry.decision === "deny" ? "not_allowed" : entry.outcome ?? outcome,
        askReason: entry.askReason,
        at,
      });
    }
    const cutoff = at - ACTIVITY_RETENTION_MS;
    const kept = this.activity.filter((row) => row.at >= cutoff);
    this.activity.length = 0;
    const byCipher = new Map<string, ActivityRow[]>();
    for (const row of kept) {
      const list = byCipher.get(row.sourceCipherId) ?? [];
      list.push(row);
      byCipher.set(row.sourceCipherId, list);
    }
    for (const list of byCipher.values()) {
      const dropped = Math.max(0, list.length - FILL_ACTIVITY_CAP);
      this.activity.push(...list.slice(dropped));
    }
  }
}
