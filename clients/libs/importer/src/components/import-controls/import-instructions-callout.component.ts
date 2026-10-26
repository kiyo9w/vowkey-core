import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import { CalloutModule, LinkModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

@Component({
  selector: "importer-instructions-callout",
  templateUrl: "./import-instructions-callout.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CalloutModule, LinkModule, I18nPipe],
  host: { class: "tw-contents" },
})
export class ImportInstructionsCalloutComponent {
  readonly instructionKey = input<string>();
  readonly instructionLink = input<string>();
  readonly vendorName = input.required<string>();
}
