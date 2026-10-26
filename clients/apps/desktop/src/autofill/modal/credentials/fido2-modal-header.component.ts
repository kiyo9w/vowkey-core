import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { VowkeyLogo, VowkeyLogoBeta } from "@vowkey/assets/svg";
import { flagEnabled } from "@vowkey/common/platform/misc/flags";
import { BitIconButtonComponent, SvgComponent, TypographyModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

/**
 * Draggable header for the passkey modal window. Mirrors the browser extension's `popup-header`.
 */
@Component({
  selector: "app-fido2-modal-header",
  templateUrl: "fido2-modal-header.component.html",
  imports: [BitIconButtonComponent, I18nPipe, SvgComponent, TypographyModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Fido2ModalHeaderComponent {
  readonly pageTitle = input.required<string>();
  readonly closeModal = output<void>();

  protected readonly logo = flagEnabled("prereleaseBuild") ? VowkeyLogoBeta : VowkeyLogo;
}
