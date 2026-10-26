// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// FIXME(https://bitwarden.atlassian.net/browse/CL-1062): `OnPush` components should not use mutable properties
/* eslint-disable @vowkey/components/enforce-readonly-angular-properties */
import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { SendAccessToken } from "@vowkey/common/auth/send-access";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { SendAccessView } from "@vowkey/common/tools/send/models/view/send-access.view";
import { SendApiService } from "@vowkey/common/tools/send/services/send-api.service.abstraction";
import { unsafeUrlReason } from "@vowkey/common/tools/url-safety";
import { ToastService } from "@vowkey/components";
// eslint-disable-next-line no-restricted-imports
import { EncArrayBuffer, EncryptService, SymmetricCryptoKey } from "@vowkey/legacy-crypto";

import { SharedModule } from "../../../shared";

@Component({
  selector: "app-send-access-file",
  templateUrl: "send-access-file.component.html",
  imports: [SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendAccessFileComponent {
  readonly send = input<SendAccessView | null>(null);
  readonly decKey = input<SymmetricCryptoKey | null>(null);
  readonly accessToken = input<SendAccessToken | null>(null);

  constructor(
    private i18nService: I18nService,
    private toastService: ToastService,
    private encryptService: EncryptService,
    private fileDownloadService: FileDownloadService,
    private sendApiService: SendApiService,
    private environmentService: EnvironmentService,
  ) {}

  protected download = async () => {
    const accessToken = this.accessToken();
    if (this.send() == null || this.decKey() == null || !accessToken) {
      return;
    }

    const downloadData = await this.sendApiService.getSendFileDownloadData(
      this.send(),
      accessToken,
    );

    if (Utils.isNullOrWhitespace(downloadData.url)) {
      this.toastService.showToast({
        variant: "error",
        title: null,
        message: this.i18nService.t("missingSendFile"),
      });
      return;
    }

    const environment = await firstValueFrom(this.environmentService.environment$);
    if (unsafeUrlReason(downloadData.url, environment.getApiUrl())) {
      this.toastService.showToast({
        variant: "error",
        title: null,
        message: this.i18nService.t("sendDownloadBlocked"),
      });
      return;
    }

    // don't follow a redirect blindly — a validated host could still redirect elsewhere
    const response = await fetch(
      new Request(downloadData.url, { cache: "no-store", redirect: "manual" }),
    );
    if (response.status !== 200) {
      this.toastService.showToast({
        variant: "error",
        title: null,
        message: this.i18nService.t("errorOccurred"),
      });
      return;
    }

    try {
      const encBuf = await EncArrayBuffer.fromResponse(response);
      const decBuf = await this.encryptService.decryptFileData(encBuf, this.decKey());
      this.fileDownloadService.download({
        fileName: this.send().file.fileName,
        blobData: decBuf as BlobPart,
        downloadMethod: "save",
      });
      // FIXME: Remove when updating file. Eslint update
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      this.toastService.showToast({
        variant: "error",
        title: null,
        message: this.i18nService.t("errorOccurred"),
      });
    }
  };
}
