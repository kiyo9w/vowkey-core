import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, ParamMap, Router, RouterModule } from "@angular/router";
import * as JSZip from "jszip";
import { getDocument } from "pdfjs-dist";
import "pdfjs-dist/webpack.mjs";
import { firstValueFrom, Subscription } from "rxjs";
import {
  capture_document_text,
  CapturedDocument,
  Cipher as SdkCipher,
  decision_begin,
  decision_finish,
  decision_requests,
  decision_take_first_answers,
  decode_document_barcode,
  detail_label,
  fill_docx_with_profile,
  fill_fields_from_profile,
  fill_hwpx_with_profile,
  fill_xlsx_with_profile,
  Locator as SdkLocator,
  profile_details,
} from "@vowkey/sdk-internal";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { ClientType } from "@vowkey/common/enums";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { syncServerAnswers } from "@vowkey/common/platform/misc/sync-server";
import { TotpService } from "@vowkey/common/vault/abstractions/totp.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { capturedFromVision, DecisionRequest, ProductInference } from "@vowkey/common/vault/local/product-inference";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import {
  formatSocialSignInSummary,
  parseSocialSignIn,
} from "@vowkey/common/vault/social-sign-in";
import { fillableProfileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import {
  buildSampleProfileCipher,
  ensureSampleWorkspace,
  fillPracticeFormFromSample,
  isSampleProfile,
  localizeSampleScenario,
  SAMPLE_SCENARIO_LIST,
  sampleScenarioOf,
  sampleWorkspaceResetIds,
  SampleScenarioId,
} from "@vowkey/common/vault/profile/sample-walkthrough";
import {
  applyProjection,
  attachSourceBytes,
  CapturedValue,
  envelopeState,
  Locator,
  migrateLegacyProfile,
  newEnvelope,
  profileUsableForFill,
  projectEnvelope,
  readEnvelope,
  recordCapture,
  VariantOrigin,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";
import { ButtonModule, ToastService } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";
import { CipherFormModule } from "../cipher-form/cipher-form.module";
import { CipherViewComponent } from "../cipher-view/cipher-view.component";
import { ProfileComponent } from "../cipher-view/profile/profile.component";
import { AgentManagementComponent } from "../agent-management/agent-management.component";
import { LOCAL_AGENT_MANAGEMENT } from "../agent-management/local-agent-management";

@Component({
  selector: "vault-local-vault",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ButtonModule, I18nPipe, CipherFormModule, CipherViewComponent, ProfileComponent, AgentManagementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="vk-local" [class.locked]="locked()" [class.detail-open]="detailOpen() || config() != null || practiceOpen()">
      @if (!locked()) {
      <aside class="vk-local-side">
        <div class="vk-brand">
          <svg class="vk-emblem" width="32" height="32" viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="118" height="118" rx="27" fill="var(--vk-surface)" stroke="var(--vk-line)" stroke-width="3"/>
            <g transform="translate(60 61) scale(0.86) translate(-60 -57)">
              <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke="var(--vk-ink)" stroke-width="7.5" stroke-linecap="round"/>
              <rect x="31" y="28" width="34" height="23" rx="5" fill="var(--vk-blue)"/>
              <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff"/>
              <g fill="var(--vk-ink)"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
              <rect x="80" y="54" width="5.5" height="22" rx="2.75" fill="var(--vk-blue)"/>
            </g>
          </svg>
          <div class="vk-brand-copy">
            <h1>Vowkey</h1>
            <p class="scope">{{ 'vowkeyLocalVault' | i18n }}</p>
          </div>
        </div>
        <nav class="vk-side-nav" [attr.aria-label]="'filter' | i18n">
          <button type="button" [attr.aria-pressed]="!showAgents() && filter() === null" (click)="setFilter(null)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/></svg>
            <span>{{ 'allItems' | i18n }}</span>
          </button>
          @for (kind of kinds; track kind.type) {
            <button type="button" [attr.aria-pressed]="!showAgents() && filter() === kind.type" (click)="setFilter(kind.type)">
              @switch (kind.type) {
                @case (cipherType.Login) {
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6.2" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M9.4 8H14M12 8V10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                }
                @case (cipherType.Identity) {
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="5.6" r="2.6" stroke="currentColor" stroke-width="1.4"/><path d="M3.2 13.4C3.9 10.9 5.7 9.8 8 9.8C10.3 9.8 12.1 10.9 12.8 13.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                }
                @case (cipherType.Card) {
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.8" y="3.5" width="12.4" height="9" rx="1.8" stroke="currentColor" stroke-width="1.4"/><path d="M1.8 6.6H14.2" stroke="currentColor" stroke-width="1.4"/></svg>
                }
                @case (cipherType.ApiKey) {
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.2 5.2L2.4 8L5.2 10.8M10.8 5.2L13.6 8L10.8 10.8M9 3.6L7 12.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                }
                @case (cipherType.Environment) {
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.8" stroke="currentColor" stroke-width="1.4"/><path d="M5 6.4L7 8L5 9.6M8.4 9.8H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
                }
                @default {
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="2.2" width="10" height="11.6" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 5.8H10.5M5.5 8.4H10.5M5.5 11H8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                }
              }
              <span>{{ chipLabel(kind) }}</span>
            </button>
          }
          @if (agentManagement != null) {
            <button type="button" [attr.aria-pressed]="showAgents()" (click)="openAgents()">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="2.5" stroke="currentColor" stroke-width="1.4"/><circle cx="6.2" cy="8" r="1" fill="currentColor"/><circle cx="9.8" cy="8" r="1" fill="currentColor"/></svg>
              <span>{{ 'vowkeyAgents' | i18n }}</span>
            </button>
          }
        </nav>
        <div class="account-links">
          @if (syncAvailable()) {
            <a routerLink="/login">{{ 'logIn' | i18n }}</a>
            <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
          }
          @if (!native && !hasPassword() && !locked()) {
            <button type="button" (click)="protecting.set(true)">{{ 'vowkeyLocalSetPassword' | i18n }}</button>
          }
          @if (canLock() && !locked()) {
            <button type="button" (click)="lock()">{{ 'lock' | i18n }}</button>
          }
        </div>
      </aside>
      }

      <section class="workspace">
        <input #docInput type="file" class="sr-file-input" data-testid="local-doc-input" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.txt,.md,.csv,.json" (change)="onDocumentFileSelected($event)" />
        <input #formInput type="file" class="sr-file-input" data-testid="local-form-input" accept=".docx,.xlsx,.hwpx,.pdf" (change)="onFormFileSelected($event)" />
        @if (error() && (!locked() || unlockTried())) { <p class="notice" role="alert">{{ error() }}</p> }
        @if (locked()) {
          <div class="unlock-stage">
            <form class="unlock-card" (ngSubmit)="unlock()">
              <svg class="unlock-emblem" width="56" height="56" viewBox="0 0 120 120" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="118" height="118" rx="27" fill="var(--vk-surface)" stroke="var(--vk-line)" stroke-width="2.5"/>
                <g transform="translate(60 61) scale(0.86) translate(-60 -57)">
                  <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke="var(--vk-ink)" stroke-width="7" stroke-linecap="round"/>
                  <rect x="31" y="28" width="34" height="23" rx="5" fill="var(--vk-blue)"/>
                  <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff"/>
                  <g fill="var(--vk-ink)"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
                  <rect x="80" y="54" width="5.5" height="22" rx="2.75" fill="var(--vk-blue)"/>
                </g>
              </svg>
              @if (attached()) {
                <h2>{{ tOr('vkAttachedTitle', 'Your vault is linked to an account') }}</h2>
                @if (syncAvailable()) {
                  <a bitButton buttonType="primary" [block]="true" routerLink="/login">{{ 'logIn' | i18n }}</a>
                } @else if (canStartOver()) {
                  <p class="unlock-sub">{{ tOr('vkAttachedOffline', "That account's server can't be reached right now.") }}</p>
                  <button bitButton buttonType="primary" [block]="true" type="button" data-testid="local-start-over" [disabled]="busy()" (click)="startOver()">{{ tOr('vkUseThisDeviceOnly', 'Use this device only') }}</button>
                } @else {
                  <p class="unlock-sub">{{ tOr('vkAttachedItems', "Your items are saved under that account. They open again when its server is back.") }}</p>
                }
              } @else {
              <h2>{{ 'unlock' | i18n }}</h2>
              <p class="unlock-sub">{{ 'vowkeyLocalVault' | i18n }}</p>
              @if (hasPassword()) {
                <label class="vk-field">
                  <span>{{ 'vowkeyLocalPassword' | i18n }}</span>
                  <input type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required />
                </label>
              } @else if (!native) {
                <p class="session-ended">{{ 'vowkeyLocalSessionEnded' | i18n }}</p>
              }
              @if (hasPassword() || native) {
                <button bitButton buttonType="primary" [block]="true" type="submit" [disabled]="busy()">{{ 'unlock' | i18n }}</button>
              }
              @if (syncAvailable()) {
                <div class="unlock-links">
                  <a routerLink="/login">{{ 'logIn' | i18n }}</a>
                  <span aria-hidden="true">·</span>
                  <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
                </div>
              }
              }
            </form>
          </div>
        } @else if (ready()) {
          @if (showAgents()) {
            <div class="compact-subhead">
              <button type="button" class="back-btn" (click)="showAgents.set(false)">← {{ 'back' | i18n }}</button>
              <strong>{{ 'vowkeyAgents' | i18n }}</strong>
            </div>
            <div class="agents-wrap"><vault-agent-management /></div>
          } @else {
            <header class="vk-topbar" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()">
              <div class="compact-brand" aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 120 120" fill="none">
                  <rect x="1" y="1" width="118" height="118" rx="28" fill="var(--vk-surface)" stroke="var(--vk-line)" stroke-width="3.5"/>
                  <g transform="translate(60 61) scale(0.86) translate(-60 -57)">
                    <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke="var(--vk-ink)" stroke-width="8" stroke-linecap="round"/>
                    <rect x="31" y="28" width="34" height="23" rx="5" fill="var(--vk-blue)"/>
                    <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff"/>
                    <g fill="var(--vk-ink)"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
                    <rect x="80" y="54" width="5.5" height="22" rx="2.75" fill="var(--vk-blue)"/>
                  </g>
                </svg>
              </div>
              <div class="search-box">
                <svg class="search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.8" stroke="currentColor" stroke-width="1.5"/>
                  <path d="M10.6 10.6L13.8 13.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <input type="search" [attr.aria-label]="'search' | i18n" [placeholder]="'search' | i18n" [ngModel]="search()" (ngModelChange)="search.set($event)" />
              </div>
              <div class="topbar-actions">
                @if (browserExtension && items().length > 0) {
                  <button type="button" class="fill-page-btn" data-testid="local-fill-page" [disabled]="busy()" (click)="fillActivePage()">{{ tOr('vkFillThisPage', 'Fill this page') }}</button>
                }
                <button type="button" class="topbar-ghost-btn hide-compact-inline" data-testid="local-add-document" [disabled]="busy()" (click)="docInput.click()">{{ tOr('vkAddDocument', 'Add document') }}</button>
                <button type="button" class="topbar-ghost-btn hide-compact-inline" data-testid="local-fill-form" [disabled]="busy()" (click)="triggerFillForm(formInput)">{{ tOr('vkFillForm', 'Fill a form') }}</button>
                <details class="new-menu" [class.has-fill-cta]="browserExtension && items().length > 0">
                  <summary>+ {{ 'new' | i18n }}</summary>
                  <div class="new-menu-sheet">
                    <button type="button" data-testid="local-menu-add-document" (click)="triggerMenuFile(docInput, $event)">{{ tOr('vkAddDocument', 'Add document') }}</button>
                    <button type="button" data-testid="local-menu-fill-form" (click)="triggerMenuFillForm(formInput, $event)">{{ tOr('vkFillForm', 'Fill a form') }}</button>
                    <button type="button" data-testid="local-menu-sample-workspace" [disabled]="busy()" (click)="loadSampleWorkspace($event)">{{ 'vkSampleWorkspaceAdd' | i18n }}</button>
                    <hr class="new-menu-sep" />
                    @for (kind of kinds; track kind.type) {
                      <button type="button" (click)="create(kind.type, $event)">{{ createLabel(kind) }}</button>
                    }
                  </div>
                </details>
              </div>
            </header>

            <nav class="compact-pills" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()" [attr.aria-label]="'filter' | i18n">
              <button type="button" [attr.aria-pressed]="filter() === null" (click)="setFilter(null)">{{ tOr('all', 'All') }}</button>
              @for (kind of compactKinds(); track kind.type) {
                <button type="button" [attr.aria-pressed]="filter() === kind.type" (click)="setFilter(kind.type)">{{ chipLabel(kind) }}</button>
              }
            </nav>

            @if (fillStatus(); as status) {
              <div class="local-fill-status" data-testid="local-fill-status" role="status">
                <span>{{ status.text }}</span>
                <div class="local-fill-status-actions">
                  @if (status.action === 'practice') {
                    <button type="button" class="local-fill-act" data-testid="local-fill-open-practice" (click)="openOrCreatePractice()">{{ 'vkWtStepForm' | i18n }}</button>
                  } @else if (status.action === 'sample') {
                    <button type="button" class="local-fill-act" data-testid="local-fill-try-sample" (click)="startSample('passport')">{{ 'vkSamplePassport' | i18n }}</button>
                  }
                  <button type="button" class="local-fill-dismiss" (click)="fillStatus.set(null)">{{ 'close' | i18n }}</button>
                </div>
              </div>
            }

            @if (offer() || protecting()) {
              <section class="protection-offer" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()">
                <span class="offer-text">{{ 'vowkeyLocalKeepOffer' | i18n }}</span>
                <div class="offer-actions">
                  @if (syncAvailable()) {
                    <a class="offer-link" routerLink="/signup">{{ 'createAccount' | i18n }}</a>
                  }
                  @if (!native && !hasPassword()) {
                    <form class="protect-form" (ngSubmit)="protect()">
                      <input type="password" name="newPassword" [attr.aria-label]="'vowkeyLocalPassword' | i18n" [placeholder]="'vowkeyLocalPassword' | i18n" [(ngModel)]="newPassword" autocomplete="new-password" required />
                      <button bitButton buttonType="secondary" type="submit" [disabled]="busy()">{{ 'vowkeyLocalSetPassword' | i18n }}</button>
                    </form>
                  }
                  <button type="button" class="offer-dismiss" (click)="dismissOffer()">{{ 'close' | i18n }}</button>
                </div>
              </section>
            }

            @if (sampleItems().length > 0) {
              <div class="local-wt-bar" data-testid="local-walkthrough-bar">
                <div class="local-wt-left">
                  <span class="local-wt-badge">{{ 'vkSampleBadge' | i18n }}</span>
                  <div class="local-wt-steps">
                    <button type="button" [class.on]="!practiceOpen()" data-testid="local-wt-details" (click)="openSampleDetails()">{{ 'vkWtStepDetails' | i18n }}</button>
                    <button type="button" [class.on]="practiceOpen()" data-testid="local-wt-form" (click)="openPractice()">{{ 'vkWtStepForm' | i18n }}</button>
                  </div>
                  <div class="local-wt-scenarios">
                    @for (scenario of sampleScenarios; track scenario.id) {
                      <button type="button" class="local-wt-doc" [class.on]="activeSampleScenario()?.id === scenario.id" (click)="startSample(scenario.id)">{{ sampleLabelKey(scenario.id) | i18n }}</button>
                    }
                  </div>
                </div>
                <button type="button" class="local-wt-clear" data-testid="local-clear-sample" (click)="clearSamples()">{{ 'vkWtClearSample' | i18n }}</button>
              </div>
            }

            <div class="panes">
              <section class="item-list" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()" [attr.aria-label]="'allItems' | i18n">
                @if (visible().length > 0) {
                  @if (suggestedItems().length > 0) {
                    <div class="vk-list-group-label" data-testid="local-suggested-header">{{ suggestedHeading() }}</div>
                    @for (item of suggestedItems(); track item.id) {
                      <button type="button" class="vk-row" [attr.aria-pressed]="selected()?.id === item.id && !practiceOpen()" (click)="select(item)">
                        <span class="row-glyph" aria-hidden="true">{{ rowInitial(item) }}</span>
                        <span class="row-text">
                          <strong>{{ item.name }}</strong>
                          <small>{{ itemSubtitle(item) }}</small>
                        </span>
                      </button>
                    }
                    @if (remainingVisible().length > 0) {
                      <div class="vk-list-group-label">{{ 'allItems' | i18n }}</div>
                    }
                  }
                  @for (item of remainingVisible(); track item.id) {
                    <button type="button" class="vk-row" [attr.aria-pressed]="selected()?.id === item.id && !practiceOpen()" (click)="select(item)">
                      <span class="row-glyph" aria-hidden="true">{{ rowInitial(item) }}</span>
                      <span class="row-text">
                        <strong>{{ item.name }}</strong>
                        <small>{{ itemSubtitle(item) }}</small>
                      </span>
                    </button>
                  }
                } @else {
                  <div class="empty-list">
                    <p>{{ 'vowkeyLocalEmpty' | i18n }}</p>
                    <div class="empty-compact">
                      <ng-container *ngTemplateOutlet="emptyHow" />
                    </div>
                  </div>
                }
              </section>

              <section class="item-detail" [class.show-compact]="detailOpen() || config() != null || practiceOpen()">
                @if (config(); as formConfig) {
                  <div class="detail-bar">
                    <button type="button" class="back-btn" (click)="cancelEdit()">← {{ 'cancel' | i18n }}</button>
                    <div class="detail-actions">
                      <button bitButton buttonType="secondary" type="button" class="wide-cancel" (click)="cancelEdit()">{{ 'cancel' | i18n }}</button>
                      <button bitButton buttonType="primary" type="submit" form="local-item-form">{{ 'save' | i18n }}</button>
                    </div>
                  </div>
                  <div class="detail-card">
                    <vault-cipher-form formId="local-item-form" [config]="formConfig" (cipherSaved)="saved($event)" />
                  </div>
                } @else if (practiceOpen() && activeSample() && activeSampleScenario(); as spec) {
                  <div class="detail-bar">
                    <button type="button" class="back-btn" (click)="openSampleDetails()">← {{ 'back' | i18n }}</button>
                    <div class="detail-actions">
                      @if (practiceFilled()) {
                        <button bitButton buttonType="secondary" type="button" (click)="resetPractice()">{{ 'vkWtClearFields' | i18n }}</button>
                      }
                      <button bitButton buttonType="primary" type="button" data-testid="local-practice-fill" (click)="fillPractice()">{{ 'vkWtFillNow' | i18n }}</button>
                    </div>
                  </div>
                  <div class="detail-card local-pf-card" data-testid="local-practice-form">
                    <div class="local-pf-head">
                      <h3>{{ spec.practiceFormTitle }}</h3>
                      <p>{{ spec.practiceFormSubtitle }}</p>
                    </div>
                    <div class="local-pf-grid">
                      @for (field of spec.fields; track field.key) {
                        <label class="local-pf-field" [class.wide]="field.wide">
                          <span class="local-pf-label">
                            <span>{{ field.practiceFieldLabel }}</span>
                            @if (practiceValues()[field.key]) {
                              <em class="local-pf-src">{{ 'vkSampleBadge' | i18n }}</em>
                            }
                          </span>
                          <input type="text" [class.filled]="!!practiceValues()[field.key]" [attr.data-testid]="'local-pf-' + field.key" [ngModel]="practiceValues()[field.key] ?? ''" (ngModelChange)="setPracticeField(field.key, $event)" />
                        </label>
                      }
                      <label class="local-pf-field wide">
                        <span class="local-pf-label">
                          <span>{{ spec.humanFieldLabel }}</span>
                          <em class="local-pf-human">{{ 'vkWtNeedsYou' | i18n }}</em>
                        </span>
                        <input type="text" data-testid="local-pf-human" [placeholder]="spec.humanFieldPlaceholder" [ngModel]="practiceHuman()" (ngModelChange)="practiceHuman.set($event)" />
                      </label>
                    </div>
                    @if (practiceFilled()) {
                      <div class="local-pf-status" data-testid="local-practice-status">
                        <span>{{ practiceSummary() }}</span>
                        <button type="button" class="local-pf-back" (click)="openSampleDetails()">{{ 'vkWtBackToDetails' | i18n }}</button>
                      </div>
                    }
                  </div>
                } @else if (selected(); as item) {
                  <div class="detail-bar">
                    <button type="button" class="back-btn" (click)="backToList()">← {{ 'back' | i18n }}</button>
                    <div class="detail-actions">
                      @if (browserExtension && (item.type === cipherType.Identity || item.type === cipherType.Login || item.type === cipherType.Card)) {
                        <button bitButton buttonType="primary" type="button" data-testid="local-detail-fill-page" [disabled]="busy()" (click)="fillActivePage()">{{ tOr('vkFillThisPage', 'Fill this page') }}</button>
                      }
                      @if (isSample(item)) {
                        <button bitButton [buttonType]="browserExtension ? 'secondary' : 'primary'" type="button" data-testid="local-open-practice" (click)="openPractice()">{{ 'vkWtStepForm' | i18n }}</button>
                        <button bitButton buttonType="secondary" type="button" data-testid="local-detail-fill-form" [disabled]="busy()" (click)="triggerFillForm(formInput)">{{ tOr('vkFillForm', 'Fill a form') }}</button>
                      } @else if (item.type === cipherType.Identity) {
                        <button bitButton buttonType="secondary" type="button" data-testid="local-detail-add-document" [disabled]="busy()" (click)="docInput.click()">{{ tOr('vkAddDocument', 'Add document') }}</button>
                        <button bitButton [buttonType]="browserExtension ? 'secondary' : 'primary'" type="button" data-testid="local-detail-fill-form" [disabled]="busy()" (click)="triggerFillForm(formInput)">{{ tOr('vkFillForm', 'Fill a form') }}</button>
                      }
                      <button bitButton buttonType="secondary" type="button" (click)="edit(item)">{{ 'edit' | i18n }}</button>
                    </div>
                  </div>
                  <div class="detail-card">
                    @if (readsAsProfile(item)) {
                      @if (startAddingDetail()) {
                        <app-profile [cipher]="item" [startAdding]="true" />
                      } @else {
                        <app-profile [cipher]="item" />
                      }
                    } @else {
                      <app-cipher-view [cipher]="item" [hideChangePasswordLink]="true" [hideHeader]="true" />
                    }
                  </div>
                } @else {
                  <div class="detail-empty">
                    <ng-container *ngTemplateOutlet="emptyHow" />
                  </div>
                }
              </section>
            </div>

            <footer class="compact-footer" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()">
              <span class="foot-scope">{{ 'vowkeyLocalVault' | i18n }}</span>
              <div class="foot-links">
                @if (agentManagement != null) {
                  <button type="button" (click)="openAgents()">{{ 'vowkeyAgents' | i18n }}</button>
                }
                @if (syncAvailable()) {
                  @if (agentManagement != null) {
                    <span aria-hidden="true">·</span>
                  }
                  <a routerLink="/login">{{ 'logIn' | i18n }}</a>
                  <span aria-hidden="true">·</span>
                  <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
                }
                @if (canLock() && !locked()) {
                  <span aria-hidden="true">·</span>
                  <button type="button" (click)="lock()">{{ 'lock' | i18n }}</button>
                }
              </div>
            </footer>
          }
        }
      </section>
    </main>
  
    <ng-template #emptyHow>
      <ol class="local-how">
        <li class="blue">
          <span class="local-how-tile"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h6.6L18 7.9V20.5H7zM13.4 3.7v4.4H18M9.6 12.4h5.8M9.6 15.4h5.8"/></svg></span>
          <b>{{ tOr('vkEmptyStepAdd', 'Add a passport or ID') }}</b>
        </li>
        <li class="amber">
          <span class="local-how-tile"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4.6a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM5.2 19.6c.5-3.4 3.2-5.4 6.8-5.4s6.3 2 6.8 5.4"/></svg></span>
          <b>{{ tOr('vkEmptyStepSave', 'Vowkey saves each detail') }}</b>
        </li>
        <li class="green">
          <span class="local-how-tile"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.8h12a1 1 0 0 1 1 1v14.4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1zM8.6 8.4h6.8M8.6 12h6.8M8.6 15.6h4.2"/></svg></span>
          <b>{{ tOr('vkEmptyStepFill', 'Fill any form in one press') }}</b>
        </li>
      </ol>
      <div class="empty-actions">
        <button type="button" class="primary" data-testid="local-empty-add-document" [disabled]="busy()" (click)="docInput.click()">{{ tOr('vkAddDocument', 'Add document') }}</button>
        <button type="button" data-testid="local-load-sample-workspace" [disabled]="busy()" (click)="loadSampleWorkspace()">{{ tOr('vkTryWithSampleDocuments', 'Try sample documents') }}</button>
      </div>
    </ng-template>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      color: var(--vk-ink);
      font-family: var(--font-sans);
      background: var(--vk-paper);
    }
    .vk-local {
      display: grid;
      grid-template-columns: 232px minmax(0, 1fr);
      min-height: 100vh;
      height: 100%;
      background: var(--vk-paper);
      color: var(--vk-ink);
    }
    .vk-local.locked { grid-template-columns: minmax(0, 1fr); }
    .vk-local-side {
      display: flex;
      flex-direction: column;
      padding: 18px 12px 14px;
      background: var(--vk-sidebar);
      border-right: 1px solid var(--vk-line);
    }
    .vk-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 4px 8px 16px;
    }
    .vk-emblem { flex: none; }
    .vk-brand-copy { min-width: 0; }
    .vk-brand-copy h1 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: var(--vk-ink);
    }
    .scope {
      margin: 2px 0 0;
      font-size: 12.5px;
      color: var(--vk-muted);
      line-height: 1.2;
    }
    .vk-side-nav {
      display: grid;
      gap: 2px;
      flex: 1;
      align-content: start;
    }
    .vk-side-nav button {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      height: 34px;
      padding: 0 10px;
      border: 0;
      border-radius: var(--vk-radius-control, 8px);
      background: none;
      color: var(--vk-ink);
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
    }
    .vk-side-nav button svg { color: var(--vk-muted); flex: none; }
    .vk-side-nav button:hover { background: var(--vk-hover); }
    .vk-side-nav button[aria-pressed="true"] {
      background: var(--vk-selected);
      font-weight: 600;
    }
    .vk-side-nav button[aria-pressed="true"] svg { color: var(--vk-ink); }
    .account-links {
      display: grid;
      gap: 4px;
      padding-top: 12px;
      margin-top: 12px;
      border-top: 1px solid var(--vk-line-soft);
    }
    .account-links a,
    .account-links button {
      display: flex;
      align-items: center;
      height: 32px;
      padding: 0 10px;
      border: 0;
      border-radius: var(--vk-radius-control, 8px);
      background: none;
      color: var(--vk-muted);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      text-align: left;
      cursor: pointer;
    }
    .account-links a:hover,
    .account-links button:hover {
      background: var(--vk-hover);
      color: var(--vk-ink);
    }
    .workspace {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      background: var(--vk-paper);
    }
    .notice {
      margin: 12px 16px 0;
      padding: 10px 14px;
      border-radius: var(--vk-radius-control, 8px);
      border: 1px solid color-mix(in srgb, var(--vk-red) 35%, var(--vk-line));
      background: color-mix(in srgb, var(--vk-red) 8%, var(--vk-surface));
      color: var(--vk-red);
      font-size: 13px;
    }
    .unlock-stage {
      display: grid;
      place-items: center;
      flex: 1;
      padding: 28px 16px;
    }
    .unlock-card {
      width: 100%;
      max-width: 380px;
      padding: 28px 24px 24px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-panel, 16px);
      background: var(--vk-card);
      box-shadow: var(--vk-shadow-panel);
      text-align: center;
    }
    .unlock-emblem { margin: 0 auto 14px; display: block; }
    .unlock-card h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--vk-ink);
    }
    .unlock-sub {
      margin: 4px 0 20px;
      font-size: 13px;
      color: var(--vk-muted);
    }
    .vk-field {
      display: grid;
      gap: 6px;
      margin-bottom: 14px;
      text-align: left;
      font-size: 13px;
      font-weight: 500;
      color: var(--vk-ink);
    }
    .vk-field input {
      width: 100%;
      height: 38px;
      padding: 0 12px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-surface);
      color: var(--vk-ink);
      font: inherit;
      font-size: 14px;
    }
    .session-ended {
      margin: 0 0 16px;
      font-size: 13.5px;
      line-height: 1.45;
      color: var(--vk-muted);
    }
    .unlock-links {
      display: none;
      justify-content: center;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      font-size: 13px;
      color: var(--vk-muted);
    }
    .unlock-links a {
      color: var(--vk-muted);
      text-decoration: none;
      font-weight: 500;
    }
    .unlock-links a:hover { color: var(--vk-ink); }
    .vk-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      height: 54px;
      padding: 0 18px;
      border-bottom: 1px solid var(--vk-line);
      background: var(--vk-surface);
    }
    .compact-brand { display: none; flex: none; }
    .search-box {
      position: relative;
      flex: 1;
      max-width: 360px;
    }
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--vk-faint);
      pointer-events: none;
    }
    .search-box input {
      width: 100%;
      height: 34px;
      padding: 0 10px 0 32px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-paper);
      color: var(--vk-ink);
      font: inherit;
      font-size: 13.5px;
    }
    .search-box input::placeholder { color: var(--vk-faint); }
    .sr-file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: none;
    }
    .topbar-ghost-btn {
      display: inline-flex;
      align-items: center;
      height: 34px;
      padding: 0 12px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-paper);
      color: var(--vk-ink);
      font: inherit;
      font-size: 13.5px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .topbar-ghost-btn:hover { background: var(--vk-hover); }
    .topbar-ghost-btn:disabled { opacity: 0.55; cursor: default; }
    .fill-page-btn {
      display: inline-flex;
      align-items: center;
      height: 34px;
      padding: 0 13px;
      border: 0;
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-blue);
      color: #ffffff;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .fill-page-btn:hover { background: var(--vk-blue-ink); }
    .fill-page-btn:disabled { opacity: 0.55; cursor: default; }
    .new-menu { position: relative; flex: none; }
    .new-menu summary {
      list-style: none;
      display: inline-flex;
      align-items: center;
      height: 34px;
      padding: 0 13px;
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-blue);
      color: #ffffff;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
    }
    .new-menu.has-fill-cta summary {
      border: 1px solid var(--vk-line);
      background: var(--vk-paper);
      color: var(--vk-ink);
      padding: 0 11px;
    }
    .new-menu.has-fill-cta summary:hover { background: var(--vk-hover); }
    .new-menu summary::-webkit-details-marker { display: none; }
    .new-menu summary:hover { background: var(--vk-blue-ink); }
    .new-menu-sheet {
      position: absolute;
      right: 0;
      top: calc(100% + 6px);
      z-index: 30;
      min-width: 184px;
      padding: 5px;
      border: 1px solid var(--vk-line);
      border-radius: 12px;
      background: var(--vk-card);
      box-shadow: var(--vk-shadow-panel);
    }
    .new-menu-sheet button {
      display: block;
      width: 100%;
      padding: 8px 11px;
      border: 0;
      border-radius: 7px;
      background: none;
      color: var(--vk-ink);
      font: inherit;
      font-size: 13.5px;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
    }
    .new-menu-sheet button:hover { background: var(--vk-hover); }
    .new-menu-sep {
      margin: 4px 6px;
      border: 0;
      border-top: 1px solid var(--vk-line-soft);
    }
    .local-fill-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 9px 18px;
      border-bottom: 1px solid var(--vk-line);
      background: color-mix(in srgb, var(--vk-blue) 6%, var(--vk-surface));
      color: var(--vk-ink);
      font-size: 13px;
      line-height: 1.4;
    }
    .local-fill-status-actions {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .local-fill-act {
      height: 27px;
      padding: 0 10px;
      border: 1px solid color-mix(in srgb, var(--vk-blue) 35%, var(--vk-line));
      border-radius: 7px;
      background: var(--vk-surface);
      color: var(--vk-blue);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .local-fill-act:hover { background: var(--vk-hover); }
    .local-fill-dismiss {
      border: 0;
      padding: 0 4px;
      background: none;
      color: var(--vk-muted);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    .local-fill-dismiss:hover { color: var(--vk-ink); }
    .compact-pills,
    .compact-footer,
    .compact-subhead { display: none; }
    .protection-offer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 18px;
      border-bottom: 1px solid var(--vk-line);
      background: var(--vk-surface);
      font-size: 13px;
    }
    .offer-text { color: var(--vk-muted); }
    .offer-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .offer-link {
      color: var(--vk-blue);
      font-weight: 600;
      text-decoration: none;
    }
    .protect-form {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .protect-form input {
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-paper);
      color: var(--vk-ink);
      font: inherit;
      font-size: 13px;
    }
    .offer-dismiss {
      border: 0;
      background: none;
      color: var(--vk-faint);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    .offer-dismiss:hover { color: var(--vk-ink); }
    .panes {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      flex: 1;
      min-height: 0;
    }
    .item-list {
      padding: 8px;
      border-right: 1px solid var(--vk-line);
      background: var(--vk-surface);
      overflow-y: auto;
    }
    .vk-list-group-label {
      padding: 6px 10px 4px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--vk-muted);
    }
    .vk-row + .vk-list-group-label {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--vk-line-soft);
    }
    .vk-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 48px;
      padding: 7px 10px;
      border: 0;
      border-radius: var(--vk-radius-row, 10px);
      background: none;
      color: var(--vk-ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .vk-row + .vk-row { margin-top: 2px; }
    .vk-row:hover { background: var(--vk-hover); }
    .vk-row[aria-pressed="true"] { background: var(--vk-selected); }
    .row-glyph {
      display: grid;
      place-items: center;
      flex: none;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid var(--vk-line-soft);
      background: var(--vk-paper);
      color: var(--vk-ink);
      font-size: 12.5px;
      font-weight: 600;
    }
    .row-text {
      display: grid;
      min-width: 0;
      flex: 1;
      gap: 1px;
    }
    .row-text strong {
      overflow: hidden;
      font-size: 14px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row-text small {
      overflow: hidden;
      font-size: 12.5px;
      color: var(--vk-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty-list {
      padding: 28px 16px;
      text-align: center;
      color: var(--vk-muted);
      font-size: 13.5px;
    }
    .empty-list p { margin: 0 0 14px; }
    .empty-actions {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .empty-actions button {
      height: 32px;
      padding: 0 12px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-paper);
      color: var(--vk-ink);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .empty-actions button:hover { background: var(--vk-hover); }
    .empty-actions button.primary { border-color: transparent; background: var(--vk-blue); color: #fff; }
    .empty-actions button.primary:hover { background: var(--vk-blue); opacity: 0.92; }
    .item-detail {
      min-width: 0;
      padding: 20px 24px;
      overflow-y: auto;
      background: var(--vk-paper);
    }
    .detail-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 14px;
    }
    .back-btn {
      display: none;
      align-items: center;
      gap: 4px;
      min-height: 32px;
      padding: 4px 10px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-surface);
      color: var(--vk-ink);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .back-btn:hover { background: var(--vk-hover); }
    .detail-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }
    .detail-actions button {
      white-space: nowrap;
    }
    .detail-card {
      padding: 18px 20px;
      border: 1px solid var(--vk-line);
      border-radius: 12px;
      background: var(--vk-card);
    }
    .detail-empty {
      display: grid;
      place-items: center;
      align-content: center;
      gap: 12px;
      min-height: 260px;
      color: var(--vk-muted);
      font-size: 14px;
      text-align: center;
    }
    .detail-empty p { margin: 0; }
    .local-how {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      gap: 14px;
      margin: 22px 0;
      padding: 0;
      list-style: none;
    }
    .local-how li {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 116px;
    }
    .local-how li + li::before {
      position: absolute;
      top: 24px;
      left: -14px;
      width: 14px;
      color: var(--vk-muted);
      line-height: 1;
      text-align: center;
      content: "→";
    }
    .local-how-tile {
      display: grid;
      width: 56px;
      height: 56px;
      place-items: center;
      border-radius: 16px;
    }
    .local-how .blue .local-how-tile { background: var(--vk-blue-soft); color: var(--vk-blue); }
    .local-how .amber .local-how-tile { background: var(--vk-amber-soft); color: var(--vk-amber); }
    .local-how .green .local-how-tile { background: color-mix(in srgb, var(--vk-green) 14%, var(--vk-surface)); color: var(--vk-green); }
    .local-how b { font-size: 13px; font-weight: 600; line-height: 1.3; color: var(--vk-ink); }
    .empty-compact { display: none; }
    .local-wt-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 14px;
      border-bottom: 1px solid var(--vk-line);
      background: color-mix(in srgb, var(--vk-blue) 5%, var(--vk-surface));
    }
    .local-wt-left {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .local-wt-badge {
      padding: 2px 7px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--vk-blue) 14%, var(--vk-surface));
      color: var(--vk-blue);
      font-size: 11px;
      font-weight: 700;
    }
    .local-wt-steps {
      display: inline-flex;
      padding: 2px;
      border: 1px solid var(--vk-line);
      border-radius: 8px;
      background: var(--vk-surface);
    }
    .local-wt-steps button {
      height: 24px;
      padding: 0 8px;
      border: 0;
      border-radius: 6px;
      background: none;
      color: var(--vk-muted);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .local-wt-steps button.on {
      background: var(--vk-ink);
      color: var(--vk-paper);
    }
    .local-wt-scenarios {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .local-wt-doc {
      height: 24px;
      padding: 0 8px;
      border: 1px solid var(--vk-line);
      border-radius: 8px;
      background: var(--vk-surface);
      color: var(--vk-muted);
      font: inherit;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .local-wt-doc.on {
      border-color: var(--vk-blue);
      color: var(--vk-blue);
      font-weight: 600;
    }
    .local-wt-clear {
      height: 26px;
      padding: 0 9px;
      border: 1px solid var(--vk-line);
      border-radius: 7px;
      background: var(--vk-surface);
      color: var(--vk-red);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .local-wt-clear:hover { background: var(--vk-hover); }
    .local-pf-head h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      color: var(--vk-ink);
    }
    .local-pf-head p {
      margin: 3px 0 16px;
      color: var(--vk-muted);
      font-size: 13px;
    }
    .local-pf-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px 14px;
    }
    .local-pf-field { display: grid; gap: 5px; }
    .local-pf-field.wide { grid-column: 1 / -1; }
    .local-pf-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--vk-ink);
    }
    .local-pf-src,
    .local-pf-human {
      padding: 1px 6px;
      border-radius: 8px;
      font-style: normal;
      font-size: 10.5px;
      font-weight: 600;
    }
    .local-pf-src {
      background: color-mix(in srgb, var(--vk-blue) 12%, var(--vk-surface));
      color: var(--vk-blue);
    }
    .local-pf-human {
      background: color-mix(in srgb, var(--vk-amber) 14%, var(--vk-surface));
      color: var(--vk-amber);
    }
    .local-pf-field input {
      width: 100%;
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--vk-line);
      border-radius: var(--vk-radius-control, 8px);
      background: var(--vk-paper);
      color: var(--vk-ink);
      font: inherit;
      font-size: 13.5px;
    }
    .local-pf-field input.filled {
      border-color: color-mix(in srgb, var(--vk-blue) 55%, var(--vk-line));
      background: color-mix(in srgb, var(--vk-blue) 6%, var(--vk-paper));
      font-weight: 600;
    }
    .local-pf-status {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--vk-line);
      font-size: 13px;
      font-weight: 500;
      color: var(--vk-ink);
    }
    .local-pf-back {
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--vk-line);
      border-radius: 7px;
      background: var(--vk-surface);
      color: var(--vk-ink);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    .agents-wrap { flex: 1; overflow-y: auto; }
    button:focus-visible,
    a:focus-visible,
    summary:focus-visible {
      outline: 2px solid var(--vk-ink);
      outline-offset: 2px;
    }
    input:focus-visible {
      outline: none;
      border-color: var(--vk-ink);
      box-shadow: 0 0 0 3px var(--vk-selected);
    }
    @media (max-width: 860px) {
      .vk-local { grid-template-columns: 188px minmax(0, 1fr); }
      .panes { grid-template-columns: 224px minmax(0, 1fr); }
      .item-detail { padding: 16px; }
    }
    @media (max-width: 680px) {
      .vk-local {
        display: flex;
        flex-direction: column;
        height: 100vh;
        min-height: 100vh;
      }
      .vk-local-side { display: none; }
      .unlock-links { display: flex; }
      .workspace { flex: 1; height: 100%; overflow: hidden; }
      .vk-topbar {
        height: 50px;
        padding: 0 12px;
        gap: 8px;
      }
      .compact-brand { display: grid; place-items: center; }
      .search-box { max-width: none; }
      .compact-pills {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        overflow-x: auto;
        border-bottom: 1px solid var(--vk-line);
        background: var(--vk-paper);
        scrollbar-width: none;
      }
      .compact-pills::-webkit-scrollbar { display: none; }
      .compact-pills button {
        flex: none;
        height: 27px;
        padding: 0 9px;
        border: 1px solid var(--vk-line);
        border-radius: 8px;
        background: var(--vk-surface);
        color: var(--vk-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
      }
      .compact-pills button[aria-pressed="true"] {
        border-color: var(--vk-ink);
        background: var(--vk-ink);
        color: var(--vk-paper);
        font-weight: 600;
      }
      .hide-compact-inline { display: none; }
      .local-fill-status { padding: 8px 12px; font-size: 12.5px; }
      .compact-subhead {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 48px;
        padding: 0 12px;
        border-bottom: 1px solid var(--vk-line);
        background: var(--vk-surface);
      }
      .compact-subhead .back-btn { display: inline-flex; }
      .panes {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .item-list {
        flex: 1;
        border-right: 0;
        overflow-y: auto;
      }
      .item-detail {
        display: none;
        flex: 1;
        padding: 12px;
        overflow-y: auto;
      }
      .item-detail.show-compact { display: block; }
      .hide-compact { display: none !important; }
      .detail-bar { justify-content: space-between; margin-bottom: 10px; }
      .back-btn { display: inline-flex; }
      .wide-cancel { display: none; }
      .detail-card { padding: 14px; }
      .empty-compact { display: block; }
      .local-pf-grid { grid-template-columns: minmax(0, 1fr); }
      .local-wt-scenarios { display: none; }
      .compact-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        height: 38px;
        padding: 0 12px;
        border-top: 1px solid var(--vk-line);
        background: var(--vk-surface);
        font-size: 12px;
        color: var(--vk-muted);
      }
      .foot-links {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .foot-links a,
      .foot-links button {
        border: 0;
        padding: 0;
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
      }
      .foot-links a:hover,
      .foot-links button:hover { color: var(--vk-ink); }
    }
  `],
})
export class LocalVaultComponent implements OnInit, OnDestroy {
  private readonly vault = inject(LocalVaultService);
  private readonly accounts = inject(AccountService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly i18n = inject(I18nService);
  private readonly environmentService = inject(EnvironmentService, { optional: true });
  /** True while the vault is linked to an account that has to be signed in to open it. */
  readonly attached = signal(false);
  /** Whether that link can be dropped: only a vault with nothing in it can. */
  readonly canStartOver = signal(false);
  /** A locked vault shows its unlock card alone; an error appears only after an attempt. */
  readonly unlockTried = signal(false);
  /** Sign-in and sign-up show only when the configured server answers. */
  readonly syncAvailable = signal(false);
  private readonly inference = inject(ProductInference, { optional: true });
  private readonly totpService = inject(TotpService, { optional: true });
  private readonly toastService = inject(ToastService, { optional: true });
  readonly cipherType = CipherType;
  private readonly platformUtils = inject(PlatformUtilsService);
  readonly native = this.platformUtils.getClientType() === ClientType.Desktop;
  readonly browserExtension = this.platformUtils.getClientType() === ClientType.Browser;
  readonly activeTabUrl = signal("");
  readonly activeTabDomain = computed(() => extractHostFromUrl(this.activeTabUrl()));
  readonly agentManagement = inject(LOCAL_AGENT_MANAGEMENT, { optional: true });
  readonly showAgents = signal(false);
  readonly detailOpen = signal(false);
  readonly startAddingDetail = signal(false);
  readonly items = signal<CipherView[]>([]);
  readonly selected = signal<CipherView | null>(null);
  readonly config = signal<CipherFormConfig | null>(null);
  readonly search = signal("");
  readonly filter = signal<CipherType | null>(null);
  readonly locked = signal(false);
  readonly ready = signal(false);
  readonly hasPassword = signal(false);
  readonly offer = signal(false);
  readonly protecting = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly practiceOpen = signal(false);
  readonly practiceValues = signal<Record<string, string>>({});
  readonly practiceHuman = signal("");
  readonly practiceFilled = signal(false);
  readonly fillStatus = signal<{ text: string; action?: "practice" | "sample" } | null>(null);
  readonly sampleScenarios = SAMPLE_SCENARIO_LIST;
  readonly isSample = isSampleProfile;
  private readonly localeTick = signal(0);
  readonly sampleItems = computed(() => this.items().filter((item) => isSampleProfile(item)));
  readonly activeSample = computed<CipherView | null>(() => {
    const sel = this.selected();
    if (sel && isSampleProfile(sel)) { return sel; }
    return this.sampleItems()[0] ?? null;
  });
  readonly activeSampleScenario = computed(() => {
    this.localeTick();
    return localizeSampleScenario(sampleScenarioOf(this.activeSample()), (key) => this.i18n.t(key));
  });
  readonly practiceSummary = computed(() => {
    const spec = this.activeSampleScenario();
    if (!spec) { return ""; }
    return this.i18n.t("vkWtFilledSummary", String(spec.fields.length), spec.sourceLabel, spec.humanFieldLabel);
  });
  readonly canLock = computed(() => this.native || this.hasPassword());
  readonly kinds: {
    type: CipherType;
    label: string;
    fallback: string;
    chipKey: string;
    chipFallback: string;
    devOnly?: boolean;
  }[] = [
    { type: CipherType.Identity, label: "profile", fallback: "Profile", chipKey: "profiles", chipFallback: "Profiles" },
    { type: CipherType.Login, label: "typeLogin", fallback: "Login", chipKey: "logins", chipFallback: "Logins" },
    { type: CipherType.Card, label: "typeCard", fallback: "Card", chipKey: "cards", chipFallback: "Cards" },
    { type: CipherType.SecureNote, label: "typeSecureNote", fallback: "Note", chipKey: "notes", chipFallback: "Notes" },
    { type: CipherType.ApiKey, label: "typeApiKey", fallback: "API key", chipKey: "keys", chipFallback: "Keys", devOnly: true },
    { type: CipherType.Environment, label: "typeEnvironment", fallback: "Environment", chipKey: "environments", chipFallback: "Environments", devOnly: true },
  ];
  readonly compactKinds = computed(() =>
    this.kinds.filter((kind) => !kind.devOnly || this.items().some((item) => item.type === kind.type)),
  );
  readonly usableProfiles = computed(() =>
    this.items().filter(
      (item) =>
        item.type === CipherType.Identity &&
        !item.isDeleted &&
        (envelopeState(item) === "none" || profileUsableForFill(item)),
    ),
  );
  readonly visible = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.items().filter((item) => {
      if (this.filter() != null && item.type !== this.filter()) { return false; }
      if (!query) { return true; }
      return item.name.toLocaleLowerCase().includes(query) || (item.subTitle ?? "").toLocaleLowerCase().includes(query);
    });
  });
  readonly suggestedHeading = computed(() => {
    this.localeTick();
    const domain = this.activeTabDomain();
    return domain ? this.tOr("vkSuggestedForDomain", `Suggested for ${domain}`, domain) : "";
  });
  readonly suggestedItems = computed(() => {
    if (!this.browserExtension || this.search().trim()) {
      return [];
    }
    const domain = this.activeTabDomain();
    if (!domain) {
      return [];
    }
    const candidates = this.visible().filter((i) => !i.isDeleted);
    const matchingLogins = candidates
      .filter((i) => i.type === CipherType.Login && loginMatchesTabHost(i, domain))
      .sort((a, b) => scoreLoginAgainstHost(b, domain) - scoreLoginAgainstHost(a, domain));
    const currentFilter = this.filter();
    const profiles =
      currentFilter === null || currentFilter === CipherType.Identity
        ? this.usableProfiles().filter((p) => candidates.some((c) => c.id === p.id)).slice(0, 1)
        : [];
    const cards =
      currentFilter === null || currentFilter === CipherType.Card
        ? candidates.filter((i) => i.type === CipherType.Card).slice(0, 1)
        : [];
    if (matchingLogins.length === 0 && profiles.length === 0 && cards.length === 0) {
      return [];
    }
    return [...matchingLogins, ...profiles, ...cards];
  });
  readonly remainingVisible = computed(() => {
    const sug = this.suggestedItems();
    if (sug.length === 0) {
      return this.visible();
    }
    const sugIds = new Set(sug.map((i) => i.id));
    return this.visible().filter((i) => !sugIds.has(i.id));
  });
  password = "";
  newPassword = "";
  private readonly subscriptions = new Subscription();
  private generation = 0;
  private pendingUnlockForSave = false;
  private latestQueryParams: ParamMap | null = null;
  private lastAppliedParamSignature = "";

  ngOnInit(): void {
    void this.vault.isAttachedToAccount().then(async (attached) => {
      this.attached.set(attached);
      this.canStartOver.set(attached && (await this.vault.store.list("ciphers")).length === 0);
    }).catch((): void => undefined);
    if (this.environmentService) {
      void syncServerAnswers(this.environmentService).then((answers) => this.syncAvailable.set(answers));
    }
    if (this.i18n.locale$?.subscribe) {
      this.subscriptions.add(this.i18n.locale$.subscribe(() => this.localeTick.update((n) => n + 1)));
    }
    if (this.route?.queryParamMap) {
      this.subscriptions.add(
        this.route.queryParamMap.subscribe((params) => {
          this.latestQueryParams = params;
          if (params.get("unlockForSave") === "1") {
            this.pendingUnlockForSave = true;
          }
          if (this.ready() && !this.locked()) {
            this.applyUnlockedQueryParams(params);
          }
        }),
      );
    }
    if (this.browserExtension) {
      void this.refreshActiveBrowserTab();
    }
    if (this.auth != null) {
      this.subscriptions.add(this.auth.activeAccountStatus$.subscribe((status) => {
        if (status === AuthenticationStatus.Unlocked) {
          this.clear();
          void this.router.navigate(["/vault"]);
        }
      }));
    } else {
      this.subscriptions.add(this.accounts.activeAccount$.subscribe((account) => {
        if (account != null) { this.clear(); void this.router.navigate(["/vault"]); }
      }));
    }
    this.subscriptions.add(this.vault.state$.subscribe((state) => {
      this.locked.set(state === "persisted-locked");
      if (state === "persisted-locked") { this.clear(); }
    }));
    void this.act(async () => {
      await this.vault.initialize();
      this.hasPassword.set((await this.vault.protectionMetadata())?.wrappedUserKey != null);
      if (this.vault.state$.value === "empty") { await this.vault.ensureUnlocked(); }
      if (this.vault.state$.value !== "persisted-locked") { await this.refresh(); }
      this.ready.set(true);
      if (!this.locked() && this.latestQueryParams) {
        this.applyUnlockedQueryParams(this.latestQueryParams);
      }
    });
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.clear(); }
  private clear(): void {
    this.generation++; this.items.set([]); this.selected.set(null); this.config.set(null);
    this.detailOpen.set(false); this.startAddingDetail.set(false); this.practiceOpen.set(false); this.resetPractice();
    this.fillStatus.set(null);
    this.password = ""; this.newPassword = ""; this.protecting.set(false);
  }
  tOr(key: string, fallback: string, p1?: string, p2?: string, p3?: string): string {
    const translated = this.i18n.t(key, p1, p2, p3);
    return translated && translated !== key ? translated : fallback;
  }
  chipLabel(kind: (typeof this.kinds)[number]): string {
    return this.tOr(kind.chipKey, kind.chipFallback);
  }
  createLabel(kind: (typeof this.kinds)[number]): string {
    if (kind.type === CipherType.SecureNote) {
      return this.tOr("vkTypeNote", "Note");
    }
    return this.tOr(kind.label, kind.fallback);
  }
  setFilter(type: CipherType | null): void {
    this.filter.set(type); this.showAgents.set(false); this.detailOpen.set(false); this.startAddingDetail.set(false); this.practiceOpen.set(false); this.config.set(null);
  }
  openAgents(): void {
    this.showAgents.set(true); this.detailOpen.set(false); this.startAddingDetail.set(false); this.practiceOpen.set(false); this.config.set(null);
  }
  backToList(): void { this.config.set(null); this.practiceOpen.set(false); this.startAddingDetail.set(false); this.detailOpen.set(false); }
  cancelEdit(): void {
    this.config.set(null);
    if (this.selected() == null) { this.detailOpen.set(false); }
  }
  readsAsProfile(item: CipherView): boolean {
    return item.type === CipherType.Identity && readEnvelope(item) != null;
  }
  sampleLabelKey(id: SampleScenarioId): string {
    if (id === "idcard") { return "vkSampleIdCard"; }
    if (id === "residence") { return "vkSampleResidence"; }
    return "vkSamplePassport";
  }
  typeLabel(type: CipherType): string { return this.kinds.find((kind) => kind.type === type)?.label ?? "item"; }
  itemSubtitle(item: CipherView): string {
    if (item.subTitle) { return item.subTitle; }
    if (item.type === CipherType.Login) {
      const social = parseSocialSignIn(item);
      if (social) {
        return formatSocialSignInSummary(social, (k, p1) => this.i18n.t(k, p1));
      }
    }
    if (item.type === CipherType.SecureNote) { return this.tOr("notes", "Note"); }
    const kind = this.kinds.find((candidate) => candidate.type === item.type);
    return kind ? this.tOr(kind.label, kind.fallback) : this.i18n.t("item");
  }
  rowInitial(item: CipherView): string {
    const trimmed = (item.name || "").trim();
    return trimmed ? Array.from(trimmed)[0].toLocaleUpperCase() : "V";
  }
  select(item: CipherView): void { this.config.set(null); this.practiceOpen.set(false); this.startAddingDetail.set(false); this.selected.set(item); this.detailOpen.set(true); }
  create(type: CipherType, event: Event): void {
    this.showAgents.set(false); this.practiceOpen.set(false); this.startAddingDetail.set(false);
    (event.target as HTMLElement).closest("details")?.removeAttribute("open");
    if (type === CipherType.Identity) {
      void this.act(async () => {
        await this.vault.initialize();
        await this.vault.ensureUnlocked();
        const profile = new CipherView();
        profile.id = crypto.randomUUID();
        profile.type = CipherType.Identity;
        profile.name = this.tOr("profile", "Profile");
        profile.identity = new IdentityView();
        writeEnvelope(profile, newEnvelope(profile.id));
        const saved = await this.vault.save(profile);
        await this.refresh();
        this.config.set(null);
        this.selected.set(this.items().find((i) => i.id === saved.id) ?? saved);
        this.startAddingDetail.set(true);
        this.detailOpen.set(true);
      });
      return;
    }
    this.selected.set(null); this.detailOpen.set(true);
    this.config.set({ ...this.baseConfig(), mode: "add", cipherType: type });
  }
  triggerMenuFile(input: HTMLInputElement, event: Event): void {
    (event.target as HTMLElement).closest("details")?.removeAttribute("open");
    input.click();
  }
  triggerMenuFillForm(input: HTMLInputElement, event: Event): void {
    (event.target as HTMLElement).closest("details")?.removeAttribute("open");
    this.triggerFillForm(input);
  }
  triggerFillForm(input: HTMLInputElement): void {
    if (this.usableProfiles().length === 0) {
      this.fillStatus.set({
        text: this.tOr(
          "vkLocalNoProfileForFill",
          "Add a profile or try a sample document first, then choose a form to fill.",
        ),
        action: "sample",
      });
      return;
    }
    input.click();
  }
  private activeFillProfile(): CipherView | null {
    const sel = this.selected();
    const usable = this.usableProfiles();
    if (sel && usable.some((p) => p.id === sel.id)) {
      return sel;
    }
    return usable[0] ?? null;
  }
  private async refreshActiveBrowserTab(): Promise<void> {
    const tab = await queryActiveExtensionWebTab();
    if (tab?.url) {
      this.activeTabUrl.set(tab.url);
    }
  }
  private applyUnlockedQueryParams(params: ParamMap): void {
    const cipherId = params.get("cipherId")?.trim() || "";
    const mode = params.get("mode")?.trim() || "";
    const newTypeRaw = params.get("newType")?.trim() || "";
    const uri = params.get("uri")?.trim() || "";
    const name = params.get("name")?.trim() || "";
    const sig = `${cipherId}|${mode}|${newTypeRaw}|${uri}|${name}`;
    if (sig === "||||" || sig === this.lastAppliedParamSignature) {
      return;
    }
    this.lastAppliedParamSignature = sig;
    if (cipherId) {
      const item = this.items().find((candidate) => candidate.id === cipherId);
      if (item) {
        if (mode === "edit") {
          void this.edit(item);
        } else {
          this.select(item);
        }
      }
      return;
    }
    if (newTypeRaw) {
      const parsedType = Number(newTypeRaw) as CipherType;
      const supported: readonly CipherType[] = [
        CipherType.Login,
        CipherType.SecureNote,
        CipherType.Card,
        CipherType.Identity,
        CipherType.ApiKey,
        CipherType.Environment,
      ];
      if (!supported.includes(parsedType)) {
        return;
      }
      this.showAgents.set(false);
      this.practiceOpen.set(false);
      this.startAddingDetail.set(false);
      if (parsedType === CipherType.Identity) {
        void this.act(async () => {
          await this.vault.initialize();
          await this.vault.ensureUnlocked();
          const profile = new CipherView();
          profile.id = crypto.randomUUID();
          profile.type = CipherType.Identity;
          profile.name = name || this.tOr("profile", "Profile");
          profile.identity = new IdentityView();
          writeEnvelope(profile, newEnvelope(profile.id));
          const saved = await this.vault.save(profile);
          await this.refresh();
          this.config.set(null);
          this.selected.set(this.items().find((i) => i.id === saved.id) ?? saved);
          this.startAddingDetail.set(true);
          this.detailOpen.set(true);
        });
        return;
      }
      this.selected.set(null);
      this.detailOpen.set(true);
      this.config.set({
        ...this.baseConfig(),
        mode: "add",
        cipherType: parsedType,
        initialValues: {
          ...(name ? { name } : {}),
          ...(uri && parsedType === CipherType.Login ? { loginUri: uri } : {}),
        },
      });
    }
  }
  private pickBestCipherForTab(tabUrl: string): CipherView | null {
    const sel = this.selected();
    if (
      this.detailOpen() &&
      sel &&
      !sel.isDeleted &&
      (sel.type === CipherType.Login ||
        sel.type === CipherType.Card ||
        sel.type === CipherType.Identity)
    ) {
      return sel;
    }
    const domain = extractHostFromUrl(tabUrl);
    if (domain) {
      const matchingLogins = this.items()
        .filter((i) => !i.isDeleted && i.type === CipherType.Login && loginMatchesTabHost(i, domain))
        .sort((a, b) => scoreLoginAgainstHost(b, domain) - scoreLoginAgainstHost(a, domain));
      if (matchingLogins.length > 0) {
        return matchingLogins[0];
      }
    }
    return (
      this.activeFillProfile() ??
      this.items().find(
        (i) =>
          !i.isDeleted &&
          (i.type === CipherType.Identity ||
            i.type === CipherType.Login ||
            i.type === CipherType.Card),
      ) ??
      null
    );
  }
  fillActivePage(): Promise<void> {
    const ext = getExtensionChrome();
    if (!ext?.tabs?.query || !ext?.runtime?.sendMessage) {
      return Promise.resolve();
    }
    return this.act(async () => {
      const tab = await queryActiveExtensionWebTab();
      if (!tab || tab.id == null || !tab.url) {
        this.fillStatus.set({
          text: this.tOr(
            "vkExtOpenWebFormFirst",
            "Open a web form tab first, then select Fill this page.",
          ),
        });
        return;
      }
      this.activeTabUrl.set(tab.url);
      const targetCipher = this.pickBestCipherForTab(tab.url);
      if (!targetCipher) {
        this.fillStatus.set({
          text: this.tOr(
            "vkLocalNoProfileForFill",
            "Add a profile or try a sample document first, then choose a form to fill.",
          ),
          action: "sample",
        });
        return;
      }
      const response = await new Promise<
        { result?: { outcome?: string; totp?: string } } | undefined
      >((resolve) => {
        ext.runtime!.sendMessage!(
          {
            command: "fillCipherForPopup",
            tabId: tab.id,
            tabUrl: tab.url,
            cipherId: targetCipher.id,
          },
          (res) => resolve(res),
        );
      });
      if (response?.result?.outcome === "filled") {
        let copiedTotp = response.result.totp ?? "";
        if (!copiedTotp && targetCipher.type === CipherType.Login && targetCipher.login?.totp && this.totpService) {
          try {
            const generated = await firstValueFrom(this.totpService.getCode$(targetCipher.login.totp));
            copiedTotp = generated?.code ?? "";
          } catch {
            copiedTotp = "";
          }
        }
        if (copiedTotp) {
          this.platformUtils.copyToClipboard(copiedTotp);
          this.toastService?.showToast({
            variant: "success",
            title: "",
            message: this.tOr("copyVerificationCode", "Verification code copied"),
          });
        }
        const filledMsg = this.tOr(
          "vkExtFilledFromProfile",
          `Filled active tab from ${targetCipher.name}.`,
          targetCipher.name,
        );
        this.fillStatus.set({
          text: copiedTotp
            ? `${filledMsg} ${this.tOr("vkTotpCopied", "Verification code copied.")}`
            : filledMsg,
        });
        if ((await this.vault.afterFillOffer())?.show) {
          this.offer.set(true);
        }
        if (typeof window !== "undefined" && window.innerWidth <= 460 && window.history.length <= 2) {
          setTimeout(() => {
            try {
              window.close();
            } catch {
              // Ignore when opened as a regular browser tab.
            }
          }, 120);
        }
      } else {
        this.fillStatus.set({
          text: this.tOr(
            "vkLocalNoFieldsFilled",
            `No matching fields were filled on this page from ${targetCipher.name}.`,
            "this page",
            targetCipher.name,
          ),
        });
      }
    });
  }
  openOrCreatePractice(): Promise<void> {
    this.fillStatus.set(null);
    if (this.activeSample() != null) {
      this.openPractice();
      return Promise.resolve();
    }
    return this.startSample("passport").then(() => this.openPractice());
  }
  onFormFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return Promise.resolve();
    }
    const lower = file.name.toLowerCase();
    const flatPdfMessage = () =>
      this.tOr(
        "vkLocalFlatPdfDesktop",
        "PDF file filling runs in Vowkey for Desktop so flat and scanned PDFs stay on your device. Word (.docx), Excel (.xlsx), and Hangul (.hwpx) forms fill right here, or try Practice fill.",
      );
    if (lower.endsWith(".pdf") && !this.native) {
      const profile = this.activeFillProfile();
      if (!profile) {
        this.fillStatus.set({
          text: flatPdfMessage(),
          action: "practice",
        });
        return Promise.resolve();
      }
      return this.act(async () => {
        await SdkLoadService.Ready;
        const pdfOutcome = await this.tryFillInteractivePdfInBrowser(file, profile);
        if (pdfOutcome === "flat") {
          this.fillStatus.set({
            text: flatPdfMessage(),
            action: "practice",
          });
        }
      });
    }
    if (!lower.endsWith(".docx") && !lower.endsWith(".xlsx") && !lower.endsWith(".hwpx")) {
      this.fillStatus.set({
        text: this.tOr(
          "vkLocalUnsupportedForm",
          "Choose a Word (.docx), Excel (.xlsx), or Hangul (.hwpx) form to fill here.",
        ),
      });
      return Promise.resolve();
    }
    const profile = this.activeFillProfile();
    if (!profile) {
      this.fillStatus.set({
        text: this.tOr(
          "vkLocalNoProfileForFill",
          "Add a profile or try a sample document first, then choose a form to fill.",
        ),
        action: "sample",
      });
      return Promise.resolve();
    }
    return this.act(async () => {
      await SdkLoadService.Ready;
      const bytes = await readFileBytes(file);
      const details = { details: profile_details(fillableProfileFieldsOf(profile)).details };
      const result = lower.endsWith(".docx")
        ? fill_docx_with_profile(bytes, details)
        : lower.endsWith(".xlsx")
          ? fill_xlsx_with_profile(bytes, details)
          : fill_hwpx_with_profile(bytes, details);
      const filled = result.report.filled_count;
      if (filled === 0) {
        this.fillStatus.set({
          text: this.tOr(
            "vkLocalNoFieldsFilled",
            `No matching fields were filled in ${file.name} from ${profile.name}.`,
            file.name,
            profile.name,
          ),
        });
        return;
      }
      const outName = filledOutputFileName(file.name);
      this.downloadBytes(outName, Uint8Array.from(result.bytes), mediaTypeForForm(lower));
      this.fillStatus.set({
        text: this.tOr(
          "vkLocalFilledCount",
          `Filled ${filled} ${filled === 1 ? "field" : "fields"} in ${outName} from ${profile.name}.`,
          String(filled),
          outName,
          profile.name,
        ),
      });
    });
  }
  private async tryFillInteractivePdfInBrowser(
    file: File,
    profile: CipherView,
  ): Promise<"filled" | "none" | "flat"> {
    try {
      const bytes = await readFileBytes(file);
      const resources = new URL("pdfjs/", document.baseURI).href;
      const loading = getDocument({
        data: bytes.slice(),
        cMapUrl: `${resources}cmaps/`,
        standardFontDataUrl: `${resources}standard_fonts/`,
        wasmUrl: `${resources}wasm/`,
        iccUrl: `${resources}iccs/`,
      });
      if (!loading?.promise) {
        return "flat";
      }
      const pdf = await loading.promise;
      try {
        interface BrowserPdfWidget {
          id: string;
          fieldName: string;
          label: string;
          fieldType: "text" | "select-one" | "checkbox";
          maxLen: number;
          checkBoxValue?: string;
        }
        const widgets: BrowserPdfWidget[] = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const annotations = await page.getAnnotations({ intent: "display" });
          for (const ann of annotations as Array<Record<string, unknown>>) {
            if (ann.subtype !== "Widget" || ann.readOnly || ann.pushButton) {
              continue;
            }
            const id = String(ann.id ?? "");
            const fieldName = String(ann.fieldName ?? "").trim();
            if (!id || !fieldName) {
              continue;
            }
            const altText = String(ann.alternativeText ?? "").trim();
            const rawType = String(ann.fieldType ?? "");
            const fieldType: "text" | "select-one" | "checkbox" =
              rawType === "Ch"
                ? "select-one"
                : rawType === "Btn"
                  ? "checkbox"
                  : "text";
            widgets.push({
              id,
              fieldName,
              label: [altText, fieldName].filter(Boolean).join(" — ") || fieldName,
              fieldType,
              maxLen: typeof ann.maxLen === "number" && ann.maxLen > 0 ? ann.maxLen : 0,
              checkBoxValue: typeof ann.exportValue === "string" ? ann.exportValue : undefined,
            });
          }
          page.cleanup();
        }
        if (widgets.length === 0) {
          return "flat";
        }
        const inputs = widgets.map((w) => ({
          id: w.id,
          name: w.fieldName,
          label: w.label,
          placeholder: "",
          autocomplete: "",
          input_type: w.fieldType,
          section: "",
          form: "",
          pattern: "",
          max_length: w.maxLen,
          format: "",
          op_ignore: false,
        }));
        const { matches } = fill_fields_from_profile({
          fields: inputs,
          profile: fillableProfileFieldsOf(profile),
          explicit_fill: true,
          choices: [],
        });
        let filled = 0;
        matches.forEach((match, index) => {
          const widget = widgets[index];
          if (!widget || !match.value) {
            return;
          }
          if (widget.fieldType === "checkbox") {
            const truthy = /^(true|1|yes|on|checked)$/i.test(match.value.trim());
            pdf.annotationStorage.setValue(widget.id, {
              value: truthy ? widget.checkBoxValue ?? "Yes" : "Off",
            });
          } else {
            pdf.annotationStorage.setValue(widget.id, { value: match.value });
          }
          filled++;
        });
        if (filled === 0) {
          this.fillStatus.set({
            text: this.tOr(
              "vkLocalNoFieldsFilled",
              `No matching fields were filled in ${file.name} from ${profile.name}.`,
              file.name,
              profile.name,
            ),
          });
          return "none";
        }
        const savedBytes = await pdf.saveDocument();
        const outName = filledOutputFileName(file.name);
        this.downloadBytes(outName, new Uint8Array(savedBytes), "application/pdf");
        this.fillStatus.set({
          text: this.tOr(
            "vkLocalFilledCount",
            `Filled ${filled} ${filled === 1 ? "field" : "fields"} in ${outName} from ${profile.name}.`,
            String(filled),
            outName,
            profile.name,
          ),
        });
        return "filled";
      } finally {
        await loading.destroy();
      }
    } catch {
      return "flat";
    }
  }
  onDocumentFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return Promise.resolve();
    }
    return this.act(async () => {
      await SdkLoadService.Ready;
      await this.vault.initialize();
      await this.vault.ensureUnlocked();
      const bytes = await readFileBytes(file);
      const captured = await this.captureDocumentBytes(file, bytes);
      const read = new Map(
        [...captured.details].filter(([key]) => captured.sources.get(key)?.kind !== "derived"),
      );
      const current = this.selected();
      const existing =
        current != null &&
        current.type === CipherType.Identity &&
        !isSampleProfile(current) &&
        current.edit !== false
          ? current
          : null;
      const profile = existing ?? buildProfileFromRead(read, file);
      profile.id ||= crypto.randomUUID();
      const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
      const previous = [...projectEnvelope(meta).text.keys()];
      const sourceId = crypto.randomUUID();
      const attachmentId = crypto.randomUUID();
      const values: CapturedValue[] = [...read].map(([key, value]) => {
        const src = captured.sources.get(key);
        return {
          key,
          value,
          origin: mapCaptureOrigin(src?.kind),
          verified: src?.verified ?? false,
          locator: mapSdkLocator(src?.locator),
        };
      });
      let firstId = true;
      recordCapture(
        meta,
        {
          fileName: file.name,
          mediaType: mediaTypeForDocument(file),
          kind: "document",
          documentDate: statedDateFromRead(read, ".issued"),
          expiresOn: statedDateFromRead(read, ".expiry"),
        },
        values,
        {
          labelOf: detail_label,
          newId: () => {
            if (firstId) {
              firstId = false;
              return sourceId;
            }
            return crypto.randomUUID();
          },
        },
      );
      attachSourceBytes(meta, sourceId, attachmentId);
      writeEnvelope(profile, meta);
      applyProjection(profile, projectEnvelope(meta), previous);
      const saved = await this.vault.save(profile, [{ id: attachmentId, fileName: file.name, bytes }]);
      await this.refresh();
      this.config.set(null);
      this.practiceOpen.set(false);
      this.startAddingDetail.set(false);
      this.selected.set(this.items().find((i) => i.id === saved.id) ?? saved);
      this.detailOpen.set(true);
      this.fillStatus.set({
        text:
          read.size > 0
            ? this.tOr(
                "vkLocalReadDetailsCount",
                `Read ${read.size} ${read.size === 1 ? "detail" : "details"} from ${file.name} into ${saved.name}.`,
                String(read.size),
                file.name,
                saved.name,
              )
            : this.tOr(
                "vkLocalSavedDocNoDetails",
                `Saved ${file.name} to ${saved.name}. Add or edit details below, or use Vowkey for Desktop to read camera photos.`,
                file.name,
                saved.name,
              ),
      });
    });
  }
  private async captureDocumentBytes(file: File, bytes: Uint8Array): Promise<CapturedDocument> {
    const year = new Date().getFullYear();
    const lower = file.name.toLowerCase();
    if (/\.(png|jpe?g|webp|bmp)$/i.test(lower)) {
      let barcodeText = "";
      if (typeof decode_document_barcode === "function") {
        try {
          const decoded = decode_document_barcode(bytes);
          barcodeText = decoded?.text?.trim() ?? "";
          if (barcodeText) {
            const captured = capture_document_text(barcodeText, year);
            if (captured.details.size > 0) {
              return captured;
            }
          }
        } catch {
          // Image has no machine-readable barcode.
        }
      }
      if (this.inference == null || this.inference.getPrivacyMode() === "local") {
        throw new Error(this.tOr(
          "vkDocumentPhotoUnsupported",
          "Photo reading is turned off. Enable online reading in Settings, or choose a document with selectable text.",
        ));
      }
      try {
        const dataUrl = `data:${mediaTypeForDocument(file)};base64,${bytesToBase64(bytes)}`;
        const captured = capturedFromVision(await this.inference.readDocumentVision(dataUrl, file.name));
        if (captured.details.size === 0) {
          throw new Error("No details found in image.");
        }
        return captured;
      } catch {
        throw new Error(this.tOr(
          "vkDocumentReadFailed",
          "Couldn't read this photo. Check your connection and try again, or choose a clearer photo.",
        ));
      }
    }

    let reading: BrowserDocumentReading;
    if (lower.endsWith(".pdf")) {
      reading = await this.extractPdfReading(bytes);
    } else if (lower.endsWith(".docx")) {
      reading = await extractDocxReading(bytes);
    } else if (lower.endsWith(".xlsx")) {
      reading = await extractXlsxReading(bytes);
    } else {
      const text = new TextDecoder().decode(bytes);
      reading = { text, pages: [] };
    }

    if (
      reading.pages.some((p) => p.pieces.length > 0) &&
      this.inference != null &&
      this.inference.getPrivacyMode() !== "local" &&
      typeof decision_begin === "function"
    ) {
      try {
        const ask = (requests: string) =>
          Promise.all(
            (JSON.parse(requests) as DecisionRequest[]).map((r) => this.inference!.decide(r)),
          );
        let plan = decision_begin(JSON.stringify(reading), 0);
        plan = decision_take_first_answers(
          plan,
          JSON.stringify(await ask(decision_requests(plan, false))),
        );
        const second = await ask(decision_requests(plan, true));
        const decided = decision_finish(plan, JSON.stringify(second), "", year);
        if (decided.details.size > 0) {
          return decided;
        }
      } catch {
        // Fall back to deterministic on-device text capture when offline or unconfigured.
      }
    }

    if (!reading.text.trim()) {
      return { details: new Map(), sources: new Map() };
    }
    return capture_document_text(reading.text, year);
  }
  private async extractPdfReading(bytes: Uint8Array): Promise<BrowserDocumentReading> {
    const resources = new URL("pdfjs/", document.baseURI).href;
    const loading = getDocument({
      data: bytes.slice(),
      cMapUrl: `${resources}cmaps/`,
      standardFontDataUrl: `${resources}standard_fonts/`,
      wasmUrl: `${resources}wasm/`,
      iccUrl: `${resources}iccs/`,
    });
    if (!loading?.promise) {
      return { text: "", pages: [] };
    }
    const pdf = await loading.promise;
    try {
      const textPages: string[] = [];
      const pages: BrowserDocumentPage[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const width = Math.max(1, viewport.width || 612);
        const height = Math.max(1, viewport.height || 792);
        const content = await page.getTextContent();
        const pieces: BrowserDocumentPiece[] = [];
        const words: string[] = [];
        for (const item of content.items) {
          if (!("str" in item)) {
            continue;
          }
          const str = item.str.trim();
          if (!str) {
            continue;
          }
          words.push(item.str);
          const tr = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 12, 0, 0];
          const fontH = Math.max(6, Math.hypot(Number(tr[2]) || 0, Number(tr[3]) || 12));
          const xPdf = Number(tr[4]) || 0;
          const yPdf = Number(tr[5]) || 0;
          const wPdf = Math.max(fontH * 0.5, Number(item.width) || str.length * fontH * 0.5);
          const x = Math.max(0, Math.min(1, xPdf / width));
          const y = Math.max(0, Math.min(1, (height - yPdf - fontH) / height));
          const w = Math.max(0.005, Math.min(1 - x, wPdf / width));
          const h = Math.max(0.005, Math.min(1 - y, (fontH * 1.15) / height));
          pieces.push({ text: str, x, y, w, h });
        }
        const line = words.join(" ").trim();
        if (line) {
          textPages.push(line);
        }
        pages.push({ page: pageNum, width, height, pieces });
        page.cleanup();
      }
      return { text: textPages.join("\n"), pages };
    } finally {
      await loading.destroy();
    }
  }
  protected downloadBytes(fileName: string, bytes: Uint8Array, mimeType: string): void {
    const blob = new Blob([Uint8Array.from(bytes).buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  startSample(scenarioId: SampleScenarioId): Promise<void> {
    this.showAgents.set(false);
    this.filter.set(null);
    this.config.set(null);
    this.practiceOpen.set(false);
    this.resetPractice();
    const existing = this.sampleItems().find((item) => sampleScenarioOf(item)?.id === scenarioId);
    if (existing) {
      this.selected.set(existing);
      this.detailOpen.set(true);
      return Promise.resolve();
    }
    return this.act(async () => {
      await this.vault.initialize();
      await this.vault.ensureUnlocked();
      const saved = await this.vault.save(buildSampleProfileCipher(scenarioId));
      await this.refresh();
      this.selected.set(this.items().find((i) => i.id === saved.id) ?? saved);
      this.detailOpen.set(true);
    });
  }
  loadSampleWorkspace(event?: Event): Promise<void> {
    (event?.target as HTMLElement | undefined)?.closest("details")?.removeAttribute("open");
    this.showAgents.set(false);
    this.filter.set(null);
    this.config.set(null);
    this.practiceOpen.set(false);
    this.resetPractice();
    return this.act(async () => {
      await this.vault.initialize();
      await this.vault.ensureUnlocked();
      const created = await ensureSampleWorkspace(this.items(), (scenarioId) =>
        this.vault.save(buildSampleProfileCipher(scenarioId)),
      );
      await this.refresh();
      const target = created[0] ?? this.sampleItems()[0] ?? null;
      if (target) {
        this.selected.set(this.items().find((item) => item.id === target.id) ?? target);
        this.detailOpen.set(true);
      }
    });
  }
  openSampleDetails(): void {
    this.practiceOpen.set(false);
    const sample = this.activeSample();
    if (sample) {
      this.selected.set(sample);
      this.detailOpen.set(true);
    }
  }
  openPractice(): void {
    const sample = this.activeSample();
    if (!sample) { return; }
    this.config.set(null);
    this.selected.set(sample);
    this.resetPractice();
    this.practiceOpen.set(true);
    this.detailOpen.set(true);
  }
  fillPractice(): Promise<void> {
    return this.act(async () => {
      await this.refresh();
      const sample = this.activeSample();
      if (!sample) { return; }
      const result = fillPracticeFormFromSample(sample);
      this.practiceValues.set(result.values);
      this.practiceFilled.set(true);
    });
  }
  resetPractice(): void {
    this.practiceValues.set({});
    this.practiceHuman.set("");
    this.practiceFilled.set(false);
  }
  setPracticeField(key: string, value: string): void {
    this.practiceValues.update((prev) => ({ ...prev, [key]: value }));
  }
  clearSamples(): Promise<void> {
    return this.act(async () => {
      const samples = this.sampleItems();
      const sampleIds = new Set(sampleWorkspaceResetIds(this.items()));
      if (sampleIds.size === 0) { return; }
      await this.vault.ensureUnlocked();
      const attachments = await this.vault.store.list<{ cipherId: string }>("attachments");
      await this.vault.store.commit([
        ...samples.map((s) => ({ store: "ciphers" as const, id: s.id })),
        ...attachments
          .filter((a) => sampleIds.has(a.value.cipherId))
          .map((a) => ({ store: "attachments" as const, id: a.id })),
      ]);
      this.practiceOpen.set(false);
      this.resetPractice();
      this.config.set(null);
      if (this.selected() && sampleIds.has(this.selected()!.id)) {
        this.selected.set(null);
        this.detailOpen.set(false);
      }
      await this.refresh();
    });
  }
  edit(item: CipherView): Promise<void> {
    return this.act(async () => {
      const encrypted = await this.vault.store.get<SdkCipher>("ciphers", item.id);
      const originalCipher = encrypted == null ? null : Cipher.fromSdkCipher(encrypted);
      if (originalCipher == null) { throw new Error(this.i18n.t("vowkeyLocalItemUnavailable")); }
      this.detailOpen.set(true);
      this.config.set({ ...this.baseConfig(), mode: "edit", cipherType: item.type, originalCipher });
    });
  }
  private baseConfig(): Pick<CipherFormConfig, "vault" | "admin" | "collections" | "folders"> &
    { organizationDataOwnershipDisabled: true; organizations: [] } {
    const folder = new FolderView(); folder.name = this.i18n.t("noneFolder");
    return { vault: "local" as const, admin: false, organizationDataOwnershipDisabled: true as const,
      collections: [], folders: [folder], organizations: [] };
  }
  saved(item: CipherView): Promise<void> {
    this.config.set(null); this.selected.set(item); this.detailOpen.set(true);
    return this.act(() => this.refresh());
  }
  startOver(): Promise<void> {
    return this.act(async () => {
      if (await this.vault.startOverIfEmpty()) {
        this.attached.set(false);
        await this.router.navigate(["/vault"]);
      }
    });
  }
  unlock(): Promise<void> {
    this.unlockTried.set(true);
    return this.act(async () => {
      await this.vault.unlock(this.password);
      this.password = "";
      if (this.pendingUnlockForSave) {
        this.pendingUnlockForSave = false;
        const ext = getExtensionChrome();
        if (ext?.runtime?.sendMessage) {
          await new Promise<void>((resolve) => {
            try {
              ext.runtime!.sendMessage!(
                { command: "guestVaultUnlockedForPendingSave" },
                () => resolve(),
              );
            } catch {
              resolve();
            }
          });
        }
        if (typeof window !== "undefined" && window.innerWidth <= 460 && window.history.length <= 2) {
          try {
            window.close();
          } catch {
            // Ignore when opened as a regular browser tab.
          }
          return;
        }
      }
      if (this.native) {
        await this.router.navigate(["/vault"]);
        return;
      }
      await this.refresh();
      if (this.latestQueryParams) {
        this.applyUnlockedQueryParams(this.latestQueryParams);
      }
    });
  }
  lock(): Promise<void> { return this.act(() => this.vault.lock()); }
  protect(): Promise<void> {
    return this.act(async () => {
      await this.vault.setPassword(this.newPassword); this.newPassword = "";
      this.hasPassword.set(true);
      await this.vault.dismissProtectionOffer(); this.offer.set(false); this.protecting.set(false);
    });
  }
  dismissOffer(): Promise<void> {
    return this.act(async () => { await this.vault.dismissProtectionOffer(); this.offer.set(false); this.protecting.set(false); });
  }
  private async refresh(): Promise<void> {
    const generation = this.generation;
    const items = await this.vault.list();
    const offer = await this.vault.afterFillOffer();
    if (generation !== this.generation) { return; }
    this.items.set(items); this.offer.set(offer.show);
    const id = this.selected()?.id;
    this.selected.set(items.find((item) => item.id === id) ?? items[0] ?? null);
  }
  private async act(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) { return; }
    this.busy.set(true); this.error.set("");
    try { await action(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : this.i18n.t("unexpectedError")); }
    finally { this.busy.set(false); }
  }
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsArrayBuffer(file);
  });
}

function filledOutputFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return `${name}-filled`;
  }
  return `${name.slice(0, dot)}-filled${name.slice(dot)}`;
}

function mediaTypeForForm(lowerName: string): string {
  if (lowerName.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lowerName.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/hwp+zip";
}

function mediaTypeForDocument(file: File): string {
  if (file.type) {
    return file.type;
  }
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) { return "application/pdf"; }
  if (lower.endsWith(".png")) { return "image/png"; }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) { return "image/jpeg"; }
  if (lower.endsWith(".webp")) { return "image/webp"; }
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "text/plain";
}

interface BrowserDocumentPiece {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BrowserDocumentPage {
  page: number;
  width: number;
  height: number;
  pieces: BrowserDocumentPiece[];
}

interface BrowserDocumentReading {
  text: string;
  pages: BrowserDocumentPage[];
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function extractDocxReading(bytes: Uint8Array): Promise<BrowserDocumentReading> {
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) {
    return { text: "", pages: [] };
  }
  const paragraphs = docXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = Array.from(p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)).map((m) =>
      decodeXmlEntities(m[1]),
    );
    const text = runs.join("").trim();
    if (text) {
      lines.push(text);
    }
  }
  const rowCount = Math.max(lines.length, 1);
  const pieces: BrowserDocumentPiece[] = lines.map((line, idx) => ({
    text: line,
    x: 0.08,
    y: Math.min(0.96, 0.04 + (idx / rowCount) * 0.9),
    w: 0.84,
    h: Math.max(0.014, 0.8 / rowCount),
  }));
  return {
    text: lines.join("\n"),
    pages: pieces.length > 0 ? [{ page: 1, width: 595, height: 842, pieces }] : [],
  };
}

async function extractXlsxReading(bytes: Uint8Array): Promise<BrowserDocumentReading> {
  const zip = await JSZip.loadAsync(bytes);
  const sharedXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const sharedStrings: string[] = [];
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
      const parts = Array.from(si[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)).map((m) =>
        decodeXmlEntities(m[1]),
      );
      sharedStrings.push(parts.join(""));
    }
  }
  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  const pages: BrowserDocumentPage[] = [];
  const textLines: string[] = [];
  let pageNum = 1;
  for (const sheetName of sheetNames) {
    const xml = await zip.file(sheetName)?.async("string");
    if (!xml) {
      continue;
    }
    const pieces: BrowserDocumentPiece[] = [];
    for (const cellMatch of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const inner = cellMatch[2];
      const ref = /\br="([A-Z]+)(\d+)"/i.exec(attrs);
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      let val = "";
      if (type === "inlineStr") {
        val = Array.from(inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
          .map((m) => decodeXmlEntities(m[1]))
          .join("");
      } else {
        const rawV = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
        val =
          type === "s"
            ? sharedStrings[Number(rawV)] ?? ""
            : decodeXmlEntities(rawV);
      }
      const trimmed = val.trim();
      if (!trimmed) {
        continue;
      }
      textLines.push(trimmed);
      const colLetters = (ref?.[1] ?? "A").toUpperCase();
      let colIdx = 0;
      for (let i = 0; i < colLetters.length; i++) {
        colIdx = colIdx * 26 + (colLetters.charCodeAt(i) - 64);
      }
      const rowIdx = Math.max(1, Number(ref?.[2] ?? 1));
      pieces.push({
        text: trimmed,
        x: Math.min(0.92, ((colIdx - 1) % 12) * 0.08 + 0.02),
        y: Math.min(0.96, ((rowIdx - 1) % 60) * 0.016 + 0.02),
        w: 0.14,
        h: 0.015,
      });
    }
    if (pieces.length > 0) {
      pages.push({ page: pageNum++, width: 842, height: 595, pieces });
    }
  }
  return { text: textLines.join("\n"), pages };
}

function buildProfileFromRead(read: Map<string, string>, file: File): CipherView {
  const latinGiven = read.get("name.given.latin")?.trim();
  const latinFamily = read.get("name.family.latin")?.trim();
  const given = read.get("name.given")?.trim();
  const family = read.get("name.family")?.trim();
  const profile = new CipherView();
  profile.type = CipherType.Identity;
  profile.identity = new IdentityView();
  profile.name =
    (latinGiven && latinFamily ? `${latinGiven} ${latinFamily}` : undefined) ??
    read.get("name.full.latin")?.trim() ??
    (given && family ? `${given} ${family}` : undefined) ??
    read.get("name.full")?.trim() ??
    latinGiven ??
    latinFamily ??
    given ??
    family ??
    file.name.replace(/\.[^.]+$/, "");
  return profile;
}

function statedDateFromRead(read: Map<string, string>, suffix: string): string | null {
  for (const [key, value] of read) {
    if (key.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function mapCaptureOrigin(kind: string | undefined): VariantOrigin {
  if (kind === "mrz" || kind === "barcode" || kind === "ocr" || kind === "chip" || kind === "text") {
    return kind;
  }
  return "ocr";
}

function mapSdkLocator(locator: SdkLocator | undefined): Locator | null {
  if (!locator) {
    return null;
  }
  if (locator.kind === "page") {
    return { kind: "page", page: locator.page, x: locator.x, y: locator.y, w: locator.w, h: locator.h };
  }
  if (locator.kind === "cell") {
    return {
      kind: "cell",
      page: locator.page,
      row: locator.row,
      column: locator.column,
      a1: locator.a1 ?? null,
      table: locator.table ?? null,
    };
  }
  return null;
}

type ExtensionTabInfo = { id?: number; url?: string; active?: boolean };
type ExtensionChromeApi = {
  tabs?: {
    query?: (
      queryInfo: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: ExtensionTabInfo[]) => void,
    ) => void;
  };
  runtime?: {
    sendMessage?: (
      message: Record<string, unknown>,
      callback?: (response?: { result?: { outcome?: string; totp?: string } }) => void,
    ) => void;
  };
};

function getExtensionChrome(): ExtensionChromeApi | undefined {
  return (globalThis as unknown as { chrome?: ExtensionChromeApi }).chrome;
}

async function queryActiveExtensionWebTab(): Promise<ExtensionTabInfo | undefined> {
  const ext = getExtensionChrome();
  if (!ext?.tabs?.query) {
    return undefined;
  }
  const queryTabs = (q: { active?: boolean; currentWindow?: boolean }) =>
    new Promise<ExtensionTabInfo[]>((resolve) => {
      ext.tabs!.query!(q, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    });
  const isWebTab = (t: ExtensionTabInfo) =>
    typeof t?.id === "number" &&
    typeof t?.url === "string" &&
    /^(?:https?|file):/i.test(t.url);
  const current = await queryTabs({ active: true, currentWindow: true });
  const hit = current.find(isWebTab);
  if (hit) {
    return hit;
  }
  const all = await queryTabs({ active: true });
  return all.find(isWebTab);
}

function extractHostFromUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) {
    return "";
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (parsed.protocol === "file:") {
      return "";
    }
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function registrableDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  const secondLast = parts[parts.length - 2];
  const last = parts[parts.length - 1];
  if (last.length === 2 && secondLast.length <= 3 && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function scoreLoginAgainstHost(item: CipherView, tabHost: string): number {
  if (!tabHost || item.type !== CipherType.Login) {
    return 0;
  }
  const tabRoot = registrableDomain(tabHost);
  let best = 0;
  for (const u of item.login?.uris ?? []) {
    const h = extractHostFromUrl(u?.uri);
    if (!h) {
      continue;
    }
    if (h === tabHost) {
      best = Math.max(best, 3);
    } else if (h.endsWith(`.${tabHost}`) || tabHost.endsWith(`.${h}`)) {
      best = Math.max(best, 2);
    } else if (registrableDomain(h) === tabRoot) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

function loginMatchesTabHost(item: CipherView, tabHost: string): boolean {
  return scoreLoginAgainstHost(item, tabHost) > 0;
}
