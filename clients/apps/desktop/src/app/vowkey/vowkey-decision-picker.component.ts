import { A11yModule } from "@angular/cdk/a11y";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  input,
  OnInit,
  output,
  signal,
} from "@angular/core";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { I18nPipe } from "@vowkey/ui-common";

import type {
  DecisionCatalogModel,
  DecisionModelRole,
  DecisionModelsState,
  DecisionPreparationState,
} from "../../capture/types/capture";

import { VowkeyGlyphComponent } from "./vowkey-glyph.component";

export type PickerView = "compare" | "all";

export function formatModelBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }
  if (bytes >= 1_000_000_000) {
    const gb = bytes / 1_000_000_000;
    return `${gb >= 10 ? gb.toFixed(1) : gb.toFixed(1)} GB`;
  }
  const mb = Math.max(1, Math.round(bytes / 1_000_000));
  return `${mb} MB`;
}

export function singleWinnerIndex(values: readonly number[], prefer: "max" | "min"): number {
  if (values.length === 0) {
    return -1;
  }
  const best = prefer === "max" ? Math.max(...values) : Math.min(...values);
  let winner = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === best) {
      if (winner !== -1) {
        return -1;
      }
      winner = i;
    }
  }
  return winner;
}

@Component({
  selector: "vk-decision-picker",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [A11yModule, I18nPipe, VowkeyGlyphComponent],
  template: `
    <div class="vk-mp-backdrop" data-testid="vk-decision-picker-backdrop" (click)="closed.emit()">
      <div
        class="vk-mp-sheet"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="'vk-mp-title'"
        data-testid="vk-decision-picker-dialog"
        (click)="onSheetClick($event)"
      >
        @if (view() === "compare") {
          <header class="vk-mp-head">
            <h2 id="vk-mp-title">{{ "vkModelPickerTitle" | i18n }}</h2>
            <button
              type="button"
              class="vk-mp-icon-btn"
              data-testid="vk-decision-picker-close"
              [attr.aria-label]="'close' | i18n"
              (click)="closed.emit()"
            >
              <vk-glyph name="close" [size]="16" />
            </button>
          </header>

          <div class="vk-mp-compare" data-testid="vk-decision-picker-compare">
            @for (model of compareModels(); track model.id; let colIdx = $index) {
              <div
                class="vk-mp-col"
                [class.active]="isModelInUse(model.id)"
                [attr.data-testid]="'vk-mp-col-' + model.id"
              >
                <div class="vk-mp-col-head">
                  <span class="vk-mp-eyebrow" [class.accent]="model.role === 'recommended'">
                    {{ roleLabelKey(model.role) | i18n }}
                  </span>
                  <strong class="vk-mp-col-name">{{ model.name }}</strong>
                  <p class="vk-mp-col-blurb">{{ model.blurbKey | i18n }}</p>
                </div>

                <div class="vk-mp-row-cell">
                  <span class="vk-mp-row-label">{{ "vkModelRowLanguages" | i18n }}</span>
                  <span class="vk-mp-row-val">{{ languagesLabelKey(model.languages) | i18n }}</span>
                </div>
                <div class="vk-mp-row-cell" [class.win]="accuracyWinner() === colIdx">
                  <span class="vk-mp-row-label">{{ "vkModelRowAccuracy" | i18n }}</span>
                  <span class="vk-mp-row-val">{{ capabilityTierLabel(model) }}</span>
                </div>
                <div class="vk-mp-row-cell" [class.win]="memoryWinner() === colIdx">
                  <span class="vk-mp-row-label">{{ "vkModelRowMemory" | i18n }}</span>
                  <span class="vk-mp-row-val">{{ formatBytes(model.memoryBytes) }}</span>
                </div>
                <div class="vk-mp-row-cell" [class.win]="downloadWinner() === colIdx">
                  <span class="vk-mp-row-label">{{ "vkModelRowDownload" | i18n }}</span>
                  <span class="vk-mp-row-val">{{ formatBytes(model.bytes) }}</span>
                </div>

                <div class="vk-mp-col-slot">
                  @if (preparationFor(model.id); as prep) {
                    @if (prep.error) {
                      <div class="vk-mp-slot-err">
                        <small [title]="prep.error">{{ prep.error }}</small>
                        <button
                          type="button"
                          class="vk-mp-btn outline full"
                          (click)="downloadRequested.emit(model.id)"
                        >
                          {{ "vkModelRetryDownload" | i18n }}
                        </button>
                      </div>
                    } @else {
                      <div class="vk-mp-progress-box">
                        <div class="vk-mp-progress-top">
                          <span>{{ progressLabel(prep) }}</span>
                          <button
                            type="button"
                            class="vk-mp-cancel-btn"
                            [attr.aria-label]="'cancel' | i18n"
                            data-testid="vk-mp-cancel-download"
                            (click)="cancelRequested.emit()"
                          >
                            <vk-glyph name="close" [size]="13" />
                          </button>
                        </div>
                        <div
                          class="vk-mp-bar-track"
                          role="progressbar"
                          [attr.aria-valuenow]="progressPercent(prep)"
                          aria-valuemin="0"
                          aria-valuemax="100"
                        >
                          <div class="vk-mp-bar-fill" [style.width.%]="progressPercent(prep)"></div>
                        </div>
                      </div>
                    }
                  } @else if (isModelInUse(model.id)) {
                    <span class="vk-mp-in-use" data-testid="vk-mp-in-use">
                      <i class="vk-mp-dot" aria-hidden="true"></i>
                      {{ "vkModelInUse" | i18n }}
                    </span>
                  } @else if (model.installed || model.foundPath) {
                    <button
                      type="button"
                      class="vk-mp-btn outline full"
                      [attr.data-testid]="'vk-mp-use-' + model.id"
                      (click)="useRequested.emit(model.id)"
                    >
                      {{ "vkModelUse" | i18n }}
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="vk-mp-btn full"
                      [class.primary]="shouldHighlightDownload(model)"
                      [class.outline]="!shouldHighlightDownload(model)"
                      [attr.data-testid]="'vk-mp-download-' + model.id"
                      (click)="downloadRequested.emit(model.id)"
                    >
                      {{ downloadSizeLabel(model.bytes) }}
                    </button>
                  }
                </div>
              </div>
            }
          </div>

          <footer class="vk-mp-foot">
            <button
              type="button"
              class="vk-mp-more-btn"
              data-testid="vk-mp-more-models"
              (click)="openAllView()"
            >
              <span>{{ moreModelsLabel() }}</span>
              <vk-glyph name="forward" [size]="14" />
            </button>
          </footer>
        } @else {
          <header class="vk-mp-head bordered">
            <button
              type="button"
              class="vk-mp-back-btn"
              id="vk-mp-title"
              data-testid="vk-mp-back-compare"
              (click)="openCompareView()"
            >
              <vk-glyph name="back" [size]="16" />
              <span>{{ "vkModelAllTitle" | i18n }}</span>
            </button>
            <div class="vk-mp-head-right">
              <button
                type="button"
                class="vk-mp-btn ghost"
                data-testid="vk-mp-import-file"
                (click)="importRequested.emit()"
              >
                {{ "vkModelAddFile" | i18n }}
              </button>
              <button
                type="button"
                class="vk-mp-icon-btn"
                data-testid="vk-decision-picker-close"
                [attr.aria-label]="'close' | i18n"
                (click)="closed.emit()"
              >
                <vk-glyph name="close" [size]="16" />
              </button>
            </div>
          </header>

          <div class="vk-mp-list" data-testid="vk-decision-picker-all">
            @if (state().customModels.length > 0) {
              <h3 class="vk-mp-sec-label">{{ "vkModelAddedSection" | i18n }}</h3>
              @for (custom of state().customModels; track custom.id) {
                <div class="vk-mp-list-row" [attr.data-testid]="'vk-mp-row-' + custom.id">
                  <div class="vk-mp-list-info">
                    <div class="vk-mp-list-title">
                      <b>{{ custom.name }}</b>
                      @if (custom.missing) {
                        <span class="vk-mp-tag warn">{{ "vkModelMissingFile" | i18n }}</span>
                      }
                    </div>
                    <div class="vk-mp-list-facts">
                      GGUF
                      @if (!custom.missing) {
                        · {{ formatBytes(custom.bytes) }}
                      }
                      · {{ custom.parentFolder }}
                    </div>
                  </div>
                  <div class="vk-mp-list-actions">
                    @if (isModelInUse(custom.id)) {
                      <span class="vk-mp-in-use">
                        <i class="vk-mp-dot" aria-hidden="true"></i>
                        {{ "vkModelInUse" | i18n }}
                      </span>
                    } @else {
                      @if (!custom.missing) {
                        <button
                          type="button"
                          class="vk-mp-btn outline"
                          [attr.data-testid]="'vk-mp-use-' + custom.id"
                          (click)="useRequested.emit(custom.id)"
                        >
                          {{ "vkModelUse" | i18n }}
                        </button>
                      }
                      <button
                        type="button"
                        class="vk-mp-trash-btn"
                        [class.armed]="armedDeleteId() === custom.id"
                        [attr.data-testid]="'vk-mp-delete-' + custom.id"
                        [attr.aria-label]="
                          armedDeleteId() === custom.id
                            ? ('vkModelForgetConfirm' | i18n)
                            : ('delete' | i18n)
                        "
                        (click)="onDeleteClick(custom.id, $event)"
                      >
                        @if (armedDeleteId() === custom.id) {
                          <span>{{ "vkModelForgetConfirm" | i18n }}</span>
                        } @else {
                          <vk-glyph name="trash" [size]="15" />
                        }
                      </button>
                    }
                  </div>
                </div>
              }
              <h3 class="vk-mp-sec-label">{{ "vkModelCatalogSection" | i18n }}</h3>
            }

            @for (model of state().catalog; track model.id) {
              <div class="vk-mp-list-row" [attr.data-testid]="'vk-mp-row-' + model.id">
                <div class="vk-mp-list-info">
                  <div class="vk-mp-list-title">
                    <b>{{ model.name }}</b>
                    @if (model.role) {
                      <span class="vk-mp-tag" [class.accent]="model.role === 'recommended'">
                        {{ roleLabelKey(model.role) | i18n }}
                      </span>
                    }
                    @if (!model.installed && model.foundPath) {
                      <span class="vk-mp-tag">{{ "vkModelFoundOnComputer" | i18n }}</span>
                    }
                  </div>
                  <div class="vk-mp-list-blurb">{{ model.blurbKey | i18n }}</div>
                  <div class="vk-mp-list-facts">
                    {{ languagesLabelKey(model.languages) | i18n }} ·
                    {{ capabilityFact(model) }} · {{ model.paramsLabel }} ·
                    {{ formatBytes(model.bytes) }}
                  </div>
                  @if (preparationFor(model.id); as prep) {
                    @if (prep.error) {
                      <div class="vk-mp-inline-err">{{ prep.error }}</div>
                    }
                  }
                </div>

                <div class="vk-mp-list-actions">
                  @if (preparationFor(model.id); as prep) {
                    @if (!prep.error) {
                      <div class="vk-mp-inline-progress">
                        <div class="vk-mp-bar-track small">
                          <div class="vk-mp-bar-fill" [style.width.%]="progressPercent(prep)"></div>
                        </div>
                        <span class="vk-mp-pct">{{ progressShortLabel(prep) }}</span>
                        <button
                          type="button"
                          class="vk-mp-cancel-btn"
                          [attr.aria-label]="'cancel' | i18n"
                          (click)="cancelRequested.emit()"
                        >
                          <vk-glyph name="close" [size]="13" />
                        </button>
                      </div>
                    } @else {
                      <button
                        type="button"
                        class="vk-mp-btn ghost"
                        [attr.data-testid]="'vk-mp-list-download-' + model.id"
                        (click)="downloadRequested.emit(model.id)"
                      >
                        <vk-glyph name="download" [size]="14" />
                        <span>{{ formatBytes(model.bytes) }}</span>
                      </button>
                    }
                  } @else if (isModelInUse(model.id)) {
                    <span class="vk-mp-in-use">
                      <i class="vk-mp-dot" aria-hidden="true"></i>
                      {{ "vkModelInUse" | i18n }}
                    </span>
                  } @else if (model.installed) {
                    <button
                      type="button"
                      class="vk-mp-btn outline"
                      [attr.data-testid]="'vk-mp-use-' + model.id"
                      (click)="useRequested.emit(model.id)"
                    >
                      {{ "vkModelUse" | i18n }}
                    </button>
                    <button
                      type="button"
                      class="vk-mp-trash-btn"
                      [class.armed]="armedDeleteId() === model.id"
                      [attr.data-testid]="'vk-mp-delete-' + model.id"
                      [attr.aria-label]="
                        armedDeleteId() === model.id
                          ? deleteConfirmLabel(model.bytes)
                          : ('delete' | i18n)
                      "
                      (click)="onDeleteClick(model.id, $event)"
                    >
                      @if (armedDeleteId() === model.id) {
                        <span>{{ deleteConfirmLabel(model.bytes) }}</span>
                      } @else {
                        <vk-glyph name="trash" [size]="15" />
                      }
                    </button>
                  } @else if (model.foundPath) {
                    <button
                      type="button"
                      class="vk-mp-btn outline"
                      [attr.data-testid]="'vk-mp-use-' + model.id"
                      (click)="useRequested.emit(model.id)"
                    >
                      {{ "vkModelUse" | i18n }}
                    </button>
                  } @else {
                    <button
                      type="button"
                      class="vk-mp-btn ghost"
                      [attr.data-testid]="'vk-mp-list-download-' + model.id"
                      (click)="downloadRequested.emit(model.id)"
                    >
                      <vk-glyph name="download" [size]="14" />
                      <span>{{ formatBytes(model.bytes) }}</span>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .vk-mp-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2200;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgb(12 14 20 / 42%);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .vk-mp-sheet {
        display: flex;
        flex-direction: column;
        width: min(820px, calc(100vw - 32px));
        max-height: min(680px, 88vh);
        overflow: hidden;
        border: 1px solid var(--vk-line);
        border-radius: 15px;
        background: var(--vk-canvas, #f7f8fa);
        color: var(--vk-ink);
        box-shadow:
          0 28px 72px rgb(0 0 0 / 26%),
          0 1px 0 rgb(255 255 255 / 0.45) inset;
        font-family: var(--font-sans);
      }
      .vk-mp-head {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 22px 13px;
        border-bottom: 1px solid var(--vk-line);
        background: color-mix(in srgb, var(--vk-card, #ffffff) 78%, var(--vk-canvas, #f7f8fa));
      }
      .vk-mp-head.bordered {
        padding: 15px 22px;
      }
      .vk-mp-head h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 650;
        letter-spacing: -0.015em;
      }
      .vk-mp-head-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vk-mp-icon-btn {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        cursor: pointer;
      }
      .vk-mp-icon-btn:hover {
        background: var(--vk-selected);
        color: var(--vk-ink);
      }
      .vk-mp-back-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 9px 4px 5px;
        margin-left: -5px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--vk-ink);
        font: inherit;
        font-size: 15.5px;
        font-weight: 650;
        letter-spacing: -0.012em;
        cursor: pointer;
      }
      .vk-mp-back-btn:hover {
        background: var(--vk-hover);
      }
      .vk-mp-compare {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-template-rows: auto repeat(4, 38px) 58px;
        column-gap: 12px;
        padding: 16px 22px 16px;
        overflow-x: auto;
      }
      .vk-mp-col {
        display: grid;
        grid-row: 1 / -1;
        grid-template-rows: subgrid;
        padding: 15px 15px 13px;
        border: 1px solid var(--vk-line);
        border-radius: 12px;
        background: var(--vk-card, #ffffff);
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.03);
        transition:
          background 0.14s ease,
          border-color 0.14s ease,
          box-shadow 0.14s ease;
      }
      .vk-mp-col.active {
        border-color: color-mix(in srgb, var(--vk-blue) 52%, var(--vk-line));
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--vk-blue) 22%, transparent),
          0 4px 14px rgb(37 99 235 / 0.07);
      }
      .vk-mp-col-head {
        display: flex;
        flex-direction: column;
        padding-bottom: 12px;
      }
      .vk-mp-eyebrow {
        display: inline-flex;
        align-self: flex-start;
        padding: 1.5px 7px;
        border-radius: 999px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        font-size: 11px;
        font-weight: 600;
        line-height: 1.4;
      }
      .vk-mp-eyebrow.accent {
        background: var(--vk-blue-soft);
        color: var(--vk-blue-ink, var(--vk-blue));
      }
      .vk-mp-col-name {
        margin-top: 7px;
        font-size: 15.5px;
        font-weight: 650;
        letter-spacing: -0.012em;
        line-height: 1.25;
      }
      .vk-mp-col-blurb {
        margin: 5px 0 0;
        color: var(--vk-muted);
        font-size: 12px;
        line-height: 1.42;
      }
      .vk-mp-row-cell {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-top: 1px solid color-mix(in srgb, var(--vk-line) 72%, transparent);
        font-size: 12.5px;
        color: var(--vk-muted);
        font-variant-numeric: tabular-nums;
      }
      .vk-mp-row-label {
        font-weight: 450;
        color: var(--vk-faint, var(--vk-muted));
      }
      .vk-mp-row-val {
        color: var(--vk-ink);
        font-weight: 500;
        text-align: right;
      }
      .vk-mp-row-cell.win .vk-mp-row-val {
        color: var(--vk-ink);
        font-weight: 650;
      }
      .vk-mp-col-slot {
        display: flex;
        align-items: flex-end;
        padding-top: 10px;
        border-top: 1px solid color-mix(in srgb, var(--vk-line) 72%, transparent);
      }
      .vk-mp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 32px;
        padding: 0 12px;
        border: 1px solid var(--vk-line);
        border-radius: 7.5px;
        background: var(--vk-card, #ffffff);
        color: var(--vk-ink);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        box-shadow: 0 1px 1px rgb(0 0 0 / 0.03);
      }
      .vk-mp-btn.full {
        width: 100%;
      }
      .vk-mp-btn.outline:hover,
      .vk-mp-btn.ghost:hover {
        background: var(--vk-hover);
      }
      .vk-mp-btn.ghost {
        background: var(--vk-hover);
        border-color: transparent;
        color: var(--vk-ink);
        font-weight: 550;
        box-shadow: none;
      }
      .vk-mp-btn.primary {
        border-color: var(--vk-blue);
        background: var(--vk-blue);
        color: #fff;
        box-shadow: 0 1px 2px rgb(37 99 235 / 0.25);
      }
      .vk-mp-btn.primary:hover {
        filter: brightness(0.96);
      }
      .vk-mp-in-use {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--vk-green-soft, rgb(18 138 90 / 0.1));
        color: var(--vk-green, #128a5a);
        font-size: 12px;
        font-weight: 600;
      }
      .vk-mp-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
      }
      .vk-mp-progress-box {
        display: grid;
        gap: 7px;
        width: 100%;
      }
      .vk-mp-progress-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        color: var(--vk-muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .vk-mp-cancel-btn {
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted);
        cursor: pointer;
      }
      .vk-mp-cancel-btn:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-mp-bar-track {
        width: 100%;
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--vk-hover);
      }
      .vk-mp-bar-track.small {
        width: 96px;
      }
      .vk-mp-bar-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--vk-blue);
        transition: width 0.15s ease;
      }
      .vk-mp-slot-err {
        display: grid;
        gap: 4px;
        width: 100%;
      }
      .vk-mp-slot-err small {
        overflow: hidden;
        color: var(--vk-red, #dc2626);
        font-size: 11.5px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-mp-foot {
        display: flex;
        flex: none;
        justify-content: flex-end;
        padding: 10px 22px 13px;
        border-top: 1px solid var(--vk-line);
        background: color-mix(in srgb, var(--vk-card, #ffffff) 60%, var(--vk-canvas, #f7f8fa));
      }
      .vk-mp-more-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 10px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-mp-more-btn:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-mp-list {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 12px 22px 20px;
      }
      .vk-mp-sec-label {
        margin: 14px 4px 6px;
        color: var(--vk-muted);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .vk-mp-list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 14px;
        margin-bottom: 7px;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
        background: var(--vk-card, #ffffff);
      }
      .vk-mp-list-row:last-child {
        margin-bottom: 0;
      }
      .vk-mp-list-info {
        display: grid;
        gap: 3px;
        min-width: 0;
        flex: 1;
      }
      .vk-mp-list-title {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      .vk-mp-list-title b {
        font-size: 14px;
        font-weight: 600;
      }
      .vk-mp-tag {
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        font-size: 11.5px;
        font-weight: 600;
      }
      .vk-mp-tag.accent {
        background: var(--vk-blue-soft);
        color: var(--vk-blue-ink, var(--vk-blue));
      }
      .vk-mp-tag.warn {
        background: var(--vk-amber-soft);
        color: var(--vk-amber);
      }
      .vk-mp-list-blurb {
        color: var(--vk-muted);
        font-size: 13px;
        line-height: 1.38;
      }
      .vk-mp-list-facts {
        color: var(--vk-faint, var(--vk-muted));
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .vk-mp-inline-err {
        margin-top: 2px;
        color: var(--vk-red, #dc2626);
        font-size: 12px;
      }
      .vk-mp-list-actions {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
      }
      .vk-mp-inline-progress {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vk-mp-pct {
        min-width: 34px;
        color: var(--vk-muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .vk-mp-trash-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 34px;
        min-width: 34px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-mp-trash-btn:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-mp-trash-btn.armed {
        padding: 0 10px;
        border-color: color-mix(in srgb, var(--vk-red, #dc2626) 35%, var(--vk-line));
        background: color-mix(in srgb, var(--vk-red, #dc2626) 11%, transparent);
        color: var(--vk-red, #dc2626);
      }
      @media (prefers-reduced-motion: reduce) {
        .vk-mp-col,
        .vk-mp-bar-fill {
          transition: none;
        }
      }
    `,
  ],
})
export class VowkeyDecisionPickerComponent implements OnInit {
  private readonly i18n = inject(I18nService);

  readonly state = input.required<DecisionModelsState>();
  readonly localModeActive = input(false);
  readonly initialView = input<PickerView>("compare");

  readonly closed = output<void>();
  readonly useRequested = output<string>();
  readonly downloadRequested = output<string>();
  readonly cancelRequested = output<void>();
  readonly deleteRequested = output<string>();
  readonly importRequested = output<void>();

  protected readonly view = signal<PickerView>("compare");
  protected readonly armedDeleteId = signal<string | null>(null);
  protected readonly formatBytes = formatModelBytes;

  ngOnInit(): void {
    this.view.set(this.initialView());
  }

  protected readonly compareModels = computed<DecisionCatalogModel[]>(() => {
    const roles: DecisionModelRole[] = ["recommended", "most_accurate", "fastest"];
    const catalog = this.state().catalog;
    const picked = roles
      .map((role) => catalog.find((m) => m.role === role))
      .filter((m): m is DecisionCatalogModel => m != null);
    return picked.length === 3 ? picked : catalog.slice(0, 3);
  });

  protected readonly accuracyWinner = computed(() =>
    singleWinnerIndex(
      this.compareModels().map((m) => m.accuracyPercent),
      "max",
    ),
  );

  protected readonly memoryWinner = computed(() =>
    singleWinnerIndex(
      this.compareModels().map((m) => m.memoryBytes),
      "min",
    ),
  );

  protected readonly downloadWinner = computed(() =>
    singleWinnerIndex(
      this.compareModels().map((m) => m.bytes),
      "min",
    ),
  );

  protected readonly moreModelsCount = computed(() => {
    const extraCatalog = Math.max(0, this.state().catalog.length - this.compareModels().length);
    return extraCatalog + this.state().customModels.length;
  });

  @HostListener("window:keydown", ["$event"])
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.closed.emit();
    }
  }

  protected onSheetClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.armedDeleteId() == null) {
      return;
    }
    const clickedTrash = event
      .composedPath()
      .some((node) => node instanceof Element && node.classList.contains("vk-mp-trash-btn"));
    if (!clickedTrash) {
      this.armedDeleteId.set(null);
    }
  }

  protected openAllView(): void {
    this.armedDeleteId.set(null);
    this.view.set("all");
  }

  protected openCompareView(): void {
    this.armedDeleteId.set(null);
    this.view.set("compare");
  }

  protected isModelInUse(modelId: string): boolean {
    return this.localModeActive() && this.state().activeModelId === modelId;
  }

  protected shouldHighlightDownload(model: DecisionCatalogModel): boolean {
    return (
      model.role === "recommended" &&
      this.state().activeModelId == null &&
      this.state().preparation == null
    );
  }

  protected preparationFor(modelId: string): DecisionPreparationState | null {
    const prep = this.state().preparation;
    return prep?.modelId === modelId ? prep : null;
  }

  protected progressPercent(prep: DecisionPreparationState): number {
    if (prep.phase === "verifying" || prep.phase === "loading") {
      return 100;
    }
    if (!prep.totalBytes || prep.totalBytes <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((prep.downloadedBytes / prep.totalBytes) * 100)));
  }

  protected progressLabel(prep: DecisionPreparationState): string {
    if (prep.phase === "verifying") {
      return this.tr("vkModelVerifying", "Checking download…");
    }
    if (prep.phase === "loading") {
      return this.tr("vkModelStarting", "Starting model…");
    }
    const pct = this.progressPercent(prep);
    const size = formatModelBytes(prep.totalBytes);
    return this.tr("vkModelProgressOfSize", `${pct}% of ${size}`, String(pct), size);
  }

  protected progressShortLabel(prep: DecisionPreparationState): string {
    if (prep.phase === "verifying") {
      return this.tr("vkModelVerifyingShort", "Checking…");
    }
    if (prep.phase === "loading") {
      return this.tr("vkModelStartingShort", "Starting…");
    }
    return `${this.progressPercent(prep)}%`;
  }

  protected roleLabelKey(role?: DecisionModelRole): string {
    if (role === "recommended") {
      return "vkModelRoleRecommended";
    }
    if (role === "most_accurate") {
      return "vkModelRoleMostAccurate";
    }
    return "vkModelRoleSmallest";
  }

  protected languagesLabelKey(languages: "multilingual" | "english"): string {
    return languages === "english" ? "vkModelLangEnglish" : "vkModelLangMultilingual";
  }

  protected downloadSizeLabel(bytes: number): string {
    const size = formatModelBytes(bytes);
    return this.tr("vkModelDownloadSize", `Download ${size}`, size);
  }

  protected moreModelsLabel(): string {
    const count = this.moreModelsCount();
    return this.tr("vkModelMoreModels", `${count} more models`, String(count));
  }

  protected capabilityTierLabel(model: DecisionCatalogModel): string {
    const maxAcc = Math.max(
      ...this.state().catalog.map((m) => m.accuracyPercent),
      model.accuracyPercent,
      1,
    );
    if (model.role === "most_accurate" || model.accuracyPercent >= maxAcc - 2) {
      return this.tr("vkModelTierHighest", "Highest");
    }
    if (model.role === "recommended" || model.accuracyPercent >= maxAcc * 0.85) {
      return this.tr("vkModelTierHigh", "High");
    }
    if (model.accuracyPercent >= maxAcc * 0.65) {
      return this.tr("vkModelTierBalanced", "Balanced");
    }
    return this.tr("vkModelTierBasic", "Basic");
  }

  protected capabilityFact(model: DecisionCatalogModel): string {
    const tier = this.capabilityTierLabel(model);
    return this.tr("vkModelQualityFact", `${tier} quality`, tier);
  }

  protected deleteConfirmLabel(bytes: number): string {
    const size = formatModelBytes(bytes);
    return this.tr("vkModelDeleteConfirm", `Delete ${size}?`, size);
  }

  protected onDeleteClick(modelId: string, event?: Event): void {
    event?.stopPropagation();
    if (this.armedDeleteId() === modelId) {
      this.armedDeleteId.set(null);
      this.deleteRequested.emit(modelId);
      return;
    }
    this.armedDeleteId.set(modelId);
  }

  private tr(key: string, fallback: string, ...args: string[]): string {
    const translated = this.i18n.t(key, ...args);
    return translated && translated !== key ? translated : fallback;
  }
}
