import { ChangeDetectionStrategy, Component } from "@angular/core";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { SessionTimeoutSettingsComponent } from "@vowkey/key-management-ui";

@Component({
  templateUrl: "session-timeout.component.html",
  imports: [SessionTimeoutSettingsComponent, JslibModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionTimeoutComponent {}
