import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { RouterModule } from "@angular/router";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { ClientType } from "@vowkey/common/enums";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { DefaultServerSettingsService } from "@vowkey/common/platform/services/default-server-settings.service";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { LinkModule } from "@vowkey/components";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  imports: [CommonModule, JslibModule, LinkModule, RouterModule],
  template: `
    <div class="tw-flex tw-flex-col tw-items-center tw-gap-2.5 tw-text-center tw-text-sm">
      <div *ngIf="!(isUserRegistrationDisabled$ | async)" class="tw-text-fg-body-subtle">
        {{ "newToVowkey" | i18n }}
        <a bitLink routerLink="/signup" data-testid="login-create-account-link">{{
          "createAccount" | i18n
        }}</a>
      </div>
      <div>
        <a
          [routerLink]="localRoute"
          class="tw-inline-flex tw-items-center tw-px-2.5 tw-py-1 tw-rounded-md tw-text-xs tw-font-medium tw-no-underline tw-text-fg-body-subtle hover:tw-text-fg-heading hover:tw-bg-[var(--vk-hover)]"
        >
          {{ "vowkeyContinueWithoutAccount" | i18n }}
        </a>
      </div>
    </div>
  `,
})
export class LoginSecondaryContentComponent {
  serverSettingsService = inject(DefaultServerSettingsService);
  private readonly platformUtils = inject(PlatformUtilsService, { optional: true });

  protected readonly localRoute =
    this.platformUtils?.getClientType() === ClientType.Desktop ? "/vault" : "/local";

  protected isUserRegistrationDisabled$ = this.serverSettingsService.isUserRegistrationDisabled$;
}
