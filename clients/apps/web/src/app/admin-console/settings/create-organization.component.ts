import { Component, inject } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { OrganizationBillingServiceAbstraction } from "@vowkey/common/billing/abstractions";
import { PlanType } from "@vowkey/common/billing/enums";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ErrorResponse } from "@vowkey/common/models/response/error.response";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { BreadcrumbsModule, ToastService } from "@vowkey/components";
import { Vfo1I18nPipe } from "@vowkey/vault";

import { OrganizationInformationComponent } from "../organizations/create/organization-information.component";
import { HeaderModule } from "../../layouts/header/header.module";
import { SharedModule } from "../../shared";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "create-organization.component.html",
  imports: [
    SharedModule,
    ReactiveFormsModule,
    OrganizationInformationComponent,
    HeaderModule,
    BreadcrumbsModule,
    Vfo1I18nPipe,
  ],
})
export class CreateOrganizationComponent {
  private readonly configService = inject(ConfigService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly organizationBillingService = inject(OrganizationBillingServiceAbstraction);
  private readonly accountService = inject(AccountService);
  private readonly router = inject(Router);
  private readonly i18nService = inject(I18nService);
  private readonly toastService = inject(ToastService);

  protected readonly showBreadcrumbs = toSignal(
    this.configService.getFeatureFlag$(FeatureFlag.VFO1Foundation),
    { initialValue: false },
  );

  protected readonly formGroup = this.formBuilder.group({
    name: ["", [Validators.required, Validators.maxLength(50)]],
    billingEmail: ["", [Validators.required, Validators.email]],
  });
  protected busy = false;

  /**
   * Creates the organization on the free plan; its seats and add-ons are bought on the plan page.
   */
  async submit(): Promise<void> {
    this.formGroup.markAllAsTouched();
    if (this.formGroup.invalid || this.busy) {
      return;
    }

    this.busy = true;
    try {
      const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
      const { name, billingEmail } = this.formGroup.getRawValue();
      const response = await this.organizationBillingService.startFree(
        {
          organization: { name: name ?? "", billingEmail: billingEmail ?? "" },
          plan: { type: PlanType.Free },
        },
        userId,
      );
      this.toastService.showToast({
        variant: "success",
        title: this.i18nService.t("organizationCreated"),
        message: this.i18nService.t("organizationReadyToGo"),
      });
      await this.router.navigate(["/organizations", response.id, "billing"]);
    } catch (error: unknown) {
      const message =
        error instanceof ErrorResponse
          ? error.getSingleMessage()
          : this.i18nService.t("errorOccurred");
      this.toastService.showToast({ variant: "error", message });
    } finally {
      this.busy = false;
    }
  }
}
