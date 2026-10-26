import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";

import { OrganizationUserApiService } from "@vowkey/admin-console/common";
import { UserNamePipe } from "@vowkey/angular/pipes/user-name.pipe";
import { UserTypePipe } from "@vowkey/angular/pipes/user-type.pipe";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import {
  AsyncActionsModule,
  AvatarModule,
  ButtonModule,
  DIALOG_DATA,
  DialogModule,
  DialogRef,
  DialogService,
  TableModule,
  ToastService,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { OrganizationUserView } from "../../../core";
import { AvatarIdPipe } from "../../pipes/avatar-id.pipe";

export type BulkEnableSecretsManagerDialogData = {
  orgId: string;
  users: OrganizationUserView[];
};

@Component({
  templateUrl: `bulk-enable-sm-dialog.component.html`,
  selector: "member-bulk-enable-sm-dialog",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AsyncActionsModule,
    AvatarIdPipe,
    AvatarModule,
    ButtonModule,
    DialogModule,
    I18nPipe,
    TableModule,
    UserNamePipe,
    UserTypePipe,
  ],
})
export class BulkEnableSecretsManagerDialogComponent {
  protected readonly dialogRef = inject(DialogRef);
  private readonly data = inject<BulkEnableSecretsManagerDialogData>(DIALOG_DATA);
  private readonly organizationUserApiService = inject(OrganizationUserApiService);
  private readonly i18nService = inject(I18nService);
  private readonly toastService = inject(ToastService);

  protected readonly users = signal<OrganizationUserView[]>([]);

  constructor() {
    this.users.set(this.data.users);
  }

  readonly submit = async () => {
    await this.organizationUserApiService.putOrganizationUserBulkEnableSecretsManager(
      this.data.orgId,
      this.users().map((u) => u.id),
    );
    this.toastService.showToast({
      variant: "success",
      message: this.i18nService.t("activatedAccessToSecretsManager"),
    });
    await this.dialogRef.close();
  };

  static open(dialogService: DialogService, data: BulkEnableSecretsManagerDialogData) {
    return dialogService.open<unknown, BulkEnableSecretsManagerDialogData>(
      BulkEnableSecretsManagerDialogComponent,
      { data },
    );
  }
}
