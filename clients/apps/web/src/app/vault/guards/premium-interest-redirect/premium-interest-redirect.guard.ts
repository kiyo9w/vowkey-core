import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { PremiumInterestStateService } from "@vowkey/angular/billing/services/premium-interest/premium-interest-state.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";

export const premiumInterestRedirectGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const accountService = inject(AccountService);
  const premiumInterestStateService = inject(PremiumInterestStateService);
  const logService = inject(LogService);

  try {
    const currentAcct = await firstValueFrom(accountService.activeAccount$);

    if (!currentAcct) {
      return router.createUrlTree(["/login"]);
    }

    const intendsToSetupPremium = await premiumInterestStateService.getPremiumInterest(
      currentAcct.id,
    );

    if (intendsToSetupPremium) {
      return router.createUrlTree(["/settings/subscription/premium"], {
        queryParams: { callToAction: "upgradeToPremium" },
      });
    }

    return true;
  } catch (error) {
    logService.error("Error in premiumInterestRedirectGuard", error);
    return true;
  }
};
