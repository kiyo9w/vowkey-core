import { Injectable } from "@angular/core";

import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { FlightRecorderLogRecorder } from "@vowkey/logging";
import { FlightRecorderClient } from "@vowkey/sdk-internal";

/**
 * Angular wrapper for {@link FlightRecorderLogRecorder}.
 */
@Injectable({ providedIn: "root" })
export class FlightRecorderLogRecorderService extends FlightRecorderLogRecorder {
  constructor() {
    super(SdkLoadService.Ready.then(() => new FlightRecorderClient()));
  }
}
