import { ChangeDetectionStrategy, Component, OnInit } from "@angular/core";
import { Router } from "@angular/router";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { svg, VowkeyIcon } from "@vowkey/assets/svg";
import { consumeDefaultPasswordManagerSuccessToast } from "@vowkey/browser/autofill/default-password-manager-session.util";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import {
  ButtonModule,
  DialogModule,
  LinkModule,
  SvgModule,
  ToastService,
  TypographyModule,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";
import { VaultCarouselModule } from "@vowkey/vault";

import { IntroCarouselService } from "../../../services/intro-carousel.service";

const FillEmblem = svg`
  <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="54" height="54" rx="14" fill="var(--vk-surface)" stroke="var(--vk-line)" stroke-width="1.5"/>
    <rect x="13" y="16" width="30" height="10" rx="3.5" stroke="var(--vk-ink)" stroke-width="2"/>
    <rect x="13" y="30" width="30" height="10" rx="3.5" stroke="var(--vk-blue)" stroke-width="2"/>
    <circle cx="38" cy="35" r="2" fill="var(--vk-blue)"/>
  </svg>
`;

const AgentRefEmblem = svg`
  <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="54" height="54" rx="14" fill="var(--vk-surface)" stroke="var(--vk-line)" stroke-width="1.5"/>
    <rect x="13" y="17" width="30" height="22" rx="6" stroke="var(--vk-ink)" stroke-width="2"/>
    <circle cx="23" cy="28" r="2.2" fill="var(--vk-blue)"/>
    <circle cx="33" cy="28" r="2.2" fill="var(--vk-blue)"/>
  </svg>
`;

@Component({
  selector: "app-intro-carousel",
  templateUrl: "./intro-carousel.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VaultCarouselModule,
    ButtonModule,
    LinkModule,
    SvgModule,
    DialogModule,
    TypographyModule,
    JslibModule,
    I18nPipe,
  ],
})
export class IntroCarouselComponent implements OnInit {
  protected readonly itemTypes = VowkeyIcon;
  protected readonly loginCards = FillEmblem;
  protected readonly agentRef = AgentRefEmblem;

  constructor(
    private readonly router: Router,
    private readonly introCarouselService: IntroCarouselService,
    private readonly toastService: ToastService,
    private readonly i18nService: I18nService,
  ) {}

  async ngOnInit() {
    if (!(await consumeDefaultPasswordManagerSuccessToast())) {
      return;
    }

    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("defaultPasswordManagerSuccessToast"),
    });
  }

  protected async navigateToSignup() {
    await this.introCarouselService.setIntroCarouselDismissed();
    await this.router.navigate(["/signup"]);
  }

  protected async navigateToLogin() {
    await this.introCarouselService.setIntroCarouselDismissed();
    await this.router.navigate(["/login"]);
  }

  protected async navigateToLocal() {
    await this.introCarouselService.setIntroCarouselDismissed();
    await this.router.navigate(["/local"]);
  }
}
