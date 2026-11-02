import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterModule } from "@angular/router";
import { Subscription } from "rxjs";
import { Cipher as SdkCipher } from "@vowkey/sdk-internal";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { ClientType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import {
  buildSampleProfileCipher,
  fillPracticeFormFromSample,
  isSampleProfile,
  SAMPLE_SCENARIO_LIST,
  sampleScenarioOf,
  SampleScenarioId,
} from "@vowkey/common/vault/profile/sample-walkthrough";
import { readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import { ButtonModule } from "@vowkey/components";
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
    <main class="vk-local" [class.detail-open]="detailOpen() || config() != null || practiceOpen()">
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
              <span>{{ kind.label | i18n }}</span>
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
          <a routerLink="/login">{{ 'logIn' | i18n }}</a>
          <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
          @if (!native && !hasPassword() && !locked()) {
            <button type="button" (click)="protecting.set(true)">{{ 'vowkeyLocalSetPassword' | i18n }}</button>
          }
          @if (canLock() && !locked()) {
            <button type="button" (click)="lock()">{{ 'lock' | i18n }}</button>
          }
        </div>
      </aside>

      <section class="workspace">
        @if (error()) { <p class="notice" role="alert">{{ error() }}</p> }
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
              <div class="unlock-links">
                <a routerLink="/login">{{ 'logIn' | i18n }}</a>
                <span aria-hidden="true">·</span>
                <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
              </div>
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
              <details class="new-menu">
                <summary>+ {{ 'new' | i18n }}</summary>
                <div class="new-menu-sheet">
                  @for (kind of kinds; track kind.type) {
                    <button type="button" (click)="create(kind.type, $event)">{{ kind.label | i18n }}</button>
                  }
                </div>
              </details>
            </header>

            <nav class="compact-pills" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()" [attr.aria-label]="'filter' | i18n">
              <button type="button" [attr.aria-pressed]="filter() === null" (click)="setFilter(null)">{{ 'allItems' | i18n }}</button>
              @for (kind of kinds; track kind.type) {
                <button type="button" [attr.aria-pressed]="filter() === kind.type" (click)="setFilter(kind.type)">{{ kind.label | i18n }}</button>
              }
              @if (agentManagement != null) {
                <button type="button" [attr.aria-pressed]="showAgents()" (click)="openAgents()">{{ 'vowkeyAgents' | i18n }}</button>
              }
            </nav>

            @if (offer() || protecting()) {
              <section class="protection-offer" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()">
                <span class="offer-text">{{ 'vowkeyLocalKeepOffer' | i18n }}</span>
                <div class="offer-actions">
                  <a class="offer-link" routerLink="/signup">{{ 'createAccount' | i18n }}</a>
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
                @for (item of visible(); track item.id) {
                  <button type="button" class="vk-row" [attr.aria-pressed]="selected()?.id === item.id && !practiceOpen()" (click)="select(item)">
                    <span class="row-glyph" aria-hidden="true">{{ rowInitial(item) }}</span>
                    <span class="row-text">
                      <strong>{{ item.name }}</strong>
                      <small>{{ itemSubtitle(item) }}</small>
                    </span>
                  </button>
                } @empty {
                  <div class="empty-list">
                    <p>{{ 'vowkeyLocalEmpty' | i18n }}</p>
                    <div class="empty-actions">
                      <button type="button" (click)="create(cipherType.Identity, $event)">+ {{ 'profile' | i18n }}</button>
                      <button type="button" (click)="create(cipherType.Login, $event)">+ {{ 'typeLogin' | i18n }}</button>
                    </div>
                    <div class="local-sample-box">
                      <span class="local-sample-title">{{ 'vkTryWithSample' | i18n }}</span>
                      <div class="local-sample-picks">
                        @for (scenario of sampleScenarios; track scenario.id) {
                          <button type="button" [attr.data-testid]="'local-try-sample-' + scenario.id" (click)="startSample(scenario.id)">{{ sampleLabelKey(scenario.id) | i18n }}</button>
                        }
                      </div>
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
                      @if (isSample(item)) {
                        <button bitButton buttonType="primary" type="button" data-testid="local-open-practice" (click)="openPractice()">{{ 'vkWtStepForm' | i18n }}</button>
                      }
                      <button bitButton buttonType="secondary" type="button" (click)="edit(item)">{{ 'edit' | i18n }}</button>
                    </div>
                  </div>
                  <div class="detail-card">
                    @if (readsAsProfile(item)) {
                      <app-profile [cipher]="item" />
                    } @else {
                      <app-cipher-view [cipher]="item" [hideChangePasswordLink]="true" />
                    }
                  </div>
                } @else {
                  <div class="detail-empty">
                    <svg width="48" height="48" viewBox="0 0 120 120" fill="none" aria-hidden="true">
                      <rect x="1" y="1" width="118" height="118" rx="27" fill="var(--vk-surface)" stroke="var(--vk-line)" stroke-width="2.5"/>
                      <g transform="translate(60 61) scale(0.86) translate(-60 -57)">
                        <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke="var(--vk-ink)" stroke-width="7" stroke-linecap="round"/>
                        <rect x="31" y="28" width="34" height="23" rx="5" fill="var(--vk-blue)"/>
                        <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff"/>
                        <g fill="var(--vk-ink)"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
                        <rect x="80" y="54" width="5.5" height="22" rx="2.75" fill="var(--vk-blue)"/>
                      </g>
                    </svg>
                    <p>{{ 'vowkeyLocalEmpty' | i18n }}</p>
                    <div class="local-sample-box center">
                      <span class="local-sample-title">{{ 'vkTryWithSample' | i18n }}</span>
                      <p class="local-sample-sub">{{ 'vkTryWithSampleSub' | i18n }}</p>
                      <div class="local-sample-picks">
                        @for (scenario of sampleScenarios; track scenario.id) {
                          <button type="button" [attr.data-testid]="'local-detail-sample-' + scenario.id" (click)="startSample(scenario.id)">{{ sampleLabelKey(scenario.id) | i18n }}</button>
                        }
                      </div>
                    </div>
                  </div>
                }
              </section>
            </div>

            <footer class="compact-footer" [class.hide-compact]="detailOpen() || config() != null || practiceOpen()">
              <span class="foot-scope">{{ 'vowkeyLocalVault' | i18n }}</span>
              <div class="foot-links">
                <a routerLink="/login">{{ 'logIn' | i18n }}</a>
                <span aria-hidden="true">·</span>
                <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
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
    .local-sample-box {
      display: none;
      margin-top: 16px;
      padding: 12px 14px;
      border: 1px solid var(--vk-line);
      border-radius: 12px;
      background: var(--vk-paper);
      text-align: center;
    }
    .local-sample-box.center {
      display: block;
      max-width: 420px;
      margin-top: 6px;
      padding: 16px 20px;
      background: var(--vk-surface);
    }
    .local-sample-title {
      display: block;
      color: var(--vk-ink);
      font-size: 13px;
      font-weight: 600;
    }
    .local-sample-sub {
      margin: 6px 0 0 !important;
      color: var(--vk-muted);
      font-size: 13px;
      line-height: 1.45;
    }
    .local-sample-picks {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .local-sample-picks button {
      height: 30px;
      padding: 0 11px;
      border: 1px solid var(--vk-line);
      border-radius: 999px;
      background: var(--vk-surface);
      color: var(--vk-ink);
      font: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }
    .local-sample-picks button:hover {
      border-color: var(--vk-blue);
      color: var(--vk-blue);
    }
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
      border-radius: 999px;
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
      border-radius: 999px;
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
      border-radius: 999px;
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
        gap: 6px;
        padding: 7px 12px;
        overflow-x: auto;
        border-bottom: 1px solid var(--vk-line);
        background: var(--vk-paper);
        scrollbar-width: none;
      }
      .compact-pills::-webkit-scrollbar { display: none; }
      .compact-pills button {
        flex: none;
        height: 28px;
        padding: 0 10px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-surface);
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
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
      .local-sample-box { display: block; }
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
  private readonly i18n = inject(I18nService);
  readonly cipherType = CipherType;
  readonly native = inject(PlatformUtilsService).getClientType() === ClientType.Desktop;
  readonly agentManagement = inject(LOCAL_AGENT_MANAGEMENT, { optional: true });
  readonly showAgents = signal(false);
  readonly detailOpen = signal(false);
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
  readonly sampleScenarios = SAMPLE_SCENARIO_LIST;
  readonly isSample = isSampleProfile;
  readonly sampleItems = computed(() => this.items().filter((item) => isSampleProfile(item)));
  readonly activeSample = computed<CipherView | null>(() => {
    const sel = this.selected();
    if (sel && isSampleProfile(sel)) { return sel; }
    return this.sampleItems()[0] ?? null;
  });
  readonly activeSampleScenario = computed(() => sampleScenarioOf(this.activeSample()));
  readonly practiceSummary = computed(() => {
    const spec = this.activeSampleScenario();
    if (!spec) { return ""; }
    return this.i18n.t("vkWtFilledSummary", String(spec.fields.length), spec.fileName, spec.humanFieldLabel);
  });
  readonly canLock = computed(() => this.native || this.hasPassword());
  readonly kinds = [
    { type: CipherType.Login, label: "typeLogin" }, { type: CipherType.Identity, label: "profile" },
    { type: CipherType.Card, label: "typeCard" }, { type: CipherType.SecureNote, label: "typeSecureNote" },
    { type: CipherType.ApiKey, label: "typeApiKey" }, { type: CipherType.Environment, label: "typeEnvironment" },
  ];
  readonly visible = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    return this.items().filter((item) => {
      if (this.filter() != null && item.type !== this.filter()) { return false; }
      if (!query) { return true; }
      return item.name.toLocaleLowerCase().includes(query) || (item.subTitle ?? "").toLocaleLowerCase().includes(query);
    });
  });
  password = "";
  newPassword = "";
  private readonly subscriptions = new Subscription();
  private generation = 0;

  ngOnInit(): void {
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
    });
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.clear(); }
  private clear(): void {
    this.generation++; this.items.set([]); this.selected.set(null); this.config.set(null);
    this.detailOpen.set(false); this.practiceOpen.set(false); this.resetPractice();
    this.password = ""; this.newPassword = ""; this.protecting.set(false);
  }
  setFilter(type: CipherType | null): void {
    this.filter.set(type); this.showAgents.set(false); this.detailOpen.set(false); this.practiceOpen.set(false); this.config.set(null);
  }
  openAgents(): void {
    this.showAgents.set(true); this.detailOpen.set(false); this.practiceOpen.set(false); this.config.set(null);
  }
  backToList(): void { this.config.set(null); this.practiceOpen.set(false); this.detailOpen.set(false); }
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
  itemSubtitle(item: CipherView): string { return item.subTitle || this.i18n.t(this.typeLabel(item.type)); }
  rowInitial(item: CipherView): string {
    const trimmed = (item.name || "").trim();
    return trimmed ? Array.from(trimmed)[0].toLocaleUpperCase() : "V";
  }
  select(item: CipherView): void { this.config.set(null); this.practiceOpen.set(false); this.selected.set(item); this.detailOpen.set(true); }
  create(type: CipherType, event: Event): void {
    this.showAgents.set(false); this.practiceOpen.set(false);
    (event.target as HTMLElement).closest("details")?.removeAttribute("open");
    this.selected.set(null); this.detailOpen.set(true);
    this.config.set({ ...this.baseConfig(), mode: "add", cipherType: type });
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
      if (samples.length === 0) { return; }
      await this.vault.ensureUnlocked();
      const sampleIds = new Set(samples.map((s) => s.id));
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
  unlock(): Promise<void> {
    return this.act(async () => { await this.vault.unlock(this.password); this.password = ""; await this.refresh(); });
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
