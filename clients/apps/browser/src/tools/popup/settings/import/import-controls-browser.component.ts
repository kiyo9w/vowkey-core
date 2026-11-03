import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
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
  templateUrl: "import-controls-browser.component.html",
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
export class ImportControlsBrowserComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly accountService = inject(AccountService, { optional: true });

  protected readonly importType = importTypeFromRoute(this.route);

  protected onBack(): void {
    void this.router.navigate(["/import-source-select"], {
      queryParams: { source: this.importType() },
    });
  }

  protected onContinue(): void {
    if (this.accountService == null) {
      void this.router.navigate(["/tabs/vault"]);
      return;
    }
    void firstValueFrom(this.accountService.activeAccount$).then((account) => {
      void this.router.navigate([account == null ? "/local" : "/tabs/vault"]);
    });
  }
}
