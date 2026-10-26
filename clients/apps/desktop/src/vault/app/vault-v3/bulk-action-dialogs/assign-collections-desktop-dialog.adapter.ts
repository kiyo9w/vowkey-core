import { Injectable, inject } from "@angular/core";
import { lastValueFrom } from "rxjs";

import { DialogService } from "@vowkey/components";
import {
  AssignCollectionsDialogRef,
  AssignCollectionsParams,
  AssignCollectionsResult,
  CollectionAssignmentParams,
  CollectionAssignmentResult,
} from "@vowkey/vault";

import { AssignCollectionsDesktopComponent } from "../../vault/assign-collections";

@Injectable()
export class AssignCollectionsDesktopDialogAdapter implements AssignCollectionsDialogRef {
  private readonly dialogService = inject(DialogService);

  async open(params: AssignCollectionsParams): Promise<AssignCollectionsResult> {
    const dialog = AssignCollectionsDesktopComponent.open(this.dialogService, {
      data: params as CollectionAssignmentParams,
    });
    const result = await lastValueFrom(dialog.closed);
    return result === CollectionAssignmentResult.Saved
      ? AssignCollectionsResult.Saved
      : AssignCollectionsResult.Canceled;
  }
}
