import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { ButtonModule, LinkModule, TypographyModule } from "@vowkey/components";
import { buildFlightRecorderCsvExport } from "@vowkey/logging";
import { FlightRecorderService } from "@vowkey/logging-angular";
import { I18nPipe } from "@vowkey/ui-common";

@Component({
  selector: "app-download-event-logs",
  templateUrl: "download-event-logs.component.html",
  imports: [ButtonModule, LinkModule, TypographyModule, I18nPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DownloadEventLogsComponent {
  private readonly flightRecorder = inject(FlightRecorderService);
  private readonly fileDownloadService = inject(FileDownloadService);

  protected readonly download = async () => {
    const events = await this.flightRecorder.read();
    this.fileDownloadService.download(buildFlightRecorderCsvExport(events));
  };
}
