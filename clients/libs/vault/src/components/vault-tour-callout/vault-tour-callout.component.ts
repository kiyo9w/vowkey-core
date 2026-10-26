import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { firstValueFrom, switchMap } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { ButtonComponent, CalloutComponent } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { Vfo1TourCalloutService } from "../../services/vfo1-tour-callout.service";

@Component({
  selector: "vault-tour-callout",
  templateUrl: "./vault-tour-callout.component.html",
  imports: [CalloutComponent, ButtonComponent, I18nPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultTourCalloutComponent {
  private readonly accountService = inject(AccountService);
  private readonly calloutService = inject(Vfo1TourCalloutService);

  protected readonly show = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.calloutService.show$(userId)),
    ),
    { initialValue: false },
  );

  protected readonly startTour = () => this.calloutService.startTour();

  protected async dismiss(): Promise<void> {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    await this.calloutService.dismiss(userId);
  }
}
