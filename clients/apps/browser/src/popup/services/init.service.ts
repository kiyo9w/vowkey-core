import { inject, Inject, Injectable, Optional, DOCUMENT } from "@angular/core";
import { pairwise } from "rxjs";

import { LocalVaultAttachService } from "@vowkey/angular/services/local-vault-attach.service";
import { AbstractThemingService } from "@vowkey/angular/platform/services/theming/theming.service.abstraction";
import { AutomationDriver } from "@vowkey/automation-driver";
import { TwoFactorService } from "@vowkey/common/auth/two-factor";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService as LogServiceAbstraction } from "@vowkey/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { MigrationRunner } from "@vowkey/common/platform/services/migration-runner";
import { SyncService } from "@vowkey/common/platform/sync";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";

import { ForegroundUnlockService } from "../../key-management/unlock/foreground-unlock.service";
import BrowserPopupUtils from "../../platform/browser/browser-popup-utils";
import { PopupSizeService } from "../../platform/popup/layout/popup-size.service";
import { PopupViewCacheService } from "../../platform/popup/view-cache/popup-view-cache.service";

@Injectable()
export class InitService {
  private sizeService = inject(PopupSizeService);
  private automationDriver = inject(AutomationDriver);

  constructor(
    private platformUtilsService: PlatformUtilsService,
    private i18nService: I18nService,
    private twoFactorService: TwoFactorService,
    private logService: LogServiceAbstraction,
    private themingService: AbstractThemingService,
    private sdkLoadService: SdkLoadService,
    private viewCacheService: PopupViewCacheService,
    private readonly migrationRunner: MigrationRunner,
    private readonly unlockService: ForegroundUnlockService,
    @Inject(DOCUMENT) private document: Document,
    @Optional() private readonly localVaultAttach?: LocalVaultAttachService,
    @Optional() private readonly localVaultService?: LocalVaultService,
    @Optional() private readonly syncService?: SyncService,
  ) {}

  init() {
    return async () => {
      await this.sdkLoadService.loadAndInit();
      this.unlockService.init();
      this.localVaultService?.state$.pipe(pairwise()).subscribe(([prev, next]) => {
        if (
          prev !== next &&
          (next === "attached" || next === "attached-local-pending") &&
          prev === "migrating"
        ) {
          void this.syncService?.fullSync(true);
        }
      });
      this.localVaultAttach?.start();
      await this.migrationRunner.waitForCompletion(); // Browser background is responsible for migrations
      await this.i18nService.init();
      this.twoFactorService.init();
      await this.viewCacheService.init();
      await this.sizeService.init();

      this.automationDriver.attachToGlobal(self);

      const htmlEl = window.document.documentElement;
      this.themingService.applyThemeChangesTo(this.document);
      htmlEl.classList.add("locale_" + this.i18nService.translationLocale);

      // Workaround for slow performance on external monitors on Chrome + MacOS
      // See: https://bugs.chromium.org/p/chromium/issues/detail?id=971701#c64
      if (
        this.platformUtilsService.isChrome() &&
        navigator.platform.indexOf("Mac") > -1 &&
        BrowserPopupUtils.inPopup(window) &&
        (window.screenLeft < 0 ||
          window.screenTop < 0 ||
          window.screenLeft > window.screen.width ||
          window.screenTop > window.screen.height)
      ) {
        htmlEl.classList.add("force_redraw");
        this.logService.info("Force redraw is on");
      }
    };
  }
}
