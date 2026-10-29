import { canonicalJson, requestHash } from "../local/canonical-json";
import { formatVkReference } from "../reference";

import type { AgentRecordProtector } from "./authority";
import type { AgentReply, AgentSnapshot, AnswerKind } from "./executor";

export type AgentAccountTransport = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
) => Promise<unknown>;

type Pairing = Omit<AgentSnapshot["pairings"][number], "encryptedVerifier">;
type Request = AgentSnapshot["requests"][number];
type Grant = AgentSnapshot["grants"][number];
type FillActivity = AgentSnapshot["activity"][number];

export interface PairingPayload {
  v: 1;
  pairingId: string;
  displayName: string;
  localExecutorId: string;
  executorDeviceId: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface RoutingPayload {
  v: 1;
  requestId: string;
  pairingId: string;
  targetDisplay: string;
  destinationKey: string;
  sections: { id: string; label: string }[];
  entries: {
    entryId: string;
    fieldId: string;
    cipherId: string;
    fieldPath: string;
    revisionDate: string;
    profileId: string | null;
    sectionId: string;
    label: string;
  }[];
  askReason: "site_not_listed" | "rule_ask" | null;
}

export interface NotePayload { v: 1; requestId: string; goal: string; reason: string }
export interface AnswerPayload {
  v: 1;
  requestId: string;
  answer: AnswerKind;
  selectedEntryIds: string[];
  sectionProfiles: Record<string, string>;
  answeredAt: string;
}
export interface ResultPayload {
  v: 1;
  requestId: string;
  status: string;
  entries: { entryId: string; reference: string; outcome: string }[];
  finishedAt: string;
}
export interface GrantPayload {
  v: 1;
  requestId: string;
  pairingId: string;
  destinationKey: string;
  cipherId: string;
  fieldPath: string;
  revokedAt: string | null;
}
export interface FillActivityPayload extends FillActivity { v: 1 }
export interface ProxyActivityPayload {
  v: 1;
  kind: "proxy";
  eventId: string;
  sourceCipherId: string | null;
  method: string;
  host: string;
  port: number;
  outcome: string;
  status?: number;
  at: number;
}
export interface FormBindingV1 {
  v: 1;
  formSignature: string;
  sectionId: string;
  profileCipherId: string;
  fields: {
    fieldSignature: string;
    detailId: string;
    variantId: string | null;
    format: { label: string };
    correctedByPerson: boolean;
  }[];
  updatedAt: string;
}

interface PairingWire {
  pairingId: string; localExecutorId: string; executorDeviceId: string | null;
  encryptedMetadata: string; revokedAt: string | null; revision: number;
}
interface RequestWire {
  requestId: string; pairingId: string; executorDeviceId: string; cipherIds: string[];
  routing: string; note: string | null; answer: string | null; result: string | null;
  status: string; receivedAt: string; deadline: string;
  answerRevision: number; resultRevision: number; revision: number;
}
interface GrantWire {
  grantId: string; sourceCipherId: string | null; encryptedGrant: string;
  revokedAt: string | null; revision: number;
}
interface ActivityWire {
  activityId: string; kind: "fill" | "proxy"; requestId: string | null;
  sourceCipherId: string | null; entryId: string | null; eventId: string | null;
  organizationId: string | null; encryptedActivity: string; revision: number; createdAt: string;
}
interface BindingWire {
  bindingId: string; profileCipherId: string | null; encryptedBinding: string; revision: number;
}
export interface AccountPairing extends Omit<PairingWire, "encryptedMetadata"> { metadata: PairingPayload }
export interface AccountRequest extends Omit<RequestWire, "routing" | "note" | "answer" | "result"> {
  routing: RoutingPayload; note: NotePayload | null; answer: AnswerPayload | null; result: ResultPayload | null;
}
export interface AccountGrant extends Omit<GrantWire, "encryptedGrant"> { grant: GrantPayload }
export interface AccountActivity extends Omit<ActivityWire, "encryptedActivity"> { activity: FillActivityPayload | ProxyActivityPayload }
export interface AccountFormBinding extends Omit<BindingWire, "encryptedBinding"> { binding: FormBindingV1 }
export interface AgentAccountSnapshot {
  revision: number;
  fullSnapshot: true;
  pairings: AccountPairing[];
  requests: AccountRequest[];
  grants: AccountGrant[];
  activity: AccountActivity[];
  formBindings: AccountFormBinding[];
  tombstones: { kind: string; id: string; revision: number; deletedAt: string }[];
}
export interface AgentAccountCoordinator {
  pairing(pairing: Pairing, localExecutorId: string): Promise<void>;
  receive(request: Request): Promise<{ receivedAt: string; deadline: string; revision: number }>;
  answer(requestId: string, answer: AnswerKind, selectedEntryIds: string[], sectionProfiles?: Record<string, string>): Promise<{ answer: AnswerPayload; revision: number }>;
  result(requestId: string, result: AgentReply): Promise<void>;
  grant(row: Grant, requestId: string): Promise<void>;
  activity(row: FillActivity): Promise<void>;
  proxyActivity(row: ProxyActivityPayload): Promise<void>;
  revokePairing(pairingId: string): Promise<void>;
  revokeGrant(grantId: string): Promise<void>;
  sync(): Promise<AgentAccountSnapshot>;
}
export interface AgentAccountOptions {
  executorDeviceId: string;
  sealSource?: (cipherId: string, plain: string) => Promise<{
    ciphertext: string; organizationId: string | null; revision: number;
  }>;
  openSource?: (cipherId: string, organizationId: string | null, ciphertext: string) => Promise<string>;
}

export class AgentAccountError extends Error {
  constructor(readonly code: string, readonly statusCode: number, readonly winning?: unknown) {
    super(code);
    this.name = "AgentAccountError";
  }
}

const terminal: Readonly<Record<string, true>> = { confirmed: true, not_written: true, not_confirmed: true, not_allowed: true, timed_out: true, account_changed: true, executor_unavailable: true };
const outcomes: Readonly<Record<string, true>> = { ...terminal, unmatched: true, no_access: true, never: true };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(): never { throw new AgentAccountError("malformed", 422); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== "string") return fail(); return value; }
function identifier(value: unknown): string { const result = text(value); if (!result || result.length > 1024) return fail(); return result; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail(); return value; }
function date(value: unknown): string { const result = text(value); if (!Number.isFinite(Date.parse(result))) return fail(); return result; }
function nullable(value: unknown): string | null { return value === null ? null : text(value); }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) return fail(); return value; }
function strings(value: unknown): string[] { return array(value).map(identifier); }
function version(value: unknown, requestId?: string): Record<string, unknown> {
  const payload = object(value);
  if (payload.v !== 1 || (requestId !== undefined && payload.requestId !== requestId)) return fail();
  return payload;
}
function parseAnswer(value: unknown, requestId: string): AnswerPayload {
  const row = version(value, requestId);
  if (row.answer !== "allow_once" && row.answer !== "always_allow" && row.answer !== "deny") return fail();
  const selectedEntryIds = strings(row.selectedEntryIds);
  if (new Set(selectedEntryIds).size !== selectedEntryIds.length) return fail();
  const sectionProfiles = Object.fromEntries(Object.entries(object(row.sectionProfiles)).map(([section, profile]) => [identifier(section), identifier(profile)]));
  return { v: 1, requestId, answer: row.answer, selectedEntryIds, sectionProfiles, answeredAt: date(row.answeredAt) };
}
function parseRouting(value: unknown, requestId: string): RoutingPayload {
  const row = version(value, requestId);
  const askReason = row.askReason;
  if (askReason !== null && askReason !== "site_not_listed" && askReason !== "rule_ask") return fail();
  return {
    v: 1, requestId, pairingId: identifier(row.pairingId), targetDisplay: text(row.targetDisplay), destinationKey: identifier(row.destinationKey), askReason: askReason as RoutingPayload["askReason"],
    sections: array(row.sections).map((value) => { const section = object(value); return { id: identifier(section.id), label: text(section.label) }; }),
    entries: array(row.entries).map((value) => {
      const entry = object(value);
      return { entryId: identifier(entry.entryId), fieldId: identifier(entry.fieldId), cipherId: identifier(entry.cipherId), fieldPath: identifier(entry.fieldPath),
        revisionDate: text(entry.revisionDate), profileId: nullable(entry.profileId), sectionId: identifier(entry.sectionId), label: text(entry.label) };
    }),
  };
}
function parseResult(value: unknown, requestId: string): ResultPayload {
  const row = version(value, requestId);
  const status = text(row.status);
  if (!Object.prototype.hasOwnProperty.call(terminal, status)) return fail();
  return { v: 1, requestId, status, finishedAt: date(row.finishedAt), entries: array(row.entries).map((value) => {
    const entry = object(value), outcome = text(entry.outcome);
    if (!Object.prototype.hasOwnProperty.call(outcomes, outcome)) return fail();
    return { entryId: identifier(entry.entryId), reference: identifier(entry.reference), outcome };
  }) };
}
function requestWire(value: unknown): RequestWire {
  const row = object(value);
  return { requestId: identifier(row.requestId), pairingId: identifier(row.pairingId), executorDeviceId: identifier(row.executorDeviceId), cipherIds: strings(row.cipherIds),
    routing: text(row.routing), note: nullable(row.note), answer: nullable(row.answer), result: nullable(row.result), status: text(row.status),
    receivedAt: date(row.receivedAt), deadline: date(row.deadline), answerRevision: number(row.answerRevision), resultRevision: number(row.resultRevision), revision: number(row.revision) };
}
function errorBody(error: unknown): { status: number; body: Record<string, unknown> } {
  const row = object(error);
  const status = number(row.statusCode ?? row.status ?? 0);
  const body = row.response ?? row.body ?? row;
  return { status, body: object(body) };
}

export interface AgentRotationRecords { agentRecords: object[]; formBindings: object[] }

export async function rotateAgentRecords(
  value: unknown, current: Pick<AgentRecordProtector, "open">, next: Pick<AgentRecordProtector, "seal">,
): Promise<AgentRotationRecords> {
  const snapshot = object(value);
  const agentRecords: object[] = [];
  const encryptedFields: Readonly<Record<string, readonly string[]>> = {
    pairing: ["encryptedMetadata"], request: ["routing", "note", "answer", "result"],
    grant: ["encryptedGrant"], activity: ["encryptedActivity"],
  };
  for (const value of array(snapshot.agentRecords)) {
    const row = object(value), kind = text(row.kind);
    if (!Object.prototype.hasOwnProperty.call(encryptedFields, kind)) fail();
    const rotated: Record<string, unknown> = { id: identifier(row.id), kind, revision: number(row.revision) };
    for (const field of encryptedFields[kind]) {
      const ciphertext = nullable(row[field]);
      rotated[field] = ciphertext === null ? null : await next.seal(await current.open(ciphertext));
    }
    agentRecords.push(rotated);
  }
  const formBindings: object[] = [];
  for (const value of array(snapshot.formBindings)) {
    const row = object(value);
    formBindings.push({ id: identifier(row.id), revision: number(row.revision),
      encryptedBinding: await next.seal(await current.open(text(row.encryptedBinding))) });
  }
  return { agentRecords, formBindings };
}

/** Keeps account encryption inside the unlocked authority. No key is returned to its caller. */
export class AccountAgentRecords implements AgentAccountCoordinator {
  private revision = 0;
  private loaded = false;
  private pairings = new Map<string, PairingWire>();
  private requests = new Map<string, RequestWire>();
  private grants = new Map<string, GrantWire>();
  private activities = new Map<string, ActivityWire>();
  private bindings = new Map<string, BindingWire>();
  private pending = new Map<string, unknown>();
  private syncing: Promise<AgentAccountSnapshot> | null = null;

  constructor(
    private readonly transport: AgentAccountTransport,
    private readonly protector: AgentRecordProtector,
    private readonly options: AgentAccountOptions,
  ) {
    if (!uuid.test(options.executorDeviceId)) fail();
  }

  private async seal(value: unknown): Promise<string> { return this.protector.seal(JSON.stringify(value)); }
  private async open(value: string): Promise<unknown> { return JSON.parse(await this.protector.open(value)); }
  private async ensureSync(): Promise<void> { if (!this.loaded) await this.sync(); }
  private async ciphertext(operation: string, plain: unknown, seal = (value: string) => this.protector.seal(value)): Promise<string> {
    const saved = this.pending.get(operation);
    if (typeof saved === "string") return saved;
    const encrypted = await seal(JSON.stringify(plain));
    this.pending.set(operation, encrypted);
    return encrypted;
  }

  async pairing(pairing: Pairing, localExecutorId: string): Promise<void> {
    await this.ensureSync();
    const previous = this.pairings.get(pairing.pairingId);
    if (previous) {
      const metadata = version(await this.open(previous.encryptedMetadata));
      if (metadata.pairingId !== pairing.pairingId || previous.localExecutorId !== localExecutorId || previous.executorDeviceId !== this.options.executorDeviceId) throw new AgentAccountError("pairing_mismatch", 409);
      if (previous.revokedAt !== null) throw new AgentAccountError("pairing_revoked", 409);
      return;
    }
    const payload: PairingPayload = { v: 1, pairingId: pairing.pairingId, displayName: pairing.displayName, localExecutorId,
      executorDeviceId: this.options.executorDeviceId, createdAt: pairing.createdAt, revokedAt: pairing.revokedAt };
    const encryptedMetadata = await this.ciphertext(`pairing:${pairing.pairingId}`, payload);
    const saved = this.parsePairing(await this.transport("POST", "/agent/pairings", { pairingId: pairing.pairingId, encryptedMetadata, localExecutorId, executorDeviceId: this.options.executorDeviceId }));
    this.pairings.set(saved.pairingId, saved);
  }

  async receive(request: Request): Promise<{ receivedAt: string; deadline: string; revision: number }> {
    await this.ensureSync();
    const routing: RoutingPayload = { v: 1, requestId: request.requestId, pairingId: request.pairingId,
      targetDisplay: request.targetDisplay, destinationKey: request.destinationKey, sections: request.sections.map(({ id, label }) => ({ id, label })),
      entries: request.entries.filter((entry) => entry.decision !== "deny")
        .map(({ entryId, fieldId, cipherId, fieldPath, revisionDate, profileId, sectionId, label }) => ({ entryId, fieldId, cipherId, fieldPath, revisionDate, profileId, sectionId, label })),
      askReason: request.entries.find((entry) => entry.askReason !== null)?.askReason ?? null };
    let saved = this.requests.get(request.requestId);
    if (!saved) {
      const ciphertext = await this.ciphertext(`routing:${request.requestId}`, routing);
      const note = request.note === null ? null : await this.ciphertext(`note:${request.requestId}`, { v: 1, requestId: request.requestId, goal: request.note.goal, reason: request.note.reason });
      try {
        saved = requestWire(await this.transport("POST", "/agent/requests", { requestId: request.requestId, pairingId: request.pairingId,
          cipherIds: [...new Set(request.entries.map((entry) => entry.cipherId))], routing: ciphertext, note, executorDeviceId: this.options.executorDeviceId }));
      } catch (error) {
        if (errorBody(error).status !== 409) throw error;
        await this.sync();
        saved = this.requests.get(request.requestId);
        if (!saved) throw error;
      }
    }
    const stored = parseRouting(await this.open(saved.routing), request.requestId);
    if (canonicalJson(stored) !== canonicalJson(routing) || saved.executorDeviceId !== this.options.executorDeviceId) throw new AgentAccountError("revision_mismatch", 409);
    this.requests.set(saved.requestId, saved);
    return { receivedAt: saved.receivedAt, deadline: saved.deadline, revision: saved.answerRevision };
  }

  async answer(requestId: string, answer: AnswerKind, selectedEntryIds: string[], sectionProfiles: Record<string, string> = {}): Promise<{ answer: AnswerPayload; revision: number }> {
    await this.ensureSync();
    let row = this.requests.get(requestId);
    if (!row) { await this.sync(); row = this.requests.get(requestId); }
    if (!row) throw new AgentAccountError("invalid_reference", 404);
    if (row.answer !== null) return { answer: parseAnswer(await this.open(row.answer), requestId), revision: row.answerRevision };
    const routing = parseRouting(await this.open(row.routing), requestId);
    if (selectedEntryIds.some((id) => !routing.entries.some((entry) => entry.entryId === id)) ||
        Object.keys(sectionProfiles).some((id) => !routing.sections.some((section) => section.id === id))) fail();
    const payload = parseAnswer({ v: 1, requestId, answer, selectedEntryIds, sectionProfiles, answeredAt: new Date().toISOString() }, requestId);
    const contentHash = await requestHash({ answer, selectedEntryIds, sectionProfiles });
    const encrypted = await this.ciphertext(`answer:${requestId}:${contentHash}`, payload);
    try {
      const saved = requestWire(await this.transport("PUT", `/agent/requests/${encodeURIComponent(requestId)}/answer`, { revision: row.answerRevision, answer: encrypted }));
      this.requests.set(requestId, saved);
      if (saved.answer === null) fail();
      return { answer: parseAnswer(await this.open(saved.answer), requestId), revision: saved.answerRevision };
    } catch (error) {
      const failure = errorBody(error);
      if (failure.status !== 409) throw error;
      if (typeof failure.body.answer === "string") {
        const winner = parseAnswer(await this.open(failure.body.answer), requestId);
        row.answer = failure.body.answer; row.answerRevision = number(failure.body.revision); row.note = null;
        return { answer: winner, revision: row.answerRevision };
      }
      await this.sync();
      const current = this.requests.get(requestId);
      if (current?.answer) return { answer: parseAnswer(await this.open(current.answer), requestId), revision: current.answerRevision };
      throw new AgentAccountError(typeof failure.body.code === "string" ? failure.body.code : "already_resolved", 409);
    }
  }

  async result(requestId: string, reply: AgentReply): Promise<void> {
    await this.ensureSync();
    const row = this.requests.get(requestId);
    if (!row) throw new AgentAccountError("invalid_reference", 404);
    if (row.executorDeviceId !== this.options.executorDeviceId) throw new AgentAccountError("not_executor", 403);
    const routing = parseRouting(await this.open(row.routing), requestId);
    const status = text(reply.status);
    if (!Object.prototype.hasOwnProperty.call(terminal, status)) fail();
    const entries = Array.isArray(reply.entries) ? reply.entries.map((value) => {
      const entry = object(value);
      return { entryId: identifier(entry.entryId), reference: identifier(entry.reference), outcome: text(entry.outcome) };
    }) : routing.entries.map((entry) => ({ entryId: entry.entryId, reference: formatVkReference(entry.cipherId, entry.fieldPath), outcome: status }));
    const payload = parseResult({ v: 1, requestId, status, entries, finishedAt: new Date().toISOString() }, requestId);
    if (row.result !== null) {
      const previous = parseResult(await this.open(row.result), requestId);
      if (previous.status !== status || canonicalJson(previous.entries) !== canonicalJson(entries)) throw new AgentAccountError("already_resolved", 409);
      return;
    }
    const encrypted = await this.ciphertext(`result:${requestId}`, payload);
    const saved = requestWire(await this.transport("PUT", `/agent/requests/${encodeURIComponent(requestId)}/result`, { revision: row.resultRevision, result: encrypted }));
    this.requests.set(requestId, saved);
  }

  async grant(row: Grant, requestId: string): Promise<void> {
    await this.ensureSync();
    const request = this.requests.get(requestId);
    if (!request?.answer) throw new AgentAccountError("already_resolved", 409);
    const answer = parseAnswer(await this.open(request.answer), requestId), routing = parseRouting(await this.open(request.routing), requestId);
    if (answer.answer !== "always_allow" || row.pairingId !== routing.pairingId || row.destinationKey !== routing.destinationKey ||
        !routing.entries.some((entry) => entry.cipherId === row.cipherId &&
          (entry.fieldPath.match(/^detail\.[^.]+/)?.[0] ?? entry.fieldPath) === row.fieldPath &&
          answer.selectedEntryIds.includes(entry.entryId))) throw new AgentAccountError("no_access", 403);
    const hash = await requestHash([row.pairingId, row.destinationKey, row.cipherId, row.fieldPath]);
    const grantId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const existing = this.grants.get(grantId);
    if (existing?.revokedAt && Date.parse(answer.answeredAt) <= Date.parse(existing.revokedAt)) throw new AgentAccountError("pairing_revoked", 409);
    const payload: GrantPayload = { v: 1, requestId, pairingId: row.pairingId, destinationKey: row.destinationKey, cipherId: row.cipherId, fieldPath: row.fieldPath, revokedAt: row.revokedAt };
    if (existing && canonicalJson(await this.open(existing.encryptedGrant)) === canonicalJson(payload)) return;
    const encryptedGrant = await this.ciphertext(`grant:${grantId}:${requestId}:${row.revokedAt}`, payload);
    const saved = this.parseGrant(await this.transport("PUT", `/agent/grants/${grantId}`, { grantId, sourceCipherId: row.cipherId, encryptedGrant, revision: existing?.revision ?? 0, revokedAt: row.revokedAt }));
    this.grants.set(saved.grantId, saved);
  }

  async activity(row: FillActivity): Promise<void> {
    const payload: FillActivityPayload = { v: 1, kind: "fill", requestId: row.requestId, sourceCipherId: row.sourceCipherId,
      entryId: row.entryId, reference: row.reference, destinationKey: row.destinationKey, pairingId: row.pairingId,
      answer: row.answer, outcome: row.outcome, askReason: row.askReason, at: row.at };
    await this.appendActivity(`fill:${row.requestId}:${row.sourceCipherId}:${row.entryId}`, row.sourceCipherId, payload,
      { kind: "fill", requestId: row.requestId, sourceCipherId: row.sourceCipherId, entryId: row.entryId });
  }

  async proxyActivity(row: ProxyActivityPayload): Promise<void> {
    const payload: ProxyActivityPayload = { v: 1, kind: "proxy", eventId: row.eventId, sourceCipherId: row.sourceCipherId,
      method: row.method, host: row.host, port: row.port, outcome: row.outcome, at: row.at, ...(row.status === undefined ? {} : { status: row.status }) };
    await this.appendActivity(`proxy:${row.eventId}`, row.sourceCipherId, payload, { kind: "proxy", eventId: row.eventId, sourceCipherId: row.sourceCipherId });
  }

  private async appendActivity(key: string, cipherId: string | null, payload: FillActivityPayload | ProxyActivityPayload, joins: object): Promise<void> {
    await this.ensureSync();
    for (const row of this.activities.values()) {
      const same = payload.kind === "fill" ? row.requestId === payload.requestId && row.sourceCipherId === payload.sourceCipherId && row.entryId === payload.entryId : row.eventId === payload.eventId;
      if (same) return;
    }
    if (cipherId && !this.options.sealSource) throw new AgentAccountError("no_access", 404);
    const source = cipherId == null ? null : await this.options.sealSource!(cipherId, JSON.stringify(payload));
    const operation = `activity:${key}:${source?.organizationId ?? "personal"}:${source?.revision ?? "none"}`;
    const encryptedActivity = await this.ciphertext(operation, payload,
      source == null ? (plain) => this.protector.seal(plain) : async () => source.ciphertext);
    let response: Record<string, unknown>;
    try {
      response = object(await this.transport("POST", "/agent/activity", { ...joins, encryptedActivity,
        sourceOrganizationId: source?.organizationId ?? null, sourceRevision: source?.revision ?? null }));
    } catch (error) {
      if (errorBody(error).status === 409) {
        const snapshot = await this.sync();
        if (snapshot.activity.some(({ activity }) => activity.kind === payload.kind &&
          (activity.kind === "fill" && payload.kind === "fill"
            ? activity.requestId === payload.requestId && activity.sourceCipherId === payload.sourceCipherId && activity.entryId === payload.entryId
            : activity.kind === "proxy" && payload.kind === "proxy" && activity.eventId === payload.eventId))) {
          return;
        }
      }
      throw error;
    }
    if (response.retained !== false) {
      const saved = this.parseActivity(response);
      this.activities.set(saved.activityId, saved);
    }
  }

  async revokePairing(pairingId: string): Promise<void> {
    await this.sync();
    const row = this.pairings.get(pairingId);
    if (!row) throw new AgentAccountError("unpaired", 404);
    if (row.revokedAt !== null) return;
    const saved = this.parsePairing(await this.transport("PUT", `/agent/pairings/${encodeURIComponent(pairingId)}`, { revision: row.revision, revokedAt: new Date().toISOString() }));
    this.pairings.set(pairingId, saved);
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.sync();
    const row = this.grants.get(grantId);
    if (!row) throw new AgentAccountError("invalid_reference", 404);
    if (row.revokedAt !== null) return;
    const old = version(await this.open(row.encryptedGrant)), revokedAt = new Date().toISOString();
    const encryptedGrant = await this.seal({ ...old, revokedAt });
    const saved = this.parseGrant(await this.transport("PUT", `/agent/grants/${encodeURIComponent(grantId)}`, { grantId, sourceCipherId: row.sourceCipherId, revision: row.revision, revokedAt, encryptedGrant }));
    this.grants.set(grantId, saved);
  }

  async putFormBinding(bindingId: string, binding: FormBindingV1): Promise<void> {
    await this.ensureSync();
    const row = this.bindings.get(bindingId);
    const encryptedBinding = await this.seal(binding);
    const saved = this.parseBinding(await this.transport("PUT", `/form-bindings/${encodeURIComponent(bindingId)}`, { bindingId, profileCipherId: binding.profileCipherId, revision: row?.revision ?? 0, encryptedBinding }));
    this.bindings.set(bindingId, saved);
  }

  async deleteFormBinding(bindingId: string): Promise<void> {
    await this.sync();
    const row = this.bindings.get(bindingId);
    if (!row) return;
    await this.transport("DELETE", `/form-bindings/${encodeURIComponent(bindingId)}?revision=${row.revision}`);
    this.bindings.delete(bindingId);
  }

  sync(): Promise<AgentAccountSnapshot> {
    if (this.syncing) return this.syncing;
    this.syncing = this.fetchSnapshot().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async fetchSnapshot(): Promise<AgentAccountSnapshot> {
    const snapshot = object(await this.transport("GET", `/agent/sync?since=${this.revision}`));
    if (snapshot.fullSnapshot !== true) fail();
    const revision = number(snapshot.revision);
    const pairings = array(snapshot.pairings).map((row) => this.parsePairing(row));
    const requests = array(snapshot.requests).map(requestWire);
    const grants = array(snapshot.grants).map((row) => this.parseGrant(row));
    const activities = array(snapshot.activity).map((row) => this.parseActivity(row));
    const bindings = array(snapshot.formBindings).map((row) => this.parseBinding(row));
    const result: AgentAccountSnapshot = { revision, fullSnapshot: true,
      pairings: await Promise.all(pairings.map(async ({ encryptedMetadata, ...row }) => {
        const metadata = version(await this.open(encryptedMetadata));
        if (metadata.pairingId !== row.pairingId || metadata.localExecutorId !== row.localExecutorId || metadata.executorDeviceId !== row.executorDeviceId) fail();
        return { ...row, metadata: { v: 1, pairingId: row.pairingId, localExecutorId: row.localExecutorId,
          executorDeviceId: identifier(metadata.executorDeviceId), displayName: text(metadata.displayName), createdAt: date(metadata.createdAt), revokedAt: nullable(metadata.revokedAt) } };
      })),
      requests: await Promise.all(requests.map(async ({ routing, note, answer, result, ...row }) => ({ ...row,
        routing: parseRouting(await this.open(routing), row.requestId),
        note: note === null ? null : this.parseNote(await this.open(note), row.requestId),
        answer: answer === null ? null : parseAnswer(await this.open(answer), row.requestId),
        result: result === null ? null : parseResult(await this.open(result), row.requestId),
      }))),
      grants: await Promise.all(grants.map(async ({ encryptedGrant, ...row }) => ({ ...row, grant: this.parseGrantPayload(await this.open(encryptedGrant), row) }))),
      activity: await Promise.all(activities.map(async ({ encryptedActivity, ...row }) => {
        let plain: string;
        if (row.sourceCipherId !== null) {
          if (!this.options.openSource) throw new AgentAccountError("no_access", 404);
          plain = await this.options.openSource(row.sourceCipherId, row.organizationId, encryptedActivity);
        } else {
          if (row.organizationId !== null) fail();
          plain = await this.protector.open(encryptedActivity);
        }
        return { ...row, activity: this.parseActivityPayload(JSON.parse(plain), row) };
      })),
      formBindings: await Promise.all(bindings.map(async ({ encryptedBinding, ...row }) => ({ ...row, binding: this.parseFormBinding(await this.open(encryptedBinding), row.profileCipherId) }))),
      tombstones: array(snapshot.tombstones).map((value) => { const row = object(value); return { kind: text(row.kind), id: identifier(row.id), revision: number(row.revision), deletedAt: date(row.deletedAt) }; }),
    };
    this.pairings = new Map(pairings.map((row) => [row.pairingId, row]));
    this.requests = new Map(requests.map((row) => [row.requestId, row]));
    this.grants = new Map(grants.map((row) => [row.grantId, row]));
    this.activities = new Map(activities.map((row) => [row.activityId, row]));
    this.bindings = new Map(bindings.map((row) => [row.bindingId, row]));
    this.revision = revision;
    this.loaded = true;
    return result;
  }

  private parsePairing(value: unknown): PairingWire { const row = object(value); return { pairingId: identifier(row.pairingId), localExecutorId: identifier(row.localExecutorId), executorDeviceId: nullable(row.executorDeviceId), encryptedMetadata: text(row.encryptedMetadata), revokedAt: nullable(row.revokedAt), revision: number(row.revision) }; }
  private parseGrant(value: unknown): GrantWire { const row = object(value); return { grantId: identifier(row.grantId), sourceCipherId: nullable(row.sourceCipherId), encryptedGrant: text(row.encryptedGrant), revokedAt: nullable(row.revokedAt), revision: number(row.revision) }; }
  private parseBinding(value: unknown): BindingWire { const row = object(value); return { bindingId: identifier(row.bindingId), profileCipherId: nullable(row.profileCipherId), encryptedBinding: text(row.encryptedBinding), revision: number(row.revision) }; }
  private parseActivity(value: unknown): ActivityWire {
    const row = object(value);
    if (row.kind !== "fill" && row.kind !== "proxy") fail();
    return { activityId: identifier(row.id), kind: row.kind, requestId: nullable(row.requestId), sourceCipherId: nullable(row.sourceCipherId),
      entryId: nullable(row.entryId), eventId: nullable(row.eventId), organizationId: nullable(row.organizationId), encryptedActivity: text(row.encryptedActivity), revision: number(row.revision), createdAt: date(row.createdAt) };
  }
  private parseNote(value: unknown, requestId: string): NotePayload { const row = version(value, requestId); return { v: 1, requestId, goal: text(row.goal), reason: text(row.reason) }; }
  private parseGrantPayload(value: unknown, wire: Omit<GrantWire, "encryptedGrant">): GrantPayload {
    const row = version(value);
    if (row.cipherId !== wire.sourceCipherId) fail();
    return { v: 1, requestId: identifier(row.requestId), pairingId: identifier(row.pairingId), destinationKey: identifier(row.destinationKey), cipherId: identifier(row.cipherId), fieldPath: identifier(row.fieldPath), revokedAt: nullable(row.revokedAt) };
  }
  private parseActivityPayload(value: unknown, wire: Omit<ActivityWire, "encryptedActivity">): FillActivityPayload | ProxyActivityPayload {
    const row = version(value);
    if (row.kind !== wire.kind || row.sourceCipherId !== wire.sourceCipherId) fail();
    if (row.kind === "fill") {
      const answer = row.answer;
      const askReason = row.askReason;
      if (row.requestId !== wire.requestId || row.entryId !== wire.entryId || (answer !== null && answer !== "allow_once" && answer !== "always_allow" && answer !== "deny") ||
          (askReason !== null && askReason !== "site_not_listed" && askReason !== "rule_ask")) return fail();
      return { v: 1, kind: "fill", requestId: identifier(row.requestId), sourceCipherId: identifier(row.sourceCipherId), entryId: identifier(row.entryId), reference: identifier(row.reference),
        destinationKey: identifier(row.destinationKey), pairingId: identifier(row.pairingId), answer: answer as AnswerKind | null, outcome: text(row.outcome), askReason: askReason as RoutingPayload["askReason"], at: number(row.at) };
    }
    if (row.eventId !== wire.eventId) fail();
    return { v: 1, kind: "proxy", eventId: identifier(row.eventId), sourceCipherId: nullable(row.sourceCipherId), method: text(row.method), host: text(row.host), port: number(row.port),
      outcome: text(row.outcome), at: number(row.at), ...(row.status === undefined ? {} : { status: number(row.status) }) };
  }
  private parseFormBinding(value: unknown, profileId: string | null): FormBindingV1 {
    const row = version(value);
    if (row.profileCipherId !== profileId) fail();
    return { v: 1, formSignature: identifier(row.formSignature), sectionId: identifier(row.sectionId), profileCipherId: identifier(row.profileCipherId), updatedAt: date(row.updatedAt),
      fields: array(row.fields).map((value) => { const field = object(value); if (typeof field.correctedByPerson !== "boolean") fail();
        return { fieldSignature: identifier(field.fieldSignature), detailId: identifier(field.detailId), variantId: nullable(field.variantId), format: { label: text(object(field.format).label) }, correctedByPerson: field.correctedByPerson }; }) };
  }
}
