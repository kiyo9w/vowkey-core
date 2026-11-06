import { ChangeDetectionStrategy, Component, EventEmitter, Output } from "@angular/core";

import { JslibModule } from "@vowkey/angular/jslib.module";

export const DEMO_ACCOUNT_EMAIL = "demo@vowkey.app";
export const DEMO_ACCOUNT_PASSWORD = "123456";

/** The Demo Day card from vowkey.app, with a button that signs in to the shared demo account. */
@Component({
  selector: "vk-demo-day-banner",
  standalone: true,
  imports: [JslibModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="dd-float" data-testid="demo-day-banner" [attr.aria-label]="'Demo Day'">
      <div class="dd-stage">
        <img class="dd-bg" src="images/demoday-bg.webp" alt="" />
        <div class="dd-grid">
          <div class="dd-brand">
            <img
              class="dd-lockup"
              src="images/demoday-lockup.webp"
              alt="Vietnam — Japan AI Hackathon 2026 · Demo Day"
            />
            <span class="dd-chip"><i class="dd-dot"></i>07 Nov 2026 · TiB Tokyo Innovation Base</span>
            <button type="button" class="dd-go" data-testid="demo-day-sign-in" (click)="signIn.emit()">
              {{ "vkDemoQuickSignIn" | i18n }}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        container-type: inline-size;
      }
      .dd-float {
        padding: 6px;
        border-radius: 26px;
        background: linear-gradient(140deg, rgba(255, 255, 255, 0.78) 0%, rgba(94, 234, 212, 0.28) 48%, rgba(255, 255, 255, 0.62) 100%);
        backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.88);
        box-shadow:
          0 28px 64px -20px rgba(4, 38, 44, 0.34),
          0 10px 24px -10px rgba(6, 56, 62, 0.2),
          inset 0 1.5px 0 rgba(255, 255, 255, 0.96),
          inset 0 -1px 0 rgba(45, 212, 191, 0.3);
      }
      .dd-stage {
        position: relative;
        border-radius: 20px;
        overflow: hidden;
        background: #052b31;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26), inset 0 0 0 1px rgba(16, 78, 84, 0.45);
        color: #f4fffd;
      }
      .dd-bg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: right 42%;
      }
      .dd-stage::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 1;
        background:
          radial-gradient(620px 240px at 16% -12%, rgba(110, 255, 228, 0.22), transparent 68%),
          linear-gradient(96deg, rgba(3, 27, 32, 0.88) 0%, rgba(4, 41, 47, 0.64) 46%, rgba(4, 34, 40, 0.22) 100%);
        pointer-events: none;
      }
      .dd-grid {
        position: relative;
        z-index: 2;
        display: grid;
        grid-template-columns: 1fr;
        align-items: center;
        gap: 18px;
        padding: 16px 20px;
      }
      .dd-brand {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 14px;
        min-width: 0;
      }
      .dd-go {
        margin-left: auto;
      }
      .dd-lockup {
        height: 48px;
        width: auto;
        max-width: 100%;
        object-fit: contain;
        filter: drop-shadow(0 4px 14px rgba(0, 0, 0, 0.32));
      }
      .dd-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 4px 11px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.13);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(153, 246, 228, 0.34);
        font-size: 12px;
        font-weight: 600;
        color: #d7fff6;
        white-space: nowrap;
      }
      .dd-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #42f5c5;
        box-shadow: 0 0 10px #42f5c5;
        flex: none;
      }
      .dd-go {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #5cf5ce 0%, #2ad4b2 100%);
        color: #03252a;
        font: inherit;
        font-size: 13.5px;
        font-weight: 750;
        letter-spacing: -0.01em;
        cursor: pointer;
        box-shadow: 0 10px 24px -6px rgba(45, 212, 191, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.72);
        transition: transform 0.16s ease, filter 0.16s ease;
      }
      .dd-go:hover {
        transform: translateY(-1px);
        filter: brightness(1.05);
      }
      @container (max-width: 620px) {
        .dd-grid {
          padding: 14px;
        }
        .dd-go {
          margin-left: 0;
          width: 100%;
          justify-content: center;
        }
        .dd-lockup {
          height: 38px;
        }
        .dd-bg {
          object-position: 92% center;
        }
        .dd-stage::before {
          background:
            radial-gradient(420px 220px at 20% 0%, rgba(110, 255, 228, 0.2), transparent 70%),
            linear-gradient(180deg, rgba(3, 27, 32, 0.9) 0%, rgba(4, 41, 47, 0.78) 58%, rgba(4, 34, 40, 0.52) 100%);
        }
      }
    `,
  ],
})
export class DemoDayBannerComponent {
  @Output() signIn = new EventEmitter<void>();
}
