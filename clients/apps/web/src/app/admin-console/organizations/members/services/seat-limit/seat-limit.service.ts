import { inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";

import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { DialogService, ToastService } from "@vowkey/components";

/**
 * A plan provides a fixed number of seats: the server's entitlement for the organization, exposed
 * as `organization.seats`. The server refuses an invite or a restore once every seat is taken; this
 * service blocks the action before the request and sends the billing owner to the plan page, where
 * more seats are bought.
 */
@Injectable({ providedIn: "root" })
export class SeatLimitService {
  private readonly i18nService = inject(I18nService);
  private readonly dialogService = inject(DialogService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);

  /** True when the seat limit stops the action; tells the admin what to do instead. */
  async blocksAction(organization: Organization, occupiedSeats: number): Promise<boolean> {
    if (occupiedSeats < organization.seats) {
      return false;
    }

    if (organization.canEditSubscription) {
      const addSeats = await this.dialogService.openSimpleDialog({
        title: { key: "upgradeOrganization" },
        content: {
          key: "subscriptionSeatMaxReached",
          placeholders: [organization.seats.toString()],
        },
        acceptButtonText: { key: "upgrade" },
        type: "info",
      });
      if (addSeats) {
        await this.router.navigate(["/organizations", organization.id, "billing"]);
      }
      return true;
    }

    this.toastService.showToast({
      variant: "error",
      title: this.i18nService.t("errorOccurred"),
      message: this.i18nService.t("seatLimitReachedContactOwner", organization.seats.toString()),
    });
    return true;
  }
}
