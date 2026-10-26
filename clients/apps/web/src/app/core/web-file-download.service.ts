import { Injectable } from "@angular/core";

import { FileDownloadBuilder } from "@vowkey/common/platform/abstractions/file-download/file-download.builder";
import { FileDownloadRequest } from "@vowkey/common/platform/abstractions/file-download/file-download.request";
import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";

@Injectable()
export class WebFileDownloadService implements FileDownloadService {
  constructor(private platformUtilsService: PlatformUtilsService) {}

  download(request: FileDownloadRequest): void {
    const builder = new FileDownloadBuilder(request);
    const a = window.document.createElement("a");
    if (!this.platformUtilsService.supportsFileDownloads()) {
      a.rel = "noreferrer";
      a.target = "_blank";
    }
    a.href = URL.createObjectURL(builder.blob);
    a.download = request.fileName;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  }
}
