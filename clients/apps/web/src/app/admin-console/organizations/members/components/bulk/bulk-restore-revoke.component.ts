import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { firstValueFrom, map, switchMap } from "rxjs";

import {
  OrganizationUserApiService,
  OrganizationUserBulkResponse,
  OrganizationUserService,
} from "@vowkey/admin-console/common";
import { UserNamePipe } from "@vowkey/angular/pipes/user-name.pipe";
import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationUserStatusType } from "@vowkey/common/admin-console/enums";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { ListResponse } from "@vowkey/common/models/response/list.response";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { getById } from "@vowkey/common/platform/misc";
import {
  AsyncActionsModule,
  AvatarModule,
  ButtonModule,
  CalloutModule,
  DIALOG_DATA,
  DialogModule,
  DialogService,
  TableModule,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { AvatarIdPipe } from "../../pipes/avatar-id.pipe";

import { BulkUserDetails } from "./bulk-status.component";

type BulkRestoreDialogParams = {
  organizationId: string;
  users: BulkUserDetails[];
  isRevoking: boolean;
};

@Component({
  selector: "member-bulk-restore-revoke",
  templateUrl: "bulk-restore-revoke.component.html",
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
    TableModule,
    UserNamePipe,
  ],
})
export class BulkRestoreRevokeComponent {
  private readonly data = inject<BulkRestoreDialogParams>(DIALOG_DATA);
  private readonly i18nService = inject(I18nService);
  private readonly organizationUserApiService = inject(OrganizationUserApiService);
  private readonly organizationUserService = inject(OrganizationUserService);
  private readonly accountService = inject(AccountService);
  private readonly organizationService = inject(OrganizationService);

  protected readonly isRevoking = this.data.isRevoking;
  protected readonly organizationId = this.data.organizationId;
  protected readonly users = signal(this.data.users);

  protected readonly statuses = signal(new Map<string, string>());
  protected readonly loading = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly showNoMasterPasswordWarning = signal(false);
  protected readonly nonCompliantMembers = signal(false);

  protected readonly bulkTitle = this.i18nService.t(
    this.isRevoking ? "revokeMembers" : "restoreMembers",
  );

  private readonly organization$ = this.accountService.activeAccount$.pipe(
    getUserId,
    switchMap((userId) => this.organizationService.organizations$(userId)),
    getById(this.organizationId),
    map((organization) => {
      if (organization == null) {
        throw new Error("Organization not found");
      }
      return organization;
    }),
  );

  constructor() {
    this.showNoMasterPasswordWarning.set(
      this.users().some(
        (u) => u.status > OrganizationUserStatusType.Invited && u.hasMasterPassword === false,
      ),
    );
  }

  readonly submit = async () => {
    this.loading.set(true);
    this.nonCompliantMembers.set(false);
    try {
      const response = await this.performBulkUserAction();
      const bulkMessage = this.isRevoking ? "bulkRevokedMessage" : "bulkRestoredMessage";
      const newStatuses = new Map<string, string>();

      for (const entry of response.data) {
        const status = entry.error !== "" ? entry.error : this.i18nService.t(bulkMessage);
        newStatuses.set(entry.id, status);
        if (entry.error !== "" && !this.isRevoking) {
          this.nonCompliantMembers.set(true);
        }
      }
      this.statuses.set(newStatuses);
      this.done.set(true);
    } catch (e) {
      this.error.set((e as any)?.message ?? String(e));
    } finally {
      this.loading.set(false);
    }
  };

  protected async performBulkUserAction(): Promise<ListResponse<OrganizationUserBulkResponse>> {
    const userIds = this.users().map((user) => user.id);
    if (this.isRevoking) {
      return await this.organizationUserApiService.revokeManyOrganizationUsers(
        this.organizationId,
        userIds,
      );
    } else {
      return await firstValueFrom(
        this.organization$.pipe(
          switchMap((organization) =>
            this.organizationUserService.bulkRestoreUsers(organization, userIds),
          ),
        ),
      );
    }
  }

  static open(dialogService: DialogService, data: BulkRestoreDialogParams) {
    return dialogService.open(BulkRestoreRevokeComponent, { data });
  }
}
