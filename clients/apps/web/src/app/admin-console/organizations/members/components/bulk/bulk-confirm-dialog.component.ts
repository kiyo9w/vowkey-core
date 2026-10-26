import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { firstValueFrom, map, Observable, switchMap } from "rxjs";

import {
  OrganizationUserApiService,
  OrganizationUserBulkPublicKeyResponse,
  OrganizationUserBulkResponse,
  OrganizationUserService,
} from "@vowkey/admin-console/common";
import { UserNamePipe } from "@vowkey/angular/pipes/user-name.pipe";
import { OrganizationUserStatusType } from "@vowkey/common/admin-console/enums";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { ProviderUserBulkPublicKeyResponse } from "@vowkey/common/admin-console/models/response/provider/provider-user-bulk-public-key.response";
import { ProviderUserBulkResponse } from "@vowkey/common/admin-console/models/response/provider/provider-user-bulk.response";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { ListResponse } from "@vowkey/common/models/response/list.response";
import { OrgKey } from "@vowkey/common/types/key";
import {
  AsyncActionsModule,
  AvatarModule,
  ButtonModule,
  CalloutModule,
  DIALOG_DATA,
  DialogConfig,
  DialogModule,
  DialogService,
  LinkModule,
  TableModule,
} from "@vowkey/components";
// eslint-disable-next-line no-restricted-imports
import { SymmetricCryptoKey } from "@vowkey/legacy-crypto";
import { I18nPipe } from "@vowkey/ui-common";

import { AvatarIdPipe } from "../../pipes/avatar-id.pipe";

import { BaseBulkConfirmComponent } from "./base-bulk-confirm.component";
import { BulkUserDetails } from "./bulk-status.component";

type BulkConfirmDialogParams = {
  organization: Organization;
  users: BulkUserDetails[];
};

@Component({
  templateUrl: "bulk-confirm-dialog.component.html",
  selector: "member-bulk-comfirm-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncActionsModule,
    AvatarIdPipe,
    AvatarModule,
    ButtonModule,
    CalloutModule,
    DialogModule,
    I18nPipe,
    LinkModule,
    TableModule,
    UserNamePipe,
  ],
})
export class BulkConfirmDialogComponent extends BaseBulkConfirmComponent {
  private readonly dialogParams = inject<BulkConfirmDialogParams>(DIALOG_DATA);
  private readonly organizationUserApiService = inject(OrganizationUserApiService);
  private readonly accountService = inject(AccountService);
  private readonly organizationUserService = inject(OrganizationUserService);

  protected readonly organization: Organization = this.dialogParams.organization;
  protected readonly organizationKey$: Observable<OrgKey>;

  constructor() {
    super();
    this.users.set(this.dialogParams.users);

    this.organizationKey$ = this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => this.keyService.orgKeys$(userId)),
      map((orgKeys) => {
        const orgId = this.dialogParams.organization.id;
        const orgKey = orgKeys?.[orgId] ?? undefined;
        if (orgKey == null) {
          throw new Error(`Organization key not found for org ${orgId}`);
        }

        return orgKey;
      }),
    );
  }

  protected readonly getCryptoKey = async (): Promise<SymmetricCryptoKey> =>
    await firstValueFrom(this.organizationKey$);

  protected readonly getPublicKeys = async (): Promise<
    ListResponse<OrganizationUserBulkPublicKeyResponse | ProviderUserBulkPublicKeyResponse>
  > => {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    return await this.organizationUserApiService.postOrganizationUsersPublicKey(
      this.organization.id,
      this.filteredUsers().map((user) => user.id),
      userId,
    );
  };

  protected readonly isAccepted = (user: BulkUserDetails) =>
    user.status === OrganizationUserStatusType.Accepted;

  protected readonly postConfirmRequest = async (
    userIdsWithKeys: { id: string; key: string }[],
  ): Promise<ListResponse<OrganizationUserBulkResponse | ProviderUserBulkResponse>> => {
    return await firstValueFrom(
      this.organizationUserService.bulkConfirmUsers(this.organization, userIdsWithKeys),
    );
  };

  static open(dialogService: DialogService, config: DialogConfig<BulkConfirmDialogParams>) {
    return dialogService.open(BulkConfirmDialogComponent, config);
  }
}
