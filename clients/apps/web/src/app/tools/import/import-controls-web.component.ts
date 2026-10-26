import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import {
  DefaultImportUpgradeMetadataService,
  ImportUpgradeMetadataServiceAbstraction,
} from "@vowkey/importer-core";
import {
  ImportControlsComponent,
  ImportUpgradeProviders,
  importTypeFromRoute,
  SYSTEM_SERVICE_PROVIDER,
} from "@vowkey/importer-ui";
import { safeProvider } from "@vowkey/ui-common";

@Component({
  templateUrl: "import-controls-web.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ImportControlsComponent],
  providers: [
    ...ImportUpgradeProviders,
    safeProvider({
      provide: ImportUpgradeMetadataServiceAbstraction,
      useClass: DefaultImportUpgradeMetadataService,
      deps: [SYSTEM_SERVICE_PROVIDER],
    }),
  ],
})
export class ImportControlsWebComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly importType = importTypeFromRoute(this.route);

  protected onBack(): void {
    void this.router.navigate(["/tools/import"], { queryParams: { source: this.importType() } });
  }

  protected onContinue(): void {
    void this.router.navigate(["/vault"]);
  }
}
