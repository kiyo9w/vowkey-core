import { ChangeDetectionStrategy, Component, inject } from "@angular/core";

import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import {
  ButtonModule,
  CenterPositionStrategy,
  DialogModule,
  DialogRef,
  DialogService,
  IconModule,
  LinkModule,
} from "@vowkey/components";
import { buildFlightRecorderCsvExport } from "@vowkey/logging";
import { I18nPipe } from "@vowkey/ui-common";

import { FlightRecorderService } from "../flight-recorder.service";

@Component({
  templateUrl: "troubleshooting-dialog.component.html",
  imports: [DialogModule, ButtonModule, IconModule, LinkModule, I18nPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TroubleshootingDialogComponent {
  private readonly dialogRef = inject(DialogRef);
  private readonly flightRecorder = inject(FlightRecorderService);
  private readonly fileDownloadService = inject(FileDownloadService);

  protected readonly download = async () => {
    const events = await this.flightRecorder.read();
    this.fileDownloadService.download(buildFlightRecorderCsvExport(events));
    await this.dialogRef.close();
  };

  static open(dialogService: DialogService) {
    return dialogService.open(TroubleshootingDialogComponent, {
      positionStrategy: new CenterPositionStrategy(),
    });
  }
}
