import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { distinctUntilChanged, map, of, Subscription, switchMap } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AppIdService } from "@vowkey/common/platform/abstractions/app-id.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { AccountAgentAccess } from "@vowkey/common/vault/agent/account-authority";
import { AgentAccountSnapshot } from "@vowkey/common/vault/agent/account-records";
import { AnswerKind } from "@vowkey/common/vault/agent/executor";
import { formatVkReference } from "@vowkey/common/vault/reference";
import { ButtonModule } from "@vowkey/components";
import { KeyService } from "@vowkey/key-management";
import { I18nPipe } from "@vowkey/ui-common";

import { AI_FILL_AGENTS, AiFillAgent, AiFillAgentId, AiFillAgents } from "./ai-fill-agents";
import { LOCAL_AGENT_MANAGEMENT, LocalAgentManagement, LocalAgentState } from "./local-agent-management";

import { AGENT_LOGOS } from "./agent-logos";

type ManagementRequest = LocalAgentState["requests"][number] & { local: boolean };
type Activity = AgentAccountSnapshot["activity"][number]["activity"] | LocalAgentState["activity"][number];
const needsLookOutcomes: Record<string, true> = {
  not_allowed: true, never: true, no_access: true, not_written: true,
  not_confirmed: true, unmatched: true, timed_out: true,
};
const outcomeLabels: Record<string, string> = {
  confirmed: "vowkeyActivityFilled", not_allowed: "vowkeyActivityNotAllowed",
  never: "vowkeyActivityNotAllowed", no_access: "vowkeyActivityNotAllowed",
  timed_out: "vowkeyActivityTimedOut", not_written: "vowkeyActivityNotFilled",
  not_confirmed: "vowkeyActivityNotFilled", unmatched: "vowkeyActivityNotFilled",
};

@Component({
  selector: "vault-agent-management",
  standalone: true,
  imports: [CommonModule, ButtonModule, I18nPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="vk-agents">
      <div class="vk-agents-head">
        <h1>{{ 'vowkeyAgents' | i18n }}</h1>
        <nav class="vk-seg" [attr.aria-label]="'vowkeyAgents' | i18n">
          <button type="button" [attr.aria-pressed]="tab() === 'agents'" (click)="tab.set('agents')">{{ 'vowkeyAgentAgentsTab' | i18n }}</button>
          <button type="button" [attr.aria-pressed]="tab() === 'activity'" (click)="tab.set('activity')">{{ 'vowkeyActivity' | i18n }}</button>
        </nav>
      </div>
      @if (error()) { <p class="vk-alert" role="alert">{{ 'vowkeyAgentAccountUnavailable' | i18n }}</p> }
      @if (localError()) { <p class="vk-alert" role="alert">{{ 'vowkeyAgentUnavailable' | i18n }}</p> }
      @if (tab() === 'agents') {
        @if (fillAgents) {
          <section class="vk-card vk-fill-agents" data-testid="ai-fill-agents">
            <h2>{{ 'vowkeyAiFillTitle' | i18n }}</h2>
            <p class="vk-help">{{ 'vowkeyAiFillHelp' | i18n }}</p>
            <div class="vk-fill-list" role="radiogroup" [attr.aria-label]="'vowkeyAiFillTitle' | i18n">
              @if (!fillAgentsLoaded() && fillAgentList().length === 0) {
                @for (slot of [1, 2, 3]; track slot) {
                  <div class="vk-fill-row vk-fill-skeleton" aria-hidden="true">
                    <span class="vk-skel-dot"></span>
                    <span class="vk-agent-logo"></span>
                    <span class="vk-skel-lines"><i></i><small></small></span>
                  </div>
                }
              } @else {
                @for (agent of fillAgentList(); track agent.id) {
                  <label class="vk-fill-row" [class.off]="!agent.path" [attr.title]="agent.path || null">
                    <input type="radio" name="vk-fill-agent" [value]="agent.id" [disabled]="!agent.path"
                      [checked]="agent.id === activeFillAgent()" (change)="chooseFillAgent(agent.id)" />
                    <span class="vk-agent-logo" aria-hidden="true">
                      @if (logoOf(agent.id); as logo) { <img [src]="logo" alt="" /> } @else { <b>{{ agent.name.charAt(0) }}</b> }
                    </span>
                    <span class="vk-agent-name">
                      {{ agent.name }}
                      <small [class.ready]="!!agent.path">{{ agentStatusLabel(agent) }}</small>
                    </span>
                  </label>
                }
              }
            </div>
          </section>
        }
        @for (pair of localState()?.pairs; track pair.connectionId) {
          <section class="vk-card vk-pair-row">
            <div><strong>{{ pair.displayName }}</strong><p>{{ 'vowkeyAgentPairHelp' | i18n }}</p></div>
            <button bitButton buttonType="primary" type="button" [disabled]="busy()" (click)="approve(pair.connectionId)">{{ 'vowkeyAgentPair' | i18n }}</button>
          </section>
        }
        @for (request of pending(); track request.requestId) {
          <section class="vk-card">
            <h2>{{ request.displayName }} · {{ request.targetDisplay }}</h2>
            <dl class="vk-meta">
              <div><dt>{{ 'vowkeyAgentGoal' | i18n }}</dt><dd>{{ request.goal }}</dd></div>
              <div><dt>{{ 'vowkeyAgentNote' | i18n }}</dt><dd>{{ request.reason }}</dd></div>
            </dl>
            <p class="vk-deadline">{{ request.deadline | date:'short' }}</p>
            <fieldset class="vk-entries">
              <legend class="tw-sr-only">{{ 'vowkeyAgentDetails' | i18n }}</legend>
              @for (entry of request.entries; track entry.entryId) {
                <label class="vk-entry-row">
                  <input type="checkbox" [checked]="selected.has(entry.entryId)" (change)="select(entry.entryId, $event)" />
                  <span>{{ entry.label }}<small>{{ entry.reference }}</small></span>
                </label>
              }
            </fieldset>
            <div class="vk-actions">
              <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="answer(request, 'deny')">{{ 'vowkeyAgentDeny' | i18n }}</button>
              <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="answer(request, 'always_allow')">{{ 'vowkeyAgentAlwaysAllow' | i18n }}</button>
              <button bitButton buttonType="primary" type="button" [disabled]="busy()" (click)="answer(request, 'allow_once')">{{ 'vowkeyAgentAllowOnce' | i18n }}</button>
            </div>
          </section>
        }
        @if (pending().length === 0 && !localState()?.pairs?.length && (!fillAgents || hasConnectedPairings())) {
          <div class="vk-empty">{{ 'vowkeyAgentNothingWaiting' | i18n }}</div>
        }
        <div class="vk-list">
          @for (pairing of snapshot()?.pairings; track pairing.pairingId) {
            @if (pairing.revokedAt == null) {
              <div class="vk-list-row">
                <span>{{ pairing.metadata.displayName }}</span>
                <details class="vk-more"><summary [attr.aria-label]="'more' | i18n">•••</summary>
                  <div class="vk-more-sheet">
                    <button type="button" [disabled]="busy()" (click)="revokePairing(pairing.pairingId)">{{ 'vowkeyAgentRevoke' | i18n }}</button>
                  </div>
                </details>
              </div>
            }
          }
          @for (pairing of localPairings(); track pairing.pairingId) {
            @if (pairing.revokedAt == null) {
              <div class="vk-list-row">
                <span>{{ pairing.displayName }}</span>
                <details class="vk-more"><summary [attr.aria-label]="'more' | i18n">•••</summary>
                  <div class="vk-more-sheet">
                    <button type="button" [disabled]="busy()" (click)="revokeLocalPairing(pairing.pairingId)">{{ 'vowkeyAgentRevoke' | i18n }}</button>
                  </div>
                </details>
              </div>
            }
          }
          @for (row of snapshot()?.grants; track row.grantId) {
            @if (row.revokedAt == null) {
              <div class="vk-list-row">
                <span>{{ pairingName(row.grant.pairingId) }}<small>{{ row.grant.destinationKey }}</small></span>
                <details class="vk-more"><summary [attr.aria-label]="'more' | i18n">•••</summary>
                  <div class="vk-more-sheet">
                    <button type="button" [disabled]="busy()" (click)="revokeGrant(row.grantId)">{{ 'vowkeyAgentRevoke' | i18n }}</button>
                  </div>
                </details>
              </div>
            }
          }
        </div>
      } @else {
        <button type="button" class="vk-filter-chip" [attr.aria-pressed]="needsLook()" (click)="needsLook.set(!needsLook())">{{ 'vowkeyNeedsLook' | i18n }}</button>
        @if (activityRows().length === 0) {
          <div class="vk-empty vk-activity-empty">{{ tr('vowkeyNoActivityYet', 'No agent activity yet.') }}</div>
        } @else {
          <ul class="vk-activity">
            @for (row of activityRows(); track row.id) {
              <li>
                <strong>{{ activityTitle(row.activity) }}</strong>
                <small>{{ activityContext(row.activity) }} · {{ outcomeLabel(row.activity.outcome) }} · {{ row.activity.at | date:'short' }}</small>
              </li>
            }
          </ul>
        }
      }
    </main>
  `,
  styles: [`
    :host { display: block; color: var(--vk-ink); font-family: var(--font-sans); }
    .vk-agents { max-width: 760px; margin: 0 auto; padding: 22px 20px; }
    .vk-agents-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
    .vk-agents-head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: var(--vk-ink); }
    .vk-seg { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid var(--vk-line); border-radius: 10px; background: var(--vk-hover); }
    .vk-seg button { height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: var(--vk-muted); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
    .vk-seg button[aria-pressed="true"] { background: var(--vk-card); color: var(--vk-ink); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
    .vk-alert { margin: 0 0 14px; padding: 10px 12px; border: 1px solid var(--vk-line); border-radius: 8px; background: var(--vk-surface); color: var(--vk-amber); font-size: 13px; }
    .vk-card { margin-bottom: 14px; padding: 16px 18px; border: 1px solid var(--vk-line); border-radius: 12px; background: var(--vk-card); }
    .vk-pair-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .vk-pair-row p { margin: 3px 0 0; font-size: 13px; color: var(--vk-muted); }
    .vk-card h2 { margin: 0; font-size: 15.5px; font-weight: 600; }
    .vk-meta { display: grid; gap: 10px; margin: 12px 0; font-size: 13.5px; }
    .vk-meta dt { font-size: 12px; font-weight: 600; color: var(--vk-muted); margin-bottom: 2px; }
    .vk-meta dd { margin: 0; white-space: pre-wrap; word-break: break-word; }
    .vk-deadline { margin: 0 0 12px; font-size: 12.5px; color: var(--vk-muted); }
    .vk-entries { border: 0; padding: 0; margin: 0 0 14px; display: grid; gap: 8px; }
    .vk-entry-row { display: flex; align-items: flex-start; gap: 8px; font-size: 13.5px; }
    .vk-entry-row small { display: block; word-break: break-all; font-family: var(--font-mono); font-size: 11.5px; color: var(--vk-muted); }
    .vk-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .vk-empty { padding: 24px 16px; border: 1px solid var(--vk-line); border-radius: 12px; background: var(--vk-card); color: var(--vk-muted); font-size: 13.5px; text-align: center; }
    .vk-list { margin-top: 16px; border: 1px solid var(--vk-line); border-radius: 12px; background: var(--vk-card); overflow: visible; }
    .vk-list:empty { display: none; }
    .vk-list-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 16px; font-size: 14px; }
    .vk-list-row + .vk-list-row { border-top: 1px solid var(--vk-line-soft); }
    .vk-list-row small { display: block; word-break: break-all; font-size: 12px; color: var(--vk-muted); }
    .vk-more { position: relative; }
    .vk-more summary { list-style: none; padding: 4px 8px; border-radius: 6px; color: var(--vk-muted); cursor: pointer; }
    .vk-more summary::-webkit-details-marker { display: none; }
    .vk-more summary:hover { background: var(--vk-hover); color: var(--vk-ink); }
    .vk-more-sheet { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 130px; padding: 4px; border: 1px solid var(--vk-line); border-radius: 10px; background: var(--vk-card); box-shadow: var(--vk-shadow-panel); }
    .vk-more-sheet button { width: 100%; padding: 7px 10px; border: 0; border-radius: 6px; background: none; color: var(--vk-red); font: inherit; font-size: 13px; font-weight: 500; text-align: left; cursor: pointer; }
    .vk-more-sheet button:hover { background: var(--vk-hover); }
    .vk-filter-chip { height: 30px; padding: 0 12px; border: 1px solid var(--vk-line); border-radius: 8px; background: var(--vk-surface); color: var(--vk-muted); font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; }
    .vk-filter-chip[aria-pressed="true"] { border-color: var(--vk-ink); background: var(--vk-ink); color: var(--vk-paper); font-weight: 600; }
    .vk-activity { list-style: none; margin: 14px 0 0; padding: 0; border: 1px solid var(--vk-line); border-radius: 12px; background: var(--vk-card); }
    .vk-activity:empty { display: none; }
    .vk-activity li { padding: 11px 16px; }
    .vk-activity li + li { border-top: 1px solid var(--vk-line-soft); }
    .vk-activity strong { display: block; font-size: 14px; font-weight: 600; }
    .vk-activity small { display: block; margin-top: 2px; font-size: 12.5px; color: var(--vk-muted); }
    .vk-activity-empty { margin-top: 14px; }
    .vk-help { margin: 4px 0 12px; font-size: 13px; line-height: 1.42; color: var(--vk-muted); }
    .vk-fill-list { display: grid; gap: 2px; }
    .vk-fill-row { display: flex; align-items: center; gap: 12px; padding: 8px 8px; border-radius: var(--vk-radius-control, 8px); font-size: 14px; font-weight: 500; cursor: pointer; }
    .vk-fill-row input[type="radio"] { accent-color: var(--vk-blue, #2563eb); }
    .vk-agent-logo { display: grid; flex: none; width: 36px; height: 36px; place-items: center; border-radius: var(--vk-radius-row, 10px); background: #fff; box-shadow: inset 0 0 0 1px var(--vk-line); }
    .vk-agent-logo img { width: 22px; height: 22px; }
    .vk-agent-logo b { color: var(--vk-violet); font-size: 15px; }
    .vk-fill-row.off .vk-agent-logo { filter: grayscale(1); }
    .vk-fill-row:hover { background: var(--vk-hover); }
    .vk-fill-row.off { cursor: default; opacity: 0.55; }
    .vk-fill-row.off:hover { background: none; }
    .vk-fill-row small { display: block; margin-top: 1px; font-size: 12px; font-weight: 450; color: var(--vk-muted); }
    .vk-fill-row small.ready { color: var(--vk-green, #128a5a); font-weight: 500; }
    .vk-fill-skeleton { cursor: default; pointer-events: none; }
    .vk-skel-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--vk-hover); flex: none; }
    .vk-skel-lines { display: grid; gap: 5px; flex: 1; }
    .vk-skel-lines i, .vk-skel-lines small { display: block; height: 11px; border-radius: 5px; background: var(--vk-hover); }
    .vk-skel-lines i { width: 112px; }
    .vk-skel-lines small { width: 72px; height: 9px; }
  `],
})
export class AgentManagementComponent implements OnInit, OnDestroy {
  private readonly accounts = inject(AccountService);
  private readonly keys = inject(KeyService);
  private readonly ciphers = inject(CipherService);
  private readonly api = inject(ApiService);
  private readonly appId = inject(AppIdService);
  private readonly i18n = inject(I18nService);
  private readonly local = inject<LocalAgentManagement | null>(LOCAL_AGENT_MANAGEMENT, { optional: true });
  readonly fillAgents = inject<AiFillAgents | null>(AI_FILL_AGENTS, { optional: true });
  readonly logoOf = (id: string): string | undefined => AGENT_LOGOS[id];
  readonly fillAgentList = signal<AiFillAgent[]>([]);
  readonly fillAgentsLoaded = signal(false);
  private readonly chosenFillAgent = signal<AiFillAgentId | null>(null);
  /** The agent AI mode uses: the chosen one when installed, otherwise the first installed one. */
  readonly activeFillAgent = computed(() => {
    const list = this.fillAgentList();
    const chosen = this.chosenFillAgent();
    return list.find((a) => a.id === chosen && a.path)?.id ?? list.find((a) => a.path)?.id ?? null;
  });
  readonly snapshot = signal<AgentAccountSnapshot | null>(null);
  readonly localState = signal<LocalAgentState | null>(null);
  readonly tab = signal<"agents" | "activity">("agents");
  readonly needsLook = signal(false);
  readonly error = signal(false);
  readonly localError = signal(false);
  readonly busy = signal(false);
  readonly selected = new Set<string>();
  readonly pending = computed<ManagementRequest[]>(() => {
    const snapshot = this.snapshot();
    const remote = snapshot?.requests.filter((row) => row.answer == null && row.result == null && row.status === "pending" && row.note != null).map((row) => ({
      requestId: row.requestId, displayName: this.pairingName(row.pairingId), targetDisplay: row.routing.targetDisplay,
      goal: row.note!.goal, reason: row.note!.reason, deadline: row.deadline, local: false,
      entries: row.routing.entries.map((entry) => ({ entryId: entry.entryId, label: entry.label,
        reference: formatVkReference(entry.cipherId, entry.fieldPath), profileId: entry.profileId, sectionId: entry.sectionId })),
    })) ?? [];
    const known = new Set(snapshot?.requests.map((row) => row.requestId));
    return [...remote, ...this.localState()?.requests.filter((row) => !known.has(row.requestId)).map((row) => ({ ...row, local: true })) ?? []];
  });
  readonly localPairings = computed(() => this.localState()?.pairings.filter((row) => !this.snapshot()?.pairings.some((remote) => row.pairingId === remote.pairingId)) ?? []);
  readonly hasConnectedPairings = computed(() => {
    const remoteActive = this.snapshot()?.pairings.some((p) => p.revokedAt == null) ?? false;
    const localActive = this.localPairings().some((p) => p.revokedAt == null);
    const grantsActive = this.snapshot()?.grants.some((g) => g.revokedAt == null) ?? false;
    return remoteActive || localActive || grantsActive;
  });
  readonly activityRows = computed(() => {
    const remote = this.snapshot()?.activity.map((row) => ({ id: row.activityId, activity: row.activity as Activity })) ?? [];
    const local = this.localState()?.activity.filter((row) => !remote.some(({ activity }) => activity.kind === "fill" && activity.requestId === row.requestId && activity.entryId === row.entryId))
      .map((activity) => ({ id: `local:${activity.requestId}:${activity.entryId}`, activity: activity as Activity })) ?? [];
    return [...remote, ...local].filter(({ activity }) => !this.needsLook() || needsLookOutcomes[activity.outcome] === true || activity.kind === "fill" && activity.askReason === "site_not_listed")
      .sort((a, b) => b.activity.at - a.activity.at);
  });
  private authority: AccountAgentAccess | null = null;
  private session: Subscription | null = null;
  private timer: number | undefined;
  private epoch = 0;
  private refreshing = false;
  private refreshingLocal = false;
  private knownEntries = new Set<string>();

  ngOnInit(): void {
    this.session = this.accounts.activeAccount$.pipe(switchMap((account) => account == null ? of(null) :
      this.keys.userKey$(account.id).pipe(map((key) => key == null ? null : account.id))),
    distinctUntilChanged()).subscribe((userId) => {
      const epoch = ++this.epoch;
      this.authority = null; this.snapshot.set(null); this.localState.set(null);
      this.selected.clear(); this.knownEntries.clear();
      if (userId != null) { void this.open(userId, epoch); }
      void this.refreshLocal();
    });
    this.timer = window.setInterval(() => { void this.refresh(); void this.refreshLocal(); }, 2000);
    void this.loadFillAgents();
  }
  private async loadFillAgents(): Promise<void> {
    if (this.fillAgents == null) { return; }
    try {
      const [list, selected] = await Promise.all([this.fillAgents.list(), this.fillAgents.selected()]);
      this.fillAgentList.set(list); this.chosenFillAgent.set(selected);
    } catch { this.fillAgentList.set([]); }
    finally { this.fillAgentsLoaded.set(true); }
  }
  agentStatusLabel(agent: AiFillAgent): string {
    if (!agent.path) {
      return this.tr("vowkeyAiFillNotInstalled", "Not installed");
    }
    return agent.id === this.activeFillAgent()
      ? this.tr("vowkeyAiFillActive", "Active")
      : this.tr("vowkeyAiFillInstalled", "Installed");
  }
  tr(key: string, fallback: string): string {
    const translated = this.i18n.t(key);
    return translated && translated !== key ? translated : fallback;
  }
  async chooseFillAgent(id: AiFillAgentId): Promise<void> {
    this.chosenFillAgent.set(id);
    await this.fillAgents?.select(id);
  }
  ngOnDestroy(): void {
    this.epoch++; this.session?.unsubscribe(); clearInterval(this.timer);
    this.authority = null; this.snapshot.set(null); this.localState.set(null);
  }
  private async open(userId: UserId, epoch: number): Promise<void> {
    try {
      const deviceId = await this.appId.getAppId();
      if (epoch !== this.epoch) { return; }
      this.authority = new AccountAgentAccess(userId, this.accounts, this.keys, this.ciphers, this.api, deviceId);
      await this.refresh();
    } catch { if (epoch === this.epoch) { this.error.set(true); } }
  }
  select(id: string, event: Event): void {
    if ((event.target as HTMLInputElement).checked) { this.selected.add(id); }
    else { this.selected.delete(id); }
  }
  pairingName(id: string): string {
    return this.snapshot()?.pairings.find((row) => row.pairingId === id)?.metadata.displayName ?? this.localState()?.pairings.find((row) => row.pairingId === id)?.displayName ?? "";
  }
  activityTitle(activity: Activity): string { return activity.kind === "proxy" ? `${activity.method} ${activity.host}` : activity.reference; }
  activityContext(activity: Activity): string { return activity.kind === "proxy" ? "" : `${this.pairingName(activity.pairingId)} · ${activity.destinationKey}`; }
  outcomeLabel(outcome: string): string {
    const key = outcomeLabels[outcome];
    return typeof key === "string" ? this.i18n.t(key) : outcome;
  }
  answer(request: ManagementRequest, answer: AnswerKind): Promise<void> {
    const entries = answer === "deny" ? [] : request.entries.filter((row) => this.selected.has(row.entryId)).map((row) => row.entryId);
    return request.local ? this.perform(() => this.local!.answer(request.requestId, answer, entries), true) :
      this.act((authority) => authority.coordination.answer(request.requestId, answer, entries));
  }
  approve(id: string): Promise<void> { return this.perform(() => this.local!.approve(id), true); }
  revokeLocalPairing(id: string): Promise<void> { return this.perform(() => this.local!.revoke(id), true); }
  revokePairing(id: string): Promise<void> { return this.act((authority) => authority.coordination.revokePairing(id)); }
  revokeGrant(id: string): Promise<void> { return this.act((authority) => authority.coordination.revokeGrant(id)); }
  private act(operation: (authority: AccountAgentAccess) => Promise<unknown>): Promise<void> {
    const authority = this.authority;
    return authority == null ? Promise.resolve() : this.perform(() => operation(authority));
  }
  private async perform(operation: () => Promise<unknown>, local = false): Promise<void> {
    if (this.busy()) { return; }
    const epoch = this.epoch; this.busy.set(true);
    try { await operation(); await Promise.all([this.refresh(), this.refreshLocal()]); }
    catch { if (epoch === this.epoch) { (local ? this.localError : this.error).set(true); } }
    finally { this.busy.set(false); }
  }
  private updateSelection(): void {
    const next = new Set(this.pending().flatMap((row) => row.entries.map((entry) => entry.entryId)));
    for (const id of next) { if (!this.knownEntries.has(id)) { this.selected.add(id); } }
    for (const id of this.selected) { if (!next.has(id)) { this.selected.delete(id); } }
    this.knownEntries = next;
  }
  private async refresh(): Promise<void> {
    const authority = this.authority;
    if (authority == null || this.refreshing) { return; }
    this.refreshing = true;
    try {
      const snapshot = await authority.coordination.sync();
      if (authority !== this.authority) { return; }
      this.snapshot.set(snapshot); this.updateSelection(); this.error.set(false);
    } catch { if (authority === this.authority) { this.error.set(true); } }
    finally { this.refreshing = false; }
  }
  private async refreshLocal(): Promise<void> {
    if (this.local == null || this.refreshingLocal) { return; }
    const epoch = this.epoch; this.refreshingLocal = true;
    try {
      const state = await this.local.pending();
      if (epoch !== this.epoch) { return; }
      this.localState.set(state); this.updateSelection(); this.localError.set(false);
    } catch { if (epoch === this.epoch) { this.localState.set(null); this.localError.set(true); } }
    finally { this.refreshingLocal = false; }
  }
}
