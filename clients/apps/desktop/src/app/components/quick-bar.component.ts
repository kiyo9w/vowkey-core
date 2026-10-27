import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { Subject, takeUntil } from "rxjs";

import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { detail_label } from "@vowkey/sdk-internal";

import type { QuickBarRequest } from "../../quick-bar/types";
import {
  AddedDetail,
  DocumentCaptureService,
  FILLABLE_FORM,
  Unclear,
} from "../services/document-capture.service";

/** One detail in a profile: what it is, whose it is, and its value. */
export interface QuickBarDetail {
  id: string;
  label: string;
  profile: string;
  value: string;
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
  imports: [CommonModule, FormsModule],
  template: `
    @if (isUnlocked()) {
      @if (!isOpen()) {
        <button
          type="button"
          class="vk-quick-trigger"
          data-testid="vowkey-quick-bar-trigger"
          title="Find a detail, add a document, fill a form. ⇧⌘Space opens it from any app."
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
                      </span>
                    </div>
                  }
                } @else {
                  <div class="qempty">
                    {{
                      query().trim()
                        ? "No detail matches “" + query().trim() + "”."
                        : "No details yet. Add a passport, a card or any document with Add or fill."
                    }}
                  </div>
                }
                <div class="foot2">
                  <span>↑↓ to choose · <kbd>↵</kbd> to copy</span>
                  <span>Drop a document here to add it</span>
                </div>
              </div>
            }

            @if (slot() === "choose") {
              <div class="p-sheet mac" data-testid="quick-bar-choose">
                <div class="sh">Fill from</div>
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
                        Fill
                      </button>
                    </span>
                  </div>
                }
              </div>
            }

            @if (slot() === "notice" && statusSubtitle()) {
              <div class="p-sheet mac" data-testid="quick-bar-notice">
                <div class="qnote">{{ statusSubtitle() }}</div>
              </div>
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
                  <div class="qempty">The file itself could not be attached to the profile.</div>
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

  readonly allHits = signal<QuickBarDetail[]>([]);
  readonly filteredHits = computed(() => {
    const query = this.query().trim().toLowerCase();
    const hits = this.allHits();
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
  private readonly pendingForm = signal<{ file: File; bytes: Uint8Array } | null>(null);

  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly authService: AuthService,
    private readonly documents: DocumentCaptureService,
    private readonly platformUtilsService: PlatformUtilsService,
    private readonly router: Router,
    private readonly zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.authService.activeAccountStatus$.pipe(takeUntil(this.destroy$)).subscribe((status) => {
      const unlocked = status === AuthenticationStatus.Unlocked;
      this.isUnlocked.set(unlocked);
      if (unlocked) {
        void this.refreshDetails();
      } else {
        this.isOpen.set(false);
        this.allHits.set([]);
      }
    });
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
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener("window:keydown", ["$event"])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isUnlocked()) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (this.isOpen()) {
        this.closeBar();
      } else {
        void this.openBar();
      }
      return;
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

  openProfile(): void {
    const id = this.addedProfile()?.id;
    this.closeBar();
    void this.router.navigate(["/vault"], {
      queryParams: id ? { itemId: id, action: "view" } : {},
    });
  }

  onQueryChange(query: string): void {
    this.query.set(query);
    this.selectedIndex.set(0);
  }

  copyHit(hit: QuickBarDetail): void {
    this.platformUtilsService.copyToClipboard(hit.value);
    this.notice(true, `${hit.label} copied`, "");
    setTimeout(() => this.closeBar(), 1200);
  }

  /** The pill in the menu bar or taskbar reads the vault, and adds or fills files, through here. */
  async answerPill(request: QuickBarRequest): Promise<unknown> {
    if (!this.isUnlocked()) {
      return { locked: true };
    }
    if (request.kind === "details") {
      await this.refreshDetails();
      // The vault is the person's own: the pill names the profile that holds the most details.
      const profiles = await this.documents.profiles();
      const own = profiles.reduce<CipherView | undefined>(
        (best, profile) =>
          best == null || this.documents.detailsOf(profile).size > this.documents.detailsOf(best).size
            ? profile
            : best,
        undefined,
      );
      return {
        firstName: own?.identity?.firstName || own?.name?.split(" ")[0] || "",
        details: [...this.allHits()]
          .sort((a, b) => firstAsked(a.id) - firstAsked(b.id))
          .map(({ label, value }) => ({ label, value })),
      };
    }
    const bytes = Uint8Array.from(request.bytes);
    const file = new File([bytes], request.name);
    this.documents.rememberPath(file, request.path);
    await this.processFile(file, bytes);
    const good = this.slot() === "added" || (this.slot() === "notice" && this.noticeGood());
    if (this.slot() === "choose") {
      // Several profiles: the person picks in the Hub.
      this.isOpen.set(true);
      return { good: true, title: request.name, subtitle: "choose whose details in Vowkey" };
    }
    return { good, title: this.statusTitle(), subtitle: this.statusSubtitle() };
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
  async processFile(file: File, given?: Uint8Array): Promise<void> {
    this.working(file.name, "Reading document");
    try {
      const bytes = given ?? new Uint8Array(await file.arrayBuffer());
      const isForm =
        FILLABLE_FORM.test(file.name) ||
        (/\.pdf$/i.test(file.name) && this.documents.isPdfForm(bytes));
      if (isForm) {
        this.working(file.name, "Filling the form");
        await this.startFilling(file, bytes);
      } else {
        await this.addDocument(file, bytes);
      }
    } catch (error) {
      this.notice(
        false,
        `Couldn't use ${file.name}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async addDocument(file: File, bytes: Uint8Array): Promise<void> {
    const { captured, unclear } = await this.documents.read(file, bytes);
    // What a photo too small or too unclear to read gives is noise, so none of it is saved.
    if (unclear != null) {
      this.notice(false, `Couldn't read ${file.name}`, this.notRead[unclear]);
      return;
    }
    const result = await this.documents.addCaptured(captured, file, bytes);
    if (result == null) {
      this.notice(false, `Nothing to add from ${file.name}`, "No details were found in it.");
      return;
    }
    if (result.added.length === 0) {
      this.notice(true, `${file.name} is already in ${result.profile.name}`, "");
      return;
    }
    this.added.set(result.added);
    this.attached.set(result.attached);
    this.addedFrom.set(file.name);
    this.addedProfile.set(result.profile);
    const count = result.added.length;
    this.statusTitle.set(`Added ${count} ${count === 1 ? "detail" : "details"}`);
    this.statusSubtitle.set(
      result.created ? `to a new profile, ${result.profile.name}` : `to ${result.profile.name}`,
    );
    this.slot.set("added");
    await this.refreshDetails();
  }

  private async startFilling(file: File, bytes: Uint8Array): Promise<void> {
    const profiles = await this.documents.profiles();
    if (profiles.length === 0) {
      this.notice(false, "No profile to fill from", "Add a passport or a card first.");
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
    const { path, filled } = /\.pdf$/i.test(file.name)
      ? await this.documents.fillPdfForm(file, bytes, profile)
      : await this.documents.fillForm(file, bytes, profile);
    if (path == null) {
      this.notice(false, `Nothing in ${file.name} matched`, `${profile.name}'s details`);
      return;
    }
    const saved = path.split(/[\\/]/).pop();
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
    const profiles = await this.documents.profiles();
    const hits: QuickBarDetail[] = [];
    for (const profile of profiles) {
      for (const [key, value] of this.documents.detailsOf(profile)) {
        hits.push({
          id: `${profile.id}-${key}`,
          label: detail_label(key),
          profile: profile.name,
          value,
        });
      }
    }
    this.allHits.set(hits);
  }
}
