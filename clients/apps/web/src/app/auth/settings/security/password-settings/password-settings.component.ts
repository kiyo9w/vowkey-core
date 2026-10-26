import { Component, OnInit } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { ChangePasswordComponent } from "@vowkey/angular/auth/password-management/change-password";
import { InputPasswordFlow } from "@vowkey/auth/angular";
import { UserDecryptionOptionsServiceAbstraction } from "@vowkey/auth/common";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { CalloutModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { WebauthnLoginSettingsModule } from "../../webauthn-login-settings";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-password-settings",
  templateUrl: "password-settings.component.html",
  imports: [CalloutModule, ChangePasswordComponent, I18nPipe, WebauthnLoginSettingsModule],
})
export class PasswordSettingsComponent implements OnInit {
  inputPasswordFlow = InputPasswordFlow.ChangePasswordWithOptionalUserKeyRotation;
  changePasswordFeatureFlag = false;

  constructor(
    private router: Router,
    private userDecryptionOptionsService: UserDecryptionOptionsServiceAbstraction,
    private accountService: AccountService,
  ) {}

  async ngOnInit() {
    // TODO: eventually this redirection logic should be replaced w/ usage of the hasPasswordGuard
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    const userHasMasterPassword = await firstValueFrom(
      this.userDecryptionOptionsService.hasMasterPasswordById$(userId),
    );

    if (!userHasMasterPassword) {
      await this.router.navigate(["/settings/security/two-factor"]);
      return;
    }
  }
}
