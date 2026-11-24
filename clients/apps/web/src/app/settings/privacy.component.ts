import { ChangeDetectionStrategy, Component, DestroyRef, OnInit } from "@angular/core";
import { FormBuilder } from "@angular/forms";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { firstValueFrom } from "rxjs";

import { PrivacySettingsService } from "@vowkey/common/platform/services/privacy-settings.service";
import { BreadcrumbsModule } from "@vowkey/components";

import { HeaderModule } from "../layouts/header/header.module";
import { SharedModule } from "../shared";

@Component({
  selector: "app-privacy",
  templateUrl: "privacy.component.html",
  imports: [SharedModule, HeaderModule, BreadcrumbsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyComponent implements OnInit {
  readonly form = this.formBuilder.group({ shareUsageCounts: false, sendCrashReports: false });

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly privacySettings: PrivacySettingsService,
    private readonly destroyRef: DestroyRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.form.setValue({
      shareUsageCounts: await firstValueFrom(this.privacySettings.shareUsageCounts$),
      sendCrashReports: await firstValueFrom(this.privacySettings.sendCrashReports$),
    });
    this.form.controls.shareUsageCounts.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((enabled) => {
      void this.privacySettings.setShareUsageCounts(enabled === true);
    });
    this.form.controls.sendCrashReports.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((enabled) => {
      void this.privacySettings.setSendCrashReports(enabled === true);
    });
  }
}
