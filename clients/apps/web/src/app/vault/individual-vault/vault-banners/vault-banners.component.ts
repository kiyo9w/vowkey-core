import { Component, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { filter, firstValueFrom, map } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { MessageListener } from "@vowkey/common/platform/messaging";
import { BannerModule } from "@vowkey/components";

import { VerifyEmailComponent } from "../../../auth/settings/verify-email.component";
import { SharedModule } from "../../../shared";

import { VaultBannersService, VisibleVaultBanner } from "./services/vault-banners.service";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-vault-banners",
  templateUrl: "./vault-banners.component.html",
  imports: [
    VerifyEmailComponent,
    SharedModule,
    BannerModule,
  ],
  providers: [VaultBannersService],
})
export class VaultBannersComponent implements OnInit {
  visibleBanners: VisibleVaultBanner[] = [];
  VisibleVaultBanner = VisibleVaultBanner;

  private activeUserId$ = this.accountService.activeAccount$.pipe(map((a) => a?.id));

  constructor(
    private vaultBannerService: VaultBannersService,
    private accountService: AccountService,
    private messageListener: MessageListener,
  ) {
    // Listen for auth request messages and show banner immediately
    this.messageListener.allMessages$
      .pipe(
        filter((message: { command: string }) => message.command === "openLoginApproval"),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (!this.visibleBanners.includes(VisibleVaultBanner.PendingAuthRequest)) {
          this.visibleBanners = [...this.visibleBanners, VisibleVaultBanner.PendingAuthRequest];
        }
      });
  }

  async ngOnInit(): Promise<void> {
    await this.determineVisibleBanners();
  }

  async dismissBanner(banner: VisibleVaultBanner): Promise<void> {
    const activeUserId = await firstValueFrom(this.activeUserId$);
    if (!activeUserId) {
      return;
    }
    await this.vaultBannerService.dismissBanner(activeUserId, banner);
    await this.determineVisibleBanners();
  }


  /** Determine which banners should be present */
  async determineVisibleBanners(): Promise<void> {
    const activeUserId = await firstValueFrom(this.activeUserId$);

    if (!activeUserId) {
      return;
    }

    const showBrowserOutdated =
      await this.vaultBannerService.shouldShowUpdateBrowserBanner(activeUserId);
    const showVerifyEmail = await this.vaultBannerService.shouldShowVerifyEmailBanner(activeUserId);
    const showPendingAuthRequest =
      await this.vaultBannerService.shouldShowPendingAuthRequestBanner(activeUserId);

    this.visibleBanners = [
      showBrowserOutdated ? VisibleVaultBanner.OutdatedBrowser : null,
      showVerifyEmail ? VisibleVaultBanner.VerifyEmail : null,
      showPendingAuthRequest ? VisibleVaultBanner.PendingAuthRequest : null,
    ].filter((banner) => banner !== null);
  }
}
