import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  untracked,
  ViewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SafeInjectionToken } from "@vowkey/ui-common";
import { getDocument, PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import "pdfjs-dist/webpack.mjs";

import { Subscription } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherSdkService } from "@vowkey/common/vault/abstractions/cipher-sdk.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { ProfileDetailEdit, ProfileService } from "@vowkey/common/vault/profile/profile.service";
import {
  AgentRule,
  agentRuleOf,
  DetailVariant,
  humanDetailLabel,
  humanizeDocumentTitle,
  Locator,
  ProfileDetail,
  ProfileSource,
  readEnvelope,
  resolveDetailVariant,
  ValueType,
} from "@vowkey/common/vault/profile/vk-meta";

export interface ProfileDocumentActions {
  remove(profileId: string, sourceId: string): Promise<CipherView>;
  move(profileId: string, sourceId: string, destinationId: string): Promise<CipherView>;
  replace?(profileId: string, sourceId: string, file: File): Promise<CipherView | null>;
  profiles(): Promise<CipherView[]>;
  pending?(): Promise<
    {
      id: string;
      kind: "capture" | "move" | "delete";
      profileId: string;
      sourceId: string;
      fileName: string;
    }[]
  >;
  retry?(id: string): Promise<CipherView>;
}

export const PROFILE_DOCUMENT_ACTIONS = new SafeInjectionToken<ProfileDocumentActions>(
  "Profile document actions",
);

interface DetailGroup {
  id: string;
  title: string;
  details: ProfileDetail[];
}

const SECTION_TITLE_KEYS: Record<string, string> = {
  identity: "vkSectionPersonal",
  documents: "vkSectionIds",
  contact: "vkSectionContact",
  work: "vkSectionWork",
  other: "vkSectionMore",
};

const ATTRIBUTE_I18N_KEYS: Record<string, string> = {
  "name.full": "vkAttrFullName",
  "name.family": "vkAttrFamilyName",
  "name.given": "vkAttrGivenName",
  "birth.date": "vkAttrBirthDate",
  "birth.place": "vkAttrBirthPlace",
  "person.sex": "vkAttrSex",
  "person.nationality": "vkAttrNationality",
  "address.full": "vkAttrCurrentAddress",
  "address.prefecture": "stateProvince",
  "address.postal": "vkAttrPostalCode",
  "address.registered_domicile": "vkAttrRegisteredDomicile",
  "contact.phone": "vkAttrPhoneNumber",
  "contact.email": "vkAttrEmailAddress",
  "id.passport.number": "vkAttrPassportNumber",
  "id.passport.expiry": "vkAttrPassportExpiry",
  "id.card.number": "vkAttrIdCardNumber",
  "id.card.expiry": "vkAttrExpiryDate",
  "id.residence_card.number": "vkAttrResidenceCardNumber",
  "id.national.number": "vkAttrNationalIdNumber",
  "id.mynumber": "vkAttrNationalIdNumber",
  "id.driver_license.number": "vkAttrDriverLicenseNumber",
  "work.employer.name": "vkAttrEmployer",
  "work.occupation": "vkAttrOccupation",
  "bank.name": "vkAttrBankName",
  "bank.branch.name": "vkAttrBranchName",
  "bank.account.number": "vkAttrAccountNumber",
};

const SCRIPT_LABELS: Record<string, string> = {
  latn: "Latin",
  kana: "カナ",
  katakana: "カナ",
  hrkt: "カナ",
  hira: "かな",
  hiragana: "かな",
  hani: "漢字",
  jpan: "日本語",
  wareki: "和暦",
  zengin: "全銀",
  viet: "VI",
};

const DOC_STAGE_H_KEY = "vk.docStageHeight";
const DOC_SPLIT_PCT_KEY = "vk.docSplitPct";
const DOC_LAYOUT_KEY = "vk.docLayout";
const DOC_EXPANDED_KEY = "vk.docExpanded";

function readNumberPref(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = Number(localStorage.getItem(key));
    if (Number.isFinite(raw) && raw >= min && raw <= max) {
      return raw;
    }
  } catch {
    // Ignore storage read errors.
  }
  return fallback;
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage write errors.
  }
}

function isHiddenValueType(valueType: string | undefined): boolean {
  return valueType === "secret" || valueType === "hidden";
}

function categoryFor(detail: ProfileDetail): { id: string; title: string; order: number } {
  const attr = (detail.attribute ?? "").toLowerCase();
  const label = humanDetailLabel(detail.attribute, detail.label).toLowerCase();
  if (
    attr.startsWith("name.") ||
    attr.startsWith("birth.") ||
    attr.startsWith("person.") ||
    /\b(name|birth|sex|gender|nationality|citizenship)\b/.test(label)
  ) {
    return { id: "identity", title: "Personal", order: 0 };
  }
  if (
    attr.startsWith("id.") ||
    attr.startsWith("visa.") ||
    attr.startsWith("tax.") ||
    /\b(passport|id|residence|visa|status|stay|license|number|issued|expir|authority)\b/.test(label)
  ) {
    return { id: "documents", title: "Documents & IDs", order: 1 };
  }
  if (
    attr.startsWith("address.") ||
    attr.startsWith("contact.") ||
    detail.valueType === "address" ||
    detail.valueType === "phone" ||
    detail.valueType === "email" ||
    /\b(address|postal|zip|city|phone|email|domicile)\b/.test(label)
  ) {
    return { id: "contact", title: "Contact & address", order: 2 };
  }
  if (
    attr.startsWith("work.") ||
    attr.startsWith("bank.") ||
    attr.startsWith("income.") ||
    /\b(employer|company|occupation|bank|branch|account|routing|iban|swift|pay|income)\b/.test(label)
  ) {
    return { id: "work", title: "Work & banking", order: 3 };
  }
  return { id: "other", title: "More details", order: 4 };
}

@Component({
  selector: "app-profile",
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="vk-profile"
      [attr.aria-label]="tr('vkProfileDetailsAria', 'Profile details and documents')"
    >
      @if (error()) {
        <p class="vk-notice vk-notice-error" role="alert">{{ error() }}</p>
      }
      @if (message()) {
        <p class="vk-notice" role="status">{{ message() }}</p>
      }
      @for (operation of operations(); track operation.id) {
        <div class="vk-pending">
          <span>
            {{ operation.fileName }} ·
            {{
              operation.kind === "move"
                ? tr("vkOpMoveWaiting", "Move waiting")
                : operation.kind === "delete"
                  ? tr("vkOpDeleteWaiting", "Deletion waiting")
                  : tr("vkOpUploadWaiting", "Upload waiting")
            }}
          </span>
          <button type="button" [disabled]="busy()" (click)="retry(operation.id)">
            {{ tr("vkRetry", "Retry") }}
          </button>
        </div>
      }

      @if (meta(); as envelope) {
        <div
          #workspaceEl
          class="vk-workspace"
          [class.is-split]="activeSources().length > 0 && docExpanded() && !bulkEdit() && docLayout() === 'split'"
          [style.--vk-doc-split]="docSplitPct() + '%'"
        >
          @if (activeSources().length > 0 && !bulkEdit()) {
            <aside
              class="vk-doc-deck"
              [class.collapsed]="!docExpanded()"
              [attr.aria-label]="tr('vkDocuments', 'Documents')"
            >
              <div class="vk-deck-bar">
                @if (!documentFocus()) {
                  <div
                    class="vk-deck-tabs"
                    role="tablist"
                    [attr.aria-label]="tr('vkDocuments', 'Documents')"
                    (wheel)="onDeckTabsWheel($event)"
                  >
                    @for (source of activeSources(); track source.id) {
                      <button
                        type="button"
                        role="tab"
                        class="vk-deck-tab"
                        [class.on]="selectedSource()?.id === source.id && docExpanded()"
                        [attr.aria-selected]="selectedSource()?.id === source.id"
                        [attr.title]="cleanSourceName(source.fileName) + ' — ' + sourceSubtitle(source)"
                        (click)="selectSourceCard(source)"
                      >
                        <span class="vk-tab-thumb" aria-hidden="true">
                          @if (sourceThumb(source.id); as thumbUrl) {
                            <img [src]="thumbUrl" alt="" />
                          } @else {
                            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                              <path
                                d="M4.2 2h4.9L12.5 5.4v8.1a.8.8 0 0 1-.8.8H4.2a.8.8 0 0 1-.8-.8V2.8a.8.8 0 0 1 .8-.8Z"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.3"
                                stroke-linejoin="round"
                              />
                            </svg>
                          }
                        </span>
                        <span class="vk-tab-name">{{ cleanSourceName(source.fileName) }}</span>
                      </button>
                    }
                  </div>
                } @else if (selectedSource(); as focusedSource) {
                  <div class="vk-deck-focus-meta">
                    <span class="vk-focus-subtitle">{{
                      tr("vkOriginalDocument", "Original document")
                    }}</span>
                  </div>
                }

                <div class="vk-deck-tools">
                  @if (docExpanded() && selectedSource(); as source) {
                    @if (pageCount() > 1) {
                      <div class="vk-capsule" role="group" [attr.aria-label]="tr('vkPages', 'Pages')">
                        <button
                          type="button"
                          [disabled]="page() === 0 || loading()"
                          (click)="renderPage(page() - 1)"
                          [attr.aria-label]="tr('vkPrevPage', 'Previous')"
                        >
                          ‹
                        </button>
                        <span class="vk-capsule-readout">{{ page() + 1 }}/{{ pageCount() }}</span>
                        <button
                          type="button"
                          [disabled]="page() + 1 >= pageCount() || loading()"
                          (click)="renderPage(page() + 1)"
                          [attr.aria-label]="tr('vkNextPage', 'Next')"
                        >
                          ›
                        </button>
                      </div>
                    }

                    @if (preview() || pdfVisible()) {
                      <div
                        class="vk-capsule"
                        role="group"
                        [attr.aria-label]="tr('vkZoomDocument', 'Document size')"
                      >
                        <button
                          type="button"
                          [attr.aria-label]="tr('vkZoomOut', 'Smaller')"
                          [disabled]="zoomPercent() <= 50"
                          (click)="stepZoom(-25)"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          class="vk-zoom-readout"
                          data-testid="profile-doc-zoom"
                          [class.on]="zoomPercent() !== 100"
                          (click)="resetZoomOrToggle()"
                          [attr.title]="tr('vkResetSize', 'Reset size')"
                        >
                          {{ zoomPercent() }}%
                        </button>
                        <button
                          type="button"
                          [attr.aria-label]="tr('vkZoomIn', 'Larger')"
                          [disabled]="zoomPercent() >= 250"
                          (click)="stepZoom(25)"
                        >
                          +
                        </button>
                      </div>

                      <div
                        class="vk-capsule vk-layout-seg"
                        role="group"
                        [attr.aria-label]="tr('vkLayout', 'Layout')"
                      >
                        <button
                          type="button"
                          data-testid="profile-layout-stack"
                          [class.on]="docLayout() === 'stack'"
                          [attr.aria-label]="tr('vkStackVertical', 'Vertical')"
                          [attr.title]="tr('vkStackVertical', 'Vertical')"
                          (click)="setDocLayout('stack')"
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true">
                            <rect x="2" y="2" width="12" height="12" rx="2" />
                            <line x1="2" y1="8" x2="14" y2="8" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          data-testid="profile-layout-split"
                          [class.on]="docLayout() === 'split'"
                          [attr.aria-label]="tr('vkSplitSide', 'Side by side')"
                          [attr.title]="tr('vkSplitSide', 'Side by side')"
                          (click)="setDocLayout('split')"
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true">
                            <rect x="2" y="2" width="12" height="12" rx="2" />
                            <line x1="8" y1="2" x2="8" y2="14" />
                          </svg>
                        </button>
                      </div>

                      <button
                        type="button"
                        class="vk-tool-icon"
                        [attr.title]="tr('vkExpandDocument', 'Expand document')"
                        [attr.aria-label]="tr('vkExpandDocument', 'Expand document')"
                        (click)="lightboxOpen.set(true)"
                      >
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M9.8 2.5h3.7v3.7M6.2 13.5H2.5V9.8M13.5 2.5 9.2 6.8M2.5 13.5l4.3-4.3" />
                        </svg>
                      </button>
                    }

                    @if (!documentFocus()) {
                      <button
                        type="button"
                        class="vk-tool-icon"
                        [attr.title]="tr('vkHidePreview', 'Hide preview')"
                        [attr.aria-label]="tr('vkHidePreview', 'Hide preview')"
                        (click)="setDocExpanded(false)"
                      >
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M4.2 9.8 8 6l3.8 3.8" />
                        </svg>
                      </button>
                    }

                    <details class="vk-more">
                      <summary [attr.aria-label]="tr('vkDocumentActions', 'Document actions')">
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                          <circle cx="3.2" cy="8" r="1.2" fill="currentColor" />
                          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                          <circle cx="12.8" cy="8" r="1.2" fill="currentColor" />
                        </svg>
                      </summary>
                      <div class="vk-menu">
                        <button
                          type="button"
                          [disabled]="loading() || source.status === 'deleted'"
                          (click)="download($event)"
                        >
                          {{ tr("vkDownloadOriginal", "Download original") }}
                        </button>
                        @if (actions && editable() && source.status !== "deleted") {
                          <button type="button" (click)="pickDestination($event)">
                            {{ tr("vkMoveToProfile", "Move to another profile") }}
                          </button>
                          <button type="button" class="danger" (click)="removeSource($event)">
                            {{ tr("vkDeleteDocument", "Delete document") }}
                          </button>
                        }
                      </div>
                    </details>
                  } @else if (!documentFocus()) {
                    <button
                      type="button"
                      class="vk-text-btn"
                      (click)="setDocExpanded(true)"
                    >
                      {{ tr("vkShowPreview", "Show preview") }}
                    </button>
                  }
                </div>
              </div>

              @if (docExpanded() && selectedSource(); as source) {
                <section class="vk-reader" [attr.aria-label]="source.fileName">
                  @if (destinations().length) {
                    <div class="vk-move-bar">
                      <label>
                        {{ tr("vkMoveTo", "Move to") }}
                        <select
                          [ngModel]="destinationId()"
                          (ngModelChange)="destinationId.set($event)"
                        >
                          <option value="">{{ tr("vkChooseProfile", "Choose profile") }}</option>
                          @for (profile of destinations(); track profile.id) {
                            <option [value]="profile.id">{{ profile.name }}</option>
                          }
                        </select>
                      </label>
                      <button
                        type="button"
                        class="vk-btn"
                        [disabled]="busy() || !destinationId()"
                        (click)="move()"
                      >
                        {{ tr("vkMoveDocument", "Move document") }}
                      </button>
                    </div>
                  }

                  @if (loading()) {
                    <div class="vk-doc-placeholder" role="status">
                      {{ tr("vkOpeningDocument", "Opening document…") }}
                    </div>
                  }

                  @if (preview() || pdfVisible()) {
                    <div
                      #stageViewport
                      class="vk-page"
                      [style.height.px]="docLayout() === 'stack' ? effectiveStageHeight() : null"
                      [style.--stage-h.px]="effectiveStageHeight()"
                      [style.--zoom-scale]="zoomPercent() / 100"
                      (wheel)="onStageWheel($event)"
                    >
                      <div
                        class="vk-page-stage"
                        [class.is-zoomed]="zoomPercent() > 100"
                        [class.is-split-fit]="docLayout() === 'split' && zoomPercent() <= 100"
                      >
                        @if (pdfVisible()) {
                          <canvas
                            #pdfCanvas
                            [attr.aria-label]="source.fileName + ', ' + (page() + 1)"
                            role="img"
                          ></canvas>
                        } @else {
                          <img
                            [src]="preview()"
                            [alt]="source.fileName + ', ' + (page() + 1)"
                            (dblclick)="lightboxOpen.set(true)"
                          />
                        }
                        @if (pageBox(); as box) {
                          <span
                            class="vk-box"
                            [style.left.%]="box.x * 100"
                            [style.top.%]="box.y * 100"
                            [style.width.%]="box.w * 100"
                            [style.height.%]="box.h * 100"
                            [attr.aria-label]="tr('vkShowInDocument', 'Show in document')"
                          >
                            @if (activeLocatedLabel(); as tagLabel) {
                              <span class="vk-box-tag" [class.inside-top]="box.y < 0.12">{{
                                tagLabel
                              }}</span>
                            }
                          </span>
                        }
                      </div>
                    </div>

                    @if (docLayout() === "stack") {
                      <div
                        class="vk-stage-resizer-h"
                        role="separator"
                        aria-orientation="horizontal"
                        [attr.aria-label]="tr('vkResizeDocument', 'Drag to resize document preview')"
                        (mousedown)="startHeightResize($event, stageViewport)"
                        (dblclick)="resetStageHeight()"
                      ></div>
                    }
                  }

                  @if (selectedLocator(); as locator) {
                    @if (locator.kind === "cell") {
                      <p class="vk-doc-caption">
                        {{ locator.page + 1 }} ·
                        {{ locator.a1 || locator.row + 1 + ":" + (locator.column + 1) }}
                      </p>
                    }
                  }

                  @if (
                    !loading() &&
                    !preview() &&
                    !pdfVisible() &&
                    source.status !== "deleted" &&
                    source.attachmentId
                  ) {
                    <div class="vk-doc-placeholder">
                      {{ tr("vkDownloadToView", "Download the original to view this file format.") }}
                    </div>
                  }
                  @if (source.status === "deleted" || !source.attachmentId) {
                    <div class="vk-doc-placeholder">
                      {{
                        tr(
                          "vkDocUnavailableDetailsIntact",
                          "The original document is unavailable. Saved details remain intact."
                        )
                      }}
                    </div>
                  }
                </section>
              }
            </aside>

            @if (docExpanded() && docLayout() === "split") {
              <div
                class="vk-stage-resizer-v"
                role="separator"
                aria-orientation="vertical"
                [attr.aria-label]="tr('vkResizeSplit', 'Drag to resize panes')"
                (mousedown)="startSplitResize($event, workspaceEl)"
                (dblclick)="resetSplitRatio()"
              ></div>
            }
          }

          <div class="vk-details-pane">
            @for (group of groupedDetails(); track group.id) {
              <section class="vk-group" [attr.aria-label]="group.title">
                <div class="vk-section-bar">
                  <button
                    type="button"
                    class="vk-group-toggle"
                    [attr.aria-expanded]="!isGroupCollapsed(group.id)"
                    (click)="toggleGroup(group.id)"
                  >
                    <svg
                      class="vk-group-chev"
                      [class.collapsed]="isGroupCollapsed(group.id)"
                      viewBox="0 0 12 12"
                      width="10"
                      height="10"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2.5 4.2 6 7.8l3.5-3.6" />
                    </svg>
                    <span class="vk-group-title">{{ group.title }}</span>
                    @if (isGroupCollapsed(group.id)) {
                      <span class="vk-group-count">{{ group.details.length }}</span>
                    }
                  </button>
                  @if (!documentFocus() && groupSingleSource(group); as groupSrc) {
                    <button
                      type="button"
                      class="vk-from-source"
                      (click)="focusSource(groupSrc)"
                      [attr.title]="cleanSourceName(groupSrc.fileName)"
                    >
                      <span>{{ tr("vkFromSourcePrefix", "From") }} {{ cleanSourceName(groupSrc.fileName) }}</span>
                      @if (sourceThumb(groupSrc.id); as gThumb) {
                        <span class="vk-from-thumb" aria-hidden="true">
                          <img [src]="gThumb" alt="" />
                        </span>
                      }
                    </button>
                  }
                </div>
                @if (!isGroupCollapsed(group.id)) {
                <div class="vk-group-card">
                  @for (detail of group.details; track detail.id) {
                    @if (winner(detail); as variant) {
                      <article
                        class="vk-detail"
                        [class.interactive]="!bulkEdit() && editing()?.detailId !== detail.id"
                        [class.located]="isActiveVariant(variant)"
                        [class.is-editing]="editing()?.detailId === detail.id"
                        (click)="onDetailRowClick(detail, variant, $event)"
                      >
                        <div class="vk-row-label" [attr.title]="labelFor(detail)">
                          <span>{{ labelFor(detail) }}</span>
                        </div>

                        @if (bulkEdit() && editable()) {
                          <div class="vk-bulk-cell" (click)="$event.stopPropagation()">
                            <input
                              class="vk-inline-input"
                              [attr.aria-label]="labelFor(detail)"
                              [value]="variant.value"
                              [disabled]="busy()"
                              autocomplete="off"
                              (keydown.enter)="$any($event.target).blur()"
                              (blur)="saveInlineBlur(detail, variant, $any($event.target).value)"
                            />
                          </div>
                        } @else {
                          <div class="vk-row-main">
                            <div class="vk-primary-line">
                              <button
                                type="button"
                                class="vk-val-btn"
                                [class.mono]="isCodeLike(detail)"
                                (click)="$event.stopPropagation(); copyAndLocate(detail, variant)"
                              >
                                {{ displayValue(detail, variant.value) }}
                              </button>

                              @if (copiedKey() === variant.id) {
                                <span class="vk-copied-pill" role="status">
                                  ✓ {{ tr("vkCopiedShort", "Copied") }}
                                </span>
                              }

                              @if (rule(detail) === "never") {
                                <span class="vk-rule-pill never" data-testid="profile-rule-pill">
                                  {{ tr("vkRuleBadgeDontFill", "Don't fill") }}
                                </span>
                              } @else if (rule(detail) === "ask") {
                                <span class="vk-rule-pill ask" data-testid="profile-rule-pill">
                                  <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
                                    <path d="M5.4 8V4.2a.8.8 0 0 1 1.6 0V7.4M7 7.4V3.4a.8.8 0 0 1 1.6 0v4M8.6 7.4V4a.8.8 0 0 1 1.6 0v4.6l.8-1a.85.85 0 0 1 1.3 1.1L11.2 11.5c-.5.9-1.3 1.5-2.6 1.5-1.8 0-3.2-1.4-3.2-3.2V8Z" />
                                  </svg>
                                  {{ tr("vkRuleBadgeAskFirst", "Ask first") }}
                                </span>
                              }
                            </div>

                            @if (alternativesOf(detail, variant).length > 0) {
                              <div class="vk-alt-readings">
                                @for (
                                  alt of alternativesOf(detail, variant);
                                  track alt.id;
                                  let first = $first
                                ) {
                                  @if (!first) {
                                    <span class="vk-alt-sep" aria-hidden="true">·</span>
                                  }
                                  <button
                                    type="button"
                                    class="vk-alt-reading"
                                    [class.located]="isActiveVariant(alt)"
                                    (click)="$event.stopPropagation(); copyAndLocate(detail, alt)"
                                    [attr.title]="tr('copy', 'Copy') + ': ' + alt.value"
                                  >
                                    @if (variantBadge(alt); as badge) {
                                      <span class="vk-alt-script">{{ badge }}</span>
                                    }
                                    <span class="vk-alt-val">{{
                                      displayValue(detail, alt.value)
                                    }}</span>
                                    @if (copiedKey() === alt.id) {
                                      <span class="vk-copied-inline">✓</span>
                                    }
                                  </button>
                                }
                              </div>
                            }
                          </div>

                          @if (isSensitive(detail) || editable()) {
                            <div class="vk-detail-actions" (click)="$event.stopPropagation()">
                              @if (isSensitive(detail)) {
                                <button
                                  type="button"
                                  class="vk-icon-btn"
                                  [attr.aria-label]="
                                    (isMasked(detail) ? tr('show', 'Show') : tr('hide', 'Hide')) +
                                    ' ' +
                                    labelFor(detail)
                                  "
                                  (click)="toggleMask(detail.id)"
                                >
                                  @if (isMasked(detail)) {
                                    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                                      <path
                                        d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.4"
                                        stroke-linejoin="round"
                                      />
                                      <circle
                                        cx="8"
                                        cy="8"
                                        r="2"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.4"
                                      />
                                    </svg>
                                  } @else {
                                    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                                      <path
                                        d="M2.2 2.2l11.6 11.6M6.6 6.7a2 2 0 0 0 2.7 2.7M3.6 5.2C2.3 6.3 1.5 8 1.5 8s2.4 4.2 6.5 4.2c1.3 0 2.4-.4 3.4-1M6.3 3.9c.5-.1 1.1-.1 1.7-.1 4.1 0 6.5 4.2 6.5 4.2a11.3 11.3 0 0 1-2.1 2.6"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.4"
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                      />
                                    </svg>
                                  }
                                </button>
                              }
                              @if (editable()) {
                                <button
                                  type="button"
                                  class="vk-icon-btn"
                                  [attr.title]="tr('vkEdit', 'Edit')"
                                  [attr.aria-label]="tr('vkEdit', 'Edit') + ': ' + labelFor(detail)"
                                  (click)="beginEdit(detail, variant, $event)"
                                >
                                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                                    <path
                                      d="M2.5 13.5l.7-3L10.8 3a1.6 1.6 0 0 1 2.2 0l0 0a1.6 1.6 0 0 1 0 2.2L5.5 12.8l-3 .7Z"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="1.35"
                                      stroke-linejoin="round"
                                    />
                                  </svg>
                                </button>
                                <details class="vk-more">
                                  <summary
                                    [attr.aria-label]="
                                      tr('vkMoreActions', 'More actions') + ': ' + labelFor(detail)
                                    "
                                  >
                                    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                                      <circle cx="3.2" cy="8" r="1.25" fill="currentColor" />
                                      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                                      <circle cx="12.8" cy="8" r="1.25" fill="currentColor" />
                                    </svg>
                                  </summary>
                                  <div class="vk-menu">
                                    @if (alternativesOf(detail, variant).length > 0) {
                                      @for (alt of alternativesOf(detail, variant); track alt.id) {
                                        <button
                                          type="button"
                                          [disabled]="busy()"
                                          (click)="chooseAlternative(detail.id, alt.id, $event)"
                                        >
                                          {{ tr("vkUseThis", "Use as primary") }}: {{ alt.value }}
                                        </button>
                                      }
                                    }
                                    <button
                                      type="button"
                                      role="menuitemradio"
                                      [attr.aria-checked]="rule(detail) === 'fill'"
                                      [disabled]="busy()"
                                      (click)="setDetailRule(detail, 'fill', $event)"
                                    >
                                      {{
                                        (rule(detail) === "fill" ? "✓ " : "") +
                                          tr("vkRuleFillWithoutAsking", "AI agents: fill without asking")
                                      }}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitemradio"
                                      [attr.aria-checked]="rule(detail) === 'ask'"
                                      [disabled]="busy()"
                                      (click)="setDetailRule(detail, 'ask', $event)"
                                    >
                                      {{
                                        (rule(detail) === "ask" ? "✓ " : "") +
                                          tr("vkRuleAskFirst", "AI agents: ask first")
                                      }}
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitemradio"
                                      [attr.aria-checked]="rule(detail) === 'never'"
                                      [disabled]="busy()"
                                      (click)="setDetailRule(detail, 'never', $event)"
                                    >
                                      {{
                                        (rule(detail) === "never" ? "✓ " : "") +
                                          tr("vkRuleDontFillAgents", "AI agents: don't fill")
                                      }}
                                    </button>
                                    <button
                                      type="button"
                                      class="danger"
                                      (click)="deleteDetailFromMenu(detail, $event)"
                                    >
                                      {{ tr("vkDeleteDetail", "Delete detail") }}
                                    </button>
                                  </div>
                                </details>
                              }
                            </div>
                          }
                        }

                        @if (editing()?.detailId === detail.id && !bulkEdit()) {
                          <form
                            class="vk-editor vk-correct"
                            (click)="$event.stopPropagation()"
                            (submit)="$event.preventDefault(); saveCorrection()"
                          >
                            <input
                              [ngModel]="correction()"
                              (ngModelChange)="correction.set($event)"
                              [attr.aria-label]="labelFor(detail)"
                              name="value"
                              autocomplete="off"
                            />
                            <span class="vk-correct-actions">
                              <button type="button" class="vk-btn" (click)="editing.set(null)">
                                {{ tr("cancel", "Cancel") }}
                              </button>
                              <button
                                type="submit"
                                class="vk-btn primary"
                                [disabled]="busy() || !correction().trim()"
                              >
                                {{ tr("save", "Save") }}
                              </button>
                            </span>
                            @if (variant.sourceId) {
                              <label class="vk-correct-kind">
                                <span>{{ tr("vkFieldType", "Field type") }}</span>
                                <select
                                  name="kind"
                                  [ngModel]="detail.attribute ?? ''"
                                  (ngModelChange)="relabel(detail, $event)"
                                  [disabled]="busy()"
                                >
                                  <option value="">{{ labelFor(detail) }}</option>
                                  @for (kind of teachableTypes; track kind.attribute) {
                                    <option [value]="kind.attribute">
                                      {{ teachableLabel(kind) }}
                                    </option>
                                  }
                                </select>
                              </label>
                            }
                          </form>
                        }
                      </article>
                    }
                  }
                </div>
                }
              </section>
            } @empty {
              <p class="vk-empty">
                {{
                  filterQuery().trim()
                    ? tr("vkNoMatches", "No matching details.")
                    : tr("vkNoDetailsSavedYet", "No details saved yet.")
                }}
              </p>
            }

            @if (editable() && !documentFocus()) {
              <details
                class="vk-new-detail"
                [open]="startAdding() || visibleDetails().length === 0"
              >
                <summary>+ {{ tr("vkAddDetail", "Add detail") }}</summary>
                @if (visibleDetails().length === 0) {
                  <div
                    class="vk-starter-chips"
                    data-testid="profile-starter-chips"
                    [attr.aria-label]="tr('vkQuickAddFields', 'Common fields')"
                  >
                    @for (chip of starterFields; track chip.attribute) {
                      <button
                        type="button"
                        class="vk-starter-chip"
                        (click)="pickStarterField(chip, newValueInput)"
                      >
                        + {{ teachableLabel(chip) }}
                      </button>
                    }
                  </div>
                }
                <form class="vk-editor" (submit)="$event.preventDefault(); add()">
                  <label>
                    {{ tr("vkDetailLabel", "Label") }}
                    <input name="label" [(ngModel)]="newLabel" required />
                  </label>
                  <label>
                    {{ tr("value", "Value") }}
                    <input
                      #newValueInput
                      name="value"
                      [(ngModel)]="newValue"
                      required
                      autocomplete="off"
                    />
                  </label>
                  <label>
                    {{ tr("type", "Type") }}
                    <select name="type" [(ngModel)]="newType">
                      <option value="text">{{ tr("vkTypeText", "Text") }}</option>
                      <option value="date">{{ tr("vkTypeDate", "Date") }}</option>
                      <option value="phone">{{ tr("vkTypePhone", "Phone") }}</option>
                      <option value="email">{{ tr("email", "Email") }}</option>
                      <option value="address">{{ tr("vkTypeAddress", "Address") }}</option>
                      <option value="number">{{ tr("vkTypeNumber", "Number") }}</option>
                      <option value="link">{{ tr("vkTypeLink", "Link") }}</option>
                      <option value="secret">{{ tr("vkTypeHidden", "Hidden value") }}</option>
                    </select>
                  </label>
                  <button
                    type="submit"
                    class="vk-btn primary"
                    [disabled]="busy() || !newLabel.trim() || !newValue.trim()"
                  >
                    {{ tr("vkSaveDetail", "Save detail") }}
                  </button>
                </form>
              </details>
            }
          </div>
        </div>
      }

      @if (lightboxOpen() && selectedSource(); as source) {
        <div class="vk-large-backdrop" (click)="lightboxOpen.set(false)">
          <div
            class="vk-lightbox-dialog"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="cleanSourceName(source.fileName)"
            (click)="$event.stopPropagation()"
          >
            <header class="vk-large-head">
              <strong>{{ cleanSourceName(source.fileName) }}</strong>
              <div class="vk-large-actions">
                <button type="button" class="vk-btn" (click)="download()">
                  {{ tr("vkDownloadOriginal", "Download original") }}
                </button>
                <button type="button" class="vk-btn" (click)="lightboxOpen.set(false)">
                  {{ tr("close", "Close") }}
                </button>
              </div>
            </header>
            <div class="vk-lightbox-body">
              @if (preview()) {
                <img [src]="preview()" [alt]="cleanSourceName(source.fileName)" />
              } @else {
                <p class="vk-doc-placeholder">
                  {{ tr("vkLightboxPdfHint", "Use the zoom controls in the viewer to inspect PDF pages.") }}
                </p>
              }
            </div>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        color: var(--vk-ink, rgb(var(--color-text-main, 23 32 46)));
      }
      .vk-profile {
        min-width: 0;
        max-width: 1080px;
      }
      button,
      summary,
      select {
        cursor: pointer;
      }
      button:disabled {
        cursor: default;
        opacity: 0.5;
      }
      button:focus-visible,
      summary:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--vk-accent, #2563eb);
        outline-offset: 2px;
      }
      button {
        color: inherit;
        font: inherit;
      }
      .vk-notice {
        margin: 0 0 12px;
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--vk-hover, rgb(148 163 184 / 12%));
        color: var(--vk-ink, inherit);
        font-size: 13px;
      }
      .vk-notice-error {
        color: var(--vk-danger, #dc2626);
      }
      .vk-pending {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
        padding: 8px 12px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 24%));
        border-radius: 9px;
        font-size: 13px;
      }
      .vk-pending button {
        border: 0;
        background: none;
        color: var(--vk-accent, #2563eb);
        font-weight: 600;
      }

      /* SECTION HEADERS & PROVENANCE */
      .vk-section-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0 2px 6px;
      }
      .vk-group-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        color: var(--vk-muted, #5d606a);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: -0.004em;
      }
      .vk-from-source {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 5px;
        margin-right: -5px;
        border: 0;
        border-radius: 5px;
        background: transparent;
        color: var(--vk-muted, #5d606a);
        font-size: 11.5px;
        font-weight: 500;
        transition:
          background-color 0.12s ease,
          color 0.12s ease;
      }
      .vk-from-source:hover {
        background: var(--vk-hover, rgb(20 21 26 / 0.05));
        color: var(--vk-ink, inherit);
      }
      .vk-from-thumb {
        display: block;
        flex: none;
        width: 20px;
        height: 13.5px;
        overflow: hidden;
        border-radius: 2.5px;
        background: var(--vk-surface, #fff);
        box-shadow: 0 0 0 1px rgb(20 21 26 / 0.16);
      }
      .vk-from-thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .vk-text-btn {
        padding: 3px 8px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted, #5d606a);
        font-size: 12px;
        font-weight: 500;
      }
      .vk-text-btn:hover {
        background: var(--vk-hover, rgb(20 21 26 / 0.05));
        color: var(--vk-ink, inherit);
      }

      /* WORKSPACE: VERTICAL STACK BY DEFAULT, OPTIONAL RESIZABLE SPLIT */
      .vk-workspace {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }
      .vk-workspace.is-split {
        display: grid;
        grid-template-columns: minmax(260px, var(--vk-doc-split, 48%)) 10px minmax(280px, 1fr);
        gap: 0;
        align-items: start;
      }
      .vk-workspace.is-split .vk-doc-deck {
        position: sticky;
        top: 0;
      }

      /* UNIFIED MACOS QUICKLOOK DOCUMENT DECK */
      .vk-doc-deck {
        position: relative;
        min-width: 0;
        border: 1px solid var(--vk-line, #e3e5ea);
        border-radius: 10px;
        background: var(--vk-card, #ffffff);
        overflow: visible;
      }
      .vk-deck-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 38px;
        padding: 4px 8px 4px 6px;
        border-bottom: 1px solid var(--vk-line-soft, #eef0f3);
        background: color-mix(in srgb, var(--vk-ink) 1.8%, var(--vk-card, #ffffff));
        border-radius: 9px 9px 0 0;
        user-select: none;
      }
      .vk-workspace.is-split .vk-deck-bar {
        flex-wrap: wrap;
        row-gap: 4px;
      }
      .vk-workspace.is-split .vk-deck-tabs {
        flex: 1 1 100%;
      }
      .vk-workspace.is-split .vk-deck-tools {
        margin-left: auto;
      }
      .vk-doc-deck.collapsed .vk-deck-bar {
        border-bottom: 0;
        border-radius: 9px;
      }
      .vk-deck-tabs {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 3px;
        min-width: 0;
        padding-right: 16px;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
        mask-image: linear-gradient(to right, #000 calc(100% - 18px), transparent);
      }
      .vk-deck-tabs::-webkit-scrollbar {
        display: none;
      }
      .vk-deck-tab {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        max-width: 210px;
        height: 28px;
        padding: 0 9px 0 6px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted, #5d606a);
        font-size: 12.5px;
        font-weight: 500;
        white-space: nowrap;
        transition:
          background-color 0.12s ease,
          color 0.12s ease,
          box-shadow 0.12s ease;
      }
      .vk-deck-tab:hover {
        background: var(--vk-hover, rgb(20 21 26 / 0.045));
        color: var(--vk-ink, inherit);
      }
      .vk-deck-tab.on {
        background: var(--vk-surface, #ffffff);
        color: var(--vk-ink, inherit);
        font-weight: 600;
        box-shadow:
          0 0 0 1px var(--vk-line, #e3e5ea),
          0 1px 2px rgb(0 0 0 / 0.06);
      }
      .vk-tab-thumb {
        display: grid;
        place-items: center;
        flex: none;
        width: 22px;
        height: 15px;
        overflow: hidden;
        border-radius: 2.5px;
        background: var(--vk-canvas, #f7f8fa);
        box-shadow: 0 0 0 1px rgb(20 21 26 / 0.14);
        color: var(--vk-muted);
      }
      .vk-tab-thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .vk-tab-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-deck-focus-meta {
        display: flex;
        align-items: center;
        padding-left: 6px;
        min-width: 0;
      }
      .vk-focus-subtitle {
        overflow: hidden;
        color: var(--vk-muted, #5d606a);
        font-size: 12px;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-deck-tools {
        display: flex;
        flex: none;
        align-items: center;
        gap: 4px;
      }
      .vk-capsule {
        display: inline-flex;
        align-items: center;
        height: 25px;
        padding: 1.5px;
        border: 1px solid var(--vk-line, #e3e5ea);
        border-radius: 6px;
        background: var(--vk-surface, #ffffff);
      }
      .vk-capsule button {
        display: inline-grid;
        place-items: center;
        min-width: 22px;
        height: 20px;
        padding: 0 5px;
        border: 0;
        border-radius: 4.5px;
        background: transparent;
        color: var(--vk-muted, #5d606a);
        font-size: 12px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .vk-capsule button:hover:not(:disabled) {
        background: var(--vk-hover, rgb(20 21 26 / 0.05));
        color: var(--vk-ink, inherit);
      }
      .vk-capsule button.on {
        background: var(--vk-selected, rgb(20 21 26 / 0.08));
        color: var(--vk-ink, inherit);
        font-weight: 600;
      }
      .vk-zoom-readout {
        min-width: 40px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
      }
      .vk-capsule-readout {
        padding: 0 5px;
        color: var(--vk-muted, #5d606a);
        font-size: 11px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .vk-tool-icon {
        display: grid;
        place-items: center;
        width: 25px;
        height: 25px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted, #5d606a);
      }
      .vk-tool-icon:hover {
        background: var(--vk-hover, rgb(20 21 26 / 0.05));
        color: var(--vk-ink, inherit);
      }

      .vk-reader {
        position: relative;
        min-width: 0;
      }
      .vk-move-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--vk-line-soft, #eef0f3);
        font-size: 12.5px;
      }
      .vk-page {
        position: relative;
        overflow: auto;
        display: grid;
        place-items: center;
        padding: 12px 16px;
        background: color-mix(in srgb, var(--vk-ink) 2.6%, var(--vk-canvas, #f7f8fa));
        border-radius: 0 0 9px 9px;
        line-height: 0;
        min-height: 150px;
      }
      .vk-workspace.is-split .vk-page {
        max-height: calc(100vh - 208px);
        min-height: 240px;
      }
      .vk-page-stage {
        position: relative;
        display: inline-block;
        margin: auto;
        max-width: 100%;
        border-radius: 8px;
        box-shadow:
          0 0 0 1px rgb(20 21 26 / 0.09),
          0 10px 24px -8px rgb(0 0 0 / 0.16),
          0 2px 5px rgb(0 0 0 / 0.06);
        line-height: 0;
      }
      .vk-page-stage > img,
      .vk-page-stage > canvas {
        display: block;
        max-width: 100%;
        max-height: calc((var(--stage-h, 224px) - 24px) * var(--zoom-scale, 1));
        width: auto;
        height: auto;
        border-radius: 8px;
        image-orientation: from-image;
      }
      .vk-page-stage.is-split-fit > img,
      .vk-page-stage.is-split-fit > canvas {
        max-height: calc((100vh - 236px) * var(--zoom-scale, 1));
        width: auto;
        max-width: 100%;
      }
      .vk-page-stage.is-zoomed {
        width: calc(480px * var(--zoom-scale, 1));
        max-width: none;
      }
      .vk-page-stage.is-zoomed > img,
      .vk-page-stage.is-zoomed > canvas {
        width: 100%;
        max-width: none;
        max-height: none;
        height: auto;
      }
      .vk-box {
        position: absolute;
        box-sizing: border-box;
        border: 1.75px solid var(--vk-blue, #2563eb);
        border-radius: 4px;
        background: rgb(37 99 235 / 0.13);
        box-shadow: 0 0 0 3px rgb(37 99 235 / 0.16);
        pointer-events: none;
        transition:
          left 0.14s ease,
          top 0.14s ease,
          width 0.14s ease,
          height 0.14s ease;
      }
      .vk-box-tag {
        position: absolute;
        left: -1.5px;
        bottom: calc(100% + 3px);
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--vk-blue, #2563eb);
        color: #ffffff;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.25;
        letter-spacing: -0.005em;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgb(37 99 235 / 0.28);
      }
      .vk-box-tag.inside-top {
        top: 2px;
        bottom: auto;
      }

      /* HAIRLINE MACOS DRAG RESIZERS */
      .vk-stage-resizer-h {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: -4px;
        z-index: 8;
        height: 8px;
        cursor: row-resize;
        user-select: none;
      }
      .vk-stage-resizer-h::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 3px;
        transform: translateX(-50%);
        width: 36px;
        height: 2.5px;
        border-radius: 99px;
        background: transparent;
        transition:
          background-color 0.12s ease,
          width 0.12s ease;
      }
      .vk-stage-resizer-h:hover::after,
      .vk-stage-resizer-h:active::after {
        width: 56px;
        background: var(--vk-blue, #2563eb);
      }
      .vk-stage-resizer-v {
        position: relative;
        align-self: stretch;
        width: 10px;
        min-height: 240px;
        cursor: col-resize;
        user-select: none;
      }
      .vk-stage-resizer-v::before {
        content: "";
        position: absolute;
        top: 8px;
        bottom: 8px;
        left: 4px;
        width: 1.5px;
        border-radius: 2px;
        background: transparent;
        transition: background 0.14s ease;
      }
      .vk-stage-resizer-v:hover::before,
      .vk-stage-resizer-v:active::before {
        background: var(--vk-blue, #2563eb);
      }

      .vk-doc-caption {
        margin: 0;
        padding: 8px 12px;
        color: var(--vk-muted, #5d606a);
        font-size: 12px;
      }
      .vk-doc-placeholder {
        padding: 24px 16px;
        color: var(--vk-muted, #5d606a);
        font-size: 13px;
        text-align: center;
        line-height: 1.45;
      }

      /* REFERENCE-GRADE OCR DETAIL CARDS */
      .vk-details-pane {
        min-width: 0;
      }
      .vk-group {
        margin-bottom: 16px;
      }
      .vk-group-toggle {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 6px 2px 3px;
        margin-left: -3px;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--vk-muted, #5d606a);
        cursor: pointer;
        transition:
          background-color 0.12s ease,
          color 0.12s ease;
      }
      .vk-group-toggle:hover {
        background: var(--vk-hover, rgb(20 21 26 / 0.045));
        color: var(--vk-ink, inherit);
      }
      .vk-group-chev {
        opacity: 0.65;
        transition: transform 0.15s ease;
      }
      .vk-group-chev.collapsed {
        transform: rotate(-90deg);
      }
      .vk-group-count {
        padding: 0 5.5px;
        border-radius: 999px;
        background: var(--vk-hover, rgb(20 21 26 / 0.06));
        color: var(--vk-muted, #5d606a);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.5;
      }
      .vk-group-card {
        border: 1px solid var(--vk-line, #e3e5ea);
        border-radius: 10px;
        background: var(--vk-card, #ffffff);
      }
      .vk-detail {
        position: relative;
        display: grid;
        grid-template-columns: 176px minmax(0, 1fr);
        align-items: start;
        gap: 12px;
        min-height: 41px;
        padding: 8px 14px 8px 16px;
        border-bottom: 1px solid var(--vk-line-soft, #eef0f3);
        transition: background-color 0.1s ease;
      }
      .vk-workspace.is-split .vk-detail {
        grid-template-columns: minmax(0, 1fr);
        gap: 2px;
        padding: 9px 14px;
      }
      .vk-workspace.is-split .vk-row-label {
        padding-top: 0;
        font-size: 12px;
      }
      .vk-detail:first-child {
        border-radius: 9px 9px 0 0;
      }
      .vk-detail:last-child {
        border-bottom: 0;
        border-radius: 0 0 9px 9px;
      }
      .vk-detail:only-child {
        border-radius: 9px;
      }
      .vk-detail.interactive {
        cursor: pointer;
      }
      .vk-detail:hover {
        background: color-mix(in srgb, var(--vk-ink) 2.6%, transparent);
      }
      .vk-detail.located {
        background: color-mix(in srgb, var(--vk-blue, #2563eb) 6.5%, transparent);
      }
      .vk-row-label {
        min-width: 0;
        padding-top: 2px;
        color: var(--vk-muted, #5d606a);
        font-size: 13px;
        font-weight: 450;
        line-height: 1.35;
        overflow-wrap: break-word;
      }
      .vk-row-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .vk-primary-line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        min-width: 0;
      }
      .vk-val-btn {
        min-width: 0;
        padding: 0;
        margin: 0;
        border: 0;
        border-radius: 4px;
        background: none;
        color: var(--vk-ink, inherit);
        font-size: 14px;
        font-weight: 500;
        line-height: 1.38;
        letter-spacing: -0.005em;
        text-align: left;
        overflow-wrap: anywhere;
        cursor: inherit;
      }
      .vk-val-btn.mono {
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 13px;
        letter-spacing: 0.015em;
      }
      .vk-copied-pill {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: 5px;
        background: var(--vk-green-soft, #e4f4ec);
        color: var(--vk-green, #128a5a);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.35;
      }

      /* QUIET TYPOGRAPHIC SCRIPT & FORMAT READINGS (ZERO GREY BADGE CLUTTER) */
      .vk-alt-readings {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 2px 7px;
        min-width: 0;
      }
      .vk-alt-sep {
        color: var(--vk-faint, #8c8f99);
        font-size: 11.5px;
        user-select: none;
      }
      .vk-alt-reading {
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
        min-width: 0;
        padding: 1px 4px;
        margin: 0 -4px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--vk-muted, #5d606a);
        font-size: 12px;
        font-weight: 450;
        line-height: 1.35;
        text-align: left;
        cursor: copy;
      }
      .vk-alt-reading:hover {
        background: var(--vk-hover, rgb(20 21 26 / 0.05));
        color: var(--vk-ink, inherit);
      }
      .vk-alt-reading.located {
        color: var(--vk-blue, #2563eb);
        font-weight: 500;
      }
      .vk-alt-script {
        color: var(--vk-faint, #8c8f99);
        font-size: 10.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
        flex: none;
      }
      .vk-alt-val {
        overflow-wrap: anywhere;
      }
      .vk-copied-inline {
        color: var(--vk-green, #128a5a);
        font-size: 11px;
        font-weight: 700;
      }

      .vk-rule-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
        padding: 1px 6px;
        border-radius: 5px;
        color: var(--vk-muted, #5d606a);
        font-size: 11.5px;
        font-weight: 500;
        line-height: 1.35;
      }
      .vk-rule-pill.never {
        color: var(--vk-faint, #8c8f99);
        background: var(--vk-hover, rgb(20 21 26 / 0.04));
      }
      .vk-rule-pill.ask {
        background: var(--vk-hover, rgb(20 21 26 / 0.055));
        color: var(--vk-muted, #5d606a);
      }

      .vk-bulk-cell {
        grid-column: 2 / -1;
        min-width: 0;
      }
      .vk-inline-input {
        width: 100%;
        height: 31px;
        padding: 0 9px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 36%));
        border-radius: 7px;
        background: var(--vk-canvas, transparent);
        color: inherit;
        font: inherit;
        font-size: 13.5px;
      }

      .vk-detail:has(details[open]) {
        z-index: 16;
      }
      .vk-detail-actions {
        position: absolute;
        top: 6px;
        right: 8px;
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 1px 2px 1px 6px;
        border-radius: 7px;
        background: color-mix(in srgb, var(--vk-card, #ffffff) 92%, transparent);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease;
      }
      .vk-detail:hover .vk-detail-actions,
      .vk-detail:focus-within .vk-detail-actions,
      .vk-detail.located .vk-detail-actions,
      .vk-detail-actions:has(details[open]) {
        opacity: 1;
        pointer-events: auto;
      }
      .vk-detail-actions:has(details[open]) {
        z-index: 20;
      }
      @media (hover: none) {
        .vk-detail-actions {
          position: static;
          padding: 0;
          background: none;
          backdrop-filter: none;
          opacity: 1;
          pointer-events: auto;
        }
      }
      .vk-icon-btn,
      .vk-more > summary {
        display: grid;
        place-items: center;
        width: 27px;
        height: 27px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: none;
        color: var(--vk-muted, inherit);
        list-style: none;
      }
      .vk-more > summary::-webkit-details-marker {
        display: none;
      }
      .vk-icon-btn:hover,
      .vk-more > summary:hover {
        background: var(--vk-hover, rgb(148 163 184 / 15%));
        color: var(--vk-ink, inherit);
      }
      .vk-more {
        position: relative;
      }
      .vk-menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        z-index: 20;
        width: max-content;
        min-width: 240px;
        max-width: 300px;
        padding: 5px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 28%));
        border-radius: 10px;
        background: var(--vk-paper, rgb(var(--color-background, 255 255 255)));
        box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
      }
      .vk-menu button {
        display: block;
        width: 100%;
        padding: 6.5px 10px;
        border: 0;
        border-radius: 6.5px;
        background: none;
        font-size: 12.5px;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .vk-menu button:hover {
        background: var(--vk-hover, rgb(148 163 184 / 14%));
      }
      .vk-menu select,
      .vk-editor input,
      .vk-editor select,
      .vk-move-bar select {
        width: 100%;
        margin-top: 5px;
        padding: 7px 9px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 32%));
        border-radius: 7px;
        background: var(--vk-canvas, transparent);
        color: inherit;
        font: inherit;
        font-size: 13px;
      }
      .danger {
        color: var(--vk-danger, #dc2626) !important;
      }
      .vk-editor {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 10px;
        padding: 10px 14px;
        border-top: 1px solid var(--vk-line, rgb(148 163 184 / 18%));
      }
      .vk-correct {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
      }
      .vk-correct-actions {
        display: flex;
        gap: 8px;
      }
      .vk-editor .vk-correct-kind {
        display: flex;
        grid-column: 1 / -1;
        align-items: center;
        gap: 10px;
        color: var(--vk-muted, rgb(148 163 184));
      }
      .vk-editor .vk-correct-kind select {
        width: auto;
        min-width: 180px;
      }
      .vk-editor label {
        display: grid;
        flex: 1;
        gap: 4px;
        min-width: 130px;
        font-size: 12.5px;
      }
      .vk-btn {
        padding: 6px 12px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 32%));
        border-radius: 8px;
        background: transparent;
        font-size: 13px;
        font-weight: 500;
      }
      .vk-btn.primary {
        border-color: transparent;
        background: var(--vk-blue, #2563eb);
        color: #fff;
      }
      .vk-empty {
        margin: 0;
        padding: 18px 12px;
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 13.5px;
      }
      .vk-new-detail {
        margin-top: 12px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 24%));
        border-radius: 10px;
        padding: 10px 14px;
        background: var(--vk-paper, #ffffff);
      }
      .vk-new-detail summary {
        font-size: 13px;
        font-weight: 500;
        color: var(--vk-muted, inherit);
        list-style: none;
      }
      .vk-new-detail summary::-webkit-details-marker {
        display: none;
      }
      .vk-starter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 10px 0 2px;
      }
      .vk-starter-chip {
        height: 28px;
        padding: 0 10px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 28%));
        border-radius: 8px;
        background: var(--vk-hover, rgb(148 163 184 / 8%));
        color: var(--vk-ink, inherit);
        font-size: 12.5px;
        font-weight: 500;
      }
      .vk-starter-chip:hover {
        border-color: var(--vk-accent, #2563eb);
        color: var(--vk-accent, #2563eb);
      }

      /* LIGHTBOX MODAL */
      .vk-large-backdrop {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(15 23 42 / 58%);
        backdrop-filter: blur(4px);
      }
      .vk-lightbox-dialog {
        width: min(1040px, 96vw);
        max-height: calc(100vh - 48px);
        display: flex;
        flex-direction: column;
        border-radius: 14px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 28%));
        background: var(--vk-surface, #ffffff);
        color: var(--vk-ink, #0f172a);
        box-shadow: 0 24px 60px rgb(0 0 0 / 30%);
        padding: 16px 20px 20px;
      }
      .vk-lightbox-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        display: grid;
        place-items: center;
        background: var(--vk-hover, #f1f5f9);
        border-radius: 10px;
        padding: 16px;
      }
      .vk-lightbox-body img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        box-shadow: 0 8px 28px rgb(0 0 0 / 16%);
      }
      .vk-large-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
      }
      .vk-large-head strong {
        font-size: 14px;
        font-weight: 600;
        color: var(--vk-ink, #0f172a);
      }
      .vk-large-actions {
        display: flex;
        gap: 8px;
      }

      @media (max-width: 720px) {
        .vk-workspace.is-split {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .vk-stage-resizer-v {
          display: none;
        }
        .vk-detail {
          grid-template-columns: minmax(0, 1fr) auto;
        }
        .vk-row-label {
          grid-column: 1 / -1;
          font-size: 12px;
        }
      }
    `,
  ],
})
export class ProfileComponent implements OnDestroy {
  private static readonly MAX_SESSION_BLOBS = 96;
  private static readonly sessionBlobs = new Map<
    string,
    { attachmentId: string; url: string }
  >();

  private static getOrCreateSessionBlobUrl(
    cipherId: string,
    source: ProfileSource,
    bytes: Uint8Array,
  ): string {
    const key = `${cipherId}:${source.id}`;
    const existing = ProfileComponent.sessionBlobs.get(key);
    if (existing && existing.attachmentId === (source.attachmentId ?? "")) {
      ProfileComponent.sessionBlobs.delete(key);
      ProfileComponent.sessionBlobs.set(key, existing);
      return existing.url;
    }
    if (existing) {
      URL.revokeObjectURL(existing.url);
      ProfileComponent.sessionBlobs.delete(key);
    }
    while (ProfileComponent.sessionBlobs.size >= ProfileComponent.MAX_SESSION_BLOBS) {
      const oldestKey = ProfileComponent.sessionBlobs.keys().next().value;
      if (oldestKey === undefined) break;
      const evicted = ProfileComponent.sessionBlobs.get(oldestKey);
      if (evicted) URL.revokeObjectURL(evicted.url);
      ProfileComponent.sessionBlobs.delete(oldestKey);
    }
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(bytes).buffer], { type: source.mediaType }),
    );
    ProfileComponent.sessionBlobs.set(key, {
      attachmentId: source.attachmentId ?? "",
      url,
    });
    return url;
  }

  private static peekSessionBlobUrl(cipherId: string, source: ProfileSource): string | null {
    if (!source.attachmentId) {
      return null;
    }
    // Verify the underlying decrypted bytes are still authorized in ProfileService's active-account cache
    const cachedBytes = ProfileService.peekCachedBytes(cipherId, source.id, source.attachmentId);
    if (!cachedBytes) {
      const stale = ProfileComponent.sessionBlobs.get(`${cipherId}:${source.id}`);
      if (stale) {
        URL.revokeObjectURL(stale.url);
        ProfileComponent.sessionBlobs.delete(`${cipherId}:${source.id}`);
      }
      return null;
    }
    return ProfileComponent.getOrCreateSessionBlobUrl(cipherId, source, cachedBytes);
  }

  readonly cipher = input.required<CipherView>();
  readonly initialSourceId = input<string | null>(null);
  readonly initialVariantId = input<string | null>(null);
  readonly startAdding = input<boolean>(false);
  readonly documentFocus = input<boolean>(false);
  readonly bulkEdit = input<boolean>(false);
  readonly filterQuery = input<string>("");
  readonly selectedSourceChange = output<string | null>();

  readonly collapsedGroups = signal<Set<string>>(new Set());
  readonly lightboxOpen = signal(false);

  readonly docLayout = signal<"stack" | "split">(
    (typeof localStorage !== "undefined" && localStorage.getItem(DOC_LAYOUT_KEY) === "split")
      ? "split"
      : "stack",
  );
  readonly docExpanded = signal(
    typeof localStorage === "undefined" || localStorage.getItem(DOC_EXPANDED_KEY) !== "0",
  );
  readonly docStageHeight = signal(readNumberPref(DOC_STAGE_H_KEY, 220, 140, 680));
  readonly docSplitPct = signal(readNumberPref(DOC_SPLIT_PCT_KEY, 48, 28, 72));
  readonly zoomPercent = signal(100);
  readonly copiedKey = signal<string | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly thumbUrls = signal<Record<string, string>>({});

  readonly effectiveStageHeight = computed(() =>
    this.documentFocus() ? Math.max(this.docStageHeight(), 280) : this.docStageHeight(),
  );

  private readonly profiles = new ProfileService(
    inject(AccountService),
    inject(CipherService),
    inject(LocalVaultService, { optional: true }),
    inject(CipherSdkService),
  );
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly platform = inject(PlatformUtilsService);
  private readonly i18n = inject(I18nService, { optional: true });
  private readonly localeTick = signal(0);
  private localeSub?: Subscription;
  readonly actions = inject<ProfileDocumentActions | null>(PROFILE_DOCUMENT_ACTIONS, {
    optional: true,
  });

  readonly current = signal<CipherView | null>(null);
  readonly meta = computed(() => (this.current() ? readEnvelope(this.current()!) : null));
  readonly editable = computed(() => !!this.current()?.edit && !this.current()?.isDeleted);
  readonly activeSources = computed(
    () => this.meta()?.sources.filter((s) => s.status !== "deleted") ?? [],
  );

  readonly visibleDetails = computed(() => {
    const all =
      this.meta()?.details.filter(
        (detail) => !isHiddenValueType(detail.valueType) || this.current()?.viewPassword !== false,
      ) ?? [];
    if (!this.documentFocus() || !this.selectedSource()) {
      return all;
    }
    const srcId = this.selectedSource()!.id;
    const filtered = all.filter((detail) =>
      detail.variants.some((v) => v.sourceId === srcId),
    );
    return filtered.length > 0 ? filtered : all;
  });

  readonly groupedDetails = computed<DetailGroup[]>(() => {
    this.localeTick();
    const needle = this.filterQuery().trim().toLocaleLowerCase();
    const buckets = new Map<
      string,
      { id: string; title: string; order: number; details: ProfileDetail[] }
    >();
    for (const detail of this.visibleDetails()) {
      const win = this.winner(detail);
      if (!win) {
        continue;
      }
      if (needle) {
        const labelText = this.labelFor(detail).toLocaleLowerCase();
        const valText = win.value.toLocaleLowerCase();
        const altMatch = detail.variants.some((v) => v.value.toLocaleLowerCase().includes(needle));
        if (!labelText.includes(needle) && !valText.includes(needle) && !altMatch) {
          continue;
        }
      }
      const cat = categoryFor(detail);
      const titleKey = SECTION_TITLE_KEYS[cat.id];
      const localizedTitle = titleKey ? this.tr(titleKey, cat.title) : cat.title;
      const existing = buckets.get(cat.id);
      if (existing) {
        existing.details.push(detail);
      } else {
        buckets.set(cat.id, { ...cat, title: localizedTitle, details: [detail] });
      }
    }
    return [...buckets.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ id, title, details }) => ({ id, title, details }));
  });

  isGroupCollapsed(groupId: string): boolean {
    if (this.filterQuery().trim()) {
      return false;
    }
    return this.collapsedGroups().has(groupId);
  }

  toggleGroup(groupId: string): void {
    this.collapsedGroups.update((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  onDeckTabsWheel(event: WheelEvent): void {
    const el = event.currentTarget as HTMLElement | null;
    if (!el || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }
    if (el.scrollWidth > el.clientWidth + 2) {
      event.preventDefault();
      el.scrollLeft += event.deltaY;
    }
  }

  private scheduleScrollActiveDeckTab(): void {
    const run = () => this.scrollActiveDeckTabIntoView();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    } else {
      queueMicrotask(run);
    }
  }

  private scrollActiveDeckTabIntoView(): void {
    const container = this.host.nativeElement.querySelector<HTMLElement>(".vk-deck-tabs");
    const active = container?.querySelector<HTMLElement>(".vk-deck-tab.on");
    if (!container || !active) {
      return;
    }
    const cRect = container.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    const pad = 8;
    if (aRect.left < cRect.left + pad) {
      const target = Math.max(0, container.scrollLeft + (aRect.left - cRect.left) - pad);
      container.scrollTo?.({ left: target, behavior: "smooth" });
    } else if (aRect.right > cRect.right - pad) {
      const target = container.scrollLeft + (aRect.right - cRect.right) + pad;
      container.scrollTo?.({ left: target, behavior: "smooth" });
    }
  }

  readonly maskedIds = signal<Set<string>>(new Set());
  readonly teachableTypes: readonly { attribute: string; label: string }[] = [
    { attribute: "name.full", label: "Full name" },
    { attribute: "name.family", label: "Family name" },
    { attribute: "name.given", label: "Given name" },
    { attribute: "birth.date", label: "Date of birth" },
    { attribute: "person.sex", label: "Sex / Gender" },
    { attribute: "person.nationality", label: "Nationality" },
    { attribute: "address.full", label: "Current address" },
    { attribute: "address.prefecture", label: "State / Province / Prefecture" },
    { attribute: "address.postal", label: "Postal code" },
    { attribute: "address.registered_domicile", label: "Registered domicile" },
    { attribute: "contact.phone", label: "Phone number" },
    { attribute: "contact.email", label: "Email address" },
    { attribute: "id.passport.number", label: "Passport number" },
    { attribute: "id.national.number", label: "National ID number" },
    { attribute: "id.residence_card.number", label: "Residence card number" },
    { attribute: "id.mynumber", label: "My Number" },
    { attribute: "id.driver_license.number", label: "Driver license number" },
    { attribute: "work.employer.name", label: "Employer" },
    { attribute: "work.occupation", label: "Occupation" },
    { attribute: "bank.name", label: "Bank name" },
    { attribute: "bank.branch.name", label: "Branch name" },
    { attribute: "bank.account.number", label: "Account number" },
  ];
  readonly starterFields: readonly {
    attribute: string;
    label: string;
    valueType: ValueType;
  }[] = [
    { attribute: "name.full", label: "Full name", valueType: "text" },
    { attribute: "birth.date", label: "Date of birth", valueType: "date" },
    { attribute: "contact.email", label: "Email address", valueType: "email" },
    { attribute: "contact.phone", label: "Phone number", valueType: "phone" },
    { attribute: "address.full", label: "Current address", valueType: "address" },
    { attribute: "id.passport.number", label: "Passport number", valueType: "text" },
  ];

  readonly tab = signal<"details" | "documents">("details");
  readonly editing = signal<{ detailId: string; variantId: string } | null>(null);
  readonly correction = signal("");
  readonly error = signal("");
  readonly message = signal("");
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly selectedSource = signal<ProfileSource | null>(null);
  readonly selectedLocator = signal<Locator | null>(null);
  readonly activeVariantId = signal<string | null>(null);
  readonly activeLocatedLabel = computed(() => {
    this.localeTick();
    const vid = this.activeVariantId();
    if (!vid) {
      return "";
    }
    const detail = this.meta()?.details.find((d) => d.variants.some((v) => v.id === vid));
    return detail ? this.labelFor(detail) : "";
  });
  readonly pageBox = computed(() => {
    const locator = this.selectedLocator();
    return locator?.kind === "page" &&
      locator.page === this.page() &&
      locator.w > 0 &&
      locator.h > 0
      ? locator
      : null;
  });
  readonly preview = signal("");
  readonly pdfVisible = signal(false);
  readonly operations = signal<
    { id: string; kind: "capture" | "move" | "delete"; fileName: string }[]
  >([]);
  readonly page = signal(0);
  readonly pageCount = signal(1);
  readonly destinations = signal<CipherView[]>([]);
  readonly destinationId = signal("");

  newLabel = "";
  newValue = "";
  newType: ValueType = "text";

  private pdf: PDFDocumentProxy | null = null;
  private pdfLoading: PDFDocumentLoadingTask | null = null;
  private rendering: RenderTask | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private objectUrl: string | null = null;
  private readonly downloads = new Set<string>();
  private readonly thumbBlobUrls = new Set<string>();
  private readonly byteCache = new Map<string, Promise<Uint8Array>>();
  private lastReaderKey = "";
  private lastCipherSourcesKey = "";
  private generation = 0;
  private renderGeneration = 0;
  private inputEpoch = 0;
  private original: Uint8Array | null = null;

  @ViewChild("pdfCanvas") set pdfCanvas(element: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvas = element?.nativeElement ?? null;
    if (this.canvas != null && this.pdf != null) {
      void this.renderPage(this.page());
    }
  }

  constructor() {
    this.localeSub = this.i18n?.locale$?.subscribe?.(() =>
      this.localeTick.update((n) => n + 1),
    );
    effect(() => {
      const cipher = this.cipher();
      const sourceId = this.initialSourceId();
      const variantId = this.initialVariantId();
      const docFocus = this.documentFocus();
      untracked(() => {
        const prevCipherId = this.current()?.id ?? null;
        this.current.set(cipher);
        const meta = readEnvelope(cipher);
        const sourcesSig = (meta?.sources ?? [])
          .map((s) => `${s.id}:${s.attachmentId ?? ""}:${s.status}`)
          .join(",");
        const nextCipherSourcesKey = `${cipher.id}|${sourcesSig}|${docFocus ? 1 : 0}`;
        const nextReaderKey = `${nextCipherSourcesKey}|${sourceId ?? ""}|${variantId ?? ""}`;
        if (nextReaderKey === this.lastReaderKey) {
          return;
        }
        this.lastReaderKey = nextReaderKey;

        // Fast path: switching selected document on the same open profile (e.g. from left vertical dropdown)
        if (
          prevCipherId === cipher.id &&
          nextCipherSourcesKey === this.lastCipherSourcesKey &&
          !variantId &&
          sourceId
        ) {
          const target = meta?.sources.find(
            (entry) => entry.id === sourceId && entry.status !== "deleted",
          );
          if (target) {
            this.docExpanded.set(true);
            if (this.selectedSource()?.id !== target.id) {
              void this.openSource(target, null);
            }
            return;
          }
        }
        this.lastCipherSourcesKey = nextCipherSourcesKey;
        if (prevCipherId !== cipher.id) {
          this.byteCache.clear();
          this.collapsedGroups.set(new Set());
        }

        const epoch = ++this.inputEpoch;
        this.resetReader();
        this.busy.set(false);
        this.error.set("");
        this.message.set("");
        this.editing.set(null);
        this.tab.set("details");
        this.activeVariantId.set(variantId ?? null);
        if (docFocus || sourceId || variantId) {
          this.docExpanded.set(true);
        } else {
          this.docExpanded.set(
            typeof localStorage === "undefined" || localStorage.getItem(DOC_EXPANDED_KEY) !== "0",
          );
        }

        const variant = meta?.details
          .flatMap((detail) => [
            ...detail.variants,
            ...detail.history.map((entry) => entry.variant),
          ])
          .find((entry) => entry.id === variantId);
        const preferredSourceId = sourceId ?? variant?.sourceId;
        const source =
          (preferredSourceId
            ? meta?.sources.find((entry) => entry.id === preferredSourceId)
            : null) ??
          meta?.sources.find((entry) => entry.status !== "deleted") ??
          meta?.sources[0] ??
          null;
        // Start warming all documents in parallel right away alongside opening the initial document
        if (meta?.sources.length) {
          void this.warmSourceThumbnails(cipher.id, meta.sources, epoch);
        }
        if (source != null) {
          void this.openSource(source, variant?.locator ?? null);
        } else {
          this.selectedSourceChange.emit(null);
        }
        void this.refreshOperations();
      });
    });
  }

  ngOnDestroy(): void {
    this.localeSub?.unsubscribe();
    if (this.copiedTimer != null) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
    this.inputEpoch++;
    this.lastReaderKey = "";
    this.byteCache.clear();
    this.resetReader();
    this.revokeThumbs();
    for (const url of this.downloads) {
      URL.revokeObjectURL(url);
    }
    this.downloads.clear();
  }

  private readSourceBytes(cipherId: string, source: ProfileSource): Promise<Uint8Array> {
    const syncBytes = ProfileService.peekCachedBytes(cipherId, source.id, source.attachmentId);
    if (syncBytes != null) {
      return Promise.resolve(syncBytes);
    }
    const key = `${cipherId}:${source.id}:${source.attachmentId ?? ""}`;
    const existing = this.byteCache.get(key);
    if (existing) {
      return existing;
    }
    const pending = this.profiles
      .bytes(cipherId, source.id, source.attachmentId)
      .catch((err) => {
        this.byteCache.delete(key);
        throw err;
      });
    this.byteCache.set(key, pending);
    return pending;
  }

  private revokeThumbs(): void {
    for (const url of this.thumbBlobUrls) {
      URL.revokeObjectURL(url);
    }
    this.thumbBlobUrls.clear();
    this.thumbUrls.set({});
  }

  private async warmSourceThumbnails(
    cipherId: string,
    sources: ProfileSource[],
    epoch: number,
  ): Promise<void> {
    const active = sources.filter(
      (source) => source.status !== "deleted" && Boolean(source.attachmentId),
    );
    const warmOne = async (source: ProfileSource): Promise<void> => {
      if (epoch !== this.inputEpoch) {
        return;
      }
      const isImage = /^image\/(png|jpeg|gif|webp|bmp)$/.test(source.mediaType);
      if (isImage) {
        const fastUrl = ProfileComponent.peekSessionBlobUrl(cipherId, source);
        if (fastUrl) {
          if (this.thumbUrls()[source.id] !== fastUrl) {
            this.thumbUrls.update((prev) => ({ ...prev, [source.id]: fastUrl }));
          }
          return;
        }
      } else if (ProfileService.peekCachedBytes(cipherId, source.id, source.attachmentId)) {
        return;
      }
      try {
        const bytes = await this.readSourceBytes(cipherId, source);
        if (epoch !== this.inputEpoch) {
          return;
        }
        if (isImage) {
          const url = ProfileComponent.getOrCreateSessionBlobUrl(cipherId, source, bytes);
          this.thumbUrls.update((prev) => ({ ...prev, [source.id]: url }));
        }
      } catch {
        // Leave fallback document icon on thumbnail read error.
      }
    };
    for (let i = 0; i < active.length; i += 4) {
      if (epoch !== this.inputEpoch) {
        return;
      }
      await Promise.all(active.slice(i, i + 4).map(warmOne));
    }
  }

  sourceThumb(sourceId: string): string | null {
    const local = this.thumbUrls()[sourceId];
    if (local) {
      return local;
    }
    const cipherId = this.current()?.id;
    const source = this.meta()?.sources.find((s) => s.id === sourceId);
    if (cipherId && source && /^image\/(png|jpeg|gif|webp|bmp)$/.test(source.mediaType)) {
      return ProfileComponent.peekSessionBlobUrl(cipherId, source);
    }
    return null;
  }

  sourceSubtitle(source: ProfileSource): string {
    const parts: string[] = [];
    if (source.kind && source.kind.toLowerCase() !== this.cleanSourceName(source.fileName).toLowerCase()) {
      parts.push(source.kind);
    }
    if (source.expiresOn) {
      parts.push(this.tr("vkExpiresOnShort", `Exp ${source.expiresOn}`, source.expiresOn));
    } else if (source.documentDate) {
      parts.push(source.documentDate);
    }
    if (source.status === "retained") {
      parts.push(this.tr("vkPrevious", "Previous"));
    }
    return parts.join(" · ") || this.tr("vkSavedDocument", "Saved document");
  }

  setDocExpanded(expanded: boolean): void {
    this.docExpanded.set(expanded);
    writePref(DOC_EXPANDED_KEY, expanded ? "1" : "0");
  }

  selectSourceCard(source: ProfileSource): void {
    if (this.selectedSource()?.id === source.id && this.docExpanded() && !this.documentFocus()) {
      this.setDocExpanded(false);
      return;
    }
    this.setDocExpanded(true);
    if (this.selectedSource()?.id !== source.id) {
      void this.openSource(source);
    }
  }

  setDocLayout(layout: "stack" | "split"): void {
    this.docLayout.set(layout);
    writePref(DOC_LAYOUT_KEY, layout);
  }

  setZoomPercent(value: number): void {
    const clamped = Math.max(50, Math.min(250, Math.round(Number(value) || 100)));
    this.zoomPercent.set(clamped);
  }

  stepZoom(delta: number): void {
    this.setZoomPercent(this.zoomPercent() + delta);
  }

  resetZoomOrToggle(): void {
    this.zoomPercent.set(this.zoomPercent() === 100 ? 150 : 100);
  }

  onStageWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const delta = event.deltaY < 0 ? 15 : -15;
    this.setZoomPercent(this.zoomPercent() + delta);
  }

  groupSingleSource(group: DetailGroup): ProfileSource | null {
    const srcIds = new Set<string>();
    for (const detail of group.details) {
      const w = this.winner(detail);
      if (w?.sourceId) {
        srcIds.add(w.sourceId);
      }
    }
    if (srcIds.size !== 1) {
      return null;
    }
    const [onlyId] = srcIds;
    return this.activeSources().find((s) => s.id === onlyId) ?? null;
  }

  focusSource(source: ProfileSource): void {
    this.setDocExpanded(true);
    if (this.selectedSource()?.id !== source.id) {
      void this.openSource(source);
    }
  }

  startHeightResize(event: MouseEvent, viewport: HTMLElement): void {
    event.preventDefault();
    const startY = event.clientY;
    const startH = viewport.getBoundingClientRect().height;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(140, Math.min(680, Math.round(startH + (ev.clientY - startY))));
      this.docStageHeight.set(next);
    };
    const onUp = () => {
      writePref(DOC_STAGE_H_KEY, String(this.docStageHeight()));
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    document.body.style.cursor = "row-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  resetStageHeight(): void {
    this.docStageHeight.set(220);
    writePref(DOC_STAGE_H_KEY, "220");
  }

  startSplitResize(event: MouseEvent, container: HTMLElement): void {
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const onMove = (ev: MouseEvent) => {
      const pct = Math.max(28, Math.min(72, Math.round(((ev.clientX - rect.left) / rect.width) * 100)));
      this.docSplitPct.set(pct);
    };
    const onUp = () => {
      writePref(DOC_SPLIT_PCT_KEY, String(this.docSplitPct()));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  resetSplitRatio(): void {
    this.docSplitPct.set(48);
    writePref(DOC_SPLIT_PCT_KEY, "48");
  }

  @HostListener("document:keydown.escape", ["$event"])
  onEscapeKey(event: Event): void {
    if (this.lightboxOpen()) {
      event.preventDefault();
      this.lightboxOpen.set(false);
    }
  }

  tr(key: string, fallback: string, p1?: string | number, p2?: string | number): string {
    this.localeTick();
    const translated = this.i18n?.t?.(
      key,
      p1 != null ? String(p1) : undefined,
      p2 != null ? String(p2) : undefined,
    );
    return translated && translated !== key ? translated : fallback;
  }

  teachableLabel(kind: { attribute: string; label: string }): string {
    const key = ATTRIBUTE_I18N_KEYS[kind.attribute];
    return key ? this.tr(key, kind.label) : kind.label;
  }

  pickStarterField(
    chip: { attribute: string; label: string; valueType: ValueType },
    valueInput?: HTMLInputElement,
  ): void {
    this.newLabel = this.teachableLabel(chip);
    this.newType = chip.valueType;
    valueInput?.focus();
  }

  labelFor(detail: ProfileDetail): string {
    this.localeTick();
    const fallback = humanDetailLabel(detail.attribute, detail.label);
    const attr = detail.attribute;
    if (attr && ATTRIBUTE_I18N_KEYS[attr]) {
      const canonicalEn = humanDetailLabel(attr, undefined);
      if (
        !detail.label ||
        detail.label === canonicalEn ||
        (attr === "address.prefecture" && detail.label === "Prefecture or state")
      ) {
        return this.tr(ATTRIBUTE_I18N_KEYS[attr], fallback);
      }
    }
    return fallback;
  }

  cleanSourceName(fileName: string): string {
    return humanizeDocumentTitle(fileName, this.current()?.name);
  }

  alternativesOf(detail: ProfileDetail, primary: DetailVariant): DetailVariant[] {
    const seen = new Set<string>([primary.value.trim()]);
    const out: DetailVariant[] = [];
    for (const alt of detail.variants) {
      if (!alt.current || alt.id === primary.id) {
        continue;
      }
      const trimmed = alt.value.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      out.push(alt);
    }
    return out;
  }

  variantBadge(variant: DetailVariant): string {
    const rawTag = (variant.tag || variant.script || "").trim();
    if (rawTag) {
      return SCRIPT_LABELS[rawTag.toLowerCase()] ?? rawTag;
    }
    return "";
  }

  isCodeLike(detail: ProfileDetail): boolean {
    const attr = detail.attribute ?? "";
    return (
      detail.valueType === "number" ||
      detail.valueType === "date" ||
      isHiddenValueType(detail.valueType) ||
      /^(?:id\.|bank\.account\.number|tax\.|address\.postal|birth\.date|visa\.expiry)/.test(attr)
    );
  }

  isActiveVariant(variant: DetailVariant): boolean {
    return this.activeVariantId() != null && this.activeVariantId() === variant.id;
  }

  winner(detail: ProfileDetail): DetailVariant | null {
    if (this.documentFocus() && this.selectedSource()) {
      const srcId = this.selectedSource()!.id;
      const fromDoc = detail.variants.find((v) => v.current && v.sourceId === srcId);
      if (fromDoc) {
        return fromDoc;
      }
    }
    return this.meta() ? resolveDetailVariant(this.meta()!, detail) : null;
  }

  rule = agentRuleOf;

  isSensitive(detail: ProfileDetail): boolean {
    if (isHiddenValueType(detail.valueType)) {
      return true;
    }
    if (detail.attribute && /^(?:id\.|bank\.account\.number|tax\.)/.test(detail.attribute)) {
      return true;
    }
    return /(?:passport|residence card|my number|national id|ssn|account number|số định danh|cccd|hộ chiếu|tài khoản|在留カード番号|旅券番号|個人番号|マイナンバー|口座番号)/i.test(
      this.labelFor(detail),
    );
  }

  isMasked(detail: ProfileDetail): boolean {
    return this.maskedIds().has(detail.id);
  }

  displayValue(detail: ProfileDetail, value: string): string {
    if (!this.isMasked(detail)) {
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.length <= 4) {
      return "••••••••";
    }
    return "•".repeat(Math.min(12, Math.max(6, trimmed.length - 2))) + trimmed.slice(-2);
  }

  toggleMask(detailId: string): void {
    const next = new Set(this.maskedIds());
    if (next.has(detailId)) {
      next.delete(detailId);
    } else {
      next.add(detailId);
    }
    this.maskedIds.set(next);
  }

  async relabel(detail: ProfileDetail, attribute: string): Promise<void> {
    if (!attribute) {
      return;
    }
    const found = this.teachableTypes.find((entry) => entry.attribute === attribute);
    const label = found?.label ?? this.labelFor(detail);
    const previous = this.labelFor(detail);
    if (await this.edit({ kind: "relabel", detailId: detail.id, attribute, label })) {
      this.message.set(`Updated ${previous} to ${label}`);
    }
  }

  copy(detail: ProfileDetail, variant: DetailVariant): void {
    if (isHiddenValueType(detail.valueType) && this.current()?.viewPassword === false) {
      return;
    }
    this.platform.copyToClipboard(variant.value);
    this.copiedKey.set(variant.id);
    if (this.copiedTimer != null) {
      clearTimeout(this.copiedTimer);
    }
    this.copiedTimer = setTimeout(() => {
      if (this.copiedKey() === variant.id) {
        this.copiedKey.set(null);
      }
      this.copiedTimer = null;
    }, 1400);
  }

  onDetailRowClick(detail: ProfileDetail, variant: DetailVariant, event: MouseEvent): void {
    if (this.bulkEdit() || this.editing()?.detailId === detail.id) {
      return;
    }
    if ((window.getSelection?.()?.toString().trim().length ?? 0) > 0) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, select, textarea, details, summary, a, label")) {
      return;
    }
    this.copyAndLocate(detail, variant);
  }

  copyAndLocate(detail: ProfileDetail, variant: DetailVariant): void {
    this.activeVariantId.set(variant.id);
    this.copy(detail, variant);
    if (variant.sourceId && this.docExpanded()) {
      void this.show(variant, detail);
    }
  }

  beginEdit(detail: ProfileDetail, variant: DetailVariant, event: Event): void {
    (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
    this.editing.set({ detailId: detail.id, variantId: variant.id });
    this.correction.set(variant.value);
  }

  async saveInlineBlur(
    detail: ProfileDetail,
    variant: DetailVariant,
    rawValue: string,
  ): Promise<void> {
    const next = rawValue.trim();
    if (!next || next === variant.value) {
      return;
    }
    await this.edit({
      kind: "correct",
      detailId: detail.id,
      variantId: variant.id,
      value: next,
    });
  }

  async saveCorrection(): Promise<void> {
    const editing = this.editing();
    if (editing) {
      await this.edit({ kind: "correct", ...editing, value: this.correction() });
    }
  }

  async add(): Promise<void> {
    if (
      await this.edit({
        kind: "add",
        label: this.newLabel,
        value: this.newValue,
        valueType: this.newType,
      })
    ) {
      this.newLabel = "";
      this.newValue = "";
    }
  }

  @HostListener("document:click", ["$event"])
  protected closeOpenMenusOnOutsideClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const hostEl = this.host.nativeElement;
    hostEl.querySelectorAll<HTMLDetailsElement>("details.vk-more[open]").forEach((menu) => {
      if (!target || !menu.contains(target)) {
        menu.removeAttribute("open");
      }
    });
  }

  private closeMenuFromEvent(event?: Event): void {
    event?.stopPropagation();
    (event?.currentTarget as HTMLElement | null)?.closest("details")?.removeAttribute("open");
  }

  async chooseAlternative(detailId: string, variantId: string, event?: Event): Promise<void> {
    this.closeMenuFromEvent(event);
    await this.edit({ kind: "choose", detailId, variantId });
  }

  async setDetailRule(detail: ProfileDetail, nextRule: AgentRule, event?: Event): Promise<void> {
    this.closeMenuFromEvent(event);
    if (this.rule(detail) === nextRule) {
      return;
    }
    await this.edit({ kind: "rule", detailId: detail.id, rule: nextRule });
  }

  async deleteDetailFromMenu(detail: ProfileDetail, event?: Event): Promise<void> {
    this.closeMenuFromEvent(event);
    await this.deleteDetail(detail);
  }

  async deleteDetail(detail: ProfileDetail): Promise<void> {
    const label = this.labelFor(detail);
    if (
      window.confirm(
        this.tr(
          "vkConfirmDeleteDetail",
          `Delete ${label}? Its saved values and history will be removed.`,
          label,
        ),
      )
    ) {
      await this.edit({ kind: "delete", detailId: detail.id });
    }
  }

  async edit(edit: ProfileDetailEdit): Promise<boolean> {
    if (this.busy() || !this.editable()) {
      return false;
    }
    const epoch = this.inputEpoch;
    const id = this.current()!.id;
    this.busy.set(true);
    this.error.set("");
    this.message.set("");
    try {
      const updated = await this.profiles.edit(id, edit);
      if (epoch !== this.inputEpoch) {
        return false;
      }
      this.current.set(updated);
      this.editing.set(null);
      this.message.set(this.tr("vkSaved", "Saved"));
      return true;
    } catch (error) {
      if (epoch === this.inputEpoch) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
      return false;
    } finally {
      if (epoch === this.inputEpoch) {
        this.busy.set(false);
      }
    }
  }

  async show(variant: DetailVariant, _detail?: ProfileDetail): Promise<void> {
    this.activeVariantId.set(variant.id);
    const source = this.meta()?.sources.find((entry) => entry.id === variant.sourceId);
    if (!source) {
      return;
    }
    this.docExpanded.set(true);
    if (this.selectedSource()?.id === source.id) {
      await this.locate(variant);
      return;
    }
    await this.openSource(source, variant.locator);
  }

  private resetReader(): void {
    this.generation++;
    this.renderGeneration++;
    this.rendering?.cancel();
    this.rendering = null;
    const loading = this.pdfLoading;
    this.pdfLoading = null;
    this.pdf = null;
    if (loading != null) {
      void loading.destroy();
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.original = null;
    this.zoomPercent.set(100);
    this.lightboxOpen.set(false);
    this.preview.set("");
    this.pdfVisible.set(false);
    this.loading.set(false);
    this.selectedSource.set(null);
    this.selectedLocator.set(null);
    this.pageCount.set(1);
    this.page.set(0);
  }

  async openSource(source: ProfileSource, locator: Locator | null = null): Promise<void> {
    const cipherId = this.current()?.id ?? "";
    const isImage = /^image\/(png|jpeg|gif|webp|bmp)$/.test(source.mediaType);

    // Zero-latency synchronous swap when image bytes are already cached in RAM
    if (
      cipherId &&
      isImage &&
      source.status !== "deleted" &&
      source.attachmentId != null
    ) {
      const syncBytes = ProfileService.peekCachedBytes(
        cipherId,
        source.id,
        source.attachmentId,
      );
      if (syncBytes != null) {
        this.generation++;
        this.renderGeneration++;
        this.rendering?.cancel();
        this.rendering = null;
        const prevPdfLoading = this.pdfLoading;
        this.pdfLoading = null;
        this.pdf = null;
        if (prevPdfLoading != null) {
          void prevPdfLoading.destroy();
        }
        const url = ProfileComponent.getOrCreateSessionBlobUrl(cipherId, source, syncBytes);
        this.original = syncBytes;
        this.tab.set("documents");
        this.selectedSource.set(source);
        this.selectedLocator.set(locator);
        this.error.set("");
        this.destinations.set([]);
        this.zoomPercent.set(100);
        this.lightboxOpen.set(false);
        this.pdfVisible.set(false);
        this.loading.set(false);
        this.pageCount.set(1);
        this.page.set(0);
        this.preview.set(url);
        if (this.thumbUrls()[source.id] !== url) {
          this.thumbUrls.update((prev) => ({ ...prev, [source.id]: url }));
        }
        this.selectedSourceChange.emit(source.id);
        this.scheduleScrollActiveDeckTab();
        this.scrollLocatedBoxIntoView();
        return;
      }
    }

    this.resetReader();
    this.tab.set("documents");
    this.selectedSource.set(source);
    this.selectedLocator.set(locator);
    this.error.set("");
    this.destinations.set([]);
    this.selectedSourceChange.emit(source.id);
    this.scheduleScrollActiveDeckTab();
    if (source.status === "deleted" || source.attachmentId == null) {
      return;
    }
    const generation = this.generation;
    this.loading.set(true);
    try {
      const bytes = await this.readSourceBytes(cipherId, source);
      if (generation !== this.generation) {
        return;
      }
      this.original = bytes;
      if (source.mediaType === "application/pdf" || /\.pdf$/i.test(source.fileName)) {
        const resources = new URL("pdfjs/", document.baseURI).href;
        const loading = getDocument({
          data: bytes.slice(),
          cMapUrl: `${resources}cmaps/`,
          standardFontDataUrl: `${resources}standard_fonts/`,
          wasmUrl: `${resources}wasm/`,
          iccUrl: `${resources}iccs/`,
        });
        this.pdfLoading = loading;
        const pdf = await loading.promise;
        if (generation !== this.generation) {
          await loading.destroy();
          return;
        }
        this.pdf = pdf;
        this.pageCount.set(pdf.numPages);
        this.page.set(Math.max(0, Math.min(locator?.page ?? 0, pdf.numPages - 1)));
        this.pdfVisible.set(true);
        if (this.canvas != null) {
          await this.renderPage(this.page());
        }
      } else if (isImage) {
        const url = ProfileComponent.getOrCreateSessionBlobUrl(cipherId, source, bytes);
        this.preview.set(url);
        if (this.thumbUrls()[source.id] !== url) {
          this.thumbUrls.update((prev) => ({ ...prev, [source.id]: url }));
        }
      }
      this.scrollLocatedBoxIntoView();
    } catch (error) {
      if (generation === this.generation) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === this.generation) {
        this.loading.set(false);
      }
    }
  }

  async renderPage(index: number): Promise<void> {
    const pdf = this.pdf;
    const canvas = this.canvas;
    if (pdf == null || canvas == null || index < 0 || index >= pdf.numPages) {
      return;
    }
    const generation = this.generation;
    const renderGeneration = ++this.renderGeneration;
    this.rendering?.cancel();
    this.rendering = null;
    this.loading.set(true);
    this.page.set(index);
    this.error.set("");
    try {
      const page = await pdf.getPage(index + 1);
      if (generation !== this.generation || renderGeneration !== this.renderGeneration) {
        return;
      }
      const viewport = page.getViewport({ scale: Math.min(window.devicePixelRatio || 1, 2) * 1.5 });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext("2d");
      if (canvasContext == null) {
        throw new Error("The document preview is unavailable.");
      }
      const rendering = page.render({ canvasContext, canvas, viewport });
      this.rendering = rendering;
      await rendering.promise;
      page.cleanup();
    } catch (error) {
      if (generation === this.generation && renderGeneration === this.renderGeneration) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === this.generation && renderGeneration === this.renderGeneration) {
        this.rendering = null;
        this.loading.set(false);
      }
    }
  }

  async locate(variant: DetailVariant): Promise<void> {
    this.selectedLocator.set(variant.locator);
    if (this.pdf && variant.locator && variant.locator.page !== this.page()) {
      await this.renderPage(variant.locator.page);
    }
    this.scrollLocatedBoxIntoView();
  }

  private scrollLocatedBoxIntoView(): void {
    if (!this.selectedLocator()) {
      return;
    }
    requestAnimationFrame(() => {
      const boxEl = this.host.nativeElement.querySelector<HTMLElement>(".vk-page .vk-box");
      const pageEl = this.host.nativeElement.querySelector<HTMLElement>(".vk-page");
      if (!boxEl || !pageEl) {
        return;
      }
      if (
        pageEl.scrollHeight > pageEl.clientHeight + 4 ||
        pageEl.scrollWidth > pageEl.clientWidth + 4
      ) {
        boxEl.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    });
  }

  download(event?: Event): void {
    this.closeMenuFromEvent(event);
    const source = this.selectedSource();
    if (this.original == null || source == null) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(this.original).buffer], { type: source.mediaType }),
    );
    this.downloads.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = source.fileName;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      this.downloads.delete(url);
    }, 1000);
  }

  async pickDestination(event?: Event): Promise<void> {
    this.closeMenuFromEvent(event);
    try {
      this.destinations.set(
        (await this.actions!.profiles()).filter(
          (profile) => profile.id !== this.current()!.id && profile.edit,
        ),
      );
    } catch (error) {
      this.error.set(String(error));
    }
  }

  async removeSource(event?: Event): Promise<void> {
    this.closeMenuFromEvent(event);
    const source = this.selectedSource();
    if (
      !this.actions ||
      !source ||
      !window.confirm(
        this.tr(
          "vkConfirmDeleteDocument",
          `Delete ${source.fileName}? Its saved details and history will stay.`,
          source.fileName,
        ),
      )
    ) {
      return;
    }
    await this.documentAction(() => this.actions!.remove(this.current()!.id, source.id));
  }

  async move(): Promise<void> {
    const source = this.selectedSource();
    if (!this.actions || !source || !this.destinationId()) {
      return;
    }
    const originId = this.current()!.id;
    await this.documentAction(async () => {
      await this.actions!.move(originId, source.id, this.destinationId());
      return this.profiles.load(originId);
    });
  }

  private async documentAction(action: () => Promise<CipherView | null>): Promise<void> {
    if (this.busy()) {
      return;
    }
    const epoch = this.inputEpoch;
    this.busy.set(true);
    this.error.set("");
    try {
      const updated = await action();
      if (epoch === this.inputEpoch && updated) {
        this.current.set(updated);
        this.resetReader();
        this.message.set(this.tr("vkSaved", "Saved"));
      }
    } catch (error) {
      if (epoch === this.inputEpoch) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (epoch === this.inputEpoch) {
        this.busy.set(false);
        await this.refreshOperations();
      }
    }
  }

  private async refreshOperations(): Promise<void> {
    const epoch = this.inputEpoch;
    try {
      const operations = (await this.actions?.pending?.()) ?? [];
      if (epoch === this.inputEpoch) {
        this.operations.set(
          operations.filter((operation) => operation.profileId === this.current()?.id),
        );
      }
    } catch (error) {
      if (epoch === this.inputEpoch) {
        this.error.set(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async retry(id: string): Promise<void> {
    const profileId = this.current()!.id;
    if (this.actions?.retry != null) {
      await this.documentAction(async () => {
        await this.actions!.retry!(id);
        return this.profiles.load(profileId);
      });
    }
  }
}
