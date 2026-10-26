import { DIALOG_DATA } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { CipherHealthView } from "@vowkey/common/dirt/models/view";
import { RiskCategory } from "@vowkey/common/dirt/vault-health/models";
import { ButtonModule, DialogModule, IconModule, TypographyModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { HealthAdditionalRisksComponent } from "../health-additional-risks/health-additional-risks.component";

export interface HealthExcludeAtRiskItemDialogData {
  currentCategory: RiskCategory;
  item: CipherHealthView;
}

/** Confirms excluding a login from the health report. Closes with `true` when confirmed. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: "dirt-health-exclude-at-risk-item-dialog",
  templateUrl: "./health-exclude-at-risk-item-dialog.component.html",
  imports: [
    DialogModule,
    ButtonModule,
    IconModule,
    TypographyModule,
    I18nPipe,
    HealthAdditionalRisksComponent,
  ],
})
export class HealthExcludeAtRiskItemDialogComponent {
  protected readonly data = inject<HealthExcludeAtRiskItemDialogData>(DIALOG_DATA);
}
