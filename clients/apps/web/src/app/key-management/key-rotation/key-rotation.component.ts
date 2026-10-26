import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { ButtonModule, DialogService } from "@vowkey/components";
import { KeyRotationDialogComponent } from "@vowkey/key-management-ui";
import { I18nPipe } from "@vowkey/ui-common";

@Component({
  selector: "app-user-key-rotation",
  templateUrl: "key-rotation.component.html",
  imports: [I18nPipe, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyRotationComponent {
  private readonly dialogService = inject(DialogService);

  protected openKeyRotationDialog() {
    KeyRotationDialogComponent.open(this.dialogService);
  }
}
