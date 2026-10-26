import { Injectable } from "@angular/core";

import { ErrorResponse } from "@vowkey/common/models/response/error.response";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { ToastService } from "@vowkey/components";

@Injectable({
  providedIn: "root",
})
export class BillingNotificationService {
  constructor(
    private logService: LogService,
    private toastService: ToastService,
  ) {}

  handleError(error: unknown, title: string = "") {
    this.logService.error(error);
    if (error instanceof ErrorResponse) {
      this.toastService.showToast({
        variant: "error",
        title: title,
        message: error.getSingleMessage(),
      });
    }
    throw error;
  }

  showSuccess(message: string, title: string = "") {
    this.toastService.showToast({
      variant: "success",
      title: title,
      message: message,
    });
  }

  showError(message: string, title: string = "") {
    this.toastService.showToast({
      variant: "error",
      title,
      message,
    });
  }
}
