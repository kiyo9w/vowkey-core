import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { VowkeyLogo } from "@vowkey/assets/svg";
import { SvgModule, TypographyModule } from "@vowkey/components";
import { ImportShellProgressComponent } from "@vowkey/importer-ui";
import { I18nPipe } from "@vowkey/ui-common";

import { PopupPageComponent } from "../../../../platform/popup/layout/popup-page.component";

@Component({
  templateUrl: "import-shell-browser.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PopupPageComponent,
    SvgModule,
    TypographyModule,
    I18nPipe,
    ImportShellProgressComponent,
    RouterOutlet,
  ],
})
export class ImportShellBrowserComponent {
  protected readonly logo = VowkeyLogo;
}
