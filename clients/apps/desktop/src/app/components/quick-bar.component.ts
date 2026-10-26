// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, HostListener, OnDestroy, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { Subject, takeUntil } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  capture_document_text,
  fill_docx_with_profile,
  fill_hwpx_with_profile,
  fill_xlsx_with_profile,
} from "@vowkey/sdk-internal";

export interface QuickBarDetailHit {
  id: string;
  label: string;
  source: string;
  value: string;
  username?: string;
  password?: string;
}

export interface QuickBarAgentRequest {
  agentName: string;
  detailLabel: string;
  goal: string;
  reason: string;
}

export type QuickBarSlotState = "search" | "drop" | "reading" | "saved" | "filling" | "done" | "req";

@Component({
  selector: "vowkey-quick-bar",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isUnlocked) {
      @if (!isOpen) {
        <button
          type="button"
          class="vk-quick-trigger"
          data-testid="vowkey-quick-bar-trigger"
          title="Quick layer (⌃⇧Space / ⌘K)"
          (click)="openBar()"
        >
          <svg class="vk-mark" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M4 3h8a2 2 0 0 1 2 2v1h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.5 5.5v9h13v-9h-13z"
            />
          </svg>
          <span>Quick</span>
          <kbd>⌘K</kbd>
        </button>
      } @else {
        <div
          class="vk-quick-backdrop"
          (click)="closeBar()"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          <div class="vk-quick-container" (click)="$event.stopPropagation()">
            <div
              class="pill2 mac"
              [class.ask]="slot === 'req'"
              id="p-pill"
              data-testid="vowkey-quick-bar-pill"
              role="group"
              aria-label="Vowkey"
            >
              <button
                type="button"
                class="p-mark"
                title="Open the Hub"
                data-testid="quick-bar-open-hub"
                (click)="openHub()"
              >
                <svg class="vk-mark" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M4 3h8a2 2 0 0 1 2 2v1h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm1.5 5.5v9h13v-9h-13z"
                  />
                </svg>
              </button>

              @switch (slot) {
                @case ("drop") {
                  <label class="p-drop ready" data-pdrop>
                    <span>Drop to add to Vault or fill file</span>
                    <input
                      type="file"
                      class="vk-hidden-file"
                      (change)="onFileSelected($event)"
                    />
                  </label>
                }
                @case ("reading") {
                  <div class="p-read">
                    <span class="thumb"></span>
                    <div>
                      <b>{{ statusTitle }}</b>
                      <small>Reading on this Mac</small>
                    </div>
                  </div>
                }
                @case ("saved") {
                  <div class="p-stat" data-testid="quick-bar-status">
                    <span class="ok">✓</span>
                    <span><b>{{ statusTitle }}</b> {{ statusSubtitle }}</span>
                  </div>
                }
                @case ("done") {
                  <div class="p-stat" data-testid="quick-bar-status">
                    <span class="ok">✓</span>
                    <span><b>{{ statusTitle }}</b> {{ statusSubtitle }}</span>
                  </div>
                }
                @case ("req") {
                  @if (pendingRequest) {
                    <div class="p-req" data-testid="quick-bar-agent-request">
                      <span class="ag">✻</span>
                      <span class="tx">
                        <b>{{ pendingRequest.agentName }} wants {{ pendingRequest.detailLabel }}</b>
                        <small>{{ pendingRequest.goal }} · “{{ pendingRequest.reason }}”</small>
                      </span>
                      <button
                        class="p-btn qt"
                        type="button"
                        data-pdeny
                        (click)="resolveAgentRequest('deny')"
                      >
                        Don't allow
                      </button>
                      <button
                        class="p-btn sec"
                        type="button"
                        data-palways
                        (click)="resolveAgentRequest('always')"
                      >
                        Always allow on this site
                      </button>
                      <button
                        class="p-btn pri"
                        type="button"
                        data-ponce
                        (click)="resolveAgentRequest('once')"
                      >
                        Allow once
                      </button>
                    </div>
                  }
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
                      placeholder="Search the Vault"
                      [(ngModel)]="query"
                      (ngModelChange)="onQueryChange()"
                      autocomplete="off"
                      aria-label="Search the Vault"
                    />
                    <kbd>⌘K</kbd>
                  </label>
                }
              }

              @if (slot === "search" || slot === "saved" || slot === "done") {
                <button
                  class="p-fill"
                  type="button"
                  data-pfill
                  data-testid="quick-bar-fill-button"
                  (click)="fillActiveWindow()"
                >
                  <span class="app">V</span>
                  <span>Fill</span>
                  <small>{{ targetWindowTitle || "Window" }}</small>
                </button>
              }
            </div>

            @if (slot === "search") {
              <div class="p-sheet mac" id="p-sheet" data-testid="quick-bar-sheet">
                <div class="sh">{{ query.trim() ? "In the Vault" : "Suggested details" }}</div>
                @if (filteredHits.length > 0) {
                  @for (hit of filteredHits; track hit.id; let idx = $index) {
                    <div
                      class="qrow"
                      [class.sel]="idx === selectedIndex"
                      [attr.data-prow]="idx"
                      (mouseenter)="selectedIndex = idx"
                    >
                      <div class="qrow-main">
                        <small>{{ hit.label }} · {{ hit.source }}</small>
                        <b>{{ hit.value }}</b>
                      </div>
                      <span class="acts">
                        <button
                          class="qact s"
                          type="button"
                          [attr.data-pcopy]="idx"
                          (click)="copyHit(hit)"
                        >
                          Copy
                        </button>
                        <button
                          class="qact p"
                          type="button"
                          [attr.data-pins]="idx"
                          (click)="insertHit(hit)"
                        >
                          Insert ↵
                        </button>
                      </span>
                    </div>
                  }
                } @else {
                  <div class="qempty">
                    {{
                      query.trim()
                        ? "Nothing in the Vault matches “" + query.trim() + "”."
                        : "Your Vault has no details yet."
                    }}
                  </div>
                }
                <div class="foot2">
                  <span>↑↓ to choose · <kbd>↵</kbd> insert · <kbd>⌘C</kbd> copy</span>
                  <label class="vk-drop-link">
                    <span>Drop or choose a document / form</span>
                    <input
                      type="file"
                      class="vk-hidden-file"
                      data-testid="quick-bar-file-input"
                      (change)="onFileSelected($event)"
                    />
                  </label>
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
      .pill2.ask {
        border-color: #2563eb;
        box-shadow:
          0 14px 34px rgba(15, 23, 42, 0.18),
          0 0 0 4px rgba(37, 99, 235, 0.16);
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
      .p-fill {
        height: 34px;
        padding: 0 14px 0 9px;
        border-radius: 99px;
        background: #2563eb;
        color: #ffffff;
        border: 0;
        font-weight: 600;
        font-size: 12.5px;
        display: flex;
        gap: 7px;
        align-items: center;
        cursor: pointer;
      }
      .p-fill .app {
        width: 18px;
        height: 18px;
        border-radius: 5px;
        background: #1e40af;
        display: grid;
        place-items: center;
        font-size: 10px;
        font-weight: 700;
      }
      .p-fill small {
        font-weight: 500;
        opacity: 0.85;
        font-size: 11px;
        max-width: 96px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-drop {
        width: 240px;
        height: 34px;
        border-radius: 99px;
        border: 1.5px dashed #2563eb;
        color: #1d4ed8;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        font-weight: 600;
        font-size: 12px;
        cursor: copy;
      }
      .p-stat {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 10px;
        font-size: 12.5px;
      }
      .p-stat .ok {
        color: #15803d;
        font-weight: 700;
      }
      .p-req {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-right: 4px;
      }
      .p-req .ag {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: #d97757;
        color: #fff;
        display: grid;
        place-items: center;
        font-weight: 700;
        font-size: 12px;
      }
      .p-req .tx {
        display: grid;
        line-height: 1.25;
        max-width: 240px;
      }
      .p-req .tx b {
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-req .tx small {
        font-size: 11px;
        color: #64748b;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-btn {
        height: 30px;
        padding: 0 11px;
        border-radius: 99px;
        border: 0;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .p-btn.pri {
        background: #2563eb;
        color: #fff;
      }
      .p-btn.sec {
        background: #ffffff;
        box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.15);
        color: #0f172a;
      }
      .p-btn.qt {
        background: transparent;
        color: #64748b;
      }
      .p-sheet {
        width: 392px;
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
      .vk-drop-link {
        color: #2563eb;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-hidden-file {
        display: none;
      }
    `,
  ],
})
export class QuickBarComponent implements OnInit, OnDestroy {
  isUnlocked = false;
  isOpen = false;
  slot: QuickBarSlotState = "search";
  query = "";
  selectedIndex = 0;
  targetWindowTitle = "";
  statusTitle = "";
  statusSubtitle = "";
  pendingRequest: QuickBarAgentRequest | null = null;
  lastAgentDecision: "once" | "always" | "deny" | null = null;

  allHits: QuickBarDetailHit[] = [];
  filteredHits: QuickBarDetailHit[] = [];
  private activeUserId: UserId | null = null;
  private profileMap: Record<string, string> = {};
  private destroy$ = new Subject<void>();

  constructor(
    private accountService: AccountService,
    private authService: AuthService,
    private cipherService: CipherService,
    private platformUtilsService: PlatformUtilsService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.accountService.activeAccount$.pipe(takeUntil(this.destroy$)).subscribe((acc) => {
      this.activeUserId = (acc?.id as UserId) ?? null;
    });

    this.authService.activeAccountStatus$.pipe(takeUntil(this.destroy$)).subscribe((status) => {
      this.isUnlocked = status === AuthenticationStatus.Unlocked;
      if (this.isUnlocked) {
        void this.refreshVaultHits();
      } else {
        this.isOpen = false;
        this.allHits = [];
        this.filteredHits = [];
      }
    });

    if (typeof ipc !== "undefined" && ipc?.autofill?.autotypeMvp?.listenRequest) {
      ipc.autofill.autotypeMvp.listenRequest((windowTitle, completeCallback) => {
        this.targetWindowTitle = windowTitle || "Window";
        this.isOpen = true;
        this.slot = "search";
        void this.refreshVaultHits().then(() => {
          const loginHit = this.allHits.find((h) => h.username && h.password);
          if (loginHit) {
            completeCallback(null, {
              username: loginHit.username,
              password: loginHit.password,
            });
          }
        });
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener("window:keydown", ["$event"])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isUnlocked) {
      return;
    }
    const isCmdOrCtrl = event.metaKey || event.ctrlKey;
    if (
      (isCmdOrCtrl && event.shiftKey && event.code === "Space") ||
      (isCmdOrCtrl && event.key.toLowerCase() === "k")
    ) {
      event.preventDefault();
      if (this.isOpen) {
        this.closeBar();
      } else {
        void this.openBar();
      }
      return;
    }

    if (!this.isOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      this.closeBar();
    } else if (event.key === "ArrowDown" && this.slot === "search") {
      event.preventDefault();
      this.selectedIndex = Math.min(
        this.selectedIndex + 1,
        Math.max(0, this.filteredHits.length - 1),
      );
    } else if (event.key === "ArrowUp" && this.slot === "search") {
      event.preventDefault();
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (event.key === "Enter" && this.slot === "search") {
      const hit = this.filteredHits[this.selectedIndex];
      if (hit) {
        event.preventDefault();
        this.insertHit(hit);
      }
    }
  }

  async openBar(): Promise<void> {
    this.isOpen = true;
    this.slot = "search";
    this.query = "";
    this.selectedIndex = 0;
    await this.refreshVaultHits();
  }

  closeBar(): void {
    this.isOpen = false;
    this.slot = "search";
  }

  openHub(): void {
    this.closeBar();
    void this.router.navigate(["/vault"]);
  }

  onQueryChange(): void {
    const q = this.query.trim().toLowerCase();
    if (!q) {
      this.filteredHits = this.allHits.slice(0, 6);
    } else {
      this.filteredHits = this.allHits
        .filter((h) => `${h.label} ${h.source} ${h.value}`.toLowerCase().includes(q))
        .slice(0, 6);
    }
    this.selectedIndex = 0;
  }

  copyHit(hit: QuickBarDetailHit): void {
    this.platformUtilsService.copyToClipboard(hit.value);
    this.statusTitle = hit.label;
    this.statusSubtitle = "copied";
    this.slot = "done";
  }

  insertHit(hit: QuickBarDetailHit): void {
    this.platformUtilsService.copyToClipboard(hit.value);
    if (typeof ipc !== "undefined" && ipc?.autofill?.autotypeMvp?.execute) {
      ipc.autofill.autotypeMvp.execute({
        username: hit.username || hit.value,
        password: hit.password || hit.value,
      });
    }
    this.statusTitle = hit.label;
    this.statusSubtitle = "inserted";
    this.slot = "done";
  }

  fillActiveWindow(): void {
    const hit =
      this.filteredHits[this.selectedIndex] ??
      this.allHits.find((h) => h.username && h.password) ??
      this.allHits[0];
    if (hit) {
      this.insertHit(hit);
    }
  }

  promptAgentAccess(req: QuickBarAgentRequest): void {
    this.pendingRequest = req;
    this.isOpen = true;
    this.slot = "req";
  }

  resolveAgentRequest(decision: "once" | "always" | "deny"): void {
    this.lastAgentDecision = decision;
    this.pendingRequest = null;
    this.slot = "search";
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.slot !== "drop") {
      this.slot = "drop";
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    if (this.slot === "drop") {
      this.slot = "search";
    }
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await this.processDroppedFile(file);
    } else {
      this.slot = "search";
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) {
      await this.processDroppedFile(file);
    }
  }

  async processDroppedFile(file: File): Promise<void> {
    this.slot = "reading";
    this.statusTitle = file.name;
    const lower = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (lower.endsWith(".docx") || lower.endsWith(".xlsx") || lower.endsWith(".hwpx")) {
      const profileInput = { details: new Map(Object.entries(this.profileMap)) };
      const filled = lower.endsWith(".docx")
        ? fill_docx_with_profile(bytes, profileInput)
        : lower.endsWith(".xlsx")
          ? fill_xlsx_with_profile(bytes, profileInput)
          : fill_hwpx_with_profile(bytes, profileInput);
      this.statusTitle = `Filled ${file.name}`;
      this.statusSubtitle = `· ${filled.report.filled_count} fields`;
      this.slot = "done";
      return;
    }

    const text = new TextDecoder().decode(bytes);
    const captured = capture_document_text(text);
    const detailsMap = captured.details;
    const fullName =
      detailsMap.get("name.full") ||
      detailsMap.get("name.full.latin") ||
      detailsMap.get("name.family") ||
      "verified";
    this.statusTitle = file.name;
    this.statusSubtitle = `saved · ${fullName}`;
    this.slot = "saved";
  }

  async refreshVaultHits(): Promise<void> {
    const userId = this.activeUserId;
    if (!userId) {
      return;
    }
    const ciphers: CipherView[] = (await this.cipherService.getAllDecrypted(userId)) ?? [];
    const hits: QuickBarDetailHit[] = [];
    const profile: Record<string, string> = {};

    for (const cipher of ciphers) {
      if (cipher.deletedDate) {
        continue;
      }
      const source = cipher.name || "Vault";
      if (cipher.type === CipherType.Identity && cipher.identity) {
        const id = cipher.identity;
        const fullName = [id.firstName, id.middleName, id.lastName].filter(Boolean).join(" ");
        if (fullName) {
          profile["name.full"] = fullName;
          profile["name.family"] = id.lastName || "";
          profile["name.given"] = id.firstName || "";
          hits.push({
            id: `${cipher.id}-name`,
            label: "Full name",
            source,
            value: fullName,
          });
        }
        if (id.passportNumber) {
          profile["passport.number"] = id.passportNumber;
          hits.push({
            id: `${cipher.id}-passport`,
            label: "Passport number",
            source,
            value: id.passportNumber,
          });
        }
        if (id.licenseNumber) {
          profile["id.national"] = id.licenseNumber;
          hits.push({
            id: `${cipher.id}-license`,
            label: "ID / Licence number",
            source,
            value: id.licenseNumber,
          });
        }
        if (id.address1) {
          profile["address.full"] = [id.address1, id.city, id.state, id.postalCode]
            .filter(Boolean)
            .join(", ");
          hits.push({
            id: `${cipher.id}-address`,
            label: "Address",
            source,
            value: profile["address.full"],
          });
        }
        if (id.phone) {
          profile["phone.mobile"] = id.phone;
          hits.push({
            id: `${cipher.id}-phone`,
            label: "Phone",
            source,
            value: id.phone,
          });
        }
        if (id.email) {
          profile["email"] = id.email;
          hits.push({
            id: `${cipher.id}-email`,
            label: "Email",
            source,
            value: id.email,
          });
        }
      } else if (cipher.type === CipherType.Login && cipher.login) {
        if (cipher.login.username) {
          hits.push({
            id: `${cipher.id}-login`,
            label: "Login",
            source,
            value: cipher.login.username,
            username: cipher.login.username,
            password: cipher.login.password || "",
          });
        }
      } else if (cipher.type === CipherType.Card && cipher.card) {
        if (cipher.card.number) {
          hits.push({
            id: `${cipher.id}-card`,
            label: "Card number",
            source,
            value: cipher.card.number,
          });
        }
      }

      if (cipher.fields?.length) {
        for (const f of cipher.fields) {
          if (f.name && f.value) {
            profile[f.name] = f.value;
            hits.push({
              id: `${cipher.id}-field-${f.name}`,
              label: f.name,
              source,
              value: f.value,
            });
          }
        }
      }
    }

    this.profileMap = profile;
    this.allHits = hits;
    this.onQueryChange();
  }
}
