import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { UpgradeImportType } from "@vowkey/importer-core";
import { ImportSourceSelectComponent, importSourceFromQuery } from "@vowkey/importer-ui";

@Component({
  templateUrl: "import-source-select-desktop.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImportSourceSelectComponent],
})
export class ImportSourceSelectDesktopComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly initialSource = importSourceFromQuery(this.route);

  protected onContinue(importType: UpgradeImportType): void {
    void this.router.navigate(["/import", importType]);
  }
}
