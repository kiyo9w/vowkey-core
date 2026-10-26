import { Component, ChangeDetectionStrategy } from "@angular/core";

import { VowkeyIcon } from "@vowkey/assets/svg";
import { SvgModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: "vault-manually-open-extension",
  templateUrl: "./manually-open-extension.component.html",
  imports: [I18nPipe, SvgModule],
})
export class ManuallyOpenExtensionComponent {
  protected readonly VowkeyIcon = VowkeyIcon;
}
