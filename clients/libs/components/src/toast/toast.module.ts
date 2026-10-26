import { ModuleWithProviders, NgModule } from "@angular/core";
import { DefaultNoComponentGlobalConfig, GlobalConfig, TOAST_CONFIG } from "ngx-toastr";

import { ToastContainerComponent } from "./toast-container.component";
import { VowkeyToastrComponent } from "./toastr.component";

@NgModule({
  imports: [VowkeyToastrComponent, ToastContainerComponent],
  exports: [VowkeyToastrComponent, ToastContainerComponent],
})
export class ToastModule {
  static forRoot(config: Partial<GlobalConfig> = {}): ModuleWithProviders<ToastModule> {
    return {
      ngModule: ToastModule,
      providers: [
        {
          provide: TOAST_CONFIG,
          useValue: {
            default: VowkeyToastrGlobalConfig,
            config: config,
          },
        },
      ],
    };
  }
}

export const VowkeyToastrGlobalConfig: GlobalConfig = {
  ...DefaultNoComponentGlobalConfig,
  toastComponent: VowkeyToastrComponent,
  tapToDismiss: false,
  timeOut: 5000,
  extendedTimeOut: 2000,
  maxOpened: 5,
  autoDismiss: true,
  progressBar: true,
};
