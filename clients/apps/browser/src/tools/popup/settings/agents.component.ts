import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { ButtonModule } from "@vowkey/components";

import { BrowserApi } from "../../../platform/browser/browser-api";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";

interface PendingRequest {
  requestId: string;
  displayName: string;
  goal: string;
  reason: string;
  targetDisplay: string;
  entries: { entryId: string; reference: string; label?: string }[];
}
interface AgentState {
  pairs: { connectionId: string; displayName: string }[];
  requests: PendingRequest[];
  pairings: { pairingId: string; displayName: string; revokedAt: string | null }[];
}

@Component({
  imports: [CommonModule, FormsModule, JslibModule, ButtonModule, PopupHeaderComponent, PopupPageComponent],
  template: `
    <popup-page>
      <popup-header slot="header" pageTitle="{{ 'vowkeyAgents' | i18n }}"></popup-header>
      <div class="tw-space-y-5 tw-p-4">
        @if (error()) { <p role="alert">{{ 'vowkeyAgentUnavailable' | i18n }}</p> }
        @if (!connected()) {
          <p>{{ 'vowkeyAgentConnectHelp' | i18n }}</p>
          <button bitButton buttonType="primary" type="button" [disabled]="busy()" (click)="connect()">
            {{ 'vowkeyAgentConnect' | i18n }}
          </button>
        } @else {
          <button bitButton buttonType="secondary" type="button" [disabled]="busy()" (click)="disconnect()">
            {{ 'vowkeyAgentDisconnect' | i18n }}
          </button>
          @for (pair of state().pairs; track pair.connectionId) {
            <section class="tw-border-b tw-border-solid tw-border-secondary-300 tw-pb-4">
              <h2 class="tw-text-base tw-font-semibold">{{ pair.displayName }}</h2>
              <p>{{ 'vowkeyAgentPairHelp' | i18n }}</p>
              <button bitButton buttonType="primary" type="button" [disabled]="busy()"
                (click)="act({action:'approve', connectionId:pair.connectionId})">
                {{ 'vowkeyAgentPair' | i18n }}
              </button>
            </section>
          }
          @for (request of state().requests; track request.requestId) {
            <section class="tw-space-y-3 tw-border-b tw-border-solid tw-border-secondary-300 tw-pb-4">
              <h2 class="tw-text-base tw-font-semibold">{{ request.displayName }} · {{ request.targetDisplay }}</h2>
              <div><h3 class="tw-font-semibold">{{ 'vowkeyAgentGoal' | i18n }}</h3>
                <p class="tw-whitespace-pre-wrap tw-break-words">{{ request.goal }}</p></div>
              <div><h3 class="tw-font-semibold">{{ 'vowkeyAgentNote' | i18n }}</h3>
                <p class="tw-whitespace-pre-wrap tw-break-words">{{ request.reason }}</p></div>
              <fieldset class="tw-space-y-2">
                <legend class="tw-sr-only">{{ 'vowkeyAgentDetails' | i18n }}</legend>
                @for (entry of request.entries; track entry.entryId) {
                  <label class="tw-flex tw-items-start tw-gap-2 tw-break-all">
                    <input type="checkbox" [checked]="selected.has(entry.entryId)"
                      (change)="select(entry.entryId, $event)" />
                    <span>{{ entry.label || entry.reference }}</span>
                  </label>
                }
              </fieldset>
              <div class="tw-flex tw-flex-wrap tw-gap-2">
                <button bitButton buttonType="primary" type="button" [disabled]="busy()"
                  (click)="answer(request, 'allow_once')">{{ 'vowkeyAgentAllowOnce' | i18n }}</button>
                <button bitButton buttonType="secondary" type="button" [disabled]="busy()"
                  (click)="answer(request, 'always_allow')">{{ 'vowkeyAgentAlwaysAllow' | i18n }}</button>
                <button bitButton buttonType="secondary" type="button" [disabled]="busy()"
                  (click)="answer(request, 'deny')">{{ 'vowkeyAgentDeny' | i18n }}</button>
              </div>
            </section>
          }
          @if (state().pairs.length === 0 && state().requests.length === 0) {
            <p>{{ 'vowkeyAgentNothingWaiting' | i18n }}</p>
          }
          @for (pairing of state().pairings; track pairing.pairingId) {
            @if (pairing.revokedAt == null) {
              <div class="tw-flex tw-items-center tw-justify-between tw-gap-3">
                <span>{{ pairing.displayName }}</span>
                <button bitButton buttonType="secondary" type="button" [disabled]="busy()"
                  (click)="act({action:'revoke', pairingId:pairing.pairingId})">{{ 'vowkeyAgentRevoke' | i18n }}</button>
              </div>
            }
          }
        }
      </div>
    </popup-page>
  `,
})
export class AgentsComponent implements OnInit, OnDestroy {
  readonly connected = signal(false);
  readonly busy = signal(false);
  readonly error = signal(false);
  readonly state = signal<AgentState>({ pairs: [], requests: [], pairings: [] });
  readonly selected = new Set<string>();
  private knownEntries = new Set<string>();
  private timer: number | undefined;
  private refreshing = false;

  async ngOnInit(): Promise<void> {
    await this.refresh();
    this.timer = window.setInterval((): void => { void this.refresh(); }, 2000);
  }
  ngOnDestroy(): void { clearInterval(this.timer); }

  async connect(): Promise<void> {
    this.busy.set(true);
    this.error.set(false);
    try {
      if (!await BrowserApi.requestPermission({ permissions: ["nativeMessaging"] })) {
        return;
      }
      await this.control({ action: "connect" });
      await this.refresh();
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  async disconnect(): Promise<void> { await this.act({ action: "disconnect" }); }

  select(id: string, event: Event): void {
    if ((event.target as HTMLInputElement).checked) { this.selected.add(id); }
    else { this.selected.delete(id); }
  }

  async answer(request: PendingRequest, answer: string): Promise<void> {
    await this.act({ action: "answer", targetRequestId: request.requestId, answer,
      selectedEntryIds: request.entries.filter((entry) => this.selected.has(entry.entryId)).map((entry) => entry.entryId) });
  }

  async act(body: object): Promise<void> {
    this.busy.set(true);
    this.error.set(false);
    try {
      await this.control(body);
      await this.refresh();
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) { return; }
    this.refreshing = true;
    try {
      const status = await this.control({ action: "status" }) as { connected: boolean };
      this.connected.set(status.connected === true);
      if (status.connected) {
        const state = await this.control({ action: "pending" }) as AgentState;
        state.pairings ??= [];
        const next = new Set(state.requests.flatMap((request) => request.entries.map((entry) => entry.entryId)));
        for (const id of next) { if (!this.knownEntries.has(id)) { this.selected.add(id); } }
        for (const id of this.selected) { if (!next.has(id)) { this.selected.delete(id); } }
        this.knownEntries = next;
        this.state.set(state);
      } else {
        this.state.set({ pairs: [], requests: [], pairings: [] });
      }
    } catch { this.error.set(true); }
    finally { this.refreshing = false; }
  }

  private async control(body: object): Promise<unknown> {
    const reply = await BrowserApi.sendMessageWithResponse<Record<string, unknown>>("agentControl", body);
    if (reply == null || reply.error != null || reply.type === "error") {
      throw new Error("executor_unavailable");
    }
    return reply;
  }
}
