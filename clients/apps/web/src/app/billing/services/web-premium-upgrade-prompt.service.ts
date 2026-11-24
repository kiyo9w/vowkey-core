import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom, Subject } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions";
import { OrganizationId } from "@vowkey/common/types/guid";
import { PremiumUpgradePromptService } from "@vowkey/common/vault/abstractions/premium-upgrade-prompt.service";
import { DialogRef, DialogService } from "@vowkey/components";
import { VaultItemDialogResult } from "@vowkey/vault";

/** The plan page, where a paid base plan is bought and an organization's seats are managed. */
const PLAN_PAGE_ROUTE = "/settings/subscription";

@Injectable()
export class WebVaultPremiumUpgradePromptService implements PremiumUpgradePromptService {
  private readonly dialogService = inject(DialogService);
  private readonly accountService = inject(AccountService);
  private readonly billingAccountProfileStateService = inject(BillingAccountProfileStateService);
  private readonly router = inject(Router);
  private readonly dialog = inject(DialogRef, { optional: true }) as DialogRef<VaultItemDialogResult> | null;

  private readonly _upgradeConfirmed$ = new Subject<boolean>();
  readonly upgradeConfirmed$ = this._upgradeConfirmed$.asObservable();

  /**
   * Prompts the user to upgrade, then sends them to the plan page for their own plan or for the
   * organization's plan.
   */
  async promptForPremium(organizationId?: OrganizationId): Promise<void> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    if (!account) {
      return;
    }

    const hasPremium = await firstValueFrom(
      this.billingAccountProfileStateService.hasPremiumFromAnySource$(account.id),
    );
    if (hasPremium) {
      // Already on a paid plan, nothing to prompt for.
      return;
    }

    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: organizationId ? "upgradeOrganization" : "premiumRequired" },
      content: { key: organizationId ? "upgradeOrganizationDesc" : "premiumRequiredDesc" },
      acceptButtonText: { key: "upgrade" },
      type: "info",
    });

    this._upgradeConfirmed$.next(confirmed);

    if (!confirmed) {
      return;
    }

    await this.router.navigate(
      organizationId ? ["/organizations", organizationId, "billing"] : [PLAN_PAGE_ROUTE],
    );
    if (this.dialog) {
      await this.dialog.close(VaultItemDialogResult.PremiumUpgrade);
    }
  }
}
