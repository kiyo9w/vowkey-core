import { Component } from "@angular/core";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { NoCredentialsIcon } from "@vowkey/assets/svg";
import { StatusLockupComponent, SvgComponent } from "@vowkey/components";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "bit-empty-credential-history",
  templateUrl: "empty-credential-history.component.html",
  imports: [JslibModule, StatusLockupComponent, SvgComponent],
})
export class EmptyCredentialHistoryComponent {
  noCredentialsIcon = NoCredentialsIcon;

  constructor() {}
}
