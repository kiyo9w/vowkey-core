import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { RouterModule } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { NudgesService, NudgeType } from "@vowkey/angular/vault";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { CardComponent, LinkModule, TypographyModule } from "@vowkey/components";

import { PopOutComponent } from "../../../platform/popup/components/pop-out.component";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "download-vowkey.component.html",
  imports: [
    CommonModule,
    JslibModule,
    RouterModule,
    PopupPageComponent,
    PopupHeaderComponent,
    PopOutComponent,
    CardComponent,
    TypographyModule,
    LinkModule,
  ],
})
export class DownloadVowkeyComponent implements OnInit {
  constructor(
    private nudgesService: NudgesService,
    private accountService: AccountService,
  ) {}

  async ngOnInit() {
    const userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
    await this.nudgesService.dismissNudge(NudgeType.DownloadVowkey, userId);
  }
}
