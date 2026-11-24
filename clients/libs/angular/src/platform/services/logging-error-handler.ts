// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { ErrorHandler, Injectable, Injector, inject } from "@angular/core";

import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { captureCrash } from "@vowkey/common/platform/services/crash-reports";

@Injectable()
export class LoggingErrorHandler extends ErrorHandler {
  /**
   * When injecting services into an `ErrorHandler`, we must use the `Injector` manually to avoid circular dependency errors.
   *
   * https://stackoverflow.com/a/57115053
   */
  private injector = inject(Injector);

  override handleError(error: any): void {
    captureCrash(error);
    try {
      const logService = this.injector.get(LogService, null);
      logService.error("Unhandled error in angular", error);
    } catch {
      super.handleError(error);
    }
  }
}
