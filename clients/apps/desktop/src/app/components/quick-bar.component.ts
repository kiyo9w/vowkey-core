import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  Inject,
  NgZone,
  OnDestroy,
  OnInit,
  Optional,
  signal,
  ViewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { combineLatest, firstValueFrom, map, of, Subject, switchMap, takeUntil } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { DeviceType } from "@vowkey/common/enums";
import { AppIdService } from "@vowkey/common/platform/abstractions/app-id.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { TotpService } from "@vowkey/common/vault/abstractions/totp.service";
import { AccountAgentAuthority } from "@vowkey/common/vault/agent/account-authority";
import { invokeAccountCoordinator } from "@vowkey/common/vault/agent/account-bridge";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { parseOwnerSecretsQuery } from "@vowkey/common/vault/agent/owner-secrets";
import { AgentTarget, AgentWrite } from "@vowkey/common/vault/agent/targets";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  AgentRule,
  agentRuleOf,
  humanDetailLabel,
  profileUsableForFill,
  readEnvelope,
  resolveDetailVariant,
} from "@vowkey/common/vault/profile/vk-meta";
import { KeyService } from "@vowkey/key-management";
import { CapturedDocument, detail_label } from "@vowkey/sdk-internal";
import { LOCAL_AGENT_MANAGEMENT, LocalAgentManagement, ProfileComponent } from "@vowkey/vault";

import type {
  AgentApprovalPrompt,
  FrontContext,
  PasswordCredentialEntry,
  QuickBarRequest,
  QuickBarVaultItem,
} from "../../quick-bar/types";
import {
  AddedDetail,
  CaptureProfileChoiceRequiredError,
  DocumentAdded,
  DocumentCaptureService,
  FILLABLE_FORM,
  FillFormBreakdown,
  PendingDocumentOperation,
  Unclear,
} from "../services/document-capture.service";
import { GlyphName, VowkeyGlyphComponent } from "../vowkey/vowkey-glyph.component";
import { HubOpenMode, VowkeyHub } from "../vowkey/vowkey-hub.service";

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
  agentRule?: AgentRule;
}

export type QuickBarSlot =
  "search" | "fill" | "drop" | "reading" | "choose" | "ambiguous" | "added" | "notice";

/** The details forms ask for most, which lead the detail list before anything is typed. */
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

function firstAsked(id: string): number {
  const index = MOST_ASKED.findIndex((key) => id.endsWith(`-${key}`));
  return index === -1 ? MOST_ASKED.length : index;
}

function normalizeHost(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  return parts.slice(-2).join(".");
}

function loginMatchesFront(cipher: CipherView, front?: FrontContext | null): boolean {
  if (!front || cipher.type !== CipherType.Login) {
    return false;
  }
  const uris = (cipher.login?.uris ?? [])
    .map((u) => u.uri?.trim() ?? "")
    .filter((u) => u.length > 0);
  const frontHost = normalizeHost(front.host || front.url);
  if (frontHost) {
    const frontBase = registrableDomain(frontHost);
    for (const uri of uris) {
      const uriHost = normalizeHost(uri);
      if (
        uriHost &&
        (uriHost === frontHost ||
          uriHost.endsWith(`.${frontHost}`) ||
          frontHost.endsWith(`.${uriHost}`) ||
          (frontBase.includes(".") && registrableDomain(uriHost) === frontBase))
      ) {
        return true;
      }
    }
  }
  const bundle = (front.bundleId ?? "").toLowerCase();
  if (bundle) {
    for (const uri of uris) {
      const lower = uri.toLowerCase();
      if (lower.includes(bundle)) {
        return true;
      }
    }
  }
  const appToken = (front.appName ?? "")
    .toLowerCase()
    .replace(/\b(browser|app|desktop)\b/g, "")
    .trim();
  if (
    appToken.length >= 3 &&
    !/^(safari|google chrome|chrome|firefox|arc|brave|preview|finder)$/.test(appToken)
  ) {
    const cipherName = (cipher.name ?? "").toLowerCase();
    if (
      cipherName === appToken ||
      cipherName.startsWith(`${appToken} `) ||
      uris.some((u) => normalizeHost(u).startsWith(`${appToken}.`))
    ) {
      return true;
    }
  }
  return false;
}

function loginMatchesServiceIds(cipher: CipherView, serviceIds: string[]): boolean {
  if (serviceIds.length === 0) {
    return true;
  }
  const uris = (cipher.login?.uris ?? []).map((u) => u.uri ?? "").filter(Boolean);
  for (const service of serviceIds) {
    const targetHost = normalizeHost(service);
    if (!targetHost) {
      continue;
    }
    const targetBase = registrableDomain(targetHost);
    if (
      uris.some((uri) => {
        const h = normalizeHost(uri);
        return (
          h === targetHost ||
          h.endsWith(`.${targetHost}`) ||
          targetHost.endsWith(`.${h}`) ||
          (targetBase.includes(".") && registrableDomain(h) === targetBase)
        );
      })
    ) {
      return true;
    }
  }
  return false;
}

@Component({
  selector: "vowkey-quick-bar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ProfileComponent, VowkeyGlyphComponent],
  template: `
    @if (isUnlocked()) {
      <input
        #quickFileInput
        id="vk-quick-file"
        type="file"
        class="vk-hidden-file"
        data-testid="quick-bar-file-input"
        (change)="onFileSelected($event)"
      />
      @if (dragging()) {
        <div class="vk-window-drop" aria-hidden="true">
          <div>
            <b>{{ tr("vkQbDropTitle", "Drop a document to add it") }}</b>
            <span>{{ tr("vkQbDropSub", "or a form to fill") }}</span>
          </div>
        </div>
      }
      @if (!isOpen()) {
        @if (reader(); as opened) {
          <div class="vk-reader-backdrop" (click)="closeReader()">
            <section
              class="vk-reader-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="vk-reader-title"
              (click)="$event.stopPropagation()"
            >
              <header>
                <div>
                  <h2 id="vk-reader-title">{{ opened.profile.name }}</h2>
                  @if (readerNote()) {
                    <p role="status">{{ readerNote() }}</p>
                  }
                </div>
                <button
                  type="button"
                  (click)="closeReader()"
                  [attr.aria-label]="tr('close', 'Close')"
                >
                  {{ tr("close", "Close") }}
                </button>
              </header>
              <app-profile
                [cipher]="opened.profile"
                [initialSourceId]="opened.sourceId"
                [initialVariantId]="opened.variantId"
              />
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
          <div class="vk-quick-container" (click)="$event.stopPropagation()">
            <div
              class="pill2"
              [class.mac]="isMac"
              [class.win]="!isMac"
              id="p-pill"
              data-testid="vowkey-quick-bar-pill"
              role="group"
              aria-label="Vowkey"
            >
              <button
                type="button"
                class="p-mark"
                [attr.data-tone]="markTone()"
                [attr.title]="tr('vkOpenVowkey', 'Open Vowkey')"
                data-testid="quick-bar-open-hub"
                (click)="openVault()"
              >
                @if (markGlyph(); as glyph) {
                  <vk-glyph [name]="glyph" [size]="glyph === 'check' ? 18 : 19" />
                } @else {
                  <svg
                    class="vk-mark"
                    width="20"
                    height="20"
                    viewBox="0 0 120 120"
                    aria-hidden="true"
                  >
                    <path
                      d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="8.5"
                      stroke-linecap="round"
                    />
                    <rect x="31" y="26" width="34" height="25" rx="5.5" class="vk-mark-accent" />
                    <rect x="37.5" y="36.75" width="21" height="3.5" rx="1.75" fill="#fff" />
                    <g fill="currentColor">
                      <circle cx="35" cy="65" r="5.5" />
                      <circle cx="51" cy="65" r="5.5" />
                      <circle cx="67" cy="65" r="5.5" />
                    </g>
                    <rect x="80" y="54" width="6" height="22" rx="3" class="vk-mark-accent" />
                  </svg>
                }
              </button>

              @switch (slot()) {
                @case ("drop") {
                  <div class="p-drop">
                    {{ tr("vkQbDropPrompt", "Drop a document to add it, or a form to fill") }}
                  </div>
                }
                @case ("reading") {
                  <div class="p-read is-busy" data-testid="quick-bar-status">
                    <div class="p-read-text">
                      <b>{{ statusTitle() }}</b>
                      <small>{{ statusSubtitle() }}</small>
                    </div>
                    <svg class="p-orbit" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <circle
                        cx="10"
                        cy="10"
                        r="7"
                        stroke="currentColor"
                        stroke-opacity="0.2"
                        stroke-width="2"
                      />
                      <path
                        d="M10 3a7 7 0 0 1 7 7"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                      />
                    </svg>
                  </div>
                }
                @case ("choose") {
                  <div class="p-read" data-testid="quick-bar-status">
                    <div class="p-read-text">
                      <b>{{ statusTitle() }}</b>
                      <small>{{ statusSubtitle() }}</small>
                    </div>
                  </div>
                }
                @case ("ambiguous") {
                  <div class="p-read" data-testid="quick-bar-status">
                    <div class="p-read-text">
                      <b>{{ statusTitle() }}</b>
                      <small>{{ statusSubtitle() }}</small>
                    </div>
                  </div>
                }
                @case ("fill") {
                  <div class="p-read is-compact" data-testid="quick-bar-status">
                    <div class="p-read-text">
                      <b>{{ tr("vkFillForm", "Fill a form") }}</b>
                      <small>{{ tr("vkQbFillFormats", "PDF, Word, Excel, or photo") }}</small>
                    </div>
                  </div>
                  <label
                    class="p-add"
                    for="vk-quick-file"
                    data-testid="quick-bar-choose-form-pill"
                    (click)="activeIntent.set('fill')"
                  >
                    {{ tr("vkChooseForm", "Choose form") }}
                  </label>
                }
                @case ("added") {
                  <div class="p-read" data-testid="quick-bar-status">
                    <div class="p-read-text">
                      <b>{{ statusTitle() }}</b>
                      <small>{{ statusSubtitle() }}</small>
                    </div>
                  </div>
                }
                @case ("notice") {
                  <div class="p-stat" [class.bad]="!noticeGood()" data-testid="quick-bar-status">
                    <b>{{ statusTitle() }}</b>
                  </div>
                }
                @default {
                  <label class="p-search">
                    <vk-glyph name="search" [size]="14" />
                    <input
                      id="p-q"
                      data-testid="quick-bar-search-input"
                      [placeholder]="tr('vkQbSearchDetails', 'Search details')"
                      [ngModel]="query()"
                      (ngModelChange)="onQueryChange($event)"
                      autocomplete="off"
                      [attr.aria-label]="tr('vkQbSearchDetails', 'Search details')"
                    />
                    <kbd>{{ quickBarShortcut }}</kbd>
                  </label>
                  <label
                    class="p-add"
                    for="vk-quick-file"
                    [attr.title]="
                      tr('vkQbDropPrompt', 'Add a document to a profile, or fill a form')
                    "
                    (click)="activeIntent.set('auto')"
                  >
                    {{ tr("vkQbAddOrFill", "Add or fill") }}
                  </label>
                }
              }
            </div>

            @if (slot() === "fill") {
              <div
                class="p-sheet"
                [class.mac]="isMac"
                [class.win]="!isMac"
                data-testid="quick-bar-fill-sheet"
              >
                <div class="sh">{{ tr("vkFillForm", "Fill a form") }}</div>
                <div class="qnote">
                  {{
                    tr(
                      "vkQbFillSheetBody",
                      "Drop a PDF, Word, Excel, or photo of a paper form here. Vowkey writes your saved details onto a copy beside the original."
                    )
                  }}
                </div>
                @if (profiles().length > 1) {
                  <label class="qnote"
                    >{{ tr("vkProfile", "Profile") }}
                    <select [ngModel]="selectedProfileId()" (ngModelChange)="selectProfile($event)">
                      <option value="">{{ tr("vkQbAskEachTime", "Ask each time") }}</option>
                      @for (profile of profiles(); track profile.id) {
                        <option [value]="profile.id">{{ profile.name }}</option>
                      }
                    </select>
                  </label>
                } @else if (profiles().length === 1) {
                  <div class="qnote">
                    <span>{{
                      tr("vkQbUsingProfile", "Using " + profiles()[0].name, profiles()[0].name)
                    }}</span>
                  </div>
                } @else {
                  <div class="qempty">
                    {{
                      tr(
                        "vkQbNeedDocumentFirst",
                        "Add a document (like an ID card or passport) first so Vowkey has details to fill with."
                      )
                    }}
                  </div>
                }
                <div class="qnote">
                  @if (profiles().length > 0) {
                    <label
                      for="vk-quick-file"
                      class="qact p"
                      data-testid="quick-bar-choose-form"
                      (click)="activeIntent.set('fill')"
                    >
                      {{ tr("vkChooseForm", "Choose form") }}
                    </label>
                  } @else {
                    <label
                      for="vk-quick-file"
                      class="qact p"
                      (click)="activeIntent.set('document')"
                    >
                      {{ tr("vkAddDocument", "Add document") }}
                    </label>
                  }
                  <button type="button" class="qact s" (click)="switchToSearch()">
                    {{ tr("vkQbSearchDetails", "Search details") }}
                  </button>
                </div>
              </div>
            }

            @if (slot() === "ambiguous") {
              <div
                class="p-sheet"
                [class.mac]="isMac"
                [class.win]="!isMac"
                data-testid="quick-bar-ambiguous"
              >
                <div class="sh">
                  {{ tr("vkQbAmbiguousTitle", "How should Vowkey use this file?") }}
                </div>
                <div class="qrow">
                  <div class="qrow-main">
                    <b>{{ tr("vkQbSaveToProfile", "Save to my profile") }}</b>
                    <small>{{
                      tr(
                        "vkQbReadDetailsFrom",
                        "Read personal details from " + statusTitle(),
                        statusTitle()
                      )
                    }}</small>
                  </div>
                  <button
                    type="button"
                    class="qact p"
                    data-testid="quick-bar-ambiguous-document"
                    (click)="chooseAmbiguous('document')"
                  >
                    {{ tr("vkQbSaveDetails", "Save details") }}
                  </button>
                </div>
                <div class="qrow">
                  <div class="qrow-main">
                    <b>{{ tr("vkFillForm", "Fill a form") }}</b>
                    <small>{{ tr("vkQbWriteCopy", "Write saved details onto a copy") }}</small>
                  </div>
                  <button
                    type="button"
                    class="qact s"
                    data-testid="quick-bar-ambiguous-fill"
                    (click)="chooseAmbiguous('fill')"
                  >
                    {{ tr("vkFillForm", "Fill a form") }}
                  </button>
                </div>
              </div>
              <button class="qact s" type="button" (click)="cancelChoice()">
                {{ tr("cancel", "Cancel") }}
              </button>
            }

            @if (slot() === "search") {
              <div
                class="p-sheet"
                [class.mac]="isMac"
                [class.win]="!isMac"
                id="p-sheet"
                data-testid="quick-bar-sheet"
              >
                <div class="sh">
                  {{
                    query().trim()
                      ? tr("vkDetails", "Details")
                      : tr("vkYourDetails", "Your details")
                  }}
                </div>
                @if (profiles().length > 1) {
                  <label class="qnote"
                    >{{ tr("vkProfile", "Profile") }}
                    <select [ngModel]="selectedProfileId()" (ngModelChange)="selectProfile($event)">
                      <option value="">{{ tr("vkAllProfiles", "All profiles") }}</option>
                      @for (profile of profiles(); track profile.id) {
                        <option [value]="profile.id">{{ profile.name }}</option>
                      }
                    </select>
                  </label>
                }
                @for (operation of operations(); track operation.id) {
                  <div class="qrow">
                    <div class="qrow-main">
                      <small>{{
                        operation.kind === "move"
                          ? tr("vkOpMoveWaiting", "Move waiting")
                          : operation.kind === "delete"
                            ? tr("vkOpDeleteWaiting", "Deletion waiting")
                            : tr("vkOpUploadWaiting", "Upload waiting")
                      }}</small>
                      <b>{{ operation.fileName }}</b>
                    </div>
                    <button
                      type="button"
                      class="qact p"
                      [disabled]="retrying()"
                      (click)="retry(operation.id)"
                    >
                      {{ tr("vkRetry", "Retry") }}
                    </button>
                  </div>
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
                        <b>{{ displayHitValue(hit) }}</b>
                      </div>
                      <span class="acts">
                        @if (isSensitiveHit(hit)) {
                          <button
                            class="qact s"
                            type="button"
                            [attr.aria-label]="
                              (isHitMasked(hit) ? tr('show', 'Show') : tr('hide', 'Hide')) +
                              ' ' +
                              hit.label
                            "
                            (click)="toggleHitMask(hit.id)"
                          >
                            {{ isHitMasked(hit) ? tr("show", "Show") : tr("hide", "Hide") }}
                          </button>
                        }
                        <button
                          class="qact p"
                          type="button"
                          [attr.data-pcopy]="idx"
                          (click)="copyHit(hit)"
                        >
                          {{ tr("copy", "Copy") }}
                        </button>
                        <details class="hit-menu">
                          <summary [attr.aria-label]="tr('vkMoreActions', 'More actions')">
                            •••
                          </summary>
                          <div>
                            <button type="button" (click)="openProfile(hit.profileId)">
                              {{ tr("vkOpenProfile", "Open profile") }}
                            </button>
                            @if (hit.sourceId) {
                              <button
                                type="button"
                                (click)="openProfile(hit.profileId, hit.sourceId, hit.variantId)"
                              >
                                {{ tr("vkShowInDocument", "Show in document") }}
                              </button>
                            }
                          </div>
                        </details>
                      </span>
                    </div>
                  }
                } @else {
                  <div class="qempty">
                    {{
                      query().trim()
                        ? tr(
                            "vkNoDetailMatches",
                            "No detail matches “" + query().trim() + "”.",
                            query().trim()
                          )
                        : tr("vkEmptyBody", "Add a document or type the details to fill this form.")
                    }}
                  </div>
                }
                <div class="qnote">
                  <label for="vk-quick-file" class="qact p" (click)="activeIntent.set('document')">
                    {{ tr("vkAddDocument", "Add document") }}
                  </label>
                  <label
                    for="vk-quick-file"
                    class="qact s"
                    data-testid="quick-bar-fill-form"
                    (click)="activeIntent.set('fill')"
                  >
                    {{ tr("vkFillForm", "Fill a form") }}
                  </label>
                  <button type="button" class="qact s" (click)="enterDetails()">
                    {{ tr("vkEnterDetails", "Enter details") }}
                  </button>
                </div>
                <div class="foot2">
                  <span>{{ tr("vkQbKeyHint", "↑↓ to choose · ↵ to copy") }}</span>
                  <span>{{ tr("vkQbDropShort", "Drop a document or a form") }}</span>
                </div>
              </div>
            }

            @if (slot() === "choose") {
              <div
                class="p-sheet"
                [class.mac]="isMac"
                [class.win]="!isMac"
                data-testid="quick-bar-choose"
              >
                <div class="sh">
                  {{
                    pendingCapture()
                      ? tr("vkQbAddDocumentTo", "Add document to")
                      : tr("vkQbFillFrom", "Fill from")
                  }}
                </div>
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
                        {{
                          pendingCapture()
                            ? tr("vkQbAddHere", "Add here")
                            : tr("vkWtFillNow", "Fill")
                        }}
                      </button>
                    </span>
                  </div>
                }
              </div>
              <button class="qact s" type="button" (click)="cancelChoice()">
                {{ tr("cancel", "Cancel") }}
              </button>
            }

            @if (
              slot() === "notice" && (statusSubtitle() || lastFilledPath() || crossDropAction())
            ) {
              <div
                class="p-sheet"
                [class.mac]="isMac"
                [class.win]="!isMac"
                data-testid="quick-bar-notice"
              >
                @if (statusSubtitle()) {
                  <div class="qnote">{{ statusSubtitle() }}</div>
                }
                @if (lastFillBreakdown(); as breakdown) {
                  @if (lastFilledPath(); as filledPath) {
                    @if (breakdown.savedToDownloads) {
                      <div class="qnote vk-fill-downloads" data-testid="quick-bar-downloads-notice">
                        {{
                          tr("vkSavedToDownloads", "Saved to Downloads: " + filledPath, filledPath)
                        }}
                      </div>
                    }
                  }
                  @if (breakdown.filledFields.length > 0) {
                    <div class="sh">{{ tr("vkFilledSection", "Filled") }}</div>
                    @for (field of breakdown.filledFields; track $index) {
                      <div class="qrow">
                        <div class="qrow-main">
                          <small>
                            {{ field.label }}
                            @if (field.closeCall) {
                              <span class="vk-close-call">{{ field.closeCall }}</span>
                            }
                          </small>
                          <b>{{ field.value }}</b>
                        </div>
                      </div>
                    }
                  }
                  @if (breakdown.unfilledFields.length > 0) {
                    <div class="sh">{{ tr("vkNeedsYourInput", "Needs your input") }}</div>
                    @for (missing of breakdown.unfilledFields; track $index) {
                      <div class="qrow">
                        <div class="qrow-main">
                          <small>{{ missing.label }}</small>
                        </div>
                      </div>
                    }
                  }
                }
                @if (lastFilledPath(); as filledPath) {
                  <div class="qnote">
                    <button
                      type="button"
                      class="qact p"
                      data-testid="quick-bar-open-filled"
                      (click)="openFilledCopy(filledPath)"
                    >
                      {{ tr("vkQbOpenFilledCopy", "Open filled copy") }}
                    </button>
                    <button
                      type="button"
                      class="qact s"
                      data-testid="quick-bar-reveal-filled"
                      (click)="revealFilledCopy(filledPath)"
                    >
                      {{
                        isMac
                          ? tr("vkShowInFinder", "Show in Finder")
                          : tr("vkShowInFolder", "Show in Explorer")
                      }}
                    </button>
                  </div>
                }
                @if (crossDropAction(); as cross) {
                  <div class="qnote">
                    <button
                      type="button"
                      class="qact p"
                      [attr.data-testid]="
                        cross.kind === 'fill' ? 'quick-bar-cross-fill' : 'quick-bar-cross-document'
                      "
                      (click)="runCrossDrop()"
                    >
                      {{
                        cross.kind === "fill"
                          ? tr("vkFillThisFormInstead", "Fill this form instead")
                          : tr("vkReadDocumentInstead", "Read details from this document instead")
                      }}
                    </button>
                  </div>
                }
              </div>
              @if (postFillOffer()) {
                <div class="qnote">
                  <b>{{ tr("vowkeyPostFillTitle", "Use these details on your other devices") }}</b>
                  <p>{{ tr("vowkeyPostFillBody", "Create an account to sync this vault.") }}</p>
                  <button type="button" class="qact p" (click)="openProtection()">
                    {{ tr("continue", "Continue") }}
                  </button>
                  <button type="button" class="qact s" (click)="dismissOffer()">
                    {{ tr("vowkeyPostFillNotNow", "Not now") }}
                  </button>
                </div>
              }
              @if (pendingForm() && profiles().length === 0) {
                <div class="qnote">
                  <label for="vk-quick-file" class="qact p" (click)="activeIntent.set('document')">
                    {{ tr("vkAddDocument", "Add document") }}
                  </label>
                  <button type="button" class="qact s" (click)="enterDetails()">
                    {{ tr("vkEnterDetails", "Enter details") }}
                  </button>
                </div>
              }
            }

            @if (slot() === "added") {
              <div
                class="p-sheet"
                [class.mac]="isMac"
                [class.win]="!isMac"
                data-testid="quick-bar-added"
              >
                <div class="sh">
                  {{ tr("vkQbReadFrom", "Read from " + addedFrom(), addedFrom()) }}
                </div>
                @for (detail of added(); track detail.key) {
                  <div class="qrow">
                    <div class="qrow-main">
                      <small>{{ detail.label }}</small>
                      <b>{{ detail.value }}</b>
                    </div>
                  </div>
                }
                @if (!attached()) {
                  <div class="qempty">
                    {{
                      tr(
                        "vkQbUploadWaitingBody",
                        "The upload is waiting. The original document is kept on this device for retry."
                      )
                    }}
                  </div>
                }
                @if (crossDropAction()?.kind === "fill") {
                  <div class="qnote">
                    <button
                      type="button"
                      class="qact s"
                      data-testid="quick-bar-cross-fill"
                      (click)="runCrossDrop()"
                    >
                      {{ tr("vkFillThisFormInstead", "Fill this form instead") }}
                    </button>
                  </div>
                }
                <div class="foot2">
                  <span>{{
                    tr("vkQbEditInProfileHint", "Change any of them in the profile.")
                  }}</span>
                  <span class="acts">
                    <button class="qact s" type="button" (click)="closeBar()">
                      {{ tr("vkDone", "Done") }}
                    </button>
                    <button
                      class="qact p"
                      type="button"
                      data-testid="quick-bar-open-profile"
                      (click)="openProfile()"
                    >
                      {{ tr("vkOpenProfile", "Open profile") }}
                    </button>
                  </span>
                  @if (pendingForm()) {
                    <button class="qact s" type="button" (click)="fillAdded()">
                      {{ tr("vkFillForm", "Fill a form") }}
                    </button>
                  }
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
        background: color-mix(in srgb, var(--vk-window, #fff) 84%, transparent);
        backdrop-filter: blur(8px);
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
      .vk-window-drop b {
        font-size: 20px;
        font-weight: 700;
      }
      .vk-window-drop span {
        color: var(--vk-muted, #5b5d66);
        font-size: 15px;
      }
      .vk-reader-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2100;
        background: rgba(15, 18, 26, 0.45);
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 24px;
      }
      .vk-reader-dialog {
        background: var(--vk-card, #fff);
        color: var(--vk-ink, #17202e);
        width: min(1120px, 100%);
        max-height: 90vh;
        overflow: auto;
        border: 1px solid var(--vk-line, #d9dde3);
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
        padding: 20px;
      }
      .vk-reader-dialog > header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 12px;
      }
      .vk-reader-dialog h2 {
        margin: 0;
        font-size: 20px;
      }
      .vk-reader-dialog p {
        margin: 6px 0 0;
        font-size: 13px;
        color: var(--vk-muted, #5b5d66);
      }
      .vk-reader-dialog > header button {
        border: 1px solid var(--vk-line, #d9dde3);
        border-radius: 8px;
        padding: 5px 12px;
        background: var(--vk-surface, transparent);
        color: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
      .vk-quick-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2000;
        background: rgb(14 18 30 / 0.14);
        backdrop-filter: blur(3px);
      }
      :host-context(.theme_dark) .vk-quick-backdrop {
        background: rgb(0 0 0 / 0.38);
      }
      .vk-quick-container {
        position: absolute;
        top: 10px;
        right: 14px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }
      .pill2 {
        min-height: 48px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--vk-surface, #ffffff) 98%, #ffffff) 0%,
          color-mix(in srgb, var(--vk-paper, #f5f4f0) 92%, var(--vk-surface, #ffffff)) 100%
        );
        backdrop-filter: blur(22px) saturate(1.35);
        border: 1px solid color-mix(in srgb, var(--vk-ink, #121216) 11%, transparent);
        border-radius: 16px;
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.94),
          inset 0 -1px 0 rgb(18 18 22 / 0.045),
          0 0 0 0.5px rgb(18 18 22 / 0.06),
          0 4px 10px -2px rgb(18 22 34 / 0.1),
          0 18px 38px -10px rgb(18 22 34 / 0.22);
        white-space: nowrap;
        color: var(--vk-ink, #121216);
      }
      :host-context(.theme_dark) .pill2 {
        background: linear-gradient(180deg, rgb(40 43 52 / 0.97) 0%, rgb(27 29 36 / 0.97) 100%);
        border-color: rgb(255 255 255 / 0.13);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.13),
          inset 0 -1px 0 rgb(0 0 0 / 0.42),
          0 0 0 1px rgb(0 0 0 / 0.65),
          0 6px 14px -2px rgb(0 0 0 / 0.48),
          0 22px 48px -10px rgb(0 0 0 / 0.72);
      }
      .p-mark {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        border: 0;
        flex: none;
        background: color-mix(in srgb, var(--vk-ink, #121216) 4.5%, var(--vk-surface, #ffffff));
        display: grid;
        place-items: center;
        color: var(--vk-ink, #121216);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.82),
          inset 0 0 0 1px color-mix(in srgb, var(--vk-ink, #121216) 9%, transparent),
          0 1px 2px rgb(18 22 34 / 0.06);
        cursor: pointer;
        transition:
          transform 0.14s ease,
          filter 0.14s ease,
          background-color 0.14s ease;
      }
      :host-context(.theme_dark) .p-mark[data-tone="idle"] {
        background: rgb(255 255 255 / 0.065);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.1),
          inset 0 0 0 1px rgb(255 255 255 / 0.09),
          0 1px 2px rgb(0 0 0 / 0.3);
      }
      .p-mark:hover {
        filter: brightness(0.97);
      }
      :host-context(.theme_dark) .p-mark:hover {
        filter: brightness(1.08);
      }
      .p-mark:active {
        transform: scale(0.96);
      }
      .p-mark .vk-mark-accent {
        fill: var(--vk-blue, #2563eb);
      }
      .p-mark[data-tone="blue"] {
        color: #ffffff;
        background: linear-gradient(160deg, #4f80f8 0%, #2563eb 100%);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.32),
          inset 0 0 0 1px rgb(255 255 255 / 0.16),
          0 2px 7px -1px rgb(37 99 235 / 0.42);
      }
      .p-mark[data-tone="green"] {
        color: #ffffff;
        background: linear-gradient(160deg, #27b47b 0%, #128a5a 100%);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.28),
          inset 0 0 0 1px rgb(255 255 255 / 0.16),
          0 2px 7px -1px rgb(18 138 90 / 0.36);
      }
      .p-mark[data-tone="amber"] {
        color: #ffffff;
        background: linear-gradient(160deg, #f09a36 0%, #c86d10 100%);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.28),
          inset 0 0 0 1px rgb(255 255 255 / 0.16),
          0 2px 7px -1px rgb(198 109 16 / 0.36);
      }
      .p-search {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 240px;
        height: 36px;
        padding: 0 10px 0 11px;
        border-radius: 10px;
        background: color-mix(in srgb, var(--vk-ink, #121216) 3%, var(--vk-surface, #ffffff));
        box-shadow:
          inset 0 1px 2px rgb(18 22 34 / 0.04),
          inset 0 0 0 1px color-mix(in srgb, var(--vk-ink, #121216) 10%, transparent);
        color: var(--vk-faint, #8a8a94);
        cursor: text;
        transition: box-shadow 0.14s ease;
      }
      :host-context(.theme_dark) .p-search {
        background: rgb(0 0 0 / 0.24);
        box-shadow:
          inset 0 1px 2px rgb(0 0 0 / 0.3),
          inset 0 0 0 1px rgb(255 255 255 / 0.1);
      }
      .p-search:focus-within {
        box-shadow:
          inset 0 0 0 1.5px color-mix(in srgb, var(--vk-blue, #2563eb) 55%, transparent),
          0 0 0 3px color-mix(in srgb, var(--vk-blue, #2563eb) 14%, transparent);
      }
      .p-search input,
      .p-search input:focus,
      .p-search input:focus-visible {
        flex: 1;
        min-width: 0;
        border: 0 !important;
        background: transparent !important;
        outline: none !important;
        box-shadow: none !important;
        font-size: 12.5px;
        color: var(--vk-ink, #121216);
      }
      .p-search input::placeholder {
        color: var(--vk-faint, #8a8a94);
      }
      .p-search kbd {
        padding: 2px 5px;
        border-radius: 5px;
        background: var(--vk-surface, #ffffff);
        border: 1px solid var(--vk-line, #e2e0da);
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 10px;
        line-height: 1.2;
        color: var(--vk-muted, #5b5d66);
      }
      :host-context(.theme_dark) .p-search kbd {
        background: rgb(255 255 255 / 0.06);
        border-color: rgb(255 255 255 / 0.1);
      }
      .p-add {
        height: 36px;
        padding: 0 14px;
        border-radius: 10px;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--vk-blue, #2563eb) 86%, #ffffff) 0%,
          var(--vk-blue, #2563eb) 100%
        );
        color: #ffffff;
        font-weight: 600;
        font-size: 12.5px;
        display: flex;
        align-items: center;
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.26),
          0 1px 2px rgb(37 99 235 / 0.28);
        cursor: pointer;
        transition: filter 0.14s ease;
      }
      :host-context(.theme_dark) .p-add {
        background: linear-gradient(180deg, #4b82f6 0%, #2563eb 100%);
      }
      .p-add:hover {
        filter: brightness(1.05);
      }
      .p-drop {
        min-width: 280px;
        height: 36px;
        padding: 0 14px;
        border-radius: 10px;
        border: 1.5px dashed var(--vk-blue, #2563eb);
        background: color-mix(in srgb, var(--vk-blue, #2563eb) 7%, transparent);
        color: var(--vk-blue-ink, #1d4ed8);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 12px;
        cursor: copy;
      }
      .p-read {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 10px 0 2px;
        min-width: 0;
        max-width: 340px;
      }
      .p-read.is-compact {
        padding-right: 4px;
      }
      .p-read-text {
        display: grid;
        gap: 1px;
        min-width: 0;
        line-height: 1.22;
      }
      .p-read-text b {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-read-text small {
        font-size: 11.5px;
        font-weight: 500;
        color: var(--vk-muted, #5b5d66);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-orbit {
        width: 18px;
        height: 18px;
        flex: none;
        color: var(--vk-blue, #2563eb);
        animation: vk-pill-spin 0.9s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .p-orbit {
          animation: none;
        }
      }
      @keyframes vk-pill-spin {
        to {
          transform: rotate(360deg);
        }
      }
      .p-stat {
        display: flex;
        align-items: center;
        min-height: 36px;
        padding: 0 10px 0 2px;
        font-size: 13px;
        max-width: 380px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-stat b {
        font-weight: 600;
        letter-spacing: -0.01em;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .p-sheet {
        width: 392px;
        max-height: 70vh;
        overflow-y: auto;
        background: linear-gradient(
          180deg,
          color-mix(in srgb, var(--vk-surface, #ffffff) 98%, #ffffff) 0%,
          color-mix(in srgb, var(--vk-paper, #f5f4f0) 94%, var(--vk-surface, #ffffff)) 100%
        );
        backdrop-filter: blur(22px) saturate(1.35);
        border: 1px solid color-mix(in srgb, var(--vk-ink, #121216) 11%, transparent);
        border-radius: 16px;
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.9),
          0 0 0 0.5px rgb(18 18 22 / 0.06),
          0 18px 42px -10px rgb(18 22 34 / 0.22),
          0 4px 10px -2px rgb(18 22 34 / 0.08);
        padding: 6px;
        display: grid;
        gap: 2px;
        color: var(--vk-ink, #121216);
      }
      :host-context(.theme_dark) .p-sheet {
        background: linear-gradient(180deg, rgb(38 40 49 / 0.97) 0%, rgb(26 28 35 / 0.97) 100%);
        border-color: rgb(255 255 255 / 0.12);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.1),
          0 0 0 1px rgb(0 0 0 / 0.65),
          0 22px 48px -10px rgb(0 0 0 / 0.72),
          0 6px 14px -2px rgb(0 0 0 / 0.45);
      }
      .p-sheet .sh {
        font-size: 10.5px;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--vk-faint, #8a8a94);
        font-weight: 600;
        padding: 6px 10px 3px;
      }
      .qrow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-radius: 10px;
        padding: 7px 10px;
      }
      .qrow.sel {
        background: var(--vk-blue-soft, rgba(37, 99, 235, 0.09));
      }
      .qrow-main {
        min-width: 0;
        display: grid;
      }
      .qrow-main small {
        font-size: 11px;
        color: var(--vk-muted, #5b5d66);
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
        padding: 5px 10px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .qact.s {
        background: var(--vk-hover, rgba(18, 18, 22, 0.055));
        color: var(--vk-ink, #121216);
        box-shadow: inset 0 0 0 1px var(--vk-line, rgba(18, 18, 22, 0.1));
      }
      .vk-quick-container > .qact.s {
        background: var(--vk-surface, #ffffff);
        padding: 6px 12px;
        border-radius: 9px;
        box-shadow:
          inset 0 0 0 1px var(--vk-line, rgba(18, 18, 22, 0.12)),
          0 6px 16px -4px rgb(18 22 34 / 0.18);
      }
      .qact.p {
        background: #2563eb;
        color: #ffffff;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.22);
      }
      .qempty {
        padding: 14px 10px;
        font-size: 12px;
        color: var(--vk-muted, #5b5d66);
        text-align: center;
      }
      .qnote {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px 12px;
        font-size: 12.5px;
        line-height: 1.4;
        color: var(--vk-muted, #5b5d66);
      }
      .foot2 {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 10px 3px;
        border-top: 1px solid var(--vk-line, rgba(18, 18, 22, 0.08));
        margin-top: 3px;
        font-size: 11px;
        color: var(--vk-muted, #5b5d66);
      }
      .vk-hidden-file {
        display: none;
      }
      .hit-menu {
        position: relative;
      }
      .hit-menu summary {
        cursor: pointer;
        padding: 5px;
        list-style: none;
      }
      .hit-menu > div {
        position: absolute;
        right: 0;
        z-index: 2;
        min-width: 160px;
        background: var(--vk-card, #fff);
        border: 1px solid var(--vk-line, #d9dde3);
        border-radius: 8px;
        padding: 6px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
      }
      .hit-menu button {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px;
        border: 0;
        background: none;
        color: inherit;
        cursor: pointer;
      }
      .qnote select {
        max-width: 100%;
        margin-left: 8px;
        padding: 5px 8px;
        border: 1px solid var(--vk-line, #d9dde3);
        background: var(--vk-surface, transparent);
        color: var(--vk-ink, inherit);
        border-radius: 6px;
      }
      .pill2.win {
        border-radius: 13px;
      }
      .pill2.win .p-mark,
      .pill2.win .p-search,
      .pill2.win .p-add,
      .pill2.win .p-drop {
        border-radius: 8px;
      }
      .p-sheet.win {
        border-radius: 12px;
      }
      .vk-close-call {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--vk-amber-soft, rgba(245, 158, 11, 0.16));
        color: var(--vk-amber, #92400e);
        font-size: 10px;
        font-weight: 600;
      }
      .vk-fill-downloads {
        font-size: 11.5px;
        color: var(--vk-muted, #475569);
        word-break: break-all;
      }
    `,
  ],
})
export class QuickBarComponent implements OnInit, OnDestroy {
  @ViewChild("quickFileInput")
  private quickFileInput?: ElementRef<HTMLInputElement>;
  readonly isUnlocked = signal(false);
  readonly isOpen = signal(false);
  readonly slot = signal<QuickBarSlot>("search");
  readonly query = signal("");
  readonly selectedIndex = signal(0);
  readonly statusTitle = signal("");
  readonly statusSubtitle = signal("");
  readonly noticeGood = signal(true);
  readonly workingKind = signal<"scan" | "form">("scan");
  readonly markTone = computed<"idle" | "blue" | "green" | "amber">(() => {
    switch (this.slot()) {
      case "search":
        return "idle";
      case "added":
        return "green";
      case "notice":
        return this.noticeGood() ? "green" : "amber";
      default:
        return "blue";
    }
  });
  readonly markGlyph = computed<GlyphName | null>(() => {
    switch (this.slot()) {
      case "search":
        return null;
      case "reading":
        return this.workingKind() === "form" || /fill/i.test(this.statusSubtitle())
          ? "form"
          : "scan";
      case "fill":
        return "form";
      case "drop":
        return "import";
      case "choose":
        return "person";
      case "ambiguous":
        return "layers";
      case "added":
        return "check";
      case "notice":
        return this.noticeGood() ? "check" : "alert";
    }
  });

  readonly profiles = signal<CipherView[]>([]);
  readonly selectedProfileId = signal("");
  readonly operations = signal<PendingDocumentOperation[]>([]);
  readonly retrying = signal(false);
  readonly postFillOffer = signal(false);
  readonly reader = signal<{
    profile: CipherView;
    sourceId: string | null;
    variantId: string | null;
  } | null>(null);
  readonly readerNote = signal("");
  private accountStatus = AuthenticationStatus.LoggedOut;
  private activeUserId: UserId | null = null;
  private refreshGeneration = 0;
  private addedSourceId: string | null = null;
  private agentAuthority: AgentVaultAuthority | null = null;
  private agentEpoch = 0;
  private agentSession = "";
  private agentKey: unknown = null;
  private frontForm: { path: string; name: string; bytes: Uint8Array } | null = null;
  private agentPollTimer: ReturnType<typeof setInterval> | null = null;
  private lastNotifiedAgentKey = "";

  readonly allHits = signal<QuickBarDetail[]>([]);
  readonly filteredHits = computed(() => {
    const query = this.query().trim().toLowerCase();
    const hits = this.selectedProfileId()
      ? this.allHits().filter((hit) => hit.profileId === this.selectedProfileId())
      : this.allHits();
    return query
      ? hits.filter((h) => `${h.label} ${h.profile} ${h.value}`.toLowerCase().includes(query))
      : hits;
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
  readonly pendingCapture = signal<{
    file: File;
    bytes: Uint8Array;
    captured: CapturedDocument;
  } | null>(null);
  readonly pendingAmbiguous = signal<{
    file: File;
    bytes: Uint8Array;
    profileId?: string;
    openReader: boolean;
  } | null>(null);
  readonly activeIntent = signal<HubOpenMode>("auto");
  readonly lastFilledPath = signal<string | null>(null);
  readonly lastFillBreakdown = signal<FillFormBreakdown | null>(null);
  readonly crossDropAction = signal<{
    kind: "fill" | "document";
    file: File;
    bytes: Uint8Array;
    profileId?: string;
    openReader: boolean;
  } | null>(null);
  private readonly localeTick = signal(0);
  readonly isMac: boolean;
  readonly quickBarShortcut: string;

  private readonly destroy$ = new Subject<void>();
  private pendingPickProfileId?: string;

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
    private readonly hub: VowkeyHub,
    @Optional() private readonly totpService?: TotpService,
    @Optional()
    @Inject(LOCAL_AGENT_MANAGEMENT)
    private readonly localAgent?: LocalAgentManagement | null,
    @Optional() private readonly i18n?: I18nService,
  ) {
    this.isMac = this.platformUtilsService?.getDevice?.() === DeviceType.MacOsDesktop;
    this.quickBarShortcut = this.isMac ? "⌘\\" : "Ctrl+\\";
  }

  protected tr(key: string, fallback: string, p1?: string | number, p2?: string | number): string {
    this.localeTick();
    const translated = this.i18n?.t?.(
      key,
      p1 != null ? String(p1) : undefined,
      p2 != null ? String(p2) : undefined,
    );
    return translated && translated !== key ? translated : fallback;
  }

  private pillStrings(): Record<string, string> {
    return {
      searchPlaceholder: this.tr("vkPillSearchPlaceholder", "Search logins, details, keys"),
      dropHint: this.tr("vkQbDropPrompt", "Drop a document to add, or a form to fill"),
      onThisDevice: this.tr("vowkeyLocalVault", "On this device"),
      fill: this.tr("vkWtFillNow", "Fill"),
      typeVerb: this.tr("vkQbType", "Type"),
      copy: this.tr("copy", "Copy"),
      vault: this.tr("vkLibrary", "Vault"),
      localPassword: this.tr("vowkeyLocalPasswordLabel", "Password on this device"),
      unlock: this.tr("unlock", "Unlock"),
      unlockInVowkey: this.tr("vkPillUnlockInApp", "Unlock the vault in Vowkey."),
      openVowkey: this.tr("vkOpenVowkey", "Open Vowkey"),
      allProfiles: this.tr("vkAllProfiles", "All profiles"),
      whoseDetails: this.tr("vkWhoseDetails", "Whose details"),
      showInDocument: this.tr("vkShowInDocument", "Show in document"),
      openProfile: this.tr("vkOpenProfile", "Open profile"),
      allowOnce: this.tr("vowkeyAgentAllowOnce", "Allow once"),
      alwaysAllowSite: this.tr("vowkeyAgentAlwaysAllowSite", "Always allow on this site"),
      alwaysAllowHere: this.tr("vowkeyAgentAlwaysAllowHere", "Always allow here"),
      dontAllow: this.tr("vowkeyAgentDeny", "Don't allow"),
      needsApproval: this.tr("vkNeedsApproval", "Needs approval"),
      connect: this.tr("vkConnect", "Connect"),
      emptyHint: this.tr(
        "vkPillEmpty",
        "Drop a document to add details, or save a login in Vowkey.",
      ),
      dropFooter: this.tr("vkQbDropShort", "Drop document or form"),
      fillForm: this.tr("vkFillForm", "Fill form"),
      fillWindow: this.tr("vkShortcutFillWindow", "Fill window"),
      suggested: this.tr("vkSuggested", "Suggested"),
      aiModeOn: this.tr("vkAiModeOn", "AI mode on: Fill asks your AI agent to fill this window"),
      aiModeOff: this.tr("vkAiModeOff", "AI mode off: Fill types your saved login instantly"),
      aiFillTitle: this.tr("vkAiFillTitle", "Fill this window with your AI agent"),
      aiStarting: this.tr("vkAiStarting", "Starting"),
      aiThinking: this.tr("vkAiThinking", "is reading the form…"),
      aiReading: this.tr("vkAiReading", "Reading the window…"),
      aiFilling: this.tr("vkAiFilling", "Filling…"),
      aiFillingN: this.tr("vkAiFillingN", "Filling fields:"),
      aiLooking: this.tr("vkAiLooking", "Checking the result…"),
      aiStop: this.tr("vkAiStop", "Stop"),
      captureForm: this.tr("vkCaptureForm", "Screen capture"),
      fillingForm: this.tr("vkFillingForm", "Filling the form"),
    };
  }

  ngOnInit(): void {
    this.i18n?.locale$
      ?.pipe?.(takeUntil(this.destroy$))
      ?.subscribe?.(() => this.localeTick.update((n) => n + 1));
    this.hub.openRequests$
      .pipe(takeUntil(this.destroy$))
      .subscribe((mode) => void this.openBar(mode ?? "auto"));
    this.hub.pickRequests$.pipe(takeUntil(this.destroy$)).subscribe((req) => {
      const mode = typeof req === "string" ? req : req.mode;
      this.pendingPickProfileId = typeof req === "string" ? undefined : req.profileId;
      this.activeIntent.set(mode);
      this.quickFileInput?.nativeElement?.click();
    });
    const accountSession = this.accounts.activeAccount$.pipe(
      switchMap((account) =>
        account == null
          ? of({ userId: null, key: null })
          : this.keys
              .userKey$(account.id)
              .pipe(map((key) => ({ userId: account.id as UserId, key }))),
      ),
    );
    combineLatest([this.authService.activeAccountStatus$, this.localVault.state$, accountSession])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([status, localState, session]) => {
        this.accountStatus = status;
        this.activeUserId = session.userId;
        const unlocked =
          localState !== "migrating" &&
          ((status === AuthenticationStatus.Unlocked && session.key != null) ||
            (status === AuthenticationStatus.LoggedOut &&
              (localState === "empty" ||
                localState === "session-unlocked" ||
                localState === "persisted-unlocked")));
        this.isUnlocked.set(unlocked);
        this.refreshGeneration++;
        const agentReady =
          unlocked &&
          ((status === AuthenticationStatus.LoggedOut &&
            (localState === "session-unlocked" || localState === "persisted-unlocked")) ||
            (status === AuthenticationStatus.Unlocked &&
              (localState === "empty" ||
                localState === "attached" ||
                localState === "attached-local-pending")));
        const scope = agentReady ? (session.userId ?? "guest") : "";
        const nextKey = agentReady ? session.key : null;
        if (this.agentSession !== scope || this.agentKey !== nextKey) {
          this.agentSession = scope;
          this.agentKey = nextKey;
          this.agentEpoch++;
          this.agentAuthority = null;
          ipc.localVault.agent.changed();
          if (agentReady) {
            ipc.localVault.agent.ready();
          }
        }
        if (unlocked) {
          void this.refreshDetails().catch((error: unknown) =>
            this.notice(
              false,
              "Couldn't open the vault",
              error instanceof Error ? error.message : String(error),
            ),
          );
          this.startAgentWatcher();
        } else {
          this.stopAgentWatcher();
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
    ipc.localVault.agent.onRequest((id, request) =>
      this.zone.run(async () => {
        try {
          const epoch = this.agentEpoch;
          const result = await this.answerAgent(request);
          if (epoch !== this.agentEpoch) {
            throw new Error("account_changed");
          }
          ipc.localVault.agent.respond(id, { result });
        } catch (error) {
          const message = error instanceof Error ? error.message : "locked";
          ipc.localVault.agent.respond(id, {
            error: ["account_changed", "locked", "malformed", "no_access"].includes(message)
              ? message
              : "no_access",
          });
        }
      }),
    );
    void this.localVault
      .initialize()
      .catch((error: unknown) =>
        this.notice(
          false,
          "Couldn't open the vault",
          error instanceof Error ? error.message : String(error),
        ),
      );
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
    this.stopAgentWatcher();
    this.agentEpoch++;
    this.agentAuthority = null;
    ipc.localVault.agent.changed();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startAgentWatcher(): void {
    if (this.agentPollTimer != null || this.localAgent == null) {
      return;
    }
    this.agentPollTimer = setInterval(() => {
      void this.checkPendingAgentPrompt();
    }, 1500);
  }

  private stopAgentWatcher(): void {
    if (this.agentPollTimer != null) {
      clearInterval(this.agentPollTimer);
      this.agentPollTimer = null;
    }
    this.lastNotifiedAgentKey = "";
  }

  private async currentAgentPrompt(): Promise<AgentApprovalPrompt | null> {
    if (this.localAgent == null) {
      return null;
    }
    try {
      const state = await this.localAgent.pending();
      const req = state.requests?.[0];
      if (req != null) {
        return {
          kind: "request",
          requestId: req.requestId,
          agentName: req.displayName,
          targetDisplay: req.targetDisplay,
          goal: req.goal,
          reason: req.reason,
          entries: (req.entries ?? []).map((entry) => ({
            entryId: entry.entryId,
            label: entry.label,
            reference: entry.reference,
          })),
        };
      }
      const pair = state.pairs?.[0];
      if (pair != null) {
        return {
          kind: "pair",
          connectionId: pair.connectionId,
          agentName: pair.displayName,
        };
      }
    } catch {
      // Agent management unavailable in this session.
    }
    return null;
  }

  private async checkPendingAgentPrompt(): Promise<void> {
    const prompt = await this.currentAgentPrompt();
    const key = prompt ? `${prompt.kind}:${prompt.requestId ?? prompt.connectionId ?? ""}` : "";
    if (key && key !== this.lastNotifiedAgentKey) {
      this.lastNotifiedAgentKey = key;
      ipc.quickBar.notifyAgentPending?.();
    } else if (!key) {
      this.lastNotifiedAgentKey = "";
    }
  }

  @HostListener("window:keydown", ["$event"])
  handleKeydown(event: KeyboardEvent): void {
    if (!this.isUnlocked()) {
      return;
    }
    if (event.key === "Escape" && this.reader()) {
      event.preventDefault();
      this.closeReader();
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

  async openBar(mode: HubOpenMode = "auto"): Promise<void> {
    this.isOpen.set(true);
    this.activeIntent.set(mode);
    this.lastFilledPath.set(null);
    this.lastFillBreakdown.set(null);
    this.crossDropAction.set(null);
    this.pendingAmbiguous.set(null);
    this.slot.set(mode === "fill" ? "fill" : "search");
    this.query.set("");
    this.selectedIndex.set(0);
    await this.refreshDetails();
  }

  switchToSearch(): void {
    this.activeIntent.set("auto");
    this.slot.set("search");
  }

  closeBar(): void {
    this.isOpen.set(false);
    this.activeIntent.set("auto");
    this.slot.set("search");
    this.pendingForm.set(null);
    this.pendingAmbiguous.set(null);
    this.lastFilledPath.set(null);
    this.lastFillBreakdown.set(null);
    this.crossDropAction.set(null);
  }

  openVault(): void {
    this.closeBar();
    void this.router.navigate(["/vault"]);
  }

  async openProfile(
    profileId = this.addedProfile()?.id,
    sourceId: string | null = null,
    variantId: string | null = null,
  ): Promise<void> {
    if (profileId == null) {
      return;
    }
    const profile = (await this.documents.profiles()).find((item) => item.id === profileId);
    if (profile == null) {
      if (this.operations().some((operation) => operation.profileId === profileId)) {
        await this.openBar();
        return;
      }
      throw new Error("The profile is unavailable.");
    }
    this.closeBar();
    this.reader.set({
      profile,
      sourceId: sourceId ?? (profileId === this.addedProfile()?.id ? this.addedSourceId : null),
      variantId,
    });
  }

  closeReader(): void {
    this.reader.set(null);
    this.readerNote.set("");
    void this.refreshDetails();
  }

  selectProfile(id: string): void {
    this.selectedProfileId.set(id);
    this.selectedIndex.set(0);
  }

  enterDetails(): void {
    this.closeBar();
    void this.router.navigate(["/vault"]);
  }

  openProtection(): void {
    this.closeBar();
    void this.router.navigate(["/vault"]);
  }

  async dismissOffer(): Promise<void> {
    await this.localVault.dismissProtectionOffer();
    this.postFillOffer.set(false);
  }

  async retry(id: string): Promise<void> {
    if (this.retrying()) {
      return;
    }
    this.retrying.set(true);
    try {
      await this.documents.retryOperation(id);
      await this.refreshDetails();
    } catch (error) {
      this.notice(
        false,
        "Couldn't finish the document update",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      this.retrying.set(false);
    }
  }

  cancelChoice(): void {
    this.pendingCapture.set(null);
    this.pendingForm.set(null);
    this.pendingAmbiguous.set(null);
    this.activeIntent.set("auto");
    this.slot.set("search");
  }

  async chooseAmbiguous(choice: "document" | "fill"): Promise<void> {
    const pending = this.pendingAmbiguous();
    if (pending == null) {
      return;
    }
    this.pendingAmbiguous.set(null);
    await this.processFile(
      pending.file,
      pending.bytes,
      pending.profileId,
      pending.openReader,
      choice,
    );
  }

  async runCrossDrop(): Promise<void> {
    const cross = this.crossDropAction();
    if (!cross) {
      return;
    }
    this.crossDropAction.set(null);
    await this.processFile(cross.file, cross.bytes, cross.profileId, cross.openReader, cross.kind);
  }

  async openFilledCopy(targetPath: string): Promise<void> {
    await ipc.capture?.openPath?.(targetPath);
  }

  async revealFilledCopy(targetPath: string): Promise<void> {
    await ipc.capture?.showInFolder?.(targetPath);
  }

  async fillAdded(): Promise<void> {
    const profile = this.addedProfile();
    if (profile != null) {
      await this.fillFrom(profile);
    }
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
      return {
        scopeIds: authority.scopeIds,
        accountBacked: authority.coordination != null,
        session: this.agentEpoch,
      };
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
    if (
      (action === "resolve" || action === "value") &&
      typeof request.itemId === "string" &&
      typeof request.fieldPath === "string"
    ) {
      return action === "resolve"
        ? authority.resolve(request.itemId, request.fieldPath)
        : authority.value(request.itemId, request.fieldPath);
    }
    if (action === "collect") {
      return authority.targets.collect(
        typeof request.targetId === "string" ? request.targetId : undefined,
      );
    }
    if (
      action === "write" &&
      isAgentTarget(request.target) &&
      Array.isArray(request.operations) &&
      request.operations.every(
        (operation) =>
          operation != null &&
          typeof operation === "object" &&
          "entryId" in operation &&
          "fieldId" in operation &&
          "value" in operation &&
          typeof operation.entryId === "string" &&
          typeof operation.fieldId === "string" &&
          typeof operation.value === "string",
      )
    ) {
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
      write: async (target: AgentTarget, operations: AgentWrite[]) =>
        this.writeFront(target, operations),
    };
    const unlockedAccount =
      userId != null && (await firstValueFrom(this.keys.userKey$(userId))) != null;
    this.agentAuthority = unlockedAccount
      ? new AccountAgentAuthority(
          userId as UserId,
          this.accounts,
          this.keys,
          this.ciphers,
          this.api,
          targets,
          await this.appId.getAppId(),
        )
      : await this.localVault.authority(targets);
    return this.agentAuthority;
  }

  private async collectFront(targetId?: string): Promise<AgentTarget[]> {
    const form = this.frontForm;
    if (
      form == null ||
      !/\.pdf$/i.test(form.name) ||
      (targetId != null && targetId !== form.path)
    ) {
      return [];
    }
    const fields = await ipc.capture.readPdfForm(form.bytes, form.name);
    return [
      {
        targetId: form.path,
        kind: "file",
        destinationKey: `file:${form.path}`,
        generation: String(form.bytes.byteLength),
        display: form.name,
        formSignature: fields.map((field) => field.key).join("\n"),
        sections: [{ id: "form", label: form.name }],
        fields: fields.map((field) => ({
          id: field.key,
          sectionId: "form",
          label: field.label || field.name,
          type: field.type,
          options: field.options,
        })),
      },
    ];
  }

  private async writeFront(
    target: AgentTarget,
    operations: AgentWrite[],
  ): Promise<{ entries: { entryId: string; outcome: "confirmed" | "not_written" }[] }> {
    const form = this.frontForm;
    if (form == null || target.targetId !== form.path) {
      return {
        entries: operations.map((operation) => ({
          entryId: operation.entryId,
          outcome: "not_written",
        })),
      };
    }
    const values = Object.fromEntries(
      operations.map((operation) => [operation.fieldId, operation.value]),
    );
    await ipc.capture.fillPdfForm({
      sourcePath: form.path,
      name: form.name,
      bytes: form.bytes,
      values,
    });
    return {
      entries: operations.map((operation) => ({
        entryId: operation.entryId,
        outcome: "confirmed",
      })),
    };
  }

  private async loadNonProfileCiphers(): Promise<CipherView[]> {
    const items: CipherView[] = [];
    if (this.accountStatus === AuthenticationStatus.Unlocked && this.activeUserId != null) {
      const accountItems = (await this.ciphers.getAllDecrypted?.(this.activeUserId)) ?? [];
      items.push(...accountItems.filter((c) => !c.deletedDate && c.type !== CipherType.Identity));
    } else if (this.accountStatus === AuthenticationStatus.LoggedOut) {
      const localItems = (await this.localVault.list?.()) ?? [];
      items.push(...localItems.filter((c) => !c.deletedDate && c.type !== CipherType.Identity));
    }
    return items;
  }

  private async resolveTotpCode(secret: string | null | undefined): Promise<string | undefined> {
    if (!secret || !secret.trim() || !this.totpService?.getCode$) {
      return undefined;
    }
    try {
      const res = await firstValueFrom(this.totpService.getCode$(secret.trim()));
      return res?.code || undefined;
    } catch {
      return undefined;
    }
  }

  private async buildQuickBarItems(
    details: QuickBarDetail[],
    front?: FrontContext | null,
  ): Promise<QuickBarVaultItem[]> {
    const ciphers = await this.loadNonProfileCiphers();
    const matchedLogins: QuickBarVaultItem[] = [];
    const otherLogins: QuickBarVaultItem[] = [];
    const cardsAndKeys: QuickBarVaultItem[] = [];

    for (const cipher of ciphers) {
      if (cipher.type === CipherType.Login) {
        const username = cipher.login?.username ?? "";
        const password = cipher.login?.password ?? "";
        const uris = (cipher.login?.uris ?? [])
          .map((u) => u.uri?.trim() ?? "")
          .filter((u) => u.length > 0);
        const primaryHost = normalizeHost(uris[0]);
        const matched = loginMatchesFront(cipher, front);
        const totp = await this.resolveTotpCode(cipher.login?.totp);
        const item: QuickBarVaultItem = {
          id: `login-${cipher.id}`,
          kind: "login",
          cipherId: cipher.id,
          label: cipher.name || primaryHost || "Login",
          subtitle: [username, primaryHost].filter(Boolean).join(" · "),
          value: password || username,
          displayValue: username || (password ? "••••••••••••" : primaryHost),
          username,
          password,
          totp,
          uris,
          matched,
        };
        if (matched) {
          matchedLogins.push(item);
        } else {
          otherLogins.push(item);
        }
      } else if (cipher.type === CipherType.Card) {
        const number = (cipher.card?.number ?? "").replace(/\s+/g, "");
        const last4 = number.slice(-4);
        const expMonth = cipher.card?.expMonth ? cipher.card.expMonth.padStart(2, "0") : "";
        const expYear = cipher.card?.expYear ? cipher.card.expYear.slice(-2) : "";
        const exp = expMonth && expYear ? `${expMonth}/${expYear}` : "";
        cardsAndKeys.push({
          id: `card-${cipher.id}`,
          kind: "card",
          cipherId: cipher.id,
          label: cipher.name || cipher.card?.brand || "Card",
          subtitle: [cipher.card?.cardholderName, exp].filter(Boolean).join(" · "),
          value: number,
          displayValue: last4 ? `•••• ${last4}` : "Card",
          cardholder: cipher.card?.cardholderName ?? undefined,
          cardNumber: number || undefined,
          cardExp: exp || undefined,
          cardCode: cipher.card?.code ?? undefined,
        });
      } else if (cipher.type === CipherType.ApiKey) {
        const raw = (cipher.apiKey?.value ?? "").trim();
        if (!raw) {
          continue;
        }
        const hostLabel =
          cipher.apiKey?.allowedHosts?.[0] || cipher.apiKey?.headerName || "API key";
        const masked = raw.length > 6 ? `${raw.slice(0, 4)}••••••••${raw.slice(-2)}` : "••••••••";
        cardsAndKeys.push({
          id: `key-${cipher.id}`,
          kind: "key",
          cipherId: cipher.id,
          label: cipher.name || hostLabel,
          subtitle: hostLabel,
          value: raw,
          displayValue: masked,
          uris: cipher.apiKey?.allowedHosts ?? [],
        });
      } else if (cipher.type === CipherType.SshKey) {
        const priv = cipher.sshKey?.privateKey ?? "";
        const pub = cipher.sshKey?.publicKey ?? "";
        const fp = cipher.sshKey?.keyFingerprint ?? "";
        cardsAndKeys.push({
          id: `key-${cipher.id}`,
          kind: "key",
          cipherId: cipher.id,
          label: cipher.name || "SSH key",
          subtitle: "SSH key",
          value: pub || priv,
          displayValue: fp || (pub ? `${pub.slice(0, 24)}…` : "••••••••"),
        });
      } else if (cipher.type === CipherType.SecureNote) {
        const secretField = (cipher.fields ?? []).find((f) => Boolean(f.value?.trim()));
        const raw = secretField?.value?.trim() || cipher.notes?.trim() || "";
        if (!raw) {
          continue;
        }
        const isKey = Boolean(secretField) || /^(sk-|ghp_|vk_|eyJ|AIza|xox[baprs]-)/.test(raw);
        const masked =
          isKey && raw.length > 6
            ? `${raw.slice(0, 4)}••••••••${raw.slice(-2)}`
            : isKey
              ? "••••••••"
              : raw.slice(0, 60);
        cardsAndKeys.push({
          id: `${isKey ? "key" : "note"}-${cipher.id}`,
          kind: isKey ? "key" : "note",
          cipherId: cipher.id,
          label: cipher.name || (isKey ? this.tr("vkKey", "Key") : this.tr("vkTypeNote", "Note")),
          subtitle: isKey ? this.tr("vkKey", "Key") : this.tr("vkTypeNote", "Note"),
          value: raw,
          displayValue: masked,
        });
      }
    }

    const detailItems: QuickBarVaultItem[] = details.map((detail) => ({
      ...detail,
      kind: "detail",
      subtitle: detail.profile,
      displayValue: detail.value,
    }));

    return [...matchedLogins, ...detailItems, ...otherLogins, ...cardsAndKeys];
  }

  private async answerPasswordCredentials(
    serviceIdentifiers?: string[],
    recordIdentifier?: string,
  ): Promise<{ locked?: boolean; credentials: PasswordCredentialEntry[] }> {
    if (!this.isUnlocked()) {
      return { locked: true, credentials: [] };
    }
    const ciphers = (await this.loadNonProfileCiphers()).filter((c) => c.type === CipherType.Login);
    const filtered = recordIdentifier
      ? ciphers.filter((c) => c.id === recordIdentifier)
      : ciphers.filter((c) => loginMatchesServiceIds(c, serviceIdentifiers ?? []));

    const credentials: PasswordCredentialEntry[] = [];
    for (const cipher of filtered) {
      const username = cipher.login?.username ?? "";
      const password = cipher.login?.password ?? "";
      if (!username && !password) {
        continue;
      }
      const firstUri =
        (cipher.login?.uris ?? []).map((u) => u.uri?.trim() ?? "").find(Boolean) ?? "";
      const domain = normalizeHost(firstUri);
      const totp = recordIdentifier ? await this.resolveTotpCode(cipher.login?.totp) : undefined;
      credentials.push({
        recordIdentifier: cipher.id,
        username: username || cipher.name || "Account",
        password: recordIdentifier ? password : undefined,
        totp,
        serviceIdentifier: firstUri || (domain ? `https://${domain}` : "https://vowkey.local"),
        title: cipher.name || domain || username,
      });
    }
    return { credentials };
  }

  /** The pill in the menu bar or taskbar reads the vault, and adds or fills files, through here. */
  async answerPill(request: QuickBarRequest): Promise<unknown> {
    if (request.kind === "passwordCredentials") {
      return this.answerPasswordCredentials(request.serviceIdentifiers, request.recordIdentifier);
    }
    if (request.kind === "unlock") {
      if (this.accountStatus === AuthenticationStatus.Locked) {
        return { locked: true, account: true, strings: this.pillStrings() };
      }
      await this.localVault.unlock(request.password);
      await this.refreshDetails();
      return { good: true, title: this.tr("vkUnlocked", "Unlocked"), subtitle: "" };
    }
    if (!this.isUnlocked()) {
      return {
        locked: true,
        account: this.accountStatus !== AuthenticationStatus.LoggedOut,
        strings: this.pillStrings(),
      };
    }
    if (request.kind === "protect") {
      await this.localVault.setPassword(request.password);
      return { good: true, title: this.tr("vkPasswordSaved", "Password saved"), subtitle: "" };
    }
    if (request.kind === "dismissProtection") {
      await this.dismissOffer();
      return { good: true, title: "Saved", subtitle: "" };
    }
    if (request.kind === "agentDecision") {
      if (this.localAgent != null) {
        if (request.connectionId) {
          await this.localAgent.approve(request.connectionId);
        } else if (request.requestId) {
          await this.localAgent.answer(request.requestId, request.decision, request.entryIds ?? []);
        }
      }
      return { good: true, title: "Updated", subtitle: "" };
    }
    if (request.kind === "openProfile") {
      await this.openProfile(request.profileId, request.sourceId, request.variantId);
      return { good: true, title: "Profile opened", subtitle: "" };
    }
    if (request.kind === "openItem") {
      await this.router.navigate(["/vault"], { queryParams: { item: request.cipherId } });
      return { good: true, title: "Item opened", subtitle: "" };
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
      const selected = selectedId
        ? profiles.find((profile) => profile.id === selectedId)
        : profiles.length === 1
          ? profiles[0]
          : null;
      if (selectedId && selected == null) {
        throw new Error("The selected profile is unavailable. Choose another profile.");
      }
      const details = (
        selected == null
          ? this.allHits()
          : this.allHits().filter((hit) => hit.profileId === selected.id)
      ).sort((a, b) => firstAsked(a.id) - firstAsked(b.id));
      const items = await this.buildQuickBarItems(details, request.front);
      const agentPrompt = await this.currentAgentPrompt();
      return {
        profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
        profileId: selected?.id ?? null,
        details,
        items,
        agentPrompt,
        operations: this.operations(),
        strings: this.pillStrings(),
        postFillOffer:
          this.accountStatus === AuthenticationStatus.LoggedOut &&
          this.localVault.state$.value !== "empty"
            ? await this.localVault.afterFillOffer()
            : { show: false },
      };
    }
    const bytes = Uint8Array.from(request.bytes);
    const file = new File([bytes], request.name);
    this.documents.rememberPath(file, request.path);
    this.frontForm = { path: request.path, name: request.name, bytes };
    await this.processFile(file, bytes, request.profileId, false, request.intent ?? "auto");
    if (
      this.slot() === "choose" ||
      this.slot() === "ambiguous" ||
      (this.pendingForm() && this.profiles().length === 0)
    ) {
      this.isOpen.set(true);
      return {
        good: false,
        title: this.slot() === "ambiguous" ? "Save or fill?" : "Choose whose details",
        subtitle: "Continue in Vowkey",
      };
    }
    return {
      good: this.slot() === "added" || (this.slot() === "notice" && this.noticeGood()),
      title: this.statusTitle(),
      subtitle: this.statusSubtitle(),
      profileId: this.addedProfile()?.id,
      sourceId: this.addedSourceId,
      filledPath: this.lastFilledPath(),
    };
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

  /** Pasting a screenshot or document (`⌘V`) reads it into a profile just like drag-and-drop. */
  @HostListener("window:paste", ["$event"])
  async onWindowPaste(event: ClipboardEvent): Promise<void> {
    if (!this.isUnlocked()) {
      return;
    }
    const extracted = this.extractPastedFiles(event);
    if (extracted.length === 0) {
      return;
    }
    event.preventDefault();
    await this.pasteFiles(extracted);
  }

  private async pasteFiles(files: File[] | FileList): Promise<void> {
    if (!this.isUnlocked()) {
      return;
    }
    const first = Array.from(files)[0];
    if (!first) {
      return;
    }
    const bytes = new Uint8Array(await first.arrayBuffer());
    const normalized = this.normalizePastedFile(first, bytes);
    if (!this.isOpen()) {
      await this.openBar();
    }
    await this.processFile(normalized, bytes, this.selectedProfileId() || undefined);
  }

  private extractPastedFiles(event: ClipboardEvent): File[] {
    const out: File[] = [];
    const items = event.clipboardData?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") {
          continue;
        }
        const file = item.getAsFile();
        if (
          file &&
          (file.type.startsWith("image/") ||
            /\.(?:pdf|docx|xlsx|hwpx|png|jpe?g|heic|webp|tiff?)$/i.test(file.name))
        ) {
          out.push(file);
        }
      }
    }
    if (out.length === 0 && event.clipboardData?.files?.length) {
      for (const file of Array.from(event.clipboardData.files)) {
        if (
          file.type.startsWith("image/") ||
          /\.(?:pdf|docx|xlsx|hwpx|png|jpe?g|heic|webp|tiff?)$/i.test(file.name)
        ) {
          out.push(file);
        }
      }
    }
    return out;
  }

  private normalizePastedFile(file: File, bytes: Uint8Array): File {
    const rawName = (file.name || "").trim();
    if (rawName && !/^image\.[a-z0-9]+$/i.test(rawName)) {
      return file;
    }
    const ext =
      file.type === "image/jpeg"
        ? "jpg"
        : file.type === "image/webp"
          ? "webp"
          : file.type === "application/pdf"
            ? "pdf"
            : "png";
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new File([copy], `Screenshot.${ext}`, { type: file.type || "image/png" });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.slot() === "search" || this.slot() === "fill") {
      this.slot.set("drop");
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    if (this.slot() === "drop") {
      this.slot.set(this.activeIntent() === "fill" ? "fill" : "search");
    }
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      await this.processFile(
        file,
        undefined,
        this.selectedProfileId() || undefined,
        true,
        this.activeIntent(),
      );
    } else {
      this.slot.set(this.activeIntent() === "fill" ? "fill" : "search");
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (file) {
      const intent = this.activeIntent();
      const explicitProfileId = this.pendingPickProfileId;
      this.pendingPickProfileId = undefined;
      this.activeIntent.set("auto");
      if (!this.isOpen()) {
        this.isOpen.set(true);
      }
      await this.processFile(
        file,
        undefined,
        explicitProfileId || this.selectedProfileId() || undefined,
        true,
        intent,
      );
      input.value = "";
    }
  }

  /**
   * A PDF, Word, Excel, Hangul or photographed paper form is filled from a profile; any other file
   * is read into one. When `intent` is `"fill"`, any open PDF, Office file, or image (`IMG_4021.JPG`,
   * etc.) is filled directly regardless of filename; when `"auto"`, visual/structural layout
   * classification distinguishes forms from personal source documents and asks when ambiguous.
   */
  async processFile(
    file: File,
    given?: Uint8Array,
    profileId?: string,
    openReader = true,
    intent: HubOpenMode = "auto",
  ): Promise<void> {
    this.lastFilledPath.set(null);
    this.lastFillBreakdown.set(null);
    this.crossDropAction.set(null);
    this.working(
      file.name,
      intent === "fill" ? "Filling the form" : "Reading file",
      intent === "fill" ? "form" : "scan",
    );
    try {
      const bytes = given ?? new Uint8Array(await file.arrayBuffer());
      const canFillExtension =
        FILLABLE_FORM.test(file.name) || /\.(?:pdf|png|jpe?g|webp|heic|tiff?)$/i.test(file.name);
      const classified =
        intent === "fill" && canFillExtension
          ? undefined
          : await this.documents.classifyDroppedFile?.(file, bytes);

      let mode: "form" | "document" | "ambiguous";
      if (intent === "fill" && canFillExtension) {
        mode = "form";
        if (classified === "document" || classified === "ambiguous") {
          this.crossDropAction.set({ kind: "document", file, bytes, profileId, openReader });
        }
      } else if (intent === "document") {
        mode = "document";
        if (
          classified === "form" ||
          classified === "ambiguous" ||
          (/\.pdf$/i.test(file.name) && Boolean(this.documents.isPdfForm?.(bytes)))
        ) {
          this.crossDropAction.set({ kind: "fill", file, bytes, profileId, openReader });
        }
      } else {
        mode =
          classified ??
          (FILLABLE_FORM.test(file.name) ||
          (/\.pdf$/i.test(file.name) && Boolean(this.documents.isPdfForm?.(bytes)))
            ? "form"
            : "document");
      }

      if (mode === "ambiguous") {
        this.pendingAmbiguous.set({ file, bytes, profileId, openReader });
        this.statusTitle.set(file.name);
        this.statusSubtitle.set("Save to profile or fill as form?");
        this.slot.set("ambiguous");
        return;
      }

      if (mode === "form") {
        this.working(file.name, "Filling the form", "form");
        await this.startFilling(file, bytes, profileId);
        if (this.slot() === "notice" && !this.noticeGood() && !this.crossDropAction()) {
          this.crossDropAction.set({ kind: "document", file, bytes, profileId, openReader });
        }
      } else {
        this.working(file.name, "Reading document", "scan");
        await this.addDocument(file, bytes, profileId);
        if (
          this.slot() === "notice" &&
          !this.noticeGood() &&
          canFillExtension &&
          !this.crossDropAction() &&
          this.statusTitle().startsWith("Nothing to add")
        ) {
          this.crossDropAction.set({ kind: "fill", file, bytes, profileId, openReader });
        }
        const addedProfile = this.addedProfile();
        const onVaultRoute =
          typeof this.router.url === "string" && this.router.url.startsWith("/vault");
        if (onVaultRoute && addedProfile != null) {
          void this.router.navigate(["/vault"], {
            queryParams: { item: addedProfile.id, source: this.addedSourceId },
            queryParamsHandling: "merge",
          });
        }
        if (
          openReader &&
          this.slot() === "added" &&
          this.attached() &&
          this.pendingForm() == null
        ) {
          const isE2e = typeof ipc !== "undefined" && Boolean(ipc.platform?.isE2e);
          if (onVaultRoute && !isE2e && !this.crossDropAction()) {
            this.closeBar();
          } else {
            this.readerNote.set(`${this.statusTitle()} ${this.statusSubtitle()}`);
            await this.openProfile();
          }
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
    if (unclear != null) {
      this.crossDropAction.set(null);
      this.notice(false, `Couldn't read ${file.name}`, this.notRead[unclear]);
      return;
    }
    let result: DocumentAdded | null;
    try {
      result = await this.documents.addCaptured(captured, file, bytes, { profileId });
    } catch (error) {
      if (error instanceof CaptureProfileChoiceRequiredError) {
        this.pendingCapture.set({ file, bytes, captured });
        this.choices.set(error.profiles);
        this.statusTitle.set(file.name);
        this.statusSubtitle.set("Whose document?");
        this.slot.set("choose");
        return;
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
    this.statusTitle.set(
      result.duplicate
        ? "Already in profile"
        : result.attached
          ? count > 0
            ? `Added ${count} ${count === 1 ? "detail" : "details"}`
            : "Document added"
          : "Upload waiting",
    );
    this.statusSubtitle.set(
      result.duplicate
        ? `kept in ${result.profile.name}`
        : result.created
          ? `to a new profile, ${result.profile.name}`
          : `to ${result.profile.name}`,
    );
    this.slot.set("added");
    this.hub.notifyChanged();
    await this.refreshDetails();
  }

  private async startFilling(file: File, bytes: Uint8Array, profileId?: string): Promise<void> {
    const profiles = (await this.documents.profiles()).filter(profileUsableForFill);
    if (profileId != null) {
      const selected = profiles.find((profile) => profile.id === profileId);
      if (selected == null) {
        throw new Error("The selected profile is unavailable. Choose another profile.");
      }
      await this.fill(file, bytes, selected);
    } else if (profiles.length === 0) {
      this.pendingForm.set({ file, bytes });
      this.notice(
        false,
        "Add details for this form",
        "Add a document or type the details to fill this form.",
      );
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
    this.working(form.file.name, "Filling the form", "form");
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

  protected readonly maskedHitIds = signal<Set<string>>(new Set());

  isSensitiveHit(hit: QuickBarDetail): boolean {
    if (hit.attribute && /^(?:id\.|bank\.account\.number|tax\.)/.test(hit.attribute)) {
      return true;
    }
    return /(?:passport|residence card|my number|national id|ssn|account number|số định danh|cccd|hộ chiếu|tài khoản|在留カード番号|旅券番号|個人番号|マイナンバー|口座番号)/i.test(
      hit.label,
    );
  }

  isHitMasked(hit: QuickBarDetail): boolean {
    return this.maskedHitIds().has(hit.id);
  }

  displayHitValue(hit: QuickBarDetail): string {
    if (!this.isHitMasked(hit)) {
      return hit.value;
    }
    const trimmed = hit.value.trim();
    if (trimmed.length <= 4) {
      return "••••••••";
    }
    return "•".repeat(Math.min(12, Math.max(6, trimmed.length - 2))) + trimmed.slice(-2);
  }

  toggleHitMask(hitId: string): void {
    const next = new Set(this.maskedHitIds());
    if (next.has(hitId)) {
      next.delete(hitId);
    } else {
      next.add(hitId);
    }
    this.maskedHitIds.set(next);
  }

  private async fill(file: File, bytes: Uint8Array, profile: CipherView): Promise<void> {
    const available = (await this.documents.profiles()).find(
      (candidate) => candidate.id === profile.id && profileUsableForFill(candidate),
    );
    if (available == null) {
      throw new Error("The selected profile is unavailable. Choose another profile.");
    }
    profile = available;
    const { path, filled } = /\.(?:pdf|png|jpe?g|webp|heic|tiff?)$/i.test(file.name)
      ? await this.documents.fillPdfForm(file, bytes, profile)
      : await this.documents.fillForm(file, bytes, profile);
    this.lastFillBreakdown.set(this.documents.lastFillBreakdown?.() ?? null);
    if (path == null) {
      this.notice(false, `Nothing in ${file.name} matched`, `${profile.name}'s details`);
      return;
    }
    const saved = path.split(/[\\/]/).pop();
    this.lastFilledPath.set(path);
    if (filled > 0 && this.accountStatus === AuthenticationStatus.LoggedOut) {
      await this.localVault.markFirstFill();
      this.postFillOffer.set((await this.localVault.afterFillOffer()).show);
    }
    this.notice(true, `Filled ${filled} ${filled === 1 ? "field" : "fields"}`, `saved as ${saved}`);
  }

  private working(title: string, subtitle: string, kind: "scan" | "form" = "scan"): void {
    this.workingKind.set(kind);
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
          if (detail.valueType === "secret" && profile.viewPassword === false) {
            continue;
          }
          const variant = resolveDetailVariant(meta, detail);
          if (variant != null) {
            hits.push({
              id: `${profile.id}-${detail.attribute ?? detail.id}`,
              profileId: profile.id,
              profile: profile.name,
              label: humanDetailLabel(detail.attribute, detail.label),
              value: variant.value,
              detailId: detail.id,
              variantId: variant.id,
              sourceId: variant.sourceId ?? undefined,
              attribute: detail.attribute ?? undefined,
              agentRule: agentRuleOf(detail),
            });
          }
        }
      } else {
        for (const [key, value] of this.documents.detailsOf(profile)) {
          hits.push({
            id: `${profile.id}-${key}`,
            profileId: profile.id,
            label: humanDetailLabel(key, detail_label(key)),
            profile: profile.name,
            value,
            attribute: key,
          });
        }
      }
    }
    const operations = await this.documents.pendingOperations();
    if (generation === this.refreshGeneration && this.isUnlocked()) {
      this.profiles.set(profiles);
      this.allHits.set(hits);
      this.operations.set(operations);
      if (
        this.selectedProfileId() &&
        !profiles.some((profile) => profile.id === this.selectedProfileId())
      ) {
        this.selectedProfileId.set("");
      }
    }
  }
}

function isAgentTarget(value: unknown): value is AgentTarget {
  return (
    value != null &&
    typeof value === "object" &&
    "targetId" in value &&
    typeof value.targetId === "string" &&
    "kind" in value &&
    (value.kind === "web" || value.kind === "file" || value.kind === "app") &&
    "destinationKey" in value &&
    typeof value.destinationKey === "string" &&
    "generation" in value &&
    typeof value.generation === "string" &&
    "display" in value &&
    typeof value.display === "string" &&
    "formSignature" in value &&
    typeof value.formSignature === "string" &&
    "sections" in value &&
    Array.isArray(value.sections) &&
    "fields" in value &&
    Array.isArray(value.fields)
  );
}
