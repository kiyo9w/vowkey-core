import { ChangeDetectionStrategy, Component, OnInit } from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { PrivacySettingsService } from "@vowkey/common/platform/services/privacy-settings.service";

import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";

type DataCollectionPermission = {
  permissions?: { request?: (permissions: { data_collection: string[] }) => Promise<boolean> };
};

@Component({
  selector: "app-privacy-settings",
  templateUrl: "privacy.component.html",
  imports: [JslibModule, ReactiveFormsModule, PopupPageComponent, PopupHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacySettingsComponent implements OnInit {
  readonly form = this.formBuilder.group({ shareUsageCounts: false, sendCrashReports: false });

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly privacySettings: PrivacySettingsService,
  ) {}

  async ngOnInit(): Promise<void> {
    this.form.setValue({
      shareUsageCounts: await firstValueFrom(this.privacySettings.shareUsageCounts$),
      sendCrashReports: await firstValueFrom(this.privacySettings.sendCrashReports$),
    });
  }

  async onToggle(which: "shareUsageCounts" | "sendCrashReports", enabled: boolean): Promise<void> {
    if (enabled && !(await this.allowDataCollection())) {
      this.form.controls[which].setValue(false, { emitEvent: false });
      await this.privacySettings.setShareUsageCounts(false);
      await this.privacySettings.setSendCrashReports(false);
      return;
    }
    if (which === "shareUsageCounts") {
      await this.privacySettings.setShareUsageCounts(enabled);
      return;
    }
    await this.privacySettings.setSendCrashReports(enabled);
  }

  /** Firefox asks for the optional data permission here, and only because a switch was turned on. */
  private async allowDataCollection(): Promise<boolean> {
    const browser = (globalThis as { browser?: DataCollectionPermission }).browser;
    const request = browser?.permissions?.request;
    if (!request) {
      return true;
    }
    return request({ data_collection: ["technicalAndInteraction"] });
  }
}
