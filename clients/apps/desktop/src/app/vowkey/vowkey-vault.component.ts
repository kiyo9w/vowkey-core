import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom, of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import {
  buildSampleProfileCipher,
  fillPracticeFormFromSample,
  isSampleProfile,
  localizeSampleScenario,
  parseSampleScenarioId,
  SAMPLE_SCENARIO_LIST,
  sampleScenarioOf,
  SampleScenarioId,
} from "@vowkey/common/vault/profile/sample-walkthrough";
import { readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherId } from "@vowkey/common/types/guid";
import { DialogService, MenuModule } from "@vowkey/components";
import { Cipher as SdkCipher } from "@vowkey/sdk-internal";
import { I18nPipe } from "@vowkey/ui-common";
import {
  CipherFormConfig,
  CipherFormConfigService,
  CipherFormModule,
  CipherViewComponent,
  DefaultCipherFormConfigService,
  ProfileComponent,
  VaultItemDialogComponent,
} from "@vowkey/vault";

import { VowkeyGlyphComponent } from "./vowkey-glyph.component";
import { VowkeyHub } from "./vowkey-hub.service";
import { LibraryRow, LibraryShow, LibrarySort, VowkeyLibrary } from "./vowkey-library.service";

const TITLES: Record<LibraryShow, string> = {
  all: "vkAllItems",
  pinned: "vkPinned",
  profiles: "vkProfiles",
  documents: "vkDocuments",
  logins: "vkLogins",
  cards: "vkCards",
  keys: "vkKeys",
  environments: "vkEnvironments",
  expiring: "vkExpiring",
  trash: "vkRecentlyDeleted",
};

const NEW_ITEMS: {
  type: CipherType;
  label: string;
  glyph: "person" | "globe" | "card" | "key" | "layers";
}[] = [
  { type: CipherType.Identity, label: "vkProfile", glyph: "person" },
  { type: CipherType.Login, label: "vkLogin", glyph: "globe" },
  { type: CipherType.Card, label: "vkCard", glyph: "card" },
  { type: CipherType.ApiKey, label: "vkKey", glyph: "key" },
  { type: CipherType.Environment, label: "vkEnvironment", glyph: "layers" },
];

/** Search and browse on the left, the chosen item on the right, in one window. */
@Component({
  selector: "vk-vault",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    I18nPipe,
    MenuModule,
    VowkeyGlyphComponent,
    CipherFormModule,
    CipherViewComponent,
    ProfileComponent,
  ],
  providers: [{ provide: CipherFormConfigService, useClass: DefaultCipherFormConfigService }],
  template: `
    <div class="vk-page">
      <header class="vk-toolbar">
        <div class="vk-history">
          <button
            type="button"
            class="vk-icon"
            (click)="history(-1)"
            [attr.aria-label]="'back' | i18n"
          >
            <vk-glyph name="back" />
          </button>
          <button
            type="button"
            class="vk-icon"
            (click)="history(1)"
            [attr.aria-label]="'next' | i18n"
          >
            <vk-glyph name="forward" />
          </button>
        </div>
        <label class="vk-search">
          <vk-glyph name="search" [size]="16" />
          <input
            #search
            type="search"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            [placeholder]="'vkSearchPlaceholder' | i18n"
            [attr.aria-label]="'vkSearchPlaceholder' | i18n"
            autocomplete="off"
            data-testid="vowkey-search"
          />
          <kbd>{{ shortcut }}</kbd>
        </label>
        <div class="vk-new">
          <button
            type="button"
            class="vk-secondary"
            data-testid="vowkey-toolbar-fill-form"
            (click)="fillForm()"
          >
            <vk-glyph name="form" [size]="16" />{{ "vkFillForm" | i18n }}
          </button>
          <button
            type="button"
            class="vk-primary"
            [bitMenuTriggerFor]="newMenu"
            menuPosition="below-end"
            data-testid="vowkey-new"
          >
            <vk-glyph name="plus" [size]="16" />{{ "vkNew" | i18n }}
          </button>
          <bit-menu #newMenu>
            <button
              type="button"
              bitMenuItem
              data-testid="vowkey-new-document"
              (click)="addDocument()"
            >
              <vk-glyph slot="start" name="document" [size]="16" />{{ "vkDocument" | i18n }}
            </button>
            <button
              type="button"
              bitMenuItem
              data-testid="vowkey-new-fill-form"
              (click)="fillForm()"
            >
              <vk-glyph slot="start" name="form" [size]="16" />{{ "vkFillFormMenu" | i18n }}
            </button>
            <bit-menu-divider />
            @for (entry of newItems; track entry.type) {
              <button type="button" bitMenuItem (click)="add(entry.type)">
                <vk-glyph slot="start" [name]="entry.glyph" [size]="16" />{{ entry.label | i18n }}
              </button>
            }
          </bit-menu>
        </div>
      </header>

      @if (sampleProfiles().length > 0) {
        <div class="vk-wt-strip" data-testid="vowkey-walkthrough-bar">
          <div class="vk-wt-left">
            <span class="vk-wt-badge">{{ "vkSampleBadge" | i18n }}</span>
            <div class="vk-wt-steps" role="tablist">
              <button
                type="button"
                role="tab"
                [class.on]="!practiceMode()"
                [attr.aria-selected]="!practiceMode()"
                data-testid="vowkey-wt-step-details"
                (click)="openSampleDetails()"
              >
                {{ "vkWtStepDetails" | i18n }}
              </button>
              <button
                type="button"
                role="tab"
                [class.on]="practiceMode()"
                [attr.aria-selected]="practiceMode()"
                data-testid="vowkey-wt-step-form"
                (click)="openPracticeForm()"
              >
                {{ "vkWtStepForm" | i18n }}
              </button>
            </div>
            <div class="vk-wt-scenarios">
              @for (scenario of sampleScenarios; track scenario.id) {
                <button
                  type="button"
                  class="vk-wt-doc"
                  [class.on]="activeSampleScenario()?.id === scenario.id"
                  (click)="trySample(scenario.id)"
                >
                  {{ sampleLabelKey(scenario.id) | i18n }}
                </button>
              }
            </div>
          </div>
          <div class="vk-wt-right">
            <button
              type="button"
              class="vk-wt-action"
              data-testid="vowkey-wt-open-quickbar"
              (click)="openQuickBar()"
            >
              {{ "vkWtOpenQuickBar" | i18n }} <kbd>{{ quickBarShortcut }}</kbd>
            </button>
            <button
              type="button"
              class="vk-wt-clear"
              data-testid="vowkey-clear-sample"
              (click)="clearSamples()"
            >
              {{ "vkWtClearSample" | i18n }}
            </button>
          </div>
        </div>
      }

      @if (library.rows().length === 0 && show() === "all" && !query() && !localFormConfig()) {
        <section class="vk-empty" aria-live="polite">
          <h1>{{ "vkNothingSavedYet" | i18n }}</h1>
          <p>{{ "vkEmptyBody" | i18n }}</p>
          <div class="vk-empty-actions">
            <button type="button" class="vk-primary" (click)="addDocument()">
              {{ "vkAddDocument" | i18n }}
            </button>
            <button
              type="button"
              class="vk-secondary"
              data-testid="vowkey-empty-fill-form"
              (click)="fillForm()"
            >
              <vk-glyph name="form" [size]="16" />{{ "vkFillForm" | i18n }}
            </button>
            <button type="button" class="vk-secondary" (click)="add(loginType)">
              {{ "vkLogin" | i18n }}
            </button>
            <button type="button" class="vk-secondary" (click)="add(identity)">
              {{ "vkEnterDetails" | i18n }}
            </button>
          </div>
          <div class="vk-sample-card">
            <div class="vk-sample-head">
              <span class="vk-sample-tag">{{ "vkSampleBadge" | i18n }}</span>
              <strong>{{ "vkTryWithSample" | i18n }}</strong>
            </div>
            <p class="vk-sample-sub">{{ "vkTryWithSampleSub" | i18n }}</p>
            <div class="vk-sample-picks">
              @for (scenario of sampleScenarios; track scenario.id) {
                <button
                  type="button"
                  class="vk-sample-pick"
                  [attr.data-testid]="'vowkey-try-sample-' + scenario.id"
                  (click)="trySample(scenario.id)"
                >
                  <vk-glyph name="document" [size]="15" />
                  <span>{{ sampleLabelKey(scenario.id) | i18n }}</span>
                </button>
              }
            </div>
          </div>
        </section>
      } @else {
        <div class="vk-body">
          <section class="vk-list" [attr.aria-label]="title()">
            <header class="vk-list-head">
              <h1>{{ title() }}</h1>
              <span class="vk-total">{{ rows().length }}</span>
              <div class="vk-sort">
                <button
                  type="button"
                  class="vk-icon"
                  [attr.aria-label]="'vkSortBy' | i18n"
                  [bitMenuTriggerFor]="sortMenu"
                  menuPosition="below-end"
                >
                  <vk-glyph name="sort" />
                </button>
                <bit-menu #sortMenu>
                  @for (option of sorts; track option.value) {
                    <button
                      type="button"
                      bitMenuItem
                      role="menuitemradio"
                      [attr.aria-checked]="sort() === option.value"
                      (click)="sort.set(option.value)"
                    >
                      {{ option.label | i18n }}
                    </button>
                  }
                </bit-menu>
              </div>
            </header>
            <ul class="vk-rows" role="listbox" [attr.aria-label]="title()">
              @for (row of rows(); track row.key) {
                <li>
                  <button
                    type="button"
                    role="option"
                    class="vk-row"
                    [class.on]="row.key === selected()?.key"
                    [attr.aria-selected]="row.key === selected()?.key"
                    (click)="select(row)"
                    (dblclick)="edit(row)"
                  >
                    <span class="vk-lead" [class.person]="row.kind === 'profile'"
                      ><vk-glyph [name]="row.glyph" [size]="20"
                    /></span>
                    <span class="vk-text">
                      <b>{{ row.title }}</b>
                      <small [class.amber]="row.expired">{{ row.subtitle }}</small>
                    </span>
                    @if (row.pinned) {
                      <vk-glyph name="bookmark" [size]="14" />
                    }
                  </button>
                </li>
              } @empty {
                <li class="vk-none">{{ "vkNoMatches" | i18n }}</li>
              }
            </ul>
          </section>

          <section class="vk-detail" [attr.aria-label]="selected()?.title">
            @if (localFormConfig(); as formConfig) {
              <header class="vk-detail-head">
                <div class="vk-head-text">
                  <h2>
                    {{
                      formConfig.mode === "add"
                        ? ("vkNew" | i18n)
                        : (cipher()?.name ?? ("vkEdit" | i18n))
                    }}
                  </h2>
                </div>
                <div class="vk-head-actions">
                  <button type="button" class="vk-secondary" (click)="cancelLocalForm()">
                    {{ "cancel" | i18n }}
                  </button>
                  <button type="submit" class="vk-primary" form="vk-local-item-form">
                    {{ "save" | i18n }}
                  </button>
                </div>
              </header>
              <div class="vk-detail-body">
                <vault-cipher-form
                  formId="vk-local-item-form"
                  [config]="formConfig"
                  (cipherSaved)="onLocalSaved($event)"
                />
              </div>
            } @else if (practiceMode() && activeSample() && activeSampleScenario(); as spec) {
              <header class="vk-detail-head">
                <span class="vk-lead big"><vk-glyph name="document" [size]="28" /></span>
                <div class="vk-head-text">
                  <h2>{{ spec.practiceFormTitle }}</h2>
                  <p>{{ spec.practiceFormSubtitle }}</p>
                </div>
                <div class="vk-head-actions">
                  @if (practiceFilled()) {
                    <button type="button" class="vk-secondary" (click)="resetPracticeFields()">
                      {{ "vkWtClearFields" | i18n }}
                    </button>
                  }
                  <button
                    type="button"
                    class="vk-primary"
                    data-testid="vowkey-practice-fill"
                    (click)="fillPracticeForm()"
                  >
                    {{ "vkWtFillNow" | i18n }}
                  </button>
                </div>
              </header>
              <div class="vk-detail-body">
                <div class="vk-practice-card" data-testid="vowkey-practice-form">
                  <div class="vk-pf-grid">
                    @for (field of spec.fields; track field.key) {
                      <label class="vk-pf-field" [class.wide]="field.wide">
                        <span class="vk-pf-label">
                          <span>{{ field.practiceFieldLabel }}</span>
                          @if (practiceValues()[field.key]) {
                            <em class="vk-pf-src">{{ "vkSampleBadge" | i18n }}</em>
                          }
                        </span>
                        <input
                          type="text"
                          [class.filled]="!!practiceValues()[field.key]"
                          [attr.data-testid]="'vowkey-pf-' + field.key"
                          [ngModel]="practiceValues()[field.key] ?? ''"
                          (ngModelChange)="setPracticeValue(field.key, $event)"
                        />
                      </label>
                    }
                    <label class="vk-pf-field wide">
                      <span class="vk-pf-label">
                        <span>{{ spec.humanFieldLabel }}</span>
                        <em class="vk-pf-human">{{ "vkWtNeedsYou" | i18n }}</em>
                      </span>
                      <input
                        type="text"
                        data-testid="vowkey-pf-human"
                        [placeholder]="spec.humanFieldPlaceholder"
                        [ngModel]="practiceHumanValue()"
                        (ngModelChange)="practiceHumanValue.set($event)"
                      />
                    </label>
                  </div>
                  @if (practiceFilled()) {
                    <div class="vk-pf-status" data-testid="vowkey-practice-status">
                      <span>{{ practiceSummary() }}</span>
                      <button type="button" class="vk-secondary" (click)="openSampleDetails()">
                        {{ "vkWtBackToDetails" | i18n }}
                      </button>
                    </div>
                  }
                </div>
              </div>
            } @else if (cipher(); as current) {
              <header class="vk-detail-head">
                <span class="vk-lead big" [class.person]="selected()?.kind === 'profile'"
                  ><vk-glyph [name]="selected()!.glyph" [size]="28"
                /></span>
                <div class="vk-head-text">
                  <h2>{{ selected()!.title }}</h2>
                  <p>{{ selected()!.subtitle }}</p>
                </div>
                <div class="vk-head-actions">
                  @if (current.isDeleted) {
                    <button type="button" class="vk-secondary" (click)="restore()">
                      {{ "vkRestore" | i18n }}
                    </button>
                    <button type="button" class="vk-secondary danger" (click)="deleteForGood()">
                      {{ "vkDeleteForGood" | i18n }}
                    </button>
                  } @else {
                    @if (current.type === identity) {
                      <button
                        type="button"
                        class="vk-secondary"
                        data-testid="vowkey-detail-fill-form"
                        (click)="fillForm()"
                      >
                        <vk-glyph name="form" [size]="15" />{{ "vkFillForm" | i18n }}
                      </button>
                    } @else if (canQuickCopy(current)) {
                      <button type="button" class="vk-secondary" (click)="quickCopy(current)">
                        <vk-glyph name="copy" [size]="15" />{{ quickCopyLabel(current) }}
                      </button>
                    }
                    <button
                      type="button"
                      class="vk-secondary"
                      data-testid="vowkey-detail-edit"
                      (click)="edit(selected()!)"
                    >
                      <vk-glyph name="pencil" [size]="15" />{{ "vkEdit" | i18n }}
                    </button>
                    <button
                      type="button"
                      class="vk-secondary vk-more-btn"
                      [bitMenuTriggerFor]="detailMenu"
                      menuPosition="below-end"
                      [attr.aria-label]="'vkMoreActions' | i18n"
                      data-testid="vowkey-detail-more"
                    >
                      <vk-glyph name="more" [size]="18" />
                    </button>
                    <bit-menu #detailMenu>
                      @if (isSample(current)) {
                        <button
                          type="button"
                          bitMenuItem
                          data-testid="vowkey-open-practice"
                          (click)="openPracticeForm()"
                        >
                          <vk-glyph slot="start" name="form" [size]="16" />{{
                            "vkWtStepForm" | i18n
                          }}
                        </button>
                      }
                      <button
                        type="button"
                        bitMenuItem
                        data-testid="vowkey-detail-pin"
                        (click)="togglePin(current)"
                      >
                        <vk-glyph slot="start" name="bookmark" [size]="16" />{{
                          (current.favorite ? "vkUnpin" : "vkPin") | i18n
                        }}
                      </button>
                      <bit-menu-divider />
                      <button
                        type="button"
                        bitMenuItem
                        class="vk-menu-danger"
                        data-testid="vowkey-detail-delete"
                        (click)="deleteCurrentItem(current)"
                      >
                        <vk-glyph slot="start" name="trash" [size]="16" />{{ "delete" | i18n }}
                      </button>
                    </bit-menu>
                  }
                </div>
              </header>
              <div class="vk-detail-body">
                @if (readsAsProfile()) {
                  <app-profile
                    [cipher]="current"
                    [initialSourceId]="
                      selected()?.kind === 'document' ? selected()!.sourceId : null
                    "
                  />
                } @else {
                  <app-cipher-view
                    [cipher]="current"
                    [hideItemHistory]="library.account() == null"
                  />
                }
              </div>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .vk-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        color: var(--vk-ink);
      }
      .vk-toolbar {
        display: flex;
        flex: none;
        align-items: center;
        gap: 12px;
        height: 56px;
        padding: 0 16px;
        border-bottom: 1px solid var(--vk-line);
        -webkit-app-region: drag;
      }
      :host-context(.win .vk-main) .vk-toolbar {
        padding-right: 150px;
      }
      .vk-toolbar button,
      .vk-toolbar label {
        -webkit-app-region: no-drag;
      }
      .vk-history {
        display: flex;
        gap: 2px;
      }
      .vk-icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-muted);
        cursor: pointer;
      }
      .vk-icon:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-search {
        display: flex;
        flex: 0 1 360px;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 10px;
        border-radius: var(--vk-radius-control);
        background: var(--vk-selected);
        color: var(--vk-muted);
      }
      .vk-search:focus-within {
        outline: 2px solid var(--vk-ink);
        outline-offset: 1px;
      }
      .vk-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: none;
        color: var(--vk-ink);
        font: inherit;
        font-size: 15px;
      }
      .vk-search input::placeholder {
        color: var(--vk-muted);
      }
      .vk-search kbd {
        padding: 1px 6px;
        border-radius: 6px;
        background: var(--vk-hover);
        font: inherit;
        font-size: 12px;
      }
      .vk-new {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      .vk-primary,
      .vk-secondary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 14px;
        border: 1px solid transparent;
        border-radius: var(--vk-radius-control);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      }
      .vk-more-btn {
        width: 34px;
        padding: 0;
        justify-content: center;
      }
      .vk-menu-danger {
        color: var(--vk-red) !important;
      }
      .vk-primary {
        background: var(--vk-blue);
        color: #fff;
      }
      .vk-primary:hover {
        background: var(--vk-blue-ink);
      }
      .vk-secondary {
        border-color: var(--vk-line);
        background: var(--vk-surface);
        color: var(--vk-ink);
        font-weight: 500;
      }
      .vk-secondary:hover {
        background: var(--vk-hover);
      }
      .vk-secondary.danger {
        color: var(--vk-red);
      }
      .vk-primary:focus-visible,
      .vk-secondary:focus-visible,
      .vk-icon:focus-visible,
      .vk-row:focus-visible {
        outline: 2px solid var(--vk-ink);
        outline-offset: 2px;
      }
      .vk-body {
        display: grid;
        grid-template-columns: minmax(260px, 314px) minmax(0, 1fr);
        flex: 1;
        min-height: 0;
      }
      .vk-list {
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-right: 1px solid var(--vk-line);
      }
      .vk-list-head {
        position: relative;
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        height: 52px;
        padding: 0 8px 0 18px;
      }
      .vk-list-head h1 {
        margin: 0;
        overflow: hidden;
        font-size: 16px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-total {
        color: var(--vk-muted);
        font-size: 15px;
      }
      .vk-sort {
        position: relative;
        margin-left: auto;
      }
      .vk-rows {
        flex: 1;
        min-height: 0;
        margin: 0;
        padding: 0 8px 8px;
        overflow-y: auto;
        list-style: none;
      }
      .vk-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 52px;
        padding: 4px 8px;
        border: 0;
        border-radius: var(--vk-radius-row);
        background: none;
        color: var(--vk-ink);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vk-row:hover {
        background: var(--vk-hover);
      }
      .vk-row.on {
        background: var(--vk-selected);
      }
      .vk-lead {
        display: grid;
        place-items: center;
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: var(--vk-radius-control);
        color: var(--vk-ink);
      }
      .vk-lead.person {
        border-radius: 50%;
        background: var(--vk-selected);
      }
      .vk-lead.big {
        width: 60px;
        height: 60px;
        border-radius: 14px;
        background: var(--vk-selected);
      }
      .vk-lead.big.person {
        border-radius: 50%;
      }
      .vk-text {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
      }
      .vk-text b {
        overflow: hidden;
        font-size: 15px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-text small {
        overflow: hidden;
        color: var(--vk-muted);
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-text small.amber {
        color: var(--vk-amber);
      }
      .vk-none {
        padding: 24px 12px;
        color: var(--vk-muted);
        font-size: 14px;
        text-align: center;
      }
      .vk-detail {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        background: var(--vk-canvas);
      }
      .vk-detail-head {
        display: flex;
        flex: none;
        align-items: flex-start;
        gap: 16px;
        padding: 22px 28px 16px;
      }
      .vk-head-text {
        flex: 1 1 auto;
        min-width: 160px;
      }
      .vk-head-text h2 {
        display: -webkit-box;
        margin: 0;
        overflow: hidden;
        font-size: 21px;
        font-weight: 700;
        line-height: 1.24;
        white-space: normal;
        word-break: break-word;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
      .vk-head-text p {
        margin: 3px 0 0;
        color: var(--vk-muted);
        font-size: 14px;
      }
      .vk-head-actions {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        padding-top: 2px;
      }
      .vk-detail-body {
        flex: 1;
        min-height: 0;
        padding: 0 32px 32px;
        overflow-y: auto;
      }
      .vk-empty {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        text-align: center;
      }
      .vk-empty h1 {
        margin: 0;
        font-size: 26px;
        font-weight: 700;
      }
      .vk-empty p {
        max-width: 300px;
        margin: 8px 0 20px;
        color: var(--vk-muted);
        font-size: 18px;
        line-height: 1.4;
      }
      .vk-empty-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 10px;
      }
      .vk-sample-card {
        max-width: 480px;
        margin-top: 26px;
        padding: 16px 20px;
        border: 1px solid var(--vk-line);
        border-radius: 14px;
        background: var(--vk-surface);
        text-align: left;
      }
      .vk-sample-head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14.5px;
      }
      .vk-sample-tag {
        padding: 2px 7px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--vk-blue) 12%, var(--vk-surface));
        color: var(--vk-blue);
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .vk-sample-card p.vk-sample-sub {
        max-width: none;
        margin: 6px 0 12px;
        color: var(--vk-muted);
        font-size: 13.5px;
        line-height: 1.45;
      }
      .vk-sample-picks {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .vk-sample-pick {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-canvas);
        color: var(--vk-ink);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-sample-pick:hover {
        border-color: var(--vk-blue);
        color: var(--vk-blue);
      }
      .vk-wt-strip {
        display: flex;
        flex: none;
        flex-wrap: nowrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 38px;
        padding: 4px 16px;
        overflow-x: auto;
        border-bottom: 1px solid var(--vk-line);
        background: var(--vk-paper);
      }
      .vk-wt-left,
      .vk-wt-right {
        display: flex;
        flex: none;
        align-items: center;
        gap: 6px;
      }
      .vk-wt-badge {
        padding: 1px 7px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-surface);
        color: var(--vk-muted);
        font-size: 11px;
        font-weight: 600;
      }
      .vk-wt-steps {
        display: inline-flex;
        padding: 2px;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-hover);
      }
      .vk-wt-steps button {
        height: 22px;
        padding: 0 8px;
        border: 0;
        border-radius: 5px;
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 11.5px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
      }
      .vk-wt-steps button.on {
        background: var(--vk-surface);
        color: var(--vk-ink);
        font-weight: 600;
        box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
      }
      .vk-wt-scenarios {
        display: inline-flex;
        gap: 3px;
      }
      .vk-wt-doc {
        height: 24px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 11.5px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
      }
      .vk-wt-doc:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-wt-doc.on {
        border-color: var(--vk-line);
        background: var(--vk-surface);
        color: var(--vk-ink);
        font-weight: 600;
      }
      .vk-wt-action,
      .vk-wt-clear {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 24px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 11.5px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
      }
      .vk-wt-action kbd {
        padding: 1px 4px;
        border: 1px solid var(--vk-line);
        border-radius: 4px;
        background: var(--vk-surface);
        color: var(--vk-muted);
        font-size: 10.5px;
      }
      .vk-wt-action:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-wt-clear:hover {
        background: var(--vk-hover);
        color: var(--vk-red);
      }
      .vk-practice-card {
        max-width: 720px;
        padding: 22px 24px;
        border: 1px solid var(--vk-line);
        border-radius: 14px;
        background: var(--vk-surface);
      }
      .vk-pf-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px 16px;
      }
      .vk-pf-field {
        display: grid;
        gap: 6px;
      }
      .vk-pf-field.wide {
        grid-column: 1 / -1;
      }
      .vk-pf-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        color: var(--vk-ink);
        font-size: 13px;
        font-weight: 600;
      }
      .vk-pf-src,
      .vk-pf-human {
        padding: 1px 7px;
        border-radius: 999px;
        font-style: normal;
        font-size: 11px;
        font-weight: 600;
      }
      .vk-pf-src {
        background: color-mix(in srgb, var(--vk-blue) 12%, var(--vk-surface));
        color: var(--vk-blue);
      }
      .vk-pf-human {
        background: color-mix(in srgb, var(--vk-amber) 14%, var(--vk-surface));
        color: var(--vk-amber);
      }
      .vk-pf-field input {
        height: 38px;
        padding: 0 12px;
        border: 1px solid var(--vk-line);
        border-radius: var(--vk-radius-control);
        background: var(--vk-canvas);
        color: var(--vk-ink);
        font: inherit;
        font-size: 14px;
      }
      .vk-pf-field input.filled {
        border-color: color-mix(in srgb, var(--vk-blue) 55%, var(--vk-line));
        background: color-mix(in srgb, var(--vk-blue) 6%, var(--vk-canvas));
        font-weight: 600;
      }
      .vk-pf-status {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid var(--vk-line);
        color: var(--vk-ink);
        font-size: 13.5px;
        font-weight: 500;
      }
    `,
  ],
})
export class VowkeyVaultComponent {
  protected readonly library = inject(VowkeyLibrary);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(DialogService);
  private readonly forms = inject(CipherFormConfigService);
  private readonly ciphers = inject(CipherService);
  private readonly accounts = inject(AccountService);
  private readonly localVault = inject(LocalVaultService, { optional: true });
  private readonly platformUtils = inject(PlatformUtilsService, { optional: true });
  private readonly hub = inject(VowkeyHub);
  private readonly i18n = inject(I18nService);

  private readonly search = viewChild<ElementRef<HTMLInputElement>>("search");
  protected readonly identity = CipherType.Identity;
  protected readonly loginType = CipherType.Login;
  protected readonly localFormConfig = signal<CipherFormConfig | null>(null);
  protected readonly newItems = NEW_ITEMS;
  protected readonly sorts: { value: LibrarySort; label: string }[] = [
    { value: "kind", label: "vkSortKind" },
    { value: "name", label: "vkSortName" },
    { value: "changed", label: "vkSortChanged" },
  ];
  protected readonly shortcut = /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
  protected readonly quickBarShortcut = /Mac/.test(navigator.platform) ? "⌃⇧Space" : "Ctrl+Shift+Space";
  protected readonly sampleScenarios = SAMPLE_SCENARIO_LIST;
  protected readonly isSample = isSampleProfile;

  protected readonly query = signal("");
  protected readonly sort = signal<LibrarySort>("kind");
  protected readonly practiceMode = signal(false);
  protected readonly practiceValues = signal<Record<string, string>>({});
  protected readonly practiceHumanValue = signal("");
  protected readonly practiceFilled = signal(false);

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly activeLocale = toSignal(this.i18n.locale$ ?? of("en"), {
    initialValue: this.i18n.translationLocale ?? "en",
  });
  protected readonly show = computed(() => (this.params().get("show") ?? "all") as LibraryShow);
  private readonly person = computed(() => this.params().get("person"));
  private readonly itemId = computed(() => this.params().get("item"));
  private readonly sourceId = computed(() => this.params().get("source"));
  private readonly walkthroughParam = computed(() => this.params().get("walkthrough"));

  protected readonly sampleProfiles = computed(() =>
    this.library.profiles().filter((profile) => isSampleProfile(profile)),
  );
  protected readonly activeSample = computed<CipherView | null>(() => {
    const current = this.cipher();
    if (current && isSampleProfile(current)) {
      return current;
    }
    return this.sampleProfiles()[0] ?? null;
  });
  protected readonly activeSampleScenario = computed(() => {
    this.activeLocale();
    return localizeSampleScenario(sampleScenarioOf(this.activeSample()), (key) => this.i18n.t(key));
  });
  protected readonly practiceSummary = computed(() => {
    const spec = this.activeSampleScenario();
    if (!spec) {
      return "";
    }
    return this.i18n.t(
      "vkWtFilledSummary",
      String(spec.fields.length),
      spec.sourceLabel,
      spec.humanFieldLabel,
    );
  });

  constructor() {
    effect(() => {
      const requested = this.walkthroughParam();
      if (!requested) {
        return;
      }
      untracked(() => {
        void this.consumeWalkthroughParam(requested);
      });
    });
  }

  protected readonly rows = computed(() =>
    this.library.rowsFor(this.show(), this.person(), this.query(), this.sort()),
  );
  protected readonly title = computed(() => {
    this.activeLocale();
    const person = this.person() ? this.library.cipherOf(this.person())?.name : null;
    return person ?? this.i18nTitle(this.show());
  });
  protected readonly selected = computed<LibraryRow | null>(() => {
    const rows = this.rows();
    return (
      rows.find(
        (row) => row.cipherId === this.itemId() && row.sourceId === (this.sourceId() ?? null),
      ) ??
      rows.find((row) => row.cipherId === this.itemId() && row.sourceId == null) ??
      rows[0] ??
      null
    );
  });
  protected readonly cipher = computed(() => this.library.cipherOf(this.selected()?.cipherId));

  private i18nTitle(show: LibraryShow): string {
    return this.i18n.t(TITLES[show]);
  }

  /** A profile reads through its envelope; one saved before envelopes shows as an ordinary item. */
  protected readsAsProfile(): boolean {
    const current = this.cipher();
    return (
      current != null &&
      (this.selected()?.kind === "document" ||
        (current.type === CipherType.Identity && readEnvelope(current) != null))
    );
  }

  @HostListener("window:keydown", ["$event"])
  protected onKey(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.search()?.nativeElement.focus();
      this.search()?.nativeElement.select();
    }
  }

  protected history(step: number): void {
    window.history.go(step);
  }

  protected select(row: LibraryRow): void {
    this.localFormConfig.set(null);
    this.practiceMode.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: row.cipherId, source: row.sourceId },
      queryParamsHandling: "merge",
    });
  }

  protected sampleLabelKey(id: SampleScenarioId): string {
    switch (id) {
      case "idcard":
        return "vkSampleIdCard";
      case "residence":
        return "vkSampleResidence";
      default:
        return "vkSamplePassport";
    }
  }

  private async consumeWalkthroughParam(raw: string): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { walkthrough: null },
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
    await this.trySample(parseSampleScenarioId(raw));
  }

  protected async trySample(scenarioId: SampleScenarioId): Promise<void> {
    this.localFormConfig.set(null);
    this.practiceMode.set(false);
    this.resetPracticeFields();

    const existing = this.sampleProfiles().find(
      (profile) => sampleScenarioOf(profile)?.id === scenarioId,
    );
    if (existing) {
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { show: "all", person: null, item: existing.id, source: null },
        queryParamsHandling: "merge",
      });
      return;
    }

    const sample = buildSampleProfileCipher(scenarioId);
    const account = await firstValueFrom(this.accounts.activeAccount$);
    let savedId: string;
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.initialize();
      await this.localVault.ensureUnlocked();
      const saved = await this.localVault.save(sample);
      savedId = saved.id;
      this.library.refreshLocal();
      this.hub.notifyChanged();
    } else {
      const saved = await this.ciphers.createWithServer(sample, account.id);
      savedId = saved.id;
      this.hub.notifyChanged();
    }

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { show: "all", person: null, item: savedId, source: null },
      queryParamsHandling: "merge",
    });
  }

  protected openSampleDetails(): void {
    this.practiceMode.set(false);
    const sample = this.activeSample();
    if (sample) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { item: sample.id, source: null },
        queryParamsHandling: "merge",
      });
    }
  }

  protected openPracticeForm(): void {
    const sample = this.activeSample();
    if (!sample) {
      return;
    }
    this.localFormConfig.set(null);
    this.resetPracticeFields();
    this.practiceMode.set(true);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: sample.id, source: null },
      queryParamsHandling: "merge",
    });
  }

  protected async fillPracticeForm(): Promise<void> {
    let sample = this.activeSample();
    if (!sample) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account && this.localVault) {
      const fresh = (await this.localVault.list()).find((item) => item.id === sample!.id);
      if (fresh) {
        sample = fresh;
        this.library.refreshLocal();
      }
    }
    const result = fillPracticeFormFromSample(sample);
    this.practiceValues.set(result.values);
    this.practiceFilled.set(true);
  }

  protected resetPracticeFields(): void {
    this.practiceValues.set({});
    this.practiceHumanValue.set("");
    this.practiceFilled.set(false);
  }

  protected setPracticeValue(key: string, value: string): void {
    this.practiceValues.update((prev) => ({ ...prev, [key]: value }));
  }

  protected openQuickBar(): void {
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    void qbIpc?.show?.();
  }

  protected async clearSamples(): Promise<void> {
    const samples = this.sampleProfiles();
    if (samples.length === 0) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.ensureUnlocked();
      const sampleIds = new Set(samples.map((s) => s.id));
      const attachments = await this.localVault.store.list<{ cipherId: string }>("attachments");
      await this.localVault.store.commit([
        ...samples.map((s) => ({ store: "ciphers" as const, id: s.id })),
        ...attachments
          .filter((a) => sampleIds.has(a.value.cipherId))
          .map((a) => ({ store: "attachments" as const, id: a.id })),
      ]);
      this.library.refreshLocal();
    } else {
      for (const sample of samples) {
        await this.ciphers.deleteWithServer(sample.id, account.id);
      }
    }
    this.practiceMode.set(false);
    this.resetPracticeFields();
    this.localFormConfig.set(null);
    this.hub.notifyChanged();
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: null, source: null, walkthrough: null },
      queryParamsHandling: "merge",
    });
  }

  protected addDocument(): void {
    this.hub.open("document");
  }

  protected fillForm(): void {
    this.hub.openFill();
  }

  protected async togglePin(current: CipherView): Promise<void> {
    const working = CipherView.fromSdkCipherView(current.toSdkCipherView());
    if (!working) {
      return;
    }
    working.favorite = !current.favorite;
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.ensureUnlocked();
      await this.localVault.save(working);
      this.library.refreshLocal();
      this.hub.notifyChanged();
      return;
    }
    await this.ciphers.updateWithServer(working, account.id, current);
    this.hub.notifyChanged();
  }

  protected async deleteCurrentItem(current: CipherView): Promise<void> {
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      await this.deleteLocalItem();
      return;
    }
    await this.ciphers.softDeleteWithServer(current.id, account.id);
    this.hub.notifyChanged();
  }

  protected cancelLocalForm(): void {
    this.localFormConfig.set(null);
  }

  protected onLocalSaved(saved: CipherView): void {
    this.localFormConfig.set(null);
    this.library.refreshLocal();
    this.hub.notifyChanged();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: saved.id, source: null },
      queryParamsHandling: "merge",
    });
  }

  private localBaseConfig(): Pick<
    CipherFormConfig,
    "vault" | "admin" | "collections" | "folders"
  > & { organizationDataOwnershipDisabled: true; organizations: [] } {
    const folder = new FolderView();
    folder.name = this.i18n.t("noneFolder");
    return {
      vault: "local",
      admin: false,
      organizationDataOwnershipDisabled: true,
      collections: [],
      folders: [folder],
      organizations: [],
    };
  }

  protected canQuickCopy(cipher: CipherView): boolean {
    if (cipher.type === CipherType.Login) {
      return Boolean(cipher.login?.password || cipher.login?.username);
    }
    if (cipher.type === CipherType.ApiKey) {
      return Boolean(cipher.apiKey?.value);
    }
    if (cipher.type === CipherType.Card) {
      return Boolean(cipher.card?.number);
    }
    return false;
  }

  private tr(key: string, fallback: string, p1?: string): string {
    const translated = this.i18n.t(key, p1);
    return translated && translated !== key ? translated : fallback;
  }

  protected quickCopyLabel(cipher: CipherView): string {
    this.activeLocale();
    if (cipher.type === CipherType.Login) {
      return cipher.login?.password
        ? this.tr("vkCopyPassword", "Copy password")
        : this.tr("vkCopyUsername", "Copy username");
    }
    if (cipher.type === CipherType.ApiKey) {
      return this.tr("vkCopyKey", "Copy key");
    }
    return this.tr("vkCopyNumber", "Copy number");
  }

  protected quickCopy(cipher: CipherView): void {
    const secret =
      cipher.type === CipherType.Login
        ? (cipher.login?.password || cipher.login?.username || "")
        : cipher.type === CipherType.ApiKey
          ? (cipher.apiKey?.value ?? "")
          : (cipher.card?.number ?? "");
    if (!secret) {
      return;
    }
    this.platformUtils?.copyToClipboard(secret);
    this.platformUtils?.showToast(
      "success",
      null,
      this.tr("vkCopiedToClipboard", "Copied to clipboard"),
    );
  }

  protected async add(type: CipherType): Promise<void> {
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.initialize();
      await this.localVault.ensureUnlocked();
      this.localFormConfig.set({
        ...this.localBaseConfig(),
        mode: "add",
        cipherType: type,
      });
      return;
    }
    const formConfig = await this.forms.buildConfig("add", undefined, type);
    await VaultItemDialogComponent.openDrawer(this.dialogs, { mode: "form", formConfig });
  }

  protected async edit(row: LibraryRow): Promise<void> {
    const cipher = this.library.cipherOf(row.cipherId);
    if (!cipher || cipher.isDeleted) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      const encrypted = await this.localVault.store.get<SdkCipher>("ciphers", cipher.id);
      const originalCipher = encrypted == null ? null : Cipher.fromSdkCipher(encrypted);
      if (!originalCipher) {
        return;
      }
      this.localFormConfig.set({
        ...this.localBaseConfig(),
        mode: "edit",
        cipherType: cipher.type,
        originalCipher,
      });
      return;
    }
    const formConfig = await this.forms.buildConfig(
      cipher.edit ? "edit" : "partial-edit",
      cipher.id as CipherId,
      cipher.type,
    );
    await VaultItemDialogComponent.openDrawer(this.dialogs, { mode: "form", formConfig });
  }

  protected async deleteLocalItem(): Promise<void> {
    const cipher = this.cipher();
    if (!cipher || !this.localVault) {
      return;
    }
    await this.localVault.ensureUnlocked();
    const attachments = await this.localVault.store.list<{ cipherId: string }>("attachments");
    await this.localVault.store.commit([
      { store: "ciphers", id: cipher.id },
      ...attachments
        .filter((a) => a.value.cipherId === cipher.id)
        .map((a) => ({ store: "attachments" as const, id: a.id })),
    ]);
    this.localFormConfig.set(null);
    this.library.refreshLocal();
    this.hub.notifyChanged();
  }

  protected async restore(): Promise<void> {
    const cipher = this.cipher();
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (cipher && account) {
      await this.ciphers.restoreWithServer(cipher.id, account.id);
    }
  }

  protected async deleteForGood(): Promise<void> {
    const cipher = this.cipher();
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (
      cipher &&
      account &&
      window.confirm(
        this.tr("vkDeleteForGoodConfirm", `Delete ${cipher.name} for good?`, cipher.name),
      )
    ) {
      await this.ciphers.deleteWithServer(cipher.id, account.id);
    }
  }
}
