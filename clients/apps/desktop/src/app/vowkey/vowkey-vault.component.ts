import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom, of, Subscription } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherPermissionsApi } from "@vowkey/common/vault/models/api/cipher-permissions.api";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { SecureNoteView } from "@vowkey/common/vault/models/view/secure-note.view";
import {
  buildSampleProfileCipher,
  ensureSampleWorkspace,
  fillPracticeFormFromSample,
  isSampleProfile,
  localizeSampleScenario,
  parseSampleScenarioId,
  sampleScenarioOf,
  sampleWorkspaceResetIds,
  SampleScenarioId,
} from "@vowkey/common/vault/profile/sample-walkthrough";
import {
  migrateLegacyProfile,
  newEnvelope,
  profileRefOf,
  readEnvelope,
  setProfileRef,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherId } from "@vowkey/common/types/guid";
import { DialogService, MenuModule } from "@vowkey/components";
import { Cipher as SdkCipher, PureCrypto } from "@vowkey/sdk-internal";
import { I18nPipe } from "@vowkey/ui-common";
import {
  CipherFormConfig,
  CipherFormConfigService,
  CipherFormModule,
  CipherViewComponent,
  DefaultCipherFormConfigService,
  ProfileComponent,
} from "@vowkey/vault";

import { DocumentCaptureService } from "../services/document-capture.service";
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
  notes: "vkNotes",
  environments: "vkEnvironments",
  expiring: "vkExpiring",
  trash: "vkRecentlyDeleted",
};

const NEW_ITEMS: {
  type: CipherType;
  label: string;
  glyph: "person" | "globe" | "card" | "key" | "note" | "layers";
}[] = [
  { type: CipherType.Identity, label: "vkProfile", glyph: "person" },
  { type: CipherType.Login, label: "vkLogin", glyph: "globe" },
  { type: CipherType.Card, label: "vkCard", glyph: "card" },
  { type: CipherType.ApiKey, label: "vkKey", glyph: "key" },
  { type: CipherType.SecureNote, label: "vkNote", glyph: "note" },
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
          <div class="vk-fill-menu-wrap" #fillMenuWrap>
            <button
              type="button"
              class="vk-secondary vk-fill-trigger"
              [class.ai-on]="aiMode()"
              data-testid="vowkey-toolbar-fill-form"
              aria-haspopup="menu"
              [attr.aria-expanded]="fillMenuOpen()"
              (click)="toggleFillMenu($event)"
            >
              <vk-glyph name="form" [size]="16" />{{ "vkFillForm" | i18n }}
              @if (aiMode()) {
                <span class="vk-ai-dot" aria-hidden="true"></span>
              }
              <vk-glyph name="chevron-down" [size]="13" />
            </button>
            @if (fillMenuOpen()) {
              <div
                class="vk-fill-popover"
                role="menu"
                data-testid="vowkey-fill-menu"
                (click)="$event.stopPropagation()"
              >
                <button
                  type="button"
                  role="menuitem"
                  class="vk-fill-item"
                  data-testid="vowkey-fill-window"
                  (click)="fillWindow()"
                >
                  <vk-glyph name="globe" [size]="16" />
                  <span class="vk-fill-item-copy">
                    <b>{{ trText("vkFillWindow", "Fill a window") }}</b>
                    <small>{{ trText("vkFillWindowHint", "Open browser tab or desktop app") }}</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="vk-fill-item"
                  data-testid="vowkey-fill-capture"
                  (click)="fillScreenCapture()"
                >
                  <vk-glyph name="eye" [size]="16" />
                  <span class="vk-fill-item-copy">
                    <b>{{ trText("vkFillScreenCapture", "Fill from screen capture") }}</b>
                    <small>{{ trText("vkFillScreenCaptureHint", "Drag over any form on screen") }}</small>
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  class="vk-fill-item"
                  data-testid="vowkey-fill-file"
                  (click)="fillFile()"
                >
                  <vk-glyph name="form" [size]="16" />
                  <span class="vk-fill-item-copy">
                    <b>{{ trText("vkFillFile", "Fill a file…") }}</b>
                    <small>{{ trText("vkFillFileHint", "Excel, Word, PDF, or image") }}</small>
                  </span>
                </button>
                @if (activeSample()) {
                  <button
                    type="button"
                    role="menuitem"
                    class="vk-fill-item"
                    data-testid="vowkey-fill-practice"
                    (click)="fillMenuOpen.set(false); openPracticeForm()"
                  >
                    <vk-glyph name="document" [size]="16" />
                    <span class="vk-fill-item-copy">
                      <b>{{ "vkWtStepForm" | i18n }}</b>
                    </span>
                  </button>
                }
                <div class="vk-fill-divider" role="separator"></div>
                <div class="vk-fill-ai-row" data-testid="vowkey-fill-ai-row">
                  <div class="vk-fill-ai-label">
                    <vk-glyph name="spark" [size]="15" />
                    <span>{{ trText("vkAiMode", "AI mode") }}</span>
                    <span
                      class="vk-ai-info"
                      tabindex="0"
                      [attr.aria-label]="aiModeEstimateHint()"
                      data-testid="vowkey-fill-ai-info"
                    >
                      i
                      <span class="vk-ai-tooltip" role="tooltip">
                        {{ aiModeEstimateHint() }}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    class="vk-switch"
                    [class.on]="aiMode()"
                    [attr.aria-checked]="aiMode()"
                    [attr.aria-label]="trText('vkAiMode', 'AI mode')"
                    data-testid="vowkey-fill-ai-switch"
                    (click)="toggleAiMode($event)"
                  >
                    <span class="vk-switch-thumb"></span>
                  </button>
                </div>
              </div>
            }
          </div>
          <button
            type="button"
            [class.vk-primary]="!hasDetailPrimary()"
            [class.vk-secondary]="hasDetailPrimary()"
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
            <bit-menu-divider />
            @for (entry of newItems; track entry.type) {
              <button type="button" bitMenuItem (click)="add(entry.type)">
                <vk-glyph slot="start" [name]="entry.glyph" [size]="16" />{{ entry.label | i18n }}
              </button>
            }
            <bit-menu-divider />
            <button
              type="button"
              bitMenuItem
              data-testid="vowkey-new-import"
              (click)="openImport()"
            >
              <vk-glyph slot="start" name="import" [size]="16" />{{ "importData" | i18n }}
            </button>
          </bit-menu>
        </div>
      </header>

      @if (library.rows().length === 0 && show() === "all" && !query() && !localFormConfig()) {
        <section class="vk-empty" aria-live="polite">
          <h1>{{ "vkObWelcomeTitle" | i18n }}</h1>
          <ol class="vk-how">
            <li data-kind="document">
              <span class="vk-how-tile vk-tile"><vk-glyph name="document" [size]="34" [solid]="true" /></span>
              <b>{{ "vkEmptyStepAdd" | i18n }}</b>
            </li>
            <li data-kind="profile">
              <span class="vk-how-tile vk-tile"><vk-glyph name="person" [size]="34" [solid]="true" /></span>
              <b>{{ "vkEmptyStepSave" | i18n }}</b>
            </li>
            <li data-kind="login">
              <span class="vk-how-tile vk-tile"><vk-glyph name="form" [size]="34" [solid]="true" /></span>
              <b>{{ "vkEmptyStepFill" | i18n }}</b>
            </li>
          </ol>
          <div class="vk-empty-actions">
            <button type="button" class="vk-primary" (click)="addDocument()">
              <vk-glyph name="plus" [size]="16" />{{ "vkAddDocument" | i18n }}
            </button>
            <button
              type="button"
              class="vk-secondary"
              data-testid="vowkey-load-sample-workspace"
              (click)="loadSampleWorkspace()"
            >
              {{ "vkTryWithSampleDocuments" | i18n }}
            </button>
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
                    <span class="vk-lead vk-tile" [attr.data-kind]="row.kind"
                      ><vk-glyph [name]="row.glyph" [size]="22" [solid]="true"
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
                <span class="vk-lead big vk-tile" [attr.data-kind]="selected()?.kind"
                  ><vk-glyph [name]="selected()!.glyph" [size]="32" [solid]="true"
                /></span>
                <div class="vk-head-text">
                  @if (editingProfileId() === current.id) {
                    <form
                      class="vk-profile-rename"
                      (submit)="$event.preventDefault(); saveProfileName(current)"
                    >
                      <input
                        type="text"
                        class="vk-profile-name-input"
                        name="profileName"
                        [ngModel]="profileDraftName()"
                        (ngModelChange)="profileDraftName.set($event)"
                        [placeholder]="'vkNewProfile' | i18n"
                        autocomplete="off"
                      />
                    </form>
                  } @else {
                    <h2>{{ selected()!.title }}</h2>
                  }
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
                  } @else if (editingProfileId() === current.id) {
                    <button type="button" class="vk-secondary" (click)="cancelProfileEdit()">
                      {{ "cancel" | i18n }}
                    </button>
                    <button
                      type="button"
                      class="vk-primary"
                      (click)="saveProfileName(current)"
                    >
                      {{ "save" | i18n }}
                    </button>
                  } @else {
                    @if (current.type === identity) {
                      <button
                        type="button"
                        class="vk-secondary"
                        [bitMenuTriggerFor]="profileAddMenu"
                        menuPosition="below-end"
                        data-testid="vowkey-profile-add"
                      >
                        <vk-glyph name="plus" [size]="15" />{{ trText("vkAddToProfile", "Add to profile") }}
                      </button>
                      <bit-menu #profileAddMenu>
                        <button
                          type="button"
                          bitMenuItem
                          data-testid="vowkey-profile-upload-doc"
                          (click)="addDocumentToProfile(current.id)"
                        >
                          <vk-glyph slot="start" name="document" [size]="16" />{{
                            trText("vkUploadDocument", "Upload document…")
                          }}
                        </button>
                        <button
                          type="button"
                          bitMenuItem
                          data-testid="vowkey-profile-import-vault"
                          (click)="openVaultImportModal(current)"
                        >
                          <vk-glyph slot="start" name="import" [size]="16" />{{
                            trText("vkImportFromVault", "Import from vault…")
                          }}
                        </button>
                        <bit-menu-divider />
                        @for (entry of profileNewItems; track entry.type) {
                          <button
                            type="button"
                            bitMenuItem
                            [attr.data-testid]="'vowkey-profile-new-' + entry.type"
                            (click)="add(entry.type, current.id)"
                          >
                            <vk-glyph slot="start" [name]="entry.glyph" [size]="16" />{{
                              entry.label | i18n
                            }}
                          </button>
                        }
                      </bit-menu>
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
                        <button
                          type="button"
                          bitMenuItem
                          data-testid="vowkey-clear-sample"
                          (click)="clearSamples()"
                        >
                          <vk-glyph slot="start" name="trash" [size]="16" />{{
                            "vkWtClearSample" | i18n
                          }}
                        </button>
                      }
                      @if (canLargeType(current)) {
                        <button
                          type="button"
                          bitMenuItem
                          data-testid="vowkey-detail-large-type"
                          (click)="openLargeType(current)"
                        >
                          <vk-glyph slot="start" name="text-size" [size]="16" />{{
                            "vkLargeType" | i18n
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
                      @if (current.type !== identity && linkedProfileOf(current); as linkedProf) {
                        <button
                          type="button"
                          bitMenuItem
                          data-testid="vowkey-detail-unlink-profile"
                          (click)="unlinkFromProfile(current)"
                        >
                          <vk-glyph slot="start" name="person" [size]="16" />{{
                            trText("vkUnlinkFromProfile", "Remove from " + linkedProf.name, linkedProf.name)
                          }}
                        </button>
                      }
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
                    [startAdding]="editingProfileId() === current.id"
                    [initialSourceId]="
                      selected()?.kind === 'document' ? selected()!.sourceId : null
                    "
                  />
                  @if (current.type === identity && !current.isDeleted && selected()?.kind !== 'document') {
                    <section
                      class="vk-profile-linked"
                      data-testid="vowkey-profile-linked-section"
                      [attr.aria-label]="trText('vkLinkedItems', 'Vault items')"
                    >
                      <header class="vk-profile-linked-head">
                        <h3>{{ trText("vkLinkedItems", "Vault items") }}</h3>
                        <button
                          type="button"
                          class="vk-secondary vk-compact-btn"
                          data-testid="vowkey-profile-import-btn"
                          (click)="openVaultImportModal(current)"
                        >
                          <vk-glyph name="import" [size]="14" />{{
                            trText("vkImportFromVault", "Import from vault…")
                          }}
                        </button>
                      </header>
                      @if (linkedItemsFor(current.id).length > 0) {
                        <ul class="vk-linked-list">
                          @for (item of linkedItemsFor(current.id); track item.key) {
                            <li class="vk-linked-row" [attr.data-testid]="'vowkey-linked-item-' + item.cipherId">
                              <button
                                type="button"
                                class="vk-linked-open"
                                (click)="select(item)"
                              >
                                <span class="vk-lead vk-tile" [attr.data-kind]="item.kind">
                                  <vk-glyph [name]="item.glyph" [size]="18" [solid]="true" />
                                </span>
                                <span class="vk-text">
                                  <b>{{ item.title }}</b>
                                  @if (item.subtitle) {
                                    <small>{{ item.subtitle }}</small>
                                  }
                                </span>
                              </button>
                              <div class="vk-linked-actions">
                                @if (library.cipherOf(item.cipherId); as linkedCipher) {
                                  @if (canQuickCopy(linkedCipher)) {
                                    <button
                                      type="button"
                                      class="vk-icon"
                                      [attr.aria-label]="quickCopyLabel(linkedCipher)"
                                      (click)="quickCopy(linkedCipher)"
                                    >
                                      <vk-glyph name="copy" [size]="15" />
                                    </button>
                                  }
                                  <button
                                    type="button"
                                    class="vk-icon"
                                    [attr.aria-label]="trText('vkUnlinkItem', 'Remove from profile')"
                                    data-testid="vowkey-unlink-item"
                                    (click)="unlinkFromProfile(linkedCipher)"
                                  >
                                    <vk-glyph name="trash" [size]="15" />
                                  </button>
                                }
                              </div>
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="vk-linked-empty">
                          {{
                            trText(
                              "vkLinkedItemsEmpty",
                              "Import logins, cards, notes, keys, or documents from your vault into this profile."
                            )
                          }}
                        </p>
                      }
                    </section>
                  }
                } @else {
                  <app-cipher-view
                    [cipher]="current"
                    [hideHeader]="true"
                    [hideItemHistory]="library.account() == null"
                  />
                }
              </div>
            }
          </section>
        </div>
      }
      @if (vaultImportTarget(); as importProfile) {
        <div
          class="vk-lt-backdrop"
          data-testid="vowkey-vault-import-backdrop"
          (click)="closeVaultImportModal()"
        >
          <div
            class="vk-lt-dialog vk-import-dialog"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="trText('vkImportToProfileTitle', 'Import to ' + importProfile.name, importProfile.name)"
            data-testid="vowkey-vault-import-modal"
            (click)="$event.stopPropagation()"
          >
            <header class="vk-lt-head">
              <strong>{{
                trText("vkImportToProfileTitle", "Import to " + importProfile.name, importProfile.name)
              }}</strong>
              <div class="vk-lt-actions">
                <button
                  type="button"
                  class="vk-secondary"
                  (click)="closeVaultImportModal()"
                >
                  {{ "cancel" | i18n }}
                </button>
                <button
                  type="button"
                  class="vk-primary"
                  [disabled]="vaultImportSelectedKeys().size === 0 || vaultImporting()"
                  data-testid="vowkey-vault-import-confirm"
                  (click)="confirmVaultImport()"
                >
                  {{ trText("vkImportSelected", "Import") }}
                  @if (vaultImportSelectedKeys().size > 0) {
                    ({{ vaultImportSelectedKeys().size }})
                  }
                </button>
              </div>
            </header>
            <label class="vk-search vk-import-search">
              <vk-glyph name="search" [size]="15" />
              <input
                type="search"
                [ngModel]="vaultImportQuery()"
                (ngModelChange)="vaultImportQuery.set($event)"
                [placeholder]="trText('vkSearchVaultItems', 'Search documents, logins, cards, notes…')"
                autocomplete="off"
                data-testid="vowkey-vault-import-search"
              />
            </label>
            <ul class="vk-import-list" data-testid="vowkey-vault-import-list">
              @for (candidate of vaultImportCandidates(); track candidate.key) {
                <li>
                  <label
                    class="vk-import-row"
                    [class.checked]="vaultImportSelectedKeys().has(candidate.key)"
                    [attr.data-testid]="'vowkey-import-row-' + candidate.key"
                  >
                    <input
                      type="checkbox"
                      [checked]="vaultImportSelectedKeys().has(candidate.key)"
                      (change)="toggleVaultImportKey(candidate.key)"
                    />
                    <span class="vk-lead vk-tile" [attr.data-kind]="candidate.kind">
                      <vk-glyph [name]="candidate.glyph" [size]="18" [solid]="true" />
                    </span>
                    <span class="vk-text">
                      <b>{{ candidate.title }}</b>
                      <small>{{ candidate.subtitle }}</small>
                    </span>
                  </label>
                </li>
              } @empty {
                <li class="vk-none">
                  {{ trText("vkNoVaultItemsToImport", "No other vault items available to import.") }}
                </li>
              }
            </ul>
          </div>
        </div>
      }
      @if (itemLargeType(); as lt) {
        <div class="vk-lt-backdrop" (click)="itemLargeType.set(null)">
          <div
            class="vk-lt-dialog"
            role="dialog"
            aria-modal="true"
            [attr.aria-label]="lt.label"
            (click)="$event.stopPropagation()"
          >
            <header class="vk-lt-head">
              <strong>{{ lt.label }}</strong>
              <div class="vk-lt-actions">
                <button type="button" class="vk-secondary" (click)="copyLargeTypeValue(lt.value)">
                  {{ "copy" | i18n }}
                </button>
                <button type="button" class="vk-secondary" (click)="itemLargeType.set(null)">
                  {{ "close" | i18n }}
                </button>
              </div>
            </header>
            <div class="vk-lt-groups">
              @for (group of lt.groups; track $index) {
                <div class="vk-lt-group">
                  @for (cell of group; track cell.idx) {
                    <span class="vk-lt-cell" [attr.data-kind]="cell.kind">
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
        height: 36px;
        padding: 0 12px;
        border-radius: var(--vk-radius-row);
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
      .vk-secondary.tint {
        border-color: transparent;
        background: var(--vk-blue-soft);
        color: var(--vk-blue-ink);
        font-weight: 600;
      }
      .vk-secondary.tint:hover {
        background: color-mix(in srgb, var(--vk-blue) 18%, var(--vk-surface));
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
        min-height: 60px;
        padding: 8px 10px;
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
        background: var(--vk-blue-soft);
      }
      .vk-lead {
        --tile: 40px;
      }
      .vk-lead.big {
        --tile: 64px;
        --tile-radius: var(--vk-radius-panel);
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
        font-size: 13px;
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
        font-size: 22px;
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
      .vk-how {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        gap: 18px;
        margin: 34px 0 34px;
        padding: 0;
        list-style: none;
      }
      .vk-how li {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 168px;
      }
      .vk-how li + li::before {
        position: absolute;
        top: 30px;
        left: -18px;
        width: 18px;
        color: var(--vk-muted);
        font-size: 18px;
        line-height: 1;
        text-align: center;
        content: "→";
      }
      .vk-how-tile {
        --tile: 72px;
        --tile-radius: var(--vk-radius-panel);
      }
      .vk-how b {
        font-size: 15px;
        font-weight: 600;
        line-height: 1.3;
      }
      .vk-empty-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 10px;
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
        border-radius: 6px;
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
      .vk-profile-rename {
        margin: 0;
      }
      .vk-profile-name-input {
        width: min(360px, 100%);
        height: 36px;
        padding: 0 10px;
        border: 1px solid var(--vk-line);
        border-radius: var(--vk-radius-control);
        background: var(--vk-canvas);
        color: var(--vk-ink);
        font: inherit;
        font-size: 19px;
        font-weight: 700;
      }
      .vk-profile-name-input:focus-visible {
        outline: 2px solid var(--vk-blue);
        outline-offset: 1px;
      }
      .vk-lt-backdrop {
        position: fixed;
        inset: 0;
        z-index: 60;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(15 23 42 / 56%);
        backdrop-filter: blur(4px);
      }
      .vk-lt-dialog {
        width: min(760px, 100%);
        max-height: calc(100vh - 48px);
        overflow: auto;
        border-radius: 14px;
        border: 1px solid var(--vk-line);
        background: var(--vk-surface);
        color: var(--vk-ink);
        box-shadow: 0 24px 60px rgb(0 0 0 / 28%);
        padding: 18px 22px 24px;
      }
      .vk-lt-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 18px;
      }
      .vk-lt-head strong {
        font-size: 14px;
        font-weight: 600;
        color: var(--vk-muted);
      }
      .vk-lt-actions {
        display: flex;
        gap: 8px;
      }
      .vk-lt-groups {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
      }
      .vk-lt-group {
        display: inline-flex;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
        overflow: hidden;
        background: var(--vk-hover);
      }
      .vk-lt-cell {
        display: grid;
        justify-items: center;
        gap: 4px;
        min-width: 40px;
        padding: 10px 8px 7px;
        border-right: 1px solid var(--vk-line);
      }
      .vk-lt-cell:last-child {
        border-right: 0;
      }
      .vk-lt-cell b {
        font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        font-size: 28px;
        line-height: 1.15;
        font-weight: 600;
      }
      .vk-lt-cell[data-kind="digit"] b {
        color: var(--vk-blue);
      }
      .vk-lt-cell[data-kind="symbol"] b {
        color: var(--vk-muted);
      }
      .vk-lt-cell small {
        font-size: 10px;
        font-variant-numeric: tabular-nums;
        color: var(--vk-muted);
      }
      .vk-fill-menu-wrap {
        position: relative;
        -webkit-app-region: no-drag;
      }
      .vk-fill-trigger {
        gap: 6px;
        padding-right: 11px;
      }
      .vk-fill-trigger.ai-on {
        border-color: color-mix(in srgb, var(--vk-blue) 38%, var(--vk-line));
      }
      .vk-ai-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--vk-blue);
        flex: none;
      }
      .vk-fill-popover {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 45;
        width: 288px;
        padding: 6px;
        border: 1px solid var(--vk-line);
        border-radius: 12px;
        background: var(--vk-surface);
        color: var(--vk-ink);
        box-shadow: 0 14px 36px rgb(0 0 0 / 16%);
        -webkit-app-region: no-drag;
      }
      .vk-fill-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: var(--vk-ink);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vk-fill-item:hover,
      .vk-fill-item:focus-visible {
        background: var(--vk-hover);
        outline: none;
      }
      .vk-fill-item vk-glyph {
        margin-top: 2px;
        color: var(--vk-muted);
        flex: none;
      }
      .vk-fill-item-copy {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }
      .vk-fill-item-copy b {
        font-size: 13.5px;
        font-weight: 600;
        line-height: 1.28;
      }
      .vk-fill-item-copy small {
        color: var(--vk-muted);
        font-size: 12px;
        line-height: 1.3;
      }
      .vk-fill-divider {
        height: 1px;
        margin: 5px 4px;
        background: var(--vk-line);
      }
      .vk-fill-ai-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 10px 6px;
      }
      .vk-fill-ai-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13.5px;
        font-weight: 600;
      }
      .vk-fill-ai-label vk-glyph {
        color: var(--vk-blue);
      }
      .vk-ai-info {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 16px;
        height: 16px;
        border: 1px solid var(--vk-line);
        border-radius: 50%;
        color: var(--vk-muted);
        font-size: 11px;
        font-weight: 700;
        font-style: normal;
        line-height: 1;
        cursor: help;
      }
      .vk-ai-info:hover,
      .vk-ai-info:focus-visible {
        border-color: var(--vk-blue);
        color: var(--vk-blue);
        outline: none;
      }
      .vk-ai-tooltip {
        position: absolute;
        top: calc(100% + 8px);
        right: -48px;
        z-index: 60;
        width: 232px;
        padding: 8px 10px;
        border: 1px solid var(--vk-line);
        border-radius: 8px;
        background: var(--vk-ink);
        color: var(--vk-surface);
        font-size: 12px;
        font-weight: 500;
        line-height: 1.38;
        box-shadow: 0 8px 24px rgb(0 0 0 / 22%);
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.12s ease;
      }
      .vk-ai-info:hover .vk-ai-tooltip,
      .vk-ai-info:focus-visible .vk-ai-tooltip {
        opacity: 1;
        visibility: visible;
      }
      .vk-switch {
        position: relative;
        display: inline-flex;
        align-items: center;
        width: 36px;
        height: 20px;
        padding: 2px;
        border: 0;
        border-radius: 999px;
        background: color-mix(in srgb, var(--vk-muted) 34%, var(--vk-hover));
        cursor: pointer;
        transition: background-color 0.15s ease;
      }
      .vk-switch.on {
        background: var(--vk-blue);
      }
      .vk-switch-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 3px rgb(0 0 0 / 24%);
        transition: transform 0.15s ease;
      }
      .vk-switch.on .vk-switch-thumb {
        transform: translateX(16px);
      }
      .vk-profile-linked {
        max-width: 780px;
        margin-top: 28px;
        padding-top: 20px;
        border-top: 1px solid var(--vk-line);
      }
      .vk-profile-linked-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .vk-profile-linked-head h3 {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        color: var(--vk-ink);
      }
      .vk-compact-btn {
        height: 30px;
        padding: 0 11px;
        font-size: 13px;
      }
      .vk-linked-list {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .vk-linked-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border: 1px solid var(--vk-line);
        border-radius: var(--vk-radius-row);
        background: var(--vk-surface);
      }
      .vk-linked-open {
        display: flex;
        flex: 1;
        align-items: center;
        gap: 10px;
        min-width: 0;
        padding: 0;
        border: 0;
        background: none;
        color: var(--vk-ink);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vk-linked-open .vk-lead {
        --tile: 34px;
      }
      .vk-linked-actions {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      .vk-linked-empty {
        margin: 4px 0 0;
        color: var(--vk-muted);
        font-size: 13.5px;
      }
      .vk-import-dialog {
        width: min(560px, 100%);
      }
      .vk-import-search {
        flex: none;
        width: 100%;
        margin-bottom: 12px;
      }
      .vk-import-list {
        max-height: 360px;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
        display: grid;
        gap: 4px;
      }
      .vk-import-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: var(--vk-radius-row);
        cursor: pointer;
      }
      .vk-import-row:hover {
        background: var(--vk-hover);
      }
      .vk-import-row.checked {
        background: var(--vk-blue-soft);
      }
      .vk-import-row input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--vk-blue);
        flex: none;
      }
      .vk-import-row .vk-lead {
        --tile: 34px;
      }
    `,
  ],
})
export class VowkeyVaultComponent implements OnDestroy {
  protected readonly library = inject(VowkeyLibrary);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(DialogService);
  private readonly forms = inject(CipherFormConfigService);
  private readonly ciphers = inject(CipherService);
  private readonly accounts = inject(AccountService);
  private readonly localVault = inject(LocalVaultService, { optional: true });
  private readonly platformUtils = inject(PlatformUtilsService, { optional: true });
  private readonly messaging = inject(MessagingService, { optional: true });
  private readonly hub = inject(VowkeyHub);
  private readonly documents = inject(DocumentCaptureService, { optional: true });
  private readonly i18n = inject(I18nService);
  private hubSub?: Subscription;

  private readonly search = viewChild<ElementRef<HTMLInputElement>>("search");
  private readonly fillMenuWrap = viewChild<ElementRef<HTMLElement>>("fillMenuWrap");
  protected readonly identity = CipherType.Identity;
  protected readonly loginType = CipherType.Login;
  protected readonly localFormConfig = signal<CipherFormConfig | null>(null);
  protected readonly editingProfileId = signal<string | null>(null);
  protected readonly profileDraftName = signal("");
  protected readonly fillMenuOpen = signal(false);
  protected readonly aiMode = signal(false);
  protected readonly pendingLinkProfileId = signal<string | null>(null);
  protected readonly vaultImportTarget = signal<CipherView | null>(null);
  protected readonly vaultImportQuery = signal("");
  protected readonly vaultImportSelectedKeys = signal<Set<string>>(new Set());
  protected readonly vaultImporting = signal(false);
  protected readonly itemLargeType = signal<{
    label: string;
    value: string;
    groups: { ch: string; idx: number; kind: "digit" | "symbol" | "letter" }[][];
  } | null>(null);
  protected readonly newItems = NEW_ITEMS;
  protected readonly profileNewItems = NEW_ITEMS.filter((item) => item.type !== CipherType.Identity);
  protected readonly sorts: { value: LibrarySort; label: string }[] = [
    { value: "kind", label: "vkSortKind" },
    { value: "name", label: "vkSortName" },
    { value: "changed", label: "vkSortChanged" },
  ];
  protected readonly shortcut = /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
  protected readonly isSample = isSampleProfile;

  protected readonly query = signal("");
  protected readonly sort = signal<LibrarySort>("kind");
  protected readonly practiceMode = signal(false);
  protected readonly practiceValues = signal<Record<string, string>>({});
  protected readonly practiceHumanValue = signal("");
  protected readonly practiceFilled = signal(false);
  private sampleWorkspaceLoading = false;

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
  private readonly actionParam = computed(() => this.params().get("action"));
  private readonly cipherTypeParam = computed(() => this.params().get("cipherType"));

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
    void this.syncAiModePref();
    this.hubSub = this.hub.vaultCommands$.subscribe((cmd) => {
      if (cmd.kind === "newItem") {
        void this.add(cmd.cipherType, cmd.profileId);
      } else if (cmd.kind === "focusSearch") {
        this.search()?.nativeElement.focus();
        this.search()?.nativeElement.select();
      } else if (cmd.kind === "openImport") {
        this.openImport();
      } else if (cmd.kind === "openExport") {
        this.messaging?.send("exportVault");
      }
    });
    effect(() => {
      const requested = this.walkthroughParam();
      if (!requested) {
        return;
      }
      untracked(() => {
        void this.consumeWalkthroughParam(requested);
      });
    });
    effect(() => {
      const action = this.actionParam();
      const rawType = this.cipherTypeParam();
      if (action !== "add") {
        return;
      }
      untracked(() => {
        void this.consumeAddActionParam(rawType);
      });
    });
  }

  ngOnDestroy(): void {
    this.hubSub?.unsubscribe();
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
  protected readonly isEmptyHome = computed(
    () =>
      this.library.rows().length === 0 &&
      this.show() === "all" &&
      !this.query() &&
      !this.localFormConfig(),
  );
  protected readonly hasDetailPrimary = computed(
    () =>
      this.isEmptyHome() ||
      this.localFormConfig() != null ||
      (this.practiceMode() && this.activeSample() != null) ||
      this.editingProfileId() != null ||
      this.vaultImportTarget() != null,
  );
  protected readonly vaultImportCandidates = computed<LibraryRow[]>(() => {
    const target = this.vaultImportTarget();
    if (!target) {
      return [];
    }
    const targetSources = (readEnvelope(target)?.sources ?? []).filter(
      (s) => s.status !== "deleted",
    );
    const existingSha = new Set(targetSources.map((s) => s.sha256).filter(Boolean));
    const seenCandidateSha = new Set<string>();
    const needle = this.vaultImportQuery().trim().toLocaleLowerCase();
    return this.library.rows().filter((row) => {
      if (row.kind === "profile") {
        return false;
      }
      if (row.kind === "document") {
        if (row.cipherId === target.id || !row.sourceId) {
          return false;
        }
        const originCipher = this.library.cipherOf(row.cipherId);
        const candidateSrc = readEnvelope(originCipher)?.sources.find(
          (s) => s.id === row.sourceId && s.status !== "deleted",
        );
        if (candidateSrc?.sha256) {
          if (existingSha.has(candidateSrc.sha256) || seenCandidateSha.has(candidateSrc.sha256)) {
            return false;
          }
          seenCandidateSha.add(candidateSrc.sha256);
        }
      } else if (this.library.personOf(row.cipherId) === target.id) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${row.title}\n${row.subtitle}\n${row.haystack}`.toLocaleLowerCase().includes(needle);
    });
  });

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

  @HostListener("document:click", ["$event"])
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.fillMenuOpen()) {
      return;
    }
    const wrap = this.fillMenuWrap()?.nativeElement;
    if (wrap && event.target instanceof Node && !wrap.contains(event.target)) {
      this.fillMenuOpen.set(false);
    }
  }

  @HostListener("window:keydown", ["$event"])
  protected onKey(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.search()?.nativeElement.focus();
      this.search()?.nativeElement.select();
      return;
    }
    if (event.key === "Escape") {
      if (this.fillMenuOpen()) {
        event.preventDefault();
        this.fillMenuOpen.set(false);
        return;
      }
      if (this.vaultImportTarget() != null) {
        event.preventDefault();
        this.closeVaultImportModal();
        return;
      }
      if (this.itemLargeType() != null) {
        event.preventDefault();
        this.itemLargeType.set(null);
        return;
      }
      if (this.localFormConfig() != null) {
        event.preventDefault();
        this.cancelLocalForm();
        return;
      }
      if (this.editingProfileId() != null) {
        event.preventDefault();
        this.cancelProfileEdit();
        return;
      }
      if (this.query()) {
        event.preventDefault();
        this.query.set("");
        return;
      }
      return;
    }
    if (
      (event.key === "ArrowDown" || event.key === "ArrowUp") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const target = event.target as HTMLElement | null;
      const isSearch = target === this.search()?.nativeElement;
      const isEditable =
        target != null &&
        !isSearch &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isEditable || this.localFormConfig() != null) {
        return;
      }
      const list = this.rows();
      if (list.length === 0) {
        return;
      }
      event.preventDefault();
      const currentKey = this.selected()?.key;
      const idx = list.findIndex((row) => row.key === currentKey);
      const nextIdx =
        event.key === "ArrowDown"
          ? idx < 0
            ? 0
            : Math.min(list.length - 1, idx + 1)
          : idx <= 0
            ? 0
            : idx - 1;
      this.select(list[nextIdx]);
    }
  }

  protected history(step: number): void {
    window.history.go(step);
  }

  protected select(row: LibraryRow): void {
    this.localFormConfig.set(null);
    this.editingProfileId.set(null);
    this.practiceMode.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: row.cipherId, source: row.sourceId },
      queryParamsHandling: "merge",
    });
  }

  private async consumeAddActionParam(rawType: string | null): Promise<void> {
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { action: null, cipherType: null },
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
    const parsed = rawType != null ? Number(rawType) : CipherType.Login;
    const cipherType = Number.isFinite(parsed) && parsed > 0 ? (parsed as CipherType) : CipherType.Login;
    await this.add(cipherType);
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

    const saved = await this.saveSampleScenario(scenarioId);
    if (!saved) {
      return;
    }
    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { show: "all", person: null, item: saved.id, source: null },
      queryParamsHandling: "merge",
    });
  }

  /** Saves one sample profile through the normal guest/account vault path, or null without a vault. */
  private async saveSampleScenario(scenarioId: SampleScenarioId): Promise<CipherView | null> {
    const sample = buildSampleProfileCipher(scenarioId);
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return null;
      }
      await this.localVault.initialize();
      await this.localVault.ensureUnlocked();
      const saved = await this.localVault.save(sample);
      this.library.refreshLocal();
      this.hub.notifyChanged();
      return saved;
    }
    const saved = await this.ciphers.createWithServer(sample, account.id);
    this.hub.notifyChanged();
    return saved;
  }

  /** One action: load every missing sample profile and open the first one. Re-running adds nothing. */
  protected async loadSampleWorkspace(): Promise<void> {
    if (this.sampleWorkspaceLoading) {
      return;
    }
    this.sampleWorkspaceLoading = true;
    try {
      this.localFormConfig.set(null);
      this.practiceMode.set(false);
      this.resetPracticeFields();

      const created = await ensureSampleWorkspace(this.library.profiles(), (scenarioId) =>
        this.saveSampleScenario(scenarioId),
      );
      const target = created[0] ?? this.sampleProfiles()[0] ?? null;
      if (!target) {
        return;
      }
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { show: "all", person: null, item: target.id, source: null },
        queryParamsHandling: "merge",
      });
    } finally {
      this.sampleWorkspaceLoading = false;
    }
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

  protected async clearSamples(): Promise<void> {
    const samples = this.sampleProfiles();
    const sampleIds = new Set(sampleWorkspaceResetIds(this.library.profiles()));
    if (sampleIds.size === 0) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.ensureUnlocked();
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

  private isE2e(): boolean {
    return Boolean(
      (globalThis as { ipc?: { platform?: { isE2e?: boolean } } }).ipc?.platform?.isE2e,
    );
  }

  protected addDocument(): void {
    const profileId = this.activeProfileId();
    if (this.isE2e()) {
      this.hub.open("document", profileId);
      return;
    }
    this.hub.pickFile("document", profileId);
  }

  protected addDocumentToProfile(profileId: string): void {
    if (this.isE2e()) {
      this.hub.open("document", profileId);
      return;
    }
    this.hub.pickFile("document", profileId);
  }

  private activeProfileId(): string | undefined {
    const current = this.cipher();
    if (current && current.type === CipherType.Identity && !current.isDeleted) {
      return current.id;
    }
    return this.person() ?? undefined;
  }

  private quickBarBridge(): {
    show?: (profileId?: string) => Promise<void>;
    scanScreen?: (profileId?: string) => Promise<unknown>;
    getShellPreferences?: () => Promise<{ aiMode?: boolean }>;
    updateShellPreferences?: (patch: { aiMode?: boolean }) => Promise<{ aiMode?: boolean }>;
  } | null {
    return (
      (
        globalThis as {
          ipc?: {
            quickBar?: {
              show?: (profileId?: string) => Promise<void>;
              scanScreen?: (profileId?: string) => Promise<unknown>;
              getShellPreferences?: () => Promise<{ aiMode?: boolean }>;
              updateShellPreferences?: (patch: { aiMode?: boolean }) => Promise<{ aiMode?: boolean }>;
            };
          };
        }
      ).ipc?.quickBar ?? null
    );
  }

  private async syncAiModePref(): Promise<void> {
    try {
      const prefs = await this.quickBarBridge()?.getShellPreferences?.();
      if (prefs != null) {
        const next = Boolean(prefs.aiMode);
        this.aiMode.set(next);
        this.documents?.setAiFillMode?.(next);
      }
    } catch {
      // Ignore outside Electron desktop shell.
    }
  }

  protected toggleFillMenu(event: Event): void {
    event.stopPropagation();
    const next = !this.fillMenuOpen();
    this.fillMenuOpen.set(next);
    if (next) {
      void this.syncAiModePref();
    }
  }

  protected aiModeEstimateHint(): string {
    this.activeLocale();
    return this.tr(
      "vkAiModeEstimateHint",
      "Calls an AI agent to solve complex forms. Takes ~15–30s longer.",
    );
  }

  protected async toggleAiMode(event: Event): Promise<void> {
    event.stopPropagation();
    const next = !this.aiMode();
    this.aiMode.set(next);
    this.documents?.setAiFillMode?.(next);
    try {
      const updated = await this.quickBarBridge()?.updateShellPreferences?.({ aiMode: next });
      if (updated != null && typeof updated.aiMode === "boolean") {
        this.aiMode.set(updated.aiMode);
        this.documents?.setAiFillMode?.(updated.aiMode);
      }
    } catch {
      // Keep local signal state in test/web environments.
    }
  }

  protected async fillWindow(): Promise<void> {
    this.fillMenuOpen.set(false);
    const profileId = this.activeProfileId();
    const qb = this.quickBarBridge();
    if (qb?.show) {
      await qb.show(profileId);
      return;
    }
    this.hub.openFill();
  }

  protected async fillScreenCapture(): Promise<void> {
    this.fillMenuOpen.set(false);
    const profileId = this.activeProfileId();
    const qb = this.quickBarBridge();
    if (qb?.scanScreen) {
      await qb.scanScreen(profileId);
      return;
    }
    this.hub.openFill();
  }

  protected fillFile(): void {
    this.fillMenuOpen.set(false);
    const profileId = this.activeProfileId();
    if (this.isE2e()) {
      this.hub.openFill();
      return;
    }
    this.hub.pickFile("fill", profileId);
  }

  protected fillForm(): void {
    this.fillFile();
  }

  protected openImport(): void {
    this.messaging?.send("importVault");
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
    if (current.type === CipherType.Identity) {
      const sources = (readEnvelope(current)?.sources ?? []).filter(
        (source) => source.status !== "deleted",
      );
      const docNames = sources.map((source) => source.fileName).join(", ");
      let content =
        sources.length > 0
          ? this.tr(
              "vkDeleteProfileWithDocs",
              `Moves ${current.name} and ${sources.length} attached document(s) (${docNames}) to Recently deleted.`,
              current.name,
              docNames,
            )
          : this.tr(
              "vkDeleteProfileConfirmBody",
              `Moves ${current.name} to Recently deleted.`,
              current.name,
            );
      if (account) {
        content = `${content} ${this.tr(
          "vkDeleteProfileSyncedNote",
          "Synced copies on your other devices move to Recently deleted too.",
        )}`;
      }
      const confirmed = await this.dialogs.openSimpleDialog({
        title: this.tr("vkDeleteProfileTitle", `Delete ${current.name}?`, current.name),
        content,
        acceptButtonText: this.i18n.t("delete"),
        type: "warning",
      });
      if (!confirmed) {
        return;
      }
    }
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.ensureUnlocked();
      const working = CipherView.fromSdkCipherView(current.toSdkCipherView());
      if (!working) {
        return;
      }
      working.deletedDate = new Date();
      await this.localVault.save(working);
      this.localFormConfig.set(null);
      this.editingProfileId.set(null);
      this.library.refreshLocal();
      this.hub.notifyChanged();
      return;
    }
    await this.ciphers.softDeleteWithServer(current.id, account.id);
    this.editingProfileId.set(null);
    this.hub.notifyChanged();
  }

  protected cancelLocalForm(): void {
    this.localFormConfig.set(null);
    this.pendingLinkProfileId.set(null);
  }

  protected cancelProfileEdit(): void {
    this.editingProfileId.set(null);
  }

  protected linkedItemsFor(profileId: string): LibraryRow[] {
    return this.library
      .rows()
      .filter((row) => row.kind !== "profile" && row.kind !== "document" && this.library.personOf(row.cipherId) === profileId);
  }

  protected linkedProfileOf(cipher: CipherView): CipherView | null {
    const pid = profileRefOf(cipher);
    return pid ? this.library.cipherOf(pid) : null;
  }

  protected openVaultImportModal(profile: CipherView): void {
    this.vaultImportQuery.set("");
    this.vaultImportSelectedKeys.set(new Set());
    this.vaultImportTarget.set(profile);
  }

  protected closeVaultImportModal(): void {
    if (this.vaultImporting()) {
      return;
    }
    this.vaultImportTarget.set(null);
    this.vaultImportSelectedKeys.set(new Set());
    this.vaultImportQuery.set("");
  }

  protected toggleVaultImportKey(key: string): void {
    this.vaultImportSelectedKeys.update((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected async confirmVaultImport(): Promise<void> {
    const target = this.vaultImportTarget();
    const keys = [...this.vaultImportSelectedKeys()];
    if (!target || keys.length === 0 || this.vaultImporting()) {
      return;
    }
    this.vaultImporting.set(true);
    try {
      const candidates = this.library.rows();
      for (const key of keys) {
        const row = candidates.find((c) => c.key === key);
        if (!row) {
          continue;
        }
        if (row.kind === "document" && row.sourceId && row.cipherId !== target.id) {
          if (this.documents?.copyDocumentToProfile) {
            await this.documents.copyDocumentToProfile(row.cipherId, row.sourceId, target.id);
          } else {
            await this.documents?.moveDocument(row.cipherId, row.sourceId, target.id);
          }
        } else if (row.kind !== "profile" && row.kind !== "document") {
          const item = this.library.cipherOf(row.cipherId);
          if (item) {
            await this.setItemProfileLink(item, target.id);
          }
        }
      }
      this.library.refreshLocal();
      this.hub.notifyChanged();
      this.vaultImportTarget.set(null);
      this.vaultImportSelectedKeys.set(new Set());
      this.vaultImportQuery.set("");
    } finally {
      this.vaultImporting.set(false);
    }
  }

  protected async unlinkFromProfile(cipher: CipherView): Promise<void> {
    await this.setItemProfileLink(cipher, null);
    this.library.refreshLocal();
    this.hub.notifyChanged();
  }

  private async setItemProfileLink(cipher: CipherView, profileId: string | null): Promise<void> {
    if (cipher.type === CipherType.Identity) {
      return;
    }
    const working = CipherView.fromSdkCipherView(cipher.toSdkCipherView());
    if (!working) {
      return;
    }
    setProfileRef(working, profileId);
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.ensureUnlocked();
      await this.localVault.save(working);
      return;
    }
    await this.ciphers.updateWithServer(working, account.id, cipher);
  }

  protected async saveProfileName(current: CipherView): Promise<void> {
    const trimmed = this.profileDraftName().trim() || this.tr("vkNewProfile", "New profile");
    const working = CipherView.fromSdkCipherView(current.toSdkCipherView());
    if (!working) {
      this.editingProfileId.set(null);
      return;
    }
    working.name = trimmed;
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (this.localVault) {
        await this.localVault.ensureUnlocked();
        await this.localVault.save(working);
        this.library.refreshLocal();
      }
    } else {
      await this.ciphers.updateWithServer(working, account.id, current);
    }
    this.editingProfileId.set(null);
    this.hub.notifyChanged();
  }

  protected async onLocalSaved(saved: CipherView): Promise<void> {
    const linkToProfileId = this.pendingLinkProfileId();
    this.pendingLinkProfileId.set(null);
    this.localFormConfig.set(null);
    if (linkToProfileId && saved.type !== CipherType.Identity) {
      await this.setItemProfileLink(saved, linkToProfileId);
      this.library.refreshLocal();
      this.hub.notifyChanged();
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { item: linkToProfileId, source: null },
        queryParamsHandling: "merge",
      });
      return;
    }
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

  protected canLargeType(cipher: CipherView): boolean {
    return Boolean(this.largeTypePayload(cipher));
  }

  private largeTypePayload(cipher: CipherView): { label: string; value: string } | null {
    if (cipher.type === CipherType.Login && cipher.login?.password) {
      return { label: cipher.name, value: cipher.login.password };
    }
    if (cipher.type === CipherType.ApiKey && cipher.apiKey?.value) {
      return { label: cipher.name, value: cipher.apiKey.value };
    }
    if (cipher.type === CipherType.SshKey && cipher.sshKey?.publicKey) {
      return { label: cipher.name, value: cipher.sshKey.publicKey };
    }
    if (cipher.type === CipherType.Card && cipher.card?.number) {
      return { label: cipher.name, value: cipher.card.number };
    }
    if (cipher.type === CipherType.SecureNote && cipher.notes) {
      return { label: cipher.name, value: cipher.notes };
    }
    return null;
  }

  protected openLargeType(cipher: CipherView): void {
    const payload = this.largeTypePayload(cipher);
    if (!payload) {
      return;
    }
    const chars = Array.from(payload.value).map((ch, i) => ({
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
    this.itemLargeType.set({ label: payload.label, value: payload.value, groups });
  }

  protected copyLargeTypeValue(value: string): void {
    this.platformUtils?.copyToClipboard(value);
    this.platformUtils?.showToast(
      "success",
      null,
      this.tr("vkCopiedToClipboard", "Copied to clipboard"),
    );
  }

  protected trText(key: string, fallback: string, p1?: string, p2?: string): string {
    this.activeLocale();
    return this.tr(key, fallback, p1, p2);
  }

  private tr(key: string, fallback: string, p1?: string, p2?: string): string {
    const translated = this.i18n.t(key, p1, p2);
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

  protected async add(type: CipherType, forProfileId?: string): Promise<void> {
    this.practiceMode.set(false);
    this.editingProfileId.set(null);
    const targetProfileId =
      type !== CipherType.Identity ? (forProfileId ?? this.activeProfileId() ?? null) : null;
    this.pendingLinkProfileId.set(targetProfileId);
    const account = await firstValueFrom(this.accounts.activeAccount$);

    if (type === CipherType.Identity) {
      this.localFormConfig.set(null);
      const created = new CipherView();
      created.type = CipherType.Identity;
      created.identity = new IdentityView();
      created.secureNote = new SecureNoteView();
      created.name = this.tr("vkNewProfile", "New profile");
      writeEnvelope(created, newEnvelope(crypto.randomUUID()));

      let saved: CipherView;
      if (!account) {
        if (!this.localVault) {
          return;
        }
        await this.localVault.initialize();
        await this.localVault.ensureUnlocked();
        saved = await this.localVault.save(created);
        this.library.refreshLocal();
      } else {
        saved = await this.ciphers.createWithServer(created, account.id);
      }
      this.hub.notifyChanged();
      this.profileDraftName.set(saved.name);
      this.editingProfileId.set(saved.id);
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          show: this.show() === "trash" ? "all" : this.show(),
          person: null,
          item: saved.id,
          source: null,
        },
        queryParamsHandling: "merge",
      });
      return;
    }

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
    this.localFormConfig.set(formConfig);
  }

  protected async edit(row: LibraryRow): Promise<void> {
    const cipher = this.library.cipherOf(row.cipherId);
    if (!cipher || cipher.isDeleted) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);

    if (cipher.type === CipherType.Identity) {
      this.localFormConfig.set(null);
      if (readEnvelope(cipher) == null) {
        const migrated = CipherView.fromSdkCipherView(cipher.toSdkCipherView());
        if (migrated) {
          migrateLegacyProfile(migrated);
          if (!account && this.localVault) {
            await this.localVault.ensureUnlocked();
            await this.localVault.save(migrated);
            this.library.refreshLocal();
          } else if (account) {
            await this.ciphers.updateWithServer(migrated, account.id, cipher);
          }
          this.hub.notifyChanged();
        }
      }
      this.profileDraftName.set(cipher.name);
      this.editingProfileId.set(cipher.id);
      return;
    }

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
    this.localFormConfig.set(formConfig);
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
    this.editingProfileId.set(null);
    this.library.refreshLocal();
    this.hub.notifyChanged();
  }

  protected async restore(): Promise<void> {
    const cipher = this.cipher();
    if (!cipher) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.ensureUnlocked();
      const encrypted = await this.localVault.store.get<SdkCipher>("ciphers", cipher.id);
      if (!encrypted) {
        return;
      }
      const key = await this.localVault.key();
      try {
        const view = CipherView.fromSdkCipherView(PureCrypto.decrypt_legacy_cipher(encrypted, key));
        if (!view) {
          return;
        }
        view.edit = true;
        view.viewPassword = true;
        view.permissions ??= new CipherPermissionsApi();
        view.permissions.delete = view.permissions.restore = true;
        view.deletedDate = null;
        await this.localVault.save(view);
      } finally {
        key.fill(0);
      }
      this.library.refreshLocal();
      this.hub.notifyChanged();
      return;
    }
    await this.ciphers.restoreWithServer(cipher.id, account.id);
    this.hub.notifyChanged();
  }

  protected async deleteForGood(): Promise<void> {
    const cipher = this.cipher();
    if (!cipher) {
      return;
    }
    const confirmed = await this.dialogs.openSimpleDialog({
      title: this.tr("vkDeleteForGoodConfirm", `Delete ${cipher.name} for good?`, cipher.name),
      content: this.tr(
        "vkDeleteForGoodBody",
        "This item and any attached documents will be permanently removed.",
      ),
      acceptButtonText: this.tr("vkDeleteForGood", "Delete for good"),
      type: "danger",
    });
    if (!confirmed) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      await this.deleteLocalItem();
      return;
    }
    await this.ciphers.deleteWithServer(cipher.id, account.id);
    this.hub.notifyChanged();
  }
}
