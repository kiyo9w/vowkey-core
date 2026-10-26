import { Component, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom, takeUntil, tap } from "rxjs";

import { CollectionService } from "@vowkey/admin-console/common";
import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { getById } from "@vowkey/common/platform/misc";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { SyncService } from "@vowkey/common/vault/abstractions/sync/sync.service.abstraction";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { CipherViewLikeUtils } from "@vowkey/common/vault/utils/cipher-view-like-utils";
import {
  BerryComponent,
  ChipFilterComponent,
  DialogService,
  BreadcrumbsModule,
} from "@vowkey/components";
import { LogService } from "@vowkey/logging";
import {
  CipherFormConfigService,
  PasswordRepromptService,
  RoutedVaultFilterBridgeService,
  RoutedVaultFilterService,
  Vfo1IconPipe,
} from "@vowkey/vault";

import { HeaderModule } from "../../../../layouts/header/header.module";
import { SharedModule } from "../../../../shared";
import { OrganizationBadgeModule } from "../../../../vault/individual-vault/organization-badge/organization-badge.module";
import { PipesModule } from "../../../../vault/individual-vault/pipes/pipes.module";
import { AdminConsoleCipherFormConfigService } from "../../../../vault/org-vault/services/admin-console-cipher-form-config.service";
import { ReusedPasswordsReportComponent as BaseReusedPasswordsReportComponent } from "../reused-passwords-report.component";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-reused-passwords-report",
  templateUrl: "../reused-passwords-report.component.html",
  providers: [
    {
      provide: CipherFormConfigService,
      useClass: AdminConsoleCipherFormConfigService,
    },
    AdminConsoleCipherFormConfigService,
    RoutedVaultFilterService,
    RoutedVaultFilterBridgeService,
  ],
  imports: [
    SharedModule,
    HeaderModule,
    OrganizationBadgeModule,
    PipesModule,
    BreadcrumbsModule,
    ChipFilterComponent,
    BerryComponent,
    Vfo1IconPipe,
  ],
})
export class ReusedPasswordsReportComponent
  extends BaseReusedPasswordsReportComponent
  implements OnInit
{
  private manageableCipherIds = new Set<string>();
  private sharedCollectionIds = new Set<string>();

  constructor(
    cipherService: CipherService,
    dialogService: DialogService,
    private route: ActivatedRoute,
    organizationService: OrganizationService,
    protected accountService: AccountService,
    protected logService: LogService,
    passwordRepromptService: PasswordRepromptService,
    i18nService: I18nService,
    syncService: SyncService,
    cipherFormConfigService: CipherFormConfigService,
    adminConsoleCipherFormConfigService: AdminConsoleCipherFormConfigService,
    private collectionService: CollectionService,
  ) {
    super(
      cipherService,
      organizationService,
      dialogService,
      accountService,
      passwordRepromptService,
      i18nService,
      syncService,
      cipherFormConfigService,
      adminConsoleCipherFormConfigService,
      logService,
    );
  }

  async ngOnInit() {
    this.isAdminConsoleActive = true;
    this.logService.info("[ReusedPasswordsOrganizationReport] org setup start");

    this.route.parent?.parent?.params
      .pipe(
        tap(async (params) => {
          this.logService.info("[ReusedPasswordsOrganizationReport] route params received");

          try {
            const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
            this.organization = await firstValueFrom(
              this.organizationService.organizations$(userId).pipe(getById(params.organizationId)),
            );
            this.logService.info(
              `[ReusedPasswordsOrganizationReport] organization context loaded found=${this.organization != null}`,
            );

            const manageableCiphers = await this.cipherService.getAll(userId);
            this.manageableCipherIds = new Set(manageableCiphers.map((c) => c.id));
            this.logService.info(
              `[ReusedPasswordsOrganizationReport] manageable ciphers loaded count=${this.manageableCipherIds.size}`,
            );

            const collections = await firstValueFrom(
              this.collectionService.decryptedCollections$(userId),
            );
            this.sharedCollectionIds = new Set(
              collections
                .filter((c) => !c.isDefaultCollection && c.organizationId === this.organization?.id)
                .map((c) => c.id as string),
            );
            this.logService.info(
              `[ReusedPasswordsOrganizationReport] shared collections loaded count=${this.sharedCollectionIds.size}`,
            );

            await super.ngOnInit();
            this.logService.info("[ReusedPasswordsOrganizationReport] org setup complete");
          } catch (e) {
            this.logService.error("[ReusedPasswordsOrganizationReport] org setup failure", e);
            throw e;
          }
        }),
        takeUntil(this.destroyed$),
      )
      .subscribe();
  }

  async getAllCiphers(): Promise<CipherView[]> {
    if (this.organization) {
      return this.cipherService.getAllFromApiForOrganization(this.organization.id, true);
    }
    return [];
  }

  canManageCipher(c: CipherView): boolean {
    if (
      CipherViewLikeUtils.isUnassigned(c) ||
      !c.collectionIds?.some((id) => this.sharedCollectionIds.has(id))
    ) {
      return false;
    }
    if (this.organization?.allowAdminAccessToAllCollectionItems) {
      return true;
    }
    return this.manageableCipherIds.has(c.id);
  }
}
