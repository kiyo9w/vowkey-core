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
  agentRuleOf,
  DetailVariant,
  humanDetailLabel,
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
  replace(profileId: string, sourceId: string, file: File): Promise<CipherView | null>;
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
  "address.postal": "vkAttrPostalCode",
  "address.registered_domicile": "vkAttrRegisteredDomicile",
  "contact.phone": "vkAttrPhoneNumber",
  "contact.email": "vkAttrEmailAddress",
  "id.passport.number": "vkAttrPassportNumber",
  "id.passport.expiry": "vkAttrPassportExpiry",
  "id.card.number": "vkAttrIdCardNumber",
  "id.card.expiry": "vkAttrExpiryDate",
  "id.residence_card.number": "vkAttrResidenceCardNumber",
  "id.mynumber": "vkAttrNationalIdNumber",
  "id.driver_license.number": "vkAttrDriverLicenseNumber",
  "work.employer.name": "vkAttrEmployer",
  "work.occupation": "vkAttrOccupation",
  "bank.name": "vkAttrBankName",
  "bank.branch.name": "vkAttrBranchName",
  "bank.account.number": "vkAttrAccountNumber",
};

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
    attr.startsWith("tax.") ||
    /\b(passport|id|residence|visa|license|number|issued|expir|authority)\b/.test(label)
  ) {
    return { id: "documents", title: "IDs & numbers", order: 1 };
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
    /\b(employer|company|occupation|bank|branch|account|routing|iban|swift)\b/.test(label)
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
    <section class="vk-profile" [attr.aria-label]="tr('vkProfileDetailsAria', 'Profile details and documents')">
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
        <div class="vk-workspace" [class.has-docs]="envelope.sources.length > 0">
          @if (envelope.sources.length > 0) {
            <aside class="vk-doc-pane" [attr.aria-label]="tr('vkDocuments', 'Documents')">
              <div class="vk-doc-bar">
                <div
                  class="vk-source-pills"
                  role="tablist"
                  [attr.aria-label]="tr('vkDocuments', 'Saved documents')"
                >
                  @for (source of envelope.sources; track source.id) {
                    <button
                      type="button"
                      role="tab"
                      class="vk-source-pill"
                      [class.selected]="selectedSource()?.id === source.id"
                      [attr.aria-selected]="selectedSource()?.id === source.id"
                      (click)="openSource(source)"
                    >
                      <span class="vk-source-name">{{ cleanSourceName(source.fileName) }}</span>
                      @if (source.status === "deleted") {
                        <small>{{ tr("vkDeleted", "Deleted") }}</small>
                      } @else if (source.status === "retained") {
                        <small>{{ tr("vkPrevious", "Previous") }}</small>
                      }
                    </button>
                  }
                </div>

                @if (selectedSource(); as source) {
                  <details class="vk-more">
                    <summary [attr.aria-label]="tr('vkDocumentActions', 'Document actions')">
                      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                        <circle cx="3.2" cy="8" r="1.25" fill="currentColor" />
                        <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                        <circle cx="12.8" cy="8" r="1.25" fill="currentColor" />
                      </svg>
                    </summary>
                    <div class="vk-menu">
                      <button
                        type="button"
                        [disabled]="loading() || source.status === 'deleted'"
                        (click)="download()"
                      >
                        {{ tr("vkDownloadOriginal", "Download original") }}
                      </button>
                      @if (actions && editable() && source.status !== "deleted") {
                        <label class="vk-file-action">
                          {{ tr("vkReplaceDocument", "Replace document") }}
                          <input type="file" (change)="replace($event)" [disabled]="busy()" />
                        </label>
                        <button type="button" (click)="pickDestination()">
                          {{ tr("vkMoveToProfile", "Move to another profile") }}
                        </button>
                        <button type="button" class="danger" (click)="removeSource()">
                          {{ tr("vkDeleteDocument", "Delete document") }}
                        </button>
                      }
                    </div>
                  </details>
                }
              </div>

              @if (selectedSource(); as source) {
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
                    <div class="vk-page">
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
                        ></span>
                      }
                    </div>
                  }

                  @if (pageCount() > 1) {
                    <div class="vk-pager">
                      <button
                        type="button"
                        class="vk-btn"
                        [disabled]="page() === 0 || loading()"
                        (click)="renderPage(page() - 1)"
                      >
                        {{ tr("vkPrevPage", "Previous") }}
                      </button>
                      <span>{{ page() + 1 }} / {{ pageCount() }}</span>
                      <button
                        type="button"
                        class="vk-btn"
                        [disabled]="page() + 1 >= pageCount() || loading()"
                        (click)="renderPage(page() + 1)"
                      >
                        {{ tr("vkNextPage", "Next") }}
                      </button>
                    </div>
                  }

                  @if (selectedLocator(); as locator) {
                    @if (locator.kind === "cell") {
                      <p class="vk-doc-caption">
                        {{ locator.page + 1 }} ·
                        {{
                          locator.a1 ||
                            (locator.row + 1) + ":" + (locator.column + 1)
                        }}
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
          }

          <div class="vk-details-pane">
            @for (group of groupedDetails(); track group.id) {
              <section class="vk-group" [attr.aria-label]="group.title">
                <h3 class="vk-group-title">{{ group.title }}</h3>
                <div class="vk-group-card">
                  @for (detail of group.details; track detail.id) {
                    @if (winner(detail); as variant) {
                      <article
                        class="vk-detail"
                        [class.located]="isActiveVariant(variant)"
                      >
                        <button
                          type="button"
                          class="vk-copy"
                          (click)="copyAndLocate(detail, variant)"
                        >
                          <small>{{ labelFor(detail) }}</small>
                          <strong [class.mono]="isCodeLike(detail)">
                            {{ displayValue(detail, variant.value) }}
                          </strong>
                        </button>

                        <div class="vk-detail-actions">
                          @if (variant.sourceId && variant.locator) {
                            <button
                              type="button"
                              class="vk-icon-btn"
                              [attr.title]="tr('vkShowInDocument', 'Show in document')"
                              [attr.aria-label]="tr('vkShowInDocument', 'Show in document') + ': ' + labelFor(detail)"
                              (click)="show(variant)"
                            >
                              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                                <rect
                                  x="2.2"
                                  y="2.2"
                                  width="11.6"
                                  height="11.6"
                                  rx="2"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="1.35"
                                />
                                <rect
                                  x="4.6"
                                  y="5.2"
                                  width="6.8"
                                  height="3.2"
                                  rx="0.8"
                                  fill="currentColor"
                                  opacity="0.35"
                                />
                              </svg>
                            </button>
                          }
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
                                <svg
                                  viewBox="0 0 16 16"
                                  width="15"
                                  height="15"
                                  aria-hidden="true"
                                >
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
                                <svg
                                  viewBox="0 0 16 16"
                                  width="15"
                                  height="15"
                                  aria-hidden="true"
                                >
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
                          }
                          <details class="vk-more">
                            <summary [attr.aria-label]="tr('vkMoreActions', 'More actions') + ': ' + labelFor(detail)">
                              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                                <circle cx="3.2" cy="8" r="1.25" fill="currentColor" />
                                <circle cx="8" cy="8" r="1.25" fill="currentColor" />
                                <circle cx="12.8" cy="8" r="1.25" fill="currentColor" />
                              </svg>
                            </summary>
                            <div class="vk-menu">
                              @if (editable()) {
                                <button
                                  type="button"
                                  [disabled]="busy()"
                                  (click)="
                                    edit({
                                      kind: 'rule',
                                      detailId: detail.id,
                                      rule: rule(detail) === 'never' ? 'ask' : 'never',
                                    })
                                  "
                                >
                                  {{
                                    rule(detail) === "never"
                                      ? tr("vkRuleLetAgentsFill", "Let AI agents fill this")
                                      : tr("vkRuleDontFillAgents", "Don't let AI agents fill this")
                                  }}
                                </button>
                              }
                              <button
                                type="button"
                                (click)="openLargeType(detail, variant, $event)"
                              >
                                {{ tr("vkLargeType", "Large type") }}
                              </button>
                              @if (editable()) {
                                <button
                                  type="button"
                                  class="danger"
                                  (click)="deleteDetail(detail)"
                                >
                                  {{ tr("vkDeleteDetail", "Delete detail") }}
                                </button>
                              }
                            </div>
                          </details>
                        </div>

                        @if (editing()?.detailId === detail.id) {
                          <form
                            class="vk-editor vk-correct"
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

                        @for (alternative of detail.variants; track alternative.id) {
                          @if (alternative.current && alternative.id !== variant.id) {
                            <div class="vk-variant">
                              <span>
                                <small>{{ tr("vkAlsoFound", "Also found") }}</small>
                                <b>{{ alternative.value }}</b>
                                <small>{{ alternative.script || sourceName(alternative) }}</small>
                              </span>
                              @if (editable()) {
                                <button
                                  type="button"
                                  class="vk-link-btn"
                                  [disabled]="busy()"
                                  (click)="
                                    edit({
                                      kind: 'choose',
                                      detailId: detail.id,
                                      variantId: alternative.id,
                                    })
                                  "
                                >
                                  {{ tr("vkUseThis", "Use this") }}
                                </button>
                              }
                            </div>
                          }
                        }
                      </article>
                    }
                  }
                </div>
              </section>
            } @empty {
              <p class="vk-empty">{{ tr("vkNoDetailsSavedYet", "No details saved yet.") }}</p>
            }

            @if (editable()) {
              <details class="vk-new-detail" [open]="startAdding() || visibleDetails().length === 0">
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
      @if (largeType(); as lt) {
        <div class="vk-large-backdrop" (click)="closeLargeType()">
          <div
            class="vk-large-dialog"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="lt.label"
            (click)="$event.stopPropagation()"
          >
            <header class="vk-large-head">
              <strong>{{ lt.label }}</strong>
              <div class="vk-large-actions">
                <button type="button" class="vk-btn" (click)="copyLargeType(lt.value)">
                  {{ tr("copy", "Copy") }}
                </button>
                <button type="button" class="vk-btn" (click)="closeLargeType()">
                  {{ tr("close", "Close") }}
                </button>
              </div>
            </header>
            <div class="vk-large-groups">
              @for (group of lt.groups; track $index) {
                <div class="vk-large-group">
                  @for (cell of group; track cell.idx) {
                    <span class="vk-large-cell" [attr.data-kind]="cell.kind">
                      <b>{{ cell.ch }}</b>
                      <small>{{ cell.idx }}</small>
                    </span>
                  }
                </div>
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
      }
      button,
      summary,
      select {
        cursor: pointer;
      }
      button:disabled {
        cursor: default;
        opacity: 0.55;
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
        padding: 9px 12px;
        border-radius: 9px;
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
        padding: 9px 12px;
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
      .vk-workspace {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 22px;
        align-items: start;
      }
      .vk-workspace.has-docs {
        grid-template-columns: minmax(260px, 0.94fr) minmax(300px, 1.06fr);
      }
      .vk-doc-pane {
        position: sticky;
        top: 0;
        min-width: 0;
        padding: 12px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 24%));
        border-radius: 14px;
        background: var(--vk-paper, rgb(var(--color-background, 255 255 255)));
      }
      .vk-doc-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }
      .vk-source-pills {
        display: flex;
        flex: 1;
        gap: 6px;
        min-width: 0;
        overflow-x: auto;
      }
      .vk-source-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 220px;
        padding: 6px 11px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 24%));
        border-radius: 8px;
        background: transparent;
        font-size: 12.5px;
        font-weight: 500;
        white-space: nowrap;
      }
      .vk-source-pill.selected {
        border-color: transparent;
        background: var(--vk-selected, rgb(148 163 184 / 20%));
        font-weight: 600;
      }
      .vk-source-name {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .vk-source-pill small {
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 11px;
      }
      .vk-reader {
        min-width: 0;
      }
      .vk-move-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 8px;
        margin-bottom: 10px;
        font-size: 12.5px;
      }
      .vk-page {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 22%));
        border-radius: 10px;
        background: var(--vk-hover, rgb(148 163 184 / 12%));
        line-height: 0;
      }
      .vk-page img,
      .vk-page canvas {
        display: block;
        width: 100%;
        height: auto;
      }
      .vk-box {
        position: absolute;
        box-sizing: border-box;
        border: 2px solid var(--vk-accent, #2563eb);
        border-radius: 4px;
        background: rgb(37 99 235 / 18%);
        box-shadow: 0 0 0 3px rgb(37 99 235 / 14%);
        pointer-events: none;
      }
      .vk-pager {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 10px;
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 12px;
      }
      .vk-doc-caption {
        margin: 8px 0 0;
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 12px;
      }
      .vk-doc-placeholder {
        padding: 28px 16px;
        border-radius: 10px;
        background: var(--vk-hover, rgb(148 163 184 / 10%));
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 13px;
        text-align: center;
        line-height: 1.45;
      }
      .vk-details-pane {
        min-width: 0;
      }
      .vk-group {
        margin-bottom: 18px;
      }
      .vk-group-title {
        margin: 0 4px 6px;
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .vk-group-card {
        border: 1px solid var(--vk-line, rgb(148 163 184 / 24%));
        border-radius: 12px;
        background: var(--vk-paper, rgb(var(--color-background, 255 255 255)));
      }
      .vk-detail {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        border-bottom: 1px solid var(--vk-line, rgb(148 163 184 / 18%));
      }
      .vk-detail:last-child {
        border-bottom: 0;
      }
      .vk-detail.located {
        background: var(--vk-selected, rgb(37 99 235 / 8%));
      }
      .vk-copy {
        min-width: 0;
        padding: 11px 14px;
        border: 0;
        background: none;
        text-align: left;
      }
      .vk-copy:hover {
        background: var(--vk-hover, rgb(148 163 184 / 8%));
      }
      .vk-copy small,
      .vk-copy strong,
      .vk-variant small {
        display: block;
      }
      .vk-copy small {
        margin-bottom: 2px;
        color: var(--vk-blue, #2563eb);
        font-size: 12.5px;
        font-weight: 500;
      }
      .vk-variant small {
        margin-bottom: 2px;
        color: var(--vk-muted, rgb(148 163 184));
        font-size: 12px;
      }
      .vk-copy strong {
        font-size: 14.5px;
        font-weight: 500;
        overflow-wrap: anywhere;
      }
      .vk-copy strong.mono {
        font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
        font-size: 13.5px;
        letter-spacing: 0.01em;
      }
      .vk-detail-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        padding-right: 8px;
      }
      .vk-icon-btn,
      .vk-more > summary {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 7px;
        background: none;
        color: var(--vk-muted, inherit);
        list-style: none;
      }
      .vk-more > summary::-webkit-details-marker {
        display: none;
      }
      .vk-icon-btn:hover,
      .vk-more > summary:hover {
        background: var(--vk-hover, rgb(148 163 184 / 14%));
        color: var(--vk-ink, inherit);
      }
      .vk-more {
        position: relative;
      }
      .vk-menu {
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        z-index: 10;
        min-width: 220px;
        padding: 6px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 28%));
        border-radius: 10px;
        background: var(--vk-paper, rgb(var(--color-background, 255 255 255)));
        box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
      }
      .vk-menu button,
      .vk-menu label {
        display: block;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: 7px;
        background: none;
        font-size: 13px;
        text-align: left;
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
      .vk-file-action input {
        display: block;
        max-width: 200px;
        margin-top: 5px;
        font-size: 12px;
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
        padding: 12px 14px;
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
        padding: 7px 12px;
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
      .vk-variant {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 14px 10px 20px;
        border-top: 1px dashed var(--vk-line, rgb(148 163 184 / 16%));
      }
      .vk-variant > span {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 8px;
      }
      .vk-variant > span {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .vk-variant b {
        font-size: 13.5px;
        font-weight: 500;
      }
      .vk-link-btn {
        border: 0;
        background: none;
        color: var(--vk-accent, #2563eb);
        font-size: 12.5px;
        font-weight: 500;
      }
      .history {
        opacity: 0.78;
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
      }
      .vk-new-detail summary {
        font-size: 13.5px;
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
      .vk-large-backdrop {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(15 23 42 / 56%);
        backdrop-filter: blur(4px);
      }
      .vk-large-dialog {
        width: min(760px, 100%);
        max-height: calc(100vh - 48px);
        overflow: auto;
        border-radius: 14px;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 28%));
        background: var(--vk-surface, #ffffff);
        color: var(--vk-ink, #0f172a);
        box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
        padding: 18px 22px 24px;
      }
      .vk-large-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }
      .vk-large-head strong {
        font-size: 14px;
        font-weight: 600;
        color: var(--vk-muted, #64748b);
      }
      .vk-large-actions {
        display: flex;
        gap: 8px;
      }
      .vk-large-groups {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
      }
      .vk-large-group {
        display: inline-flex;
        border: 1px solid var(--vk-line, rgb(148 163 184 / 24%));
        border-radius: 10px;
        overflow: hidden;
        background: var(--vk-hover, rgb(148 163 184 / 8%));
      }
      .vk-large-cell {
        display: grid;
        justify-items: center;
        gap: 4px;
        min-width: 40px;
        padding: 10px 8px 7px;
        border-right: 1px solid var(--vk-line, rgb(148 163 184 / 16%));
      }
      .vk-large-cell:last-child {
        border-right: 0;
      }
      .vk-large-cell b {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 28px;
        line-height: 1.15;
        font-weight: 600;
      }
      .vk-large-cell[data-kind="digit"] b {
        color: var(--vk-accent, #2563eb);
      }
      .vk-large-cell[data-kind="symbol"] b {
        color: var(--vk-muted, #64748b);
      }
      .vk-large-cell small {
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: var(--vk-muted, #64748b);
      }
      @media (max-width: 820px) {
        .vk-workspace.has-docs {
          grid-template-columns: 1fr;
        }
        .vk-doc-pane {
          position: static;
        }
      }
    `,
  ],
})
export class ProfileComponent implements OnDestroy {
  readonly cipher = input.required<CipherView>();
  readonly initialSourceId = input<string | null>(null);
  readonly initialVariantId = input<string | null>(null);
  readonly startAdding = input<boolean>(false);
  readonly largeType = signal<{
    label: string;
    value: string;
    groups: { ch: string; idx: number; kind: "digit" | "symbol" | "letter" }[][];
  } | null>(null);
  private readonly profiles = new ProfileService(
    inject(AccountService),
    inject(CipherService),
    inject(LocalVaultService, { optional: true }),
    inject(CipherSdkService),
  );
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
  readonly visibleDetails = computed(
    () =>
      this.meta()?.details.filter(
        (detail) => !isHiddenValueType(detail.valueType) || this.current()?.viewPassword !== false,
      ) ?? [],
  );
  readonly groupedDetails = computed<DetailGroup[]>(() => {
    this.localeTick();
    const buckets = new Map<string, { id: string; title: string; order: number; details: ProfileDetail[] }>();
    for (const detail of this.visibleDetails()) {
      if (!this.winner(detail)) {
        continue;
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
  readonly maskedIds = signal<Set<string>>(new Set());
  readonly teachableTypes: readonly { attribute: string; label: string }[] = [
    { attribute: "name.full", label: "Full name" },
    { attribute: "name.family", label: "Family name" },
    { attribute: "name.given", label: "Given name" },
    { attribute: "birth.date", label: "Date of birth" },
    { attribute: "person.sex", label: "Sex / Gender" },
    { attribute: "person.nationality", label: "Nationality" },
    { attribute: "address.full", label: "Current address" },
    { attribute: "address.postal", label: "Postal code" },
    { attribute: "address.registered_domicile", label: "Registered domicile" },
    { attribute: "contact.phone", label: "Phone number" },
    { attribute: "contact.email", label: "Email address" },
    { attribute: "id.passport.number", label: "Passport number" },
    { attribute: "id.residence_card.number", label: "Residence card number" },
    { attribute: "id.mynumber", label: "National ID number" },
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
  readonly documentDetails = computed(() =>
    this.visibleDetails().flatMap((detail) =>
      [...detail.variants, ...detail.history.map((entry) => entry.variant)]
        .filter((variant) => variant.sourceId === this.selectedSource()?.id)
        .map((variant) => ({ detail, variant })),
    ),
  );
  newLabel = "";
  newValue = "";
  newType: ValueType = "text";
  private pdf: PDFDocumentProxy | null = null;
  private pdfLoading: PDFDocumentLoadingTask | null = null;
  private rendering: RenderTask | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private objectUrl: string | null = null;
  private readonly downloads = new Set<string>();
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
      untracked(() => {
        this.inputEpoch++;
        this.current.set(cipher);
        this.resetReader();
        this.busy.set(false);
        this.error.set("");
        this.message.set("");
        this.editing.set(null);
        this.tab.set("details");
        this.activeVariantId.set(variantId ?? null);
        const meta = readEnvelope(cipher);
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
        if (source != null) {
          void this.openSource(source, variant?.locator ?? null);
        }
        void this.refreshOperations();
      });
    });
  }

  ngOnDestroy(): void {
    this.localeSub?.unsubscribe();
    this.inputEpoch++;
    this.resetReader();
    for (const url of this.downloads) {
      URL.revokeObjectURL(url);
    }
    this.downloads.clear();
  }

  @HostListener("document:keydown.escape", ["$event"])
  onEscapeKey(event: Event): void {
    if (this.largeType() != null) {
      event.preventDefault();
      this.closeLargeType();
    }
  }

  openLargeType(detail: ProfileDetail, variant: DetailVariant, event?: Event): void {
    (event?.currentTarget as HTMLElement | null)?.closest("details")?.removeAttribute("open");
    const chars = Array.from(variant.value).map((ch, i) => ({
      ch: ch === " " ? "␣" : ch,
      idx: i + 1,
      kind: (/\d/.test(ch)
        ? "digit"
        : /[\p{L}\p{M}]/u.test(ch)
          ? "letter"
          : "symbol") as "digit" | "symbol" | "letter",
    }));
    const groups: { ch: string; idx: number; kind: "digit" | "symbol" | "letter" }[][] = [];
    for (let i = 0; i < chars.length; i += 4) {
      groups.push(chars.slice(i, i + 4));
    }
    this.largeType.set({
      label: this.labelFor(detail),
      value: variant.value,
      groups,
    });
  }

  closeLargeType(): void {
    this.largeType.set(null);
  }

  copyLargeType(value: string): void {
    this.platform.copyToClipboard(value);
    this.platform.showToast("info", "", this.tr("valueCopied", "Copied"));
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
      if (!detail.label || detail.label === canonicalEn) {
        return this.tr(ATTRIBUTE_I18N_KEYS[attr], fallback);
      }
    }
    return fallback;
  }

  cleanSourceName(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, "") || fileName;
  }

  isCodeLike(detail: ProfileDetail): boolean {
    const attr = detail.attribute ?? "";
    return (
      detail.valueType === "number" ||
      isHiddenValueType(detail.valueType) ||
      /^(?:id\.|bank\.account\.number|tax\.|address\.postal)/.test(attr)
    );
  }

  isActiveVariant(variant: DetailVariant): boolean {
    return this.activeVariantId() != null && this.activeVariantId() === variant.id;
  }

  winner(detail: ProfileDetail): DetailVariant | null {
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

  sourceName(variant: DetailVariant): string {
    const source = this.meta()?.sources.find((entry) => entry.id === variant.sourceId);
    return source == null
      ? this.tr("vkEnteredByHand", "Entered by hand")
      : source.status === "deleted"
        ? `${source.fileName} (${this.tr("vkDeleted", "deleted")})`
        : source.fileName;
  }

  copy(detail: ProfileDetail, variant: DetailVariant): void {
    if (isHiddenValueType(detail.valueType) && this.current()?.viewPassword === false) {
      return;
    }
    this.platform.copyToClipboard(variant.value);
    const label = this.labelFor(detail);
    this.message.set(this.tr("vkCopiedItem", `Copied ${label}`, label));
  }

  copyAndLocate(detail: ProfileDetail, variant: DetailVariant): void {
    this.copy(detail, variant);
    if (variant.sourceId) {
      void this.show(variant);
    }
  }

  beginEdit(detail: ProfileDetail, variant: DetailVariant, event: Event): void {
    (event.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
    this.editing.set({ detailId: detail.id, variantId: variant.id });
    this.correction.set(variant.value);
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

  async show(variant: DetailVariant): Promise<void> {
    this.activeVariantId.set(variant.id);
    const source = this.meta()?.sources.find((entry) => entry.id === variant.sourceId);
    if (!source) {
      return;
    }
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
    this.preview.set("");
    this.pdfVisible.set(false);
    this.loading.set(false);
    this.selectedSource.set(null);
    this.selectedLocator.set(null);
    this.pageCount.set(1);
    this.page.set(0);
  }

  async openSource(source: ProfileSource, locator: Locator | null = null): Promise<void> {
    this.resetReader();
    this.tab.set("documents");
    this.selectedSource.set(source);
    this.selectedLocator.set(locator);
    this.error.set("");
    this.destinations.set([]);
    if (source.status === "deleted" || source.attachmentId == null) {
      return;
    }
    const generation = this.generation;
    this.loading.set(true);
    try {
      const bytes = await this.profiles.bytes(this.current()!.id, source.id);
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
      } else if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(source.mediaType)) {
        this.objectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(bytes).buffer], { type: source.mediaType }),
        );
        this.preview.set(this.objectUrl);
      }
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
  }

  download(): void {
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

  async pickDestination(): Promise<void> {
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

  async removeSource(): Promise<void> {
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

  async replace(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const source = this.selectedSource();
    if (!file || !source || !this.actions) {
      return;
    }
    await this.documentAction(() => this.actions!.replace(this.current()!.id, source.id, file));
    input.value = "";
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
