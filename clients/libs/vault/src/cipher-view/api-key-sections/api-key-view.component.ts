import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";

import { EventCollectionService, EventType } from "@vowkey/common/dirt/event-logs";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { ApiKeySendStyle, ApiKeyView } from "@vowkey/common/vault/models/view/api-key.view";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  FormFieldModule,
  IconButtonModule,
  SectionHeaderComponent,
  TypographyModule,
} from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { CopyCipherFieldDirective } from "../../components/copy-cipher-field.directive";
import { ReadOnlyCipherCardComponent } from "../read-only-cipher-card/read-only-cipher-card.component";

@Component({
  selector: "app-api-key-view",
  templateUrl: "api-key-view.component.html",
  imports: [
    I18nPipe,
    CopyCipherFieldDirective,
    SectionHeaderComponent,
    ReadOnlyCipherCardComponent,
    TypographyModule,
    FormFieldModule,
    IconButtonModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiKeyViewComponent {
  private readonly i18nService = inject(I18nService);
  private readonly eventCollectionService = inject(EventCollectionService);

  readonly apiKey = input.required<ApiKeyView>();
  readonly cipher = input.required<CipherView>();

  readonly revealValue = signal(false);

  readonly sendStyleLabel = computed(() => {
    switch (this.apiKey().sendStyle) {
      case ApiKeySendStyle.Header:
        return this.i18nService.t("sendStyleHeader");
      case ApiKeySendStyle.Basic:
        return this.i18nService.t("sendStyleBasic");
      default:
        return this.i18nService.t("sendStyleBearer");
    }
  });

  readonly hosts = computed(() => this.apiKey().allowedHosts?.join(", ") ?? "");

  async toggleValueVisible(visible: boolean) {
    this.revealValue.set(visible);
    if (visible) {
      await this.eventCollectionService.collect(
        EventType.Cipher_ClientToggledPasswordVisible,
        this.cipher().id,
        false,
        this.cipher().organizationId,
      );
    }
  }
}
