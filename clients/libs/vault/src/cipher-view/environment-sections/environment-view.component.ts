import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { formatEnvironmentReference } from "@vowkey/common/vault/reference";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { EnvironmentView } from "@vowkey/common/vault/models/view/environment.view";
import {
  FormFieldModule,
  IconButtonModule,
  SectionHeaderComponent,
  ToastService,
  TypographyModule,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { ReadOnlyCipherCardComponent } from "../read-only-cipher-card/read-only-cipher-card.component";

@Component({
  selector: "app-environment-view",
  templateUrl: "environment-view.component.html",
  imports: [
    I18nPipe,
    SectionHeaderComponent,
    ReadOnlyCipherCardComponent,
    TypographyModule,
    FormFieldModule,
    IconButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnvironmentViewComponent {
  private readonly i18nService = inject(I18nService);
  private readonly platformUtilsService = inject(PlatformUtilsService);
  private readonly toastService = inject(ToastService);

  readonly environment = input.required<EnvironmentView>();
  readonly cipher = input.required<CipherView>();

  readonly members = computed(() =>
    (this.environment().members ?? []).map((member) => ({
      name: member.name,
      itemId: member.itemId,
      reference: formatEnvironmentReference(member.name, member.itemId),
    })),
  );

  copyReference(reference: string) {
    this.platformUtilsService.copyToClipboard(reference);
    this.toastService.showToast({
      variant: "success",
      title: "",
      message: this.i18nService.t("valueCopied", this.i18nService.t("reference")),
    });
  }
}
