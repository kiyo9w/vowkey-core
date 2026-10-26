import { AsyncPipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { switchMap } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { SideNavVariant, NavigationModule, SideNavService } from "@vowkey/components";
import { Vfo1TourCalloutService, VaultTourCalloutComponent } from "@vowkey/vault";

import { UpgradeCalloutComponent } from "../billing/individual/upgrade/upgrade-nav-button/upgrade-callout/upgrade-callout.component";

import { AccountMenuComponent } from "./header/account-menu.component";
import { ProductSwitcherModule } from "./product-switcher/product-switcher.module";
import { ProductSwitcherService } from "./product-switcher/shared/product-switcher.service";

@Component({
  selector: "app-side-nav",
  templateUrl: "web-side-nav.component.html",
  imports: [
    AccountMenuComponent,
    AsyncPipe,
    NavigationModule,
    ProductSwitcherModule,
    UpgradeCalloutComponent,
    VaultTourCalloutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebSideNavComponent {
  readonly variant = input<SideNavVariant>("primary");
  protected readonly sideNavService = inject(SideNavService);

  private readonly productSwitcherService = inject(ProductSwitcherService);
  private readonly accountService = inject(AccountService);
  private readonly tourCalloutService = inject(Vfo1TourCalloutService);

  protected readonly shouldShowPremiumUpgradeButton$ =
    this.productSwitcherService.shouldShowPremiumUpgradeButton$;

  /**
   * Whether the VFO1 Foundation flag is enabled. While it is off, the legacy header account menu
   * is shown instead (see `WebHeaderComponent`).
   */
  protected readonly vfo1FoundationEnabled = toSignal(
    inject(ConfigService).getFeatureFlag$(FeatureFlag.VFO1Foundation),
    { initialValue: false },
  );

  protected readonly tourCalloutClaimsSlot = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.tourCalloutService.claimsSlot$(userId)),
    ),
    { initialValue: false },
  );
}
