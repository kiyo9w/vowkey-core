import { ChangeDetectionStrategy, Component } from "@angular/core";

import { VowkeyShellComponent } from "../vowkey/vowkey-shell.component";

/** The signed-in window: the Vowkey shell around whichever page the route shows. */
@Component({
  selector: "app-layout",
  imports: [VowkeyShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./desktop-layout.component.html",
})
export class DesktopLayoutComponent {}
