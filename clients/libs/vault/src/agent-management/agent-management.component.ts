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

import { LOCAL_AGENT_MANAGEMENT, LocalAgentManagement, LocalAgentState } from "./local-agent-management";

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
    <main class="tw-mx-auto tw-w-full tw-max-w-4xl tw-p-6">
      <h1 class="tw-mb-5 tw-text-2xl tw-font-bold">{{ 'vowkeyAgents' | i18n }}</h1>
      <nav class="tw-mb-5 tw-flex tw-gap-4" [attr.aria-label]="'vowkeyAgents' | i18n">
        <button bitButton buttonType="secondary" type="button" [attr.aria-pressed]="tab() === 'agents'" (click)="tab.set('agents')">{{ 'vowkeyAgentAgentsTab' | i18n }}</button>
        <button bitButton buttonType="secondary" type="button" [attr.aria-pressed]="tab() === 'activity'" (click)="tab.set('activity')">{{ 'vowkeyActivity' | i18n }}</button>
      </nav>
      @if (error()) { <p class="tw-mb-4" role="alert">{{ 'vowkeyAgentAccountUnavailable' | i18n }}</p> }
      @if (localError()) { <p class="tw-mb-4" role="alert">{{ 'vowkeyAgentUnavailable' | i18n }}</p> }
      @if (tab() === 'agents') {
        @for (pair of localState()?.pairs; track pair.connectionId) {
          <section class="tw-mb-5 tw-flex tw-items-center tw-justify-between tw-gap-4 tw-rounded-xl tw-border tw-border-solid tw-border-secondary-300 tw-p-4">
            <div><strong>{{ pair.displayName }}</strong><p>{{ 'vowkeyAgentPairHelp' | i18n }}</p></div>
            <button bitButton buttonType="primary" type="button" [disabled]="busy()" (click)="approve(pair.connectionId)">{{ 'vowkeyAgentPair' | i18n }}</button>
          </section>
        }
        @for (request of pending(); track request.requestId) {
          <section class="tw-mb-5 tw-rounded-xl tw-border tw-border-solid tw-border-secondary-300 tw-p-4">
            <h2 class="tw-text-lg tw-font-semibold">{{ request.displayName }} · {{ request.targetDisplay }}</h2>
            <dl class="tw-my-4 tw-space-y-3">
              <div><dt class="tw-font-semibold">{{ 'vowkeyAgentGoal' | i18n }}</dt><dd class="tw-m-0 tw-whitespace-pre-wrap tw-break-words">{{ request.goal }}</dd></div>
              <div><dt class="tw-font-semibold">{{ 'vowkeyAgentNote' | i18n }}</dt><dd class="tw-m-0 tw-whitespace-pre-wrap tw-break-words">{{ request.reason }}</dd></div>
            </dl>
            <p class="tw-text-sm tw-text-muted">{{ request.deadline | date:'short' }}</p>
            <fieldset class="tw-my-4 tw-space-y-2">
              <legend class="tw-sr-only">{{ 'vowkeyAgentDetails' | i18n }}</legend>
              @for (entry of request.entries; track entry.entryId) {
                <label class="tw-flex tw-items-start tw-gap-2">
                  <input type="checkbox" [checked]="selected.has(entry.entryId)" (change)="select(entry.entryId, $event)" />
                  <span>{{ entry.label }}<small class="tw-block tw-break-all tw-text-muted">{{ entry.reference }}</small></span>
                </label>
              }
            </fieldset>
            <div class="tw-flex tw-flex-wrap tw-gap-2">
              <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="answer(request, 'deny')">{{ 'vowkeyAgentDeny' | i18n }}</button>
              <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="answer(request, 'always_allow')">{{ 'vowkeyAgentAlwaysAllow' | i18n }}</button>
              <button bitButton buttonType="primary" type="button" [disabled]="busy()" (click)="answer(request, 'allow_once')">{{ 'vowkeyAgentAllowOnce' | i18n }}</button>
            </div>
          </section>
        }
        @if (pending().length === 0 && !localState()?.pairs?.length) { <p>{{ 'vowkeyAgentNothingWaiting' | i18n }}</p> }
        <div class="tw-mt-6 tw-divide-y tw-divide-solid tw-divide-secondary-300">
          @for (pairing of snapshot()?.pairings; track pairing.pairingId) {
            @if (pairing.revokedAt == null) {
              <div class="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-3">
                <span>{{ pairing.metadata.displayName }}</span>
                <details><summary [attr.aria-label]="'more' | i18n">•••</summary>
                  <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="revokePairing(pairing.pairingId)">{{ 'vowkeyAgentRevoke' | i18n }}</button>
                </details>
              </div>
            }
          }
          @for (pairing of localPairings(); track pairing.pairingId) {
            @if (pairing.revokedAt == null) {
              <div class="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-3">
                <span>{{ pairing.displayName }}</span>
                <details><summary [attr.aria-label]="'more' | i18n">•••</summary>
                  <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="revokeLocalPairing(pairing.pairingId)">{{ 'vowkeyAgentRevoke' | i18n }}</button>
                </details>
              </div>
            }
          }
          @for (row of snapshot()?.grants; track row.grantId) {
            @if (row.revokedAt == null) {
              <div class="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-py-3">
                <span>{{ pairingName(row.grant.pairingId) }}<small class="tw-block tw-break-all tw-text-muted">{{ row.grant.destinationKey }}</small></span>
                <details><summary [attr.aria-label]="'more' | i18n">•••</summary>
                  <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="revokeGrant(row.grantId)">{{ 'vowkeyAgentRevoke' | i18n }}</button>
                </details>
              </div>
            }
          }
        </div>
      } @else {
        <button bitButton buttonType="secondary" type="button" [attr.aria-pressed]="needsLook()" (click)="needsLook.set(!needsLook())">{{ 'vowkeyNeedsLook' | i18n }}</button>
        <ul class="tw-m-0 tw-mt-4 tw-list-none tw-p-0">
          @for (row of activityRows(); track row.id) {
            <li class="tw-border-b tw-border-solid tw-border-secondary-300 tw-py-3">
              <strong class="tw-font-medium">{{ activityTitle(row.activity) }}</strong>
              <small class="tw-block tw-text-muted">{{ activityContext(row.activity) }} · {{ outcomeLabel(row.activity.outcome) }} · {{ row.activity.at | date:'short' }}</small>
            </li>
          }
        </ul>
      }
    </main>
  `,
})
export class AgentManagementComponent implements OnInit, OnDestroy {
  private readonly accounts = inject(AccountService);
  private readonly keys = inject(KeyService);
  private readonly ciphers = inject(CipherService);
  private readonly api = inject(ApiService);
  private readonly appId = inject(AppIdService);
  private readonly i18n = inject(I18nService);
  private readonly local = inject<LocalAgentManagement | null>(LOCAL_AGENT_MANAGEMENT, { optional: true });
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
