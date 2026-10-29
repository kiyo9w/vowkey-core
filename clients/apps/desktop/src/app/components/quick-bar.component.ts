import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { combineLatest, firstValueFrom, map, of, Subject, switchMap, takeUntil } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { AppIdService } from "@vowkey/common/platform/abstractions/app-id.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { AccountAgentAuthority } from "@vowkey/common/vault/agent/account-authority";
import { invokeAccountCoordinator } from "@vowkey/common/vault/agent/account-bridge";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { parseOwnerSecretsQuery } from "@vowkey/common/vault/agent/owner-secrets";
import { AgentTarget, AgentWrite } from "@vowkey/common/vault/agent/targets";
import { KeyService } from "@vowkey/key-management";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { readEnvelope, resolveDetailVariant, profileUsableForFill } from "@vowkey/common/vault/profile/vk-meta";
import { ProfileComponent } from "@vowkey/vault";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { CapturedDocument, detail_label } from "@vowkey/sdk-internal";

import type { QuickBarRequest } from "../../quick-bar/types";
import { VowkeyHub } from "../vowkey/vowkey-hub.service";
import {
  AddedDetail,
  DocumentCaptureService,
  CaptureProfileChoiceRequiredError,
  DocumentAdded,
  PendingDocumentOperation,
  FILLABLE_FORM,
  Unclear,
} from "../services/document-capture.service";

/** One detail in a profile: what it is, whose it is, and its value. */
export interface QuickBarDetail {
  id: string;
  label: string;
  profile: string;
  value: string;
  profileId: string;
  detailId?: string;
  variantId?: string;
  sourceId?: string;
  attribute?: string;
}

export type QuickBarSlot = "search" | "drop" | "reading" | "choose" | "added" | "notice";

const MAX_ROWS = 8;

/** The details forms ask for most, which lead the pill's list before anything is typed. */
const MOST_ASKED = [
  "name.full",
  "name.full.latin",
  "name.full.kana",
  "birth.date",
  "id.passport.number",
  "id.residence_card.number",
  "id.national.number",
  "id.driver_license.number",
  "contact.phone.mobile",
  "contact.phone",
  "contact.email",
  "address.full",
  "address.postal",
];

/** Where a detail (by its hit id, "<profile id>-<key>") sits in MOST_ASKED; the rest follow. */
function firstAsked(id: string): number {
  const index = MOST_ASKED.findIndex((key) => id.endsWith(`-${key}`));
  return index === -1 ? MOST_ASKED.length : index;
}

@Component({
  selector: "vowkey-quick-bar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ProfileComponent],
  template: `
    @if (isUnlocked()) {
      @if (dragging()) {
        <div class="vk-window-drop" aria-hidden="true">
          <div><b>Drop a document to add it</b><span>or a form to fill</span></div>
        </div>
      }
      @if (!isOpen()) {
      @if (reader(); as opened) {
        <div class="vk-reader-backdrop" (click)="closeReader()">
          <section class="vk-reader-dialog" role="dialog" aria-modal="true" aria-labelledby="vk-reader-title" (click)="$event.stopPropagation()">
            <header><div><h2 id="vk-reader-title">{{ opened.profile.name }}</h2>@if (readerNote()) { <p role="status">{{ readerNote() }}</p> }</div><button type="button" (click)="closeReader()" aria-label="Close profile">Close</button></header>
            <app-profile [cipher]="opened.profile" [initialSourceId]="opened.sourceId" [initialVariantId]="opened.variantId" />
          </section>
        </div>
      }
      } @else {
        <div
          class="vk-quick-backdrop"
          (click)="closeBar()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          <input
            id="vk-quick-file"
            type="file"
            class="vk-hidden-file"
            data-testid="quick-bar-file-input"
            (change)="onFileSelected($event)"
          />
          <div class="vk-quick-container" (click)="$event.stopPropagation()">
            <div
              class="pill2 mac"
              id="p-pill"
              data-testid="vowkey-quick-bar-pill"
              role="group"
              aria-label="Vowkey"
            >
              <button
                type="button"
                class="p-mark"
                title="Open the vault"
                data-testid="quick-bar-open-hub"
                (click)="openVault()"
              >
                <svg class="vk-mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M4 3h8a2 2 0 0 1 2 2v1h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.5 5.5v9h13v-9h-13z"
                  />
                </svg>
              </button>

              @switch (slot()) {
                @case ("drop") {
                  <div class="p-drop">Drop a document to add it, or a form to fill</div>
                }
                @case ("reading") {
                  <div class="p-read" data-testid="quick-bar-status">
                    <b>{{ statusTitle() }}</b>
                    <small>{{ statusSubtitle() }}</small>
                  </div>
                }
                @case ("choose") {
                  <div class="p-read" data-testid="quick-bar-status">
                    <b>{{ statusTitle() }}</b>
                    <small>{{ statusSubtitle() }}</small>
                  </div>
                }
                @case ("added") {
                  <div class="p-stat" data-testid="quick-bar-status">
                    <span class="ok">✓</span>
                    <span
                      ><b>{{ statusTitle() }}</b> {{ statusSubtitle() }}</span
                    >
                  </div>
                }
                @case ("notice") {
                  <div class="p-stat" [class.bad]="!noticeGood()" data-testid="quick-bar-status">
                    <span class="ok">{{ noticeGood() ? "✓" : "!" }}</span>
                    <span><b>{{ statusTitle() }}</b></span>
                  </div>
                }
                @default {
                  <label class="p-search">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
                      <circle cx="7" cy="7" r="4.8" />
                      <path d="M10.6 10.6 14 14" stroke-linecap="round" />
                    </svg>
                    <input
                      id="p-q"
                      data-testid="quick-bar-search-input"
                      placeholder="Search details"
                      [ngModel]="query()"
                      (ngModelChange)="onQueryChange($event)"
                      autocomplete="off"
                      aria-label="Search details"
                    />
                    <kbd>⌘K</kbd>
                  </label>
                  <label
                    class="p-add"
                    for="vk-quick-file"
                    title="Add a document to a profile, or fill a form"
                  >
                    Add or fill
                  </label>
                }
              }
            </div>

            @if (slot() === "search") {
              <div class="p-sheet mac" id="p-sheet" data-testid="quick-bar-sheet">
                <div class="sh">{{ query().trim() ? "Details" : "Your details" }}</div>
                @if (profiles().length > 1) {
                  <label class="qnote">Profile
                    <select [ngModel]="selectedProfileId()" (ngModelChange)="selectProfile($event)">
                      <option value="">All profiles</option>
                      @for (profile of profiles(); track profile.id) { <option [value]="profile.id">{{ profile.name }}</option> }
                    </select>
                  </label>
                }
                @for (operation of operations(); track operation.id) {
                  <div class="qrow"><div class="qrow-main"><small>{{ operation.kind === 'move' ? 'Move waiting' : operation.kind === 'delete' ? 'Deletion waiting' : 'Upload waiting' }}</small><b>{{ operation.fileName }}</b></div><button type="button" class="qact p" [disabled]="retrying()" (click)="retry(operation.id)">Retry</button></div>
                }
                @if (filteredHits().length > 0) {
                  @for (hit of filteredHits(); track hit.id; let idx = $index) {
                    <div
                      class="qrow"
                      [class.sel]="idx === selectedIndex()"
                      [attr.data-prow]="idx"
                      (mouseenter)="selectedIndex.set(idx)"
                    >
                      <div class="qrow-main">
                        <small>{{ hit.label }} · {{ hit.profile }}</small>
                        <b>{{ hit.value }}</b>
                      </div>
                      <span class="acts">
                        <button
                          class="qact p"
                          type="button"
                          [attr.data-pcopy]="idx"
                          (click)="copyHit(hit)"
                        >
                          Copy
                        </button>
                        <details class="hit-menu"><summary [attr.aria-label]="'More for ' + hit.label">•••</summary><div>
                          <button type="button" (click)="openProfile(hit.profileId)">Open profile</button>
                          @if (hit.sourceId) { <button type="button" (click)="openProfile(hit.profileId, hit.sourceId, hit.variantId)">Show in document</button> }
                        </div></details>
                      </span>
                    </div>
                  }
                } @else {
                  <div class="qempty">
                    {{
                      query().trim()
                        ? "No detail matches “" + query().trim() + "”."
                        : "Add a document or type the details to fill this form."
                    }}
                  </div>
                }
                  <div class="qnote"><label for="vk-quick-file" class="qact p">Add document</label><button type="button" class="qact s" (click)="enterDetails()">Enter details</button></div>
                <div class="foot2">
                  <span>↑↓ to choose · <kbd>↵</kbd> to copy</span>
                  <span>Drop a document here to add it</span>
                </div>
              </div>
            }

            @if (slot() === "choose") {
              <div class="p-sheet mac" data-testid="quick-bar-choose">
                <div class="sh">{{ pendingCapture() ? 'Add document to' : 'Fill from' }}</div>
                @for (choice of choices(); track choice.id) {
                  <div class="qrow">
                    <div class="qrow-main">
                      <b>{{ choice.name }}</b>
                    </div>
                    <span class="acts">
                      <button
                        class="qact p"
                        type="button"
                        [attr.data-pchoose]="choice.id"
                        (click)="fillFrom(choice)"
                      >
                        {{ pendingCapture() ? 'Add here' : 'Fill' }}
                      </button>
                    </span>
                  </div>
                }
              </div>
                <button class="qact s" type="button" (click)="cancelChoice()">Cancel</button>
            }

            @if (slot() === "notice" && statusSubtitle()) {
              <div class="p-sheet mac" data-testid="quick-bar-notice">
                <div class="qnote">{{ statusSubtitle() }}</div>
              </div>
                @if (postFillOffer()) {
                  <div class="qnote"><b>Use these details on your other devices</b><p>Create an account to sync this vault.</p><button type="button" class="qact p" (click)="openProtection()">Continue</button><button type="button" class="qact s" (click)="dismissOffer()">Not now</button></div>
                }
                @if (pendingForm() && profiles().length === 0) {
                  <div class="qnote"><label for="vk-quick-file" class="qact p">Add document</label><button type="button" class="qact s" (click)="enterDetails()">Enter details</button></div>
                }
            }

            @if (slot() === "added") {
              <div class="p-sheet mac" data-testid="quick-bar-added">
                <div class="sh">Read from {{ addedFrom() }}</div>
                @for (detail of added(); track detail.key) {
                  <div class="qrow">
                    <div class="qrow-main">
                      <small>{{ detail.label }}</small>
                      <b>{{ detail.value }}</b>
                    </div>
                  </div>
                }
                @if (!attached()) {
                  <div class="qempty">The upload is waiting. The original document is kept on this device for retry.</div>
                }
                <div class="foot2">
                  <span>Change any of them in the profile.</span>
                  <span class="acts">
                    <button class="qact s" type="button" (click)="closeBar()">Done</button>
                    <button
                      class="qact p"
                      type="button"
                      data-testid="quick-bar-open-profile"
                      (click)="openProfile()"
                    >
                      Open profile
                    </button>
                  </span>
                    @if (pendingForm()) { <button class="qact s" type="button" (click)="fillAdded()">Fill form</button> }
                </div>
              </div>
            }
          </div>
        </div>
      }
    }
  `,
  styles: [
    `
      .vk-window-drop {
        position: fixed;
        inset: 0;
        z-index: 2200;
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--vk-window, #fff) 82%, transparent);
        backdrop-filter: blur(6px);
        pointer-events: none;
      }
      .vk-window-drop > div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        align-items: center;
        padding: 44px 64px;
        border: 2px dashed var(--vk-blue, #2563eb);
        border-radius: 20px;
        color: var(--vk-ink, #121216);
        font-family: var(--font-sans);
      }
      .vk-window-drop b { font-size: 20px; font-weight: 700; }
      .vk-window-drop span { color: var(--vk-muted, #5b5d66); font-size: 15px; }

      .vk-quick-trigger {
        position: fixed;
        top: 10px;
        right: 14px;
        z-index: 1050;
        height: 28px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 10px;
        border-radius: 99px;
        border: 1px solid rgba(15, 23, 42, 0.14);
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(14px);
        color: #0f172a;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
      }
      .vk-quick-trigger kbd {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        color: #64748b;
      }
      .vk-quick-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2000;
        background: rgba(15, 23, 42, 0.12);
      }
      .vk-quick-container {
        position: absolute;
        top: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }
      .pill2 {
        height: 46px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px;
        background: rgba(255, 255, 255, 0.94);
        backdrop-filter: blur(22px) saturate(1.4);
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 99px;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.18);
        white-space: nowrap;
        color: #0f172a;
      }
      .p-mark {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 0;
        background: transparent;
        display: grid;
        place-items: center;
        color: #0f172a;
        cursor: pointer;
      }
      .p-mark:hover {
        background: rgba(15, 23, 42, 0.06);
      }
      .p-search {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 240px;
        height: 34px;
        padding: 0 12px;
        border-radius: 99px;
        background: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
        cursor: text;
      }
      .p-search svg {
        width: 13px;
        height: 13px;
        color: #64748b;
        flex: none;
      }
      .p-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: none;
        outline: none;
        font-size: 12.5px;
        color: #0f172a;
      }
      .p-search kbd {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        color: #64748b;
      }
      .p-add {
        height: 34px;
        padding: 0 14px;
        border-radius: 99px;
        background: #2563eb;
        color: #ffffff;
        font-weight: 600;
        font-size: 12.5px;
        display: flex;
        align-items: center;
        cursor: pointer;
      }
      .p-drop {
        width: 300px;
        height: 34px;
        border-radius: 99px;
        border: 1.5px dashed #2563eb;
        color: #1d4ed8;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 12px;
        cursor: copy;
      }
      .p-read {
        display: grid;
        line-height: 1.25;
        padding: 0 12px;
        min-width: 200px;
        max-width: 320px;
      }
      .p-read b {
        font-size: 12.5px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-read small {
        font-size: 11px;
        color: #64748b;
      }
      .p-stat {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 12px 0 10px;
        font-size: 12.5px;
        max-width: 420px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-stat .ok {
        color: #15803d;
        font-weight: 700;
      }
      .p-stat.bad .ok {
        color: #b45309;
      }
      .p-sheet {
        width: 392px;
        max-height: 70vh;
        overflow-y: auto;
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(22px) saturate(1.4);
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 18px;
        box-shadow: 0 16px 38px rgba(15, 23, 42, 0.18);
        padding: 6px;
        display: grid;
        gap: 2px;
        color: #0f172a;
      }
      .p-sheet .sh {
        font-size: 10.5px;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: #64748b;
        font-weight: 600;
        padding: 6px 10px 3px;
      }
      .qrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-radius: 12px;
        padding: 7px 10px;
      }
      .qrow.sel {
        background: rgba(37, 99, 235, 0.08);
      }
      .qrow-main {
        min-width: 0;
        display: grid;
      }
      .qrow-main small {
        font-size: 11px;
        color: #64748b;
      }
      .qrow-main b {
        font-size: 12.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .acts {
        display: inline-flex;
        gap: 5px;
        flex: none;
      }
      .qact {
        border: 0;
        border-radius: 7px;
        padding: 4px 9px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .qact.s {
        background: rgba(15, 23, 42, 0.06);
        color: #0f172a;
      }
      .qact.p {
        background: #2563eb;
        color: #ffffff;
      }
      .qempty {
        padding: 14px 10px;
        font-size: 12px;
        color: #64748b;
        text-align: center;
      }
      .qnote {
        padding: 10px 12px;
        font-size: 12.5px;
        line-height: 1.4;
        color: #334155;
      }
      .foot2 {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px 3px;
        border-top: 1px solid rgba(15, 23, 42, 0.08);
        margin-top: 3px;
        font-size: 11px;
        color: #64748b;
      }
      .vk-hidden-file {
        display: none;
      }
      .vk-reader-backdrop{position:fixed;inset:0;z-index:2100;background:#10182850;display:flex;justify-content:center;align-items:center;padding:24px}.vk-reader-dialog{background:var(--vk-card,#fff);color:var(--vk-ink,#17202e);width:min(1100px,100%);max-height:90vh;overflow:auto;border:1px solid var(--vk-line,#d9dde3);border-radius:14px;box-shadow:0 20px 80px #0003;padding:20px}.vk-reader-dialog>header{display:flex;align-items:start;justify-content:space-between;gap:16px;margin-bottom:12px}.vk-reader-dialog h2{margin:0;font-size:20px}.vk-reader-dialog p{margin:6px 0;font-size:13px}.vk-reader-dialog>header button{border:0;background:none;color:inherit;cursor:pointer}.hit-menu{position:relative}.hit-menu summary{cursor:pointer;padding:5px}.hit-menu>div{position:absolute;right:0;z-index:2;min-width:160px;background:var(--vk-card,#fff);border:1px solid var(--vk-line,#d9dde3);border-radius:8px;padding:6px;box-shadow:0 6px 20px #0002}.hit-menu button{display:block;width:100%;text-align:left;padding:8px;border:0;background:none;color:inherit;cursor:pointer}.qnote select{max-width:100%;margin-left:8px;padding:5px;border:1px solid #d9dde3;background:transparent;color:inherit;border-radius:6px}
    `,
  ],
})
export class QuickBarComponent implements OnInit, OnDestroy {
  readonly isUnlocked = signal(false);
  readonly isOpen = signal(false);
  readonly slot = signal<QuickBarSlot>("search");
  readonly query = signal("");
  readonly selectedIndex = signal(0);
  readonly statusTitle = signal("");
  readonly statusSubtitle = signal("");
  readonly noticeGood = signal(true);

  readonly profiles = signal<CipherView[]>([]);
  readonly selectedProfileId = signal("");
  readonly operations = signal<PendingDocumentOperation[]>([]);
  readonly retrying = signal(false);
  readonly postFillOffer = signal(false);
  readonly reader = signal<{ profile: CipherView; sourceId: string | null; variantId: string | null } | null>(null);
  readonly readerNote = signal("");
  private accountStatus = AuthenticationStatus.LoggedOut;
  private refreshGeneration = 0;
  private addedSourceId: string | null = null;
  private agentAuthority: AgentVaultAuthority | null = null;
  private agentEpoch = 0;
  private agentSession = "";
  private agentKey: unknown = null;
  private frontForm: { path: string; name: string; bytes: Uint8Array } | null = null;
  readonly allHits = signal<QuickBarDetail[]>([]);
  readonly filteredHits = computed(() => {
    const query = this.query().trim().toLowerCase();
    const hits = this.selectedProfileId() ? this.allHits().filter((hit) => hit.profileId === this.selectedProfileId()) : this.allHits();
    return (
      query
        ? hits.filter((h) => `${h.label} ${h.profile} ${h.value}`.toLowerCase().includes(query))
        : hits
    ).slice(0, MAX_ROWS);
  });

  /** What the last document added, and the profile it went to. */
  readonly added = signal<AddedDetail[]>([]);
  readonly attached = signal(true);
  readonly addedFrom = signal("");
  private readonly addedProfile = signal<CipherView | null>(null);
  /** What to say when a photo is too small or too unclear to read. */
  private readonly notRead: Record<Unclear, string> = {
    small: "The print is too small in this photo. Retake it closer, or add the original file.",
    unclear: "This photo is too unclear to read. Retake it, or add the original file.",
  };

  /** The profiles to pick from when a form could be filled from more than one. */
  readonly choices = signal<CipherView[]>([]);
  readonly pendingForm = signal<{ file: File; bytes: Uint8Array } | null>(null);
  readonly pendingCapture = signal<{ file: File; bytes: Uint8Array; captured: CapturedDocument } | null>(null);

  private readonly destroy$ = new Subject<void>();

  private readonly hub = inject(VowkeyHub);

  constructor(
    private readonly authService: AuthService,
    private readonly documents: DocumentCaptureService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly router: Router,
    private readonly zone: NgZone,
    private readonly localVault: LocalVaultService,
    private readonly accounts: AccountService,
    private readonly keys: KeyService,
    private readonly ciphers: CipherService,
    private readonly api: ApiService,
    private readonly appId: AppIdService,
  ) {}

  ngOnInit(): void {
    this.hub.openRequests$.pipe(takeUntil(this.destroy$)).subscribe(() => void this.openBar());
    const accountSession = this.accounts.activeAccount$.pipe(switchMap((account) => account == null
      ? of({ userId: null, key: null })
      : this.keys.userKey$(account.id).pipe(map((key) => ({ userId: account.id, key })))));
    combineLatest([this.authService.activeAccountStatus$, this.localVault.state$, accountSession])
      .pipe(takeUntil(this.destroy$)).subscribe(([status, localState, session]) => {
      this.accountStatus = status;
      const unlocked = localState !== "migrating" && (status === AuthenticationStatus.Unlocked && session.key != null ||
        status === AuthenticationStatus.LoggedOut && (localState === "empty" || localState === "session-unlocked" || localState === "persisted-unlocked"));
      this.isUnlocked.set(unlocked);
      this.refreshGeneration++;
      const scope = unlocked ? session.userId ?? "guest" : "";
      if (this.agentSession !== scope || this.agentKey !== session.key) {
        this.agentSession = scope;
        this.agentKey = session.key;
        this.agentEpoch++;
        this.agentAuthority = null;
        ipc.localVault.agent.changed();
        if (unlocked) {
          ipc.localVault.agent.ready();
        }
      }
      if (unlocked) {
        void this.refreshDetails().catch((error: unknown) => this.notice(false, "Couldn't open the vault", error instanceof Error ? error.message : String(error)));
      } else {
        this.isOpen.set(false);
        this.reader.set(null);
        this.addedProfile.set(null);
        this.added.set([]);
        this.pendingCapture.set(null);
        this.pendingForm.set(null);
        this.allHits.set([]);
        this.profiles.set([]);
        this.selectedProfileId.set("");
      }
    });
    ipc.localVault.agent.onRequest((id, request) => this.zone.run(async () => {
      try {
        const epoch = this.agentEpoch;
        const result = await this.answerAgent(request);
        if (epoch !== this.agentEpoch) {
          throw new Error("account_changed");
        }
        ipc.localVault.agent.respond(id, { result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "locked";
        ipc.localVault.agent.respond(id, { error: ["account_changed", "locked", "malformed", "no_access"].includes(message) ? message : "no_access" });
      }
    }));
    ipc.localVault.agent.ready();
    void this.localVault.initialize().catch((error: unknown) => this.notice(false, "Couldn't open the vault", error instanceof Error ? error.message : String(error)));
    ipc.quickBar.onRequest((id, request) =>
      this.zone.run(async () => {
        let result: unknown;
        try {
          result = await this.answerPill(request);
        } catch (error) {
          result = {
            good: false,
            title: "Something went wrong",
            subtitle: error instanceof Error ? error.message : String(error),
          };
        }
        ipc.quickBar.respond(id, result);
      }),
    );
  }

  ngOnDestroy(): void {
    this.agentEpoch++;
    this.agentAuthority = null;
    ipc.localVault.agent.changed();
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener("window:keydown", ["$event"])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isUnlocked()) { return; }
    if (event.key === "Escape" && this.reader()) {
      event.preventDefault(); this.closeReader(); return;
    }
    if (!this.isOpen()) {
      return;
    }
    const searching = this.slot() === "search";
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeBar();
    } else if (event.key === "ArrowDown" && searching) {
      event.preventDefault();
      this.selectedIndex.update((i) =>
        Math.min(i + 1, Math.max(0, this.filteredHits().length - 1)),
      );
    } else if (event.key === "ArrowUp" && searching) {
      event.preventDefault();
      this.selectedIndex.update((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && searching) {
      const hit = this.filteredHits()[this.selectedIndex()];
      if (hit) {
        event.preventDefault();
        this.copyHit(hit);
      }
    }
  }

  async openBar(): Promise<void> {
    this.isOpen.set(true);
    this.slot.set("search");
    this.query.set("");
    this.selectedIndex.set(0);
    await this.refreshDetails();
  }

  closeBar(): void {
    this.isOpen.set(false);
    this.slot.set("search");
    this.pendingForm.set(null);
  }

  openVault(): void {
    this.closeBar();
    void this.router.navigate(["/vault"]);
  }

  async openProfile(profileId = this.addedProfile()?.id, sourceId: string | null = null, variantId: string | null = null): Promise<void> {
    if (profileId == null) { return; }
    const profile = (await this.documents.profiles()).find((item) => item.id === profileId);
    if (profile == null) {
      if (this.operations().some((operation) => operation.profileId === profileId)) { await this.openBar(); return; }
      throw new Error("The profile is unavailable.");
    }
    this.closeBar();
    this.reader.set({ profile, sourceId: sourceId ?? (profileId === this.addedProfile()?.id ? this.addedSourceId : null), variantId });
  }

  closeReader(): void { this.reader.set(null); this.readerNote.set(""); void this.refreshDetails(); }
  selectProfile(id: string): void { this.selectedProfileId.set(id); this.selectedIndex.set(0); }
  enterDetails(): void { this.closeBar(); void this.router.navigate(["/local"]); }
  openProtection(): void { this.closeBar(); void this.router.navigate(["/local"]); }
  async dismissOffer(): Promise<void> { await this.localVault.dismissProtectionOffer(); this.postFillOffer.set(false); }
  async retry(id: string): Promise<void> {
    if (this.retrying()) { return; }
    this.retrying.set(true);
    try { await this.documents.retryOperation(id); await this.refreshDetails(); }
    catch (error) { this.notice(false, "Couldn't finish the document update", error instanceof Error ? error.message : String(error)); }
    finally { this.retrying.set(false); }
  }
  cancelChoice(): void { this.pendingCapture.set(null); this.pendingForm.set(null); this.slot.set("search"); }
  async fillAdded(): Promise<void> { const profile = this.addedProfile(); if (profile != null) { await this.fillFrom(profile); } }

  onQueryChange(query: string): void {
    this.query.set(query);
    this.selectedIndex.set(0);
  }

  copyHit(hit: QuickBarDetail): void {
    this.platformUtilsService.copyToClipboard(hit.value);
    this.notice(true, `${hit.label} copied`, "");
    setTimeout(() => this.closeBar(), 1200);
  }

  /** The desktop broker asks this window. The answer is the unlocked vault, never a second store. */
  private async answerAgent(request: { action: string; [key: string]: unknown }): Promise<unknown> {
    if (!this.isUnlocked()) {
      throw new Error("locked");
    }
    const authority = await this.currentAuthority();
    const action = request.action;
    if (action === "coordinate" && authority.coordination != null) {
      return invokeAccountCoordinator(authority.coordination, request.method, request.args);
    }
    if (action === "scope") {
      return { scopeIds: authority.scopeIds, accountBacked: authority.coordination != null, session: this.agentEpoch };
    }
    if (action === "secrets" && authority.secrets != null) {
      return authority.secrets(parseOwnerSecretsQuery(request.query));
    }
    if (action === "seal" && typeof request.plain === "string") {
      return authority.seal(request.plain);
    }
    if (action === "open" && typeof request.ciphertext === "string") {
      return authority.open(request.ciphertext);
    }
    if ((action === "resolve" || action === "value") && typeof request.itemId === "string" && typeof request.fieldPath === "string") {
      return action === "resolve" ? authority.resolve(request.itemId, request.fieldPath) : authority.value(request.itemId, request.fieldPath);
    }
    if (action === "collect") {
      return authority.targets.collect(typeof request.targetId === "string" ? request.targetId : undefined);
    }
    if (action === "write" && isAgentTarget(request.target) && Array.isArray(request.operations) &&
      request.operations.every((operation) => operation != null && typeof operation === "object" &&
        "entryId" in operation && "fieldId" in operation && "value" in operation &&
        typeof operation.entryId === "string" && typeof operation.fieldId === "string" && typeof operation.value === "string")) {
      return authority.targets.write(request.target, request.operations);
    }
    throw new Error("locked");
  }

  private async currentAuthority(): Promise<AgentVaultAuthority> {
    if (this.agentAuthority != null) {
      return this.agentAuthority;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    const userId = account?.id;
    const targets = {
      collect: async (targetId?: string) => this.collectFront(targetId),
      write: async (target: AgentTarget, operations: AgentWrite[]) => this.writeFront(target, operations),
    };
    const unlockedAccount = userId != null && await firstValueFrom(this.keys.userKey$(userId)) != null;
    this.agentAuthority = unlockedAccount
      ? new AccountAgentAuthority(userId as UserId, this.accounts, this.keys, this.ciphers, this.api, targets, await this.appId.getAppId())
      : await this.localVault.authority(targets);
    return this.agentAuthority;
  }

  private async collectFront(targetId?: string): Promise<AgentTarget[]> {
    const form = this.frontForm;
    if (form == null || !/\.pdf$/i.test(form.name) || (targetId != null && targetId !== form.path)) {
      return [];
    }
    const fields = await ipc.capture.readPdfForm(form.bytes);
    return [{
      targetId: form.path, kind: "file", destinationKey: `file:${form.path}`, generation: String(form.bytes.byteLength),
      display: form.name, formSignature: fields.map((field) => field.key).join("\n"),
      sections: [{ id: "form", label: form.name }],
      fields: fields.map((field) => ({ id: field.key, sectionId: "form", label: field.label || field.name, type: field.type, options: field.options })),
    }];
  }

  private async writeFront(target: AgentTarget, operations: AgentWrite[]): Promise<{ entries: { entryId: string; outcome: "confirmed" | "not_written" }[] }> {
    const form = this.frontForm;
    if (form == null || target.targetId !== form.path) {
      return { entries: operations.map((operation) => ({ entryId: operation.entryId, outcome: "not_written" })) };
    }
    const values = Object.fromEntries(operations.map((operation) => [operation.fieldId, operation.value]));
    await ipc.capture.fillPdfForm({ sourcePath: form.path, name: form.name, bytes: form.bytes, values });
    return { entries: operations.map((operation) => ({ entryId: operation.entryId, outcome: "confirmed" })) };
  }


  /** The pill in the menu bar or taskbar reads the vault, and adds or fills files, through here. */
  async answerPill(request: QuickBarRequest): Promise<unknown> {
    if (request.kind === "unlock") {
      if (this.accountStatus === AuthenticationStatus.Locked) { return { locked: true, account: true }; }
      await this.localVault.unlock(request.password);
      await this.refreshDetails();
      return { good: true, title: "Unlocked", subtitle: "" };
    }
    if (!this.isUnlocked()) {
      return { locked: true, account: this.accountStatus !== AuthenticationStatus.LoggedOut };
    }
    if (request.kind === "protect") {
      await this.localVault.setPassword(request.password);
      return { good: true, title: "Local password saved", subtitle: "" };
    }
    if (request.kind === "dismissProtection") {
      await this.dismissOffer();
      return { good: true, title: "Saved", subtitle: "" };
    }
    if (request.kind === "openProfile") {
      await this.openProfile(request.profileId, request.sourceId, request.variantId);
      return { good: true, title: "Profile opened", subtitle: "" };
    }
    if (request.kind === "filled") {
      if (this.accountStatus === AuthenticationStatus.LoggedOut) {
        await this.localVault.markFirstFill();
        this.postFillOffer.set((await this.localVault.afterFillOffer()).show);
      }
      return { good: true, title: "Filled", subtitle: "", postFillOffer: this.postFillOffer() };
    }
    if (request.kind === "details") {
      await this.refreshDetails();
      const profiles = this.profiles().filter(profileUsableForFill);
      const selectedId = request.profileId ?? this.selectedProfileId();
      const selected = selectedId ? profiles.find((profile) => profile.id === selectedId) : profiles.length === 1 ? profiles[0] : null;
      if (selectedId && selected == null) { throw new Error("The selected profile is unavailable. Choose another profile."); }
      return {
        profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
        profileId: selected?.id ?? null,
        details: selected == null ? [] : this.allHits().filter((hit) => hit.profileId === selected.id)
          .sort((a, b) => firstAsked(a.id) - firstAsked(b.id)),
        operations: this.operations(),
        postFillOffer: this.accountStatus === AuthenticationStatus.LoggedOut ? await this.localVault.afterFillOffer() : { show: false },
      };
    }
    const bytes = Uint8Array.from(request.bytes);
    const file = new File([bytes], request.name);
    this.documents.rememberPath(file, request.path);
    this.frontForm = { path: request.path, name: request.name, bytes };
    await this.processFile(file, bytes, request.profileId, false);
    if (this.slot() === "choose" || this.pendingForm() && this.profiles().length === 0) {
      this.isOpen.set(true);
      return { good: false, title: "Choose whose details", subtitle: "Continue in Vowkey" };
    }
    return { good: this.slot() === "added" || this.slot() === "notice" && this.noticeGood(), title: this.statusTitle(), subtitle: this.statusSubtitle(),
      profileId: this.addedProfile()?.id, sourceId: this.addedSourceId };
  }

  protected readonly dragging = signal(false);

  /** A file dragged over the window offers to be added or filled, wherever the person is. */
  @HostListener("window:dragover", ["$event"])
  onWindowDragOver(event: DragEvent): void {
    if (!this.isUnlocked() || this.isOpen() || !event.dataTransfer?.types?.includes("Files")) {
      return;
    }
    event.preventDefault();
    this.dragging.set(true);
  }

  @HostListener("window:dragleave", ["$event"])
  onWindowDragLeave(event: DragEvent): void {
    if (event.relatedTarget == null) {
      this.dragging.set(false);
    }
  }

  @HostListener("window:drop", ["$event"])
  async onWindowDrop(event: DragEvent): Promise<void> {
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (!this.isUnlocked() || this.isOpen() || !file) {
      return;
    }
    event.preventDefault();
    await this.openBar();
    await this.processFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.slot() === "search") {
      this.slot.set("drop");
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    if (this.slot() === "drop") {
      this.slot.set("search");
    }
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await this.processFile(file);
    } else {
      this.slot.set("search");
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) {
      await this.processFile(file);
      input.value = "";
    }
  }

  /** A PDF, Word, Excel or Hangul form is filled from a profile; any other file is read into one. */
  async processFile(file: File, given?: Uint8Array, profileId?: string, openReader = true): Promise<void> {
    this.working(file.name, "Reading document");
    try {
      const bytes = given ?? new Uint8Array(await file.arrayBuffer());
      const isForm =
        FILLABLE_FORM.test(file.name) ||
        (/\.pdf$/i.test(file.name) && this.documents.isPdfForm(bytes));
      if (isForm) {
        this.working(file.name, "Filling the form");
        await this.startFilling(file, bytes, profileId);
      } else {
        await this.addDocument(file, bytes, profileId);
        if (openReader && this.slot() === "added" && this.attached() && this.pendingForm() == null) {
          this.readerNote.set(`${this.statusTitle()} ${this.statusSubtitle()}`);
          await this.openProfile();
        }
      }
    } catch (error) {
      this.notice(
        false,
        `Couldn't use ${file.name}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async addDocument(file: File, bytes: Uint8Array, profileId?: string): Promise<void> {
    const { captured, unclear } = await this.documents.read(file, bytes);
    // What a photo too small or too unclear to read gives is noise, so none of it is saved.
    if (unclear != null) {
      this.notice(false, `Couldn't read ${file.name}`, this.notRead[unclear]);
      return;
    }
    let result: DocumentAdded | null;
    try { result = await this.documents.addCaptured(captured, file, bytes, { profileId }); }
    catch (error) {
      if (error instanceof CaptureProfileChoiceRequiredError) {
        this.pendingCapture.set({ file, bytes, captured }); this.choices.set(error.profiles);
        this.statusTitle.set(file.name); this.statusSubtitle.set("Whose document?"); this.slot.set("choose"); return;
      }
      throw error;
    }
    if (result == null) {
      this.notice(false, `Nothing to add from ${file.name}`, "No details were found in it.");
      return;
    }
    this.addedSourceId = result.sourceId ?? null;
    this.added.set(result.added);
    this.attached.set(result.attached);
    this.addedFrom.set(file.name);
    this.addedProfile.set(result.profile);
    const count = result.added.length;
    this.statusTitle.set(result.attached ? (count > 0 ? `Added ${count} ${count === 1 ? "detail" : "details"}` : "Document added") : "Upload waiting");
    this.statusSubtitle.set(
      result.created ? `to a new profile, ${result.profile.name}` : `to ${result.profile.name}`,
    );
    this.slot.set("added");
    await this.refreshDetails();
  }

  private async startFilling(file: File, bytes: Uint8Array, profileId?: string): Promise<void> {
    const profiles = (await this.documents.profiles()).filter(profileUsableForFill);
    if (profileId != null) {
      const selected = profiles.find((profile) => profile.id === profileId);
      if (selected == null) { throw new Error("The selected profile is unavailable. Choose another profile."); }
      await this.fill(file, bytes, selected);
    } else if (profiles.length === 0) {
      this.pendingForm.set({ file, bytes });
      this.notice(false, "Add details for this form", "Add a document or type the details to fill this form.");
    } else if (profiles.length === 1) {
      await this.fill(file, bytes, profiles[0]);
    } else {
      this.pendingForm.set({ file, bytes });
      this.choices.set(profiles);
      this.statusTitle.set(file.name);
      this.statusSubtitle.set("Whose details?");
      this.slot.set("choose");
    }
  }

  async fillFrom(profile: CipherView): Promise<void> {
    const capture = this.pendingCapture();
    if (capture != null) {
      this.pendingCapture.set(null);
      await this.addDocument(capture.file, capture.bytes, profile.id);
      return;
    }
    const form = this.pendingForm();
    if (form == null) {
      return;
    }
    this.pendingForm.set(null);
    this.working(form.file.name, "Filling the form");
    try {
      await this.fill(form.file, form.bytes, profile);
    } catch (error) {
      this.notice(
        false,
        `Couldn't fill ${form.file.name}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async fill(file: File, bytes: Uint8Array, profile: CipherView): Promise<void> {
    const available = (await this.documents.profiles()).find((candidate) => candidate.id === profile.id && profileUsableForFill(candidate));
    if (available == null) { throw new Error("The selected profile is unavailable. Choose another profile."); }
    profile = available;
    const { path, filled } = /\.pdf$/i.test(file.name)
      ? await this.documents.fillPdfForm(file, bytes, profile)
      : await this.documents.fillForm(file, bytes, profile);
    if (path == null) {
      this.notice(false, `Nothing in ${file.name} matched`, `${profile.name}'s details`);
      return;
    }
    const saved = path.split(/[\\/]/).pop();
    if (filled > 0 && this.accountStatus === AuthenticationStatus.LoggedOut) {
      await this.localVault.markFirstFill();
      this.postFillOffer.set((await this.localVault.afterFillOffer()).show);
    }
    this.notice(true, `Filled ${filled} ${filled === 1 ? "field" : "fields"}`, `saved as ${saved}`);
  }

  private working(title: string, subtitle: string): void {
    this.statusTitle.set(title);
    this.statusSubtitle.set(subtitle);
    this.slot.set("reading");
  }

  private notice(good: boolean, title: string, subtitle: string): void {
    this.noticeGood.set(good);
    this.statusTitle.set(title);
    this.statusSubtitle.set(subtitle);
    this.slot.set("notice");
  }

  async refreshDetails(): Promise<void> {
    const generation = this.refreshGeneration;
    const profiles = await this.documents.profiles();
    const hits: QuickBarDetail[] = [];
    for (const profile of profiles.filter(profileUsableForFill)) {
      const meta = readEnvelope(profile);
      if (meta != null) {
        for (const detail of meta.details) {
          if (detail.valueType === "secret" && profile.viewPassword === false) { continue; }
          const variant = resolveDetailVariant(meta, detail);
          if (variant != null) {
            hits.push({ id: `${profile.id}-${detail.attribute ?? detail.id}`, profileId: profile.id,
              profile: profile.name, label: detail.label, value: variant.value, detailId: detail.id,
              variantId: variant.id, sourceId: variant.sourceId ?? undefined, attribute: detail.attribute ?? undefined });
          }
        }
      } else {
        for (const [key, value] of this.documents.detailsOf(profile)) {
          hits.push({ id: `${profile.id}-${key}`, profileId: profile.id, label: detail_label(key), profile: profile.name, value, attribute: key });
        }
      }
    }
    const operations = await this.documents.pendingOperations();
    if (generation === this.refreshGeneration && this.isUnlocked()) {
      this.profiles.set(profiles);
      this.allHits.set(hits);
      this.operations.set(operations);
      if (this.selectedProfileId() && !profiles.some((profile) => profile.id === this.selectedProfileId())) { this.selectedProfileId.set(""); }
    }
  }
}

function isAgentTarget(value: unknown): value is AgentTarget {
  return value != null && typeof value === "object" && "targetId" in value && typeof value.targetId === "string" &&
    "kind" in value && (value.kind === "web" || value.kind === "file" || value.kind === "app") &&
    "destinationKey" in value && typeof value.destinationKey === "string" &&
    "generation" in value && typeof value.generation === "string" &&
    "display" in value && typeof value.display === "string" &&
    "formSignature" in value && typeof value.formSignature === "string" &&
    "sections" in value && Array.isArray(value.sections) && "fields" in value && Array.isArray(value.fields);
}
