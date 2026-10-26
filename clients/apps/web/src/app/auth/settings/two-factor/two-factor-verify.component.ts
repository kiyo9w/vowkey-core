import { Component, Inject } from "@angular/core";
import { FormControl, FormGroup, ReactiveFormsModule } from "@angular/forms";

import { UserVerificationFormInputComponent } from "@vowkey/auth/angular";
import { UserVerificationService } from "@vowkey/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { TwoFactorProviderType } from "@vowkey/common/auth/enums/two-factor-provider-type";
import { SecretVerificationRequest } from "@vowkey/common/auth/models/request/secret-verification.request";
import {
  TwoFactorService,
  TwoFactorSetupDialogData,
  TwoFactorResponse,
} from "@vowkey/common/auth/two-factor";
import { VerificationWithSecret } from "@vowkey/common/auth/types/verification";
import { ErrorResponse } from "@vowkey/common/models/response/error.response";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import {
  AsyncActionsModule,
  ButtonModule,
  DIALOG_DATA,
  DialogConfig,
  DialogModule,
  DialogRef,
  DialogService,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

type TwoFactorVerifyDialogData = {
  type: TwoFactorProviderType;
  organizationId: string;
};

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-two-factor-verify",
  templateUrl: "two-factor-verify.component.html",
  imports: [
    AsyncActionsModule,
    ButtonModule,
    DialogModule,
    I18nPipe,
    ReactiveFormsModule,
    UserVerificationFormInputComponent,
  ],
})
export class TwoFactorVerifyComponent {
  type: TwoFactorProviderType;
  organizationId: string;
  formPromise: Promise<TwoFactorResponse> | undefined;

  protected formGroup = new FormGroup({
    secret: new FormControl<VerificationWithSecret | null>(null),
  });
  invalidSecret: boolean = false;

  constructor(
    @Inject(DIALOG_DATA) protected data: TwoFactorVerifyDialogData,
    private dialogRef: DialogRef,
    private twoFactorService: TwoFactorService,
    private i18nService: I18nService,
    private userVerificationService: UserVerificationService,
  ) {
    this.type = data.type;
    this.organizationId = data.organizationId;
  }

  submit = async () => {
    try {
      if (!this.formGroup.value.secret) {
        throw new Error("Secret is required");
      }

      const secret = this.formGroup.value.secret!;
      this.formPromise = this.userVerificationService.buildRequest(secret).then((request) => {
        return this.apiCall(request);
      });

      const response = await this.formPromise;
      await this.dialogRef.close({
        response: response,
        secret: secret.secret,
        verificationType: secret.type,
      });
    } catch (e) {
      if (e instanceof ErrorResponse && e.statusCode === 400) {
        this.invalidSecret = true;
      }
      throw e;
    }
  };

  get dialogTitle(): string {
    switch (this.type) {
      case -1 as TwoFactorProviderType:
        return this.i18nService.t("recoveryCodeTitle");
      case TwoFactorProviderType.Duo:
      case TwoFactorProviderType.OrganizationDuo:
        return "Duo";
      case TwoFactorProviderType.Email:
        return this.i18nService.t("emailTitle");
      case TwoFactorProviderType.WebAuthn:
        return this.i18nService.t("webAuthnTitle");
      case TwoFactorProviderType.Authenticator:
        return this.i18nService.t("authenticatorAppTitle");
      case TwoFactorProviderType.Yubikey:
        return "Yubikey";
      default:
        throw new Error(`Unknown two-factor type: ${this.type}`);
    }
  }

  private apiCall(request: SecretVerificationRequest): Promise<TwoFactorResponse> {
    switch (this.type) {
      case -1 as TwoFactorProviderType:
        return this.twoFactorService.getTwoFactorRecover(request);
      case TwoFactorProviderType.Duo:
      case TwoFactorProviderType.OrganizationDuo:
        if (this.organizationId != null) {
          return this.twoFactorService.getTwoFactorOrganizationDuo(this.organizationId, request);
        } else {
          return this.twoFactorService.getTwoFactorDuo(request);
        }
      case TwoFactorProviderType.Email:
        return this.twoFactorService.getTwoFactorEmail(request);
      case TwoFactorProviderType.WebAuthn:
        return this.twoFactorService.getTwoFactorWebAuthn(request);
      case TwoFactorProviderType.Authenticator:
        return this.twoFactorService.getTwoFactorAuthenticator(request);
      case TwoFactorProviderType.Yubikey:
        return this.twoFactorService.getTwoFactorYubiKey(request);
      default:
        throw new Error(`Unknown two-factor type: ${this.type}`);
    }
  }

  static open(dialogService: DialogService, config: DialogConfig<TwoFactorVerifyDialogData>) {
    return dialogService.open<TwoFactorSetupDialogData<any>, TwoFactorVerifyDialogData>(
      TwoFactorVerifyComponent,
      config as DialogConfig<TwoFactorVerifyDialogData, TwoFactorSetupDialogData<any>>,
    );
  }
}
