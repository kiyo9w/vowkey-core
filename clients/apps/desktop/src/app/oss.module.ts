import { OverlayModule, OVERLAY_DEFAULT_CONFIG } from "@angular/cdk/overlay";
import { NgModule } from "@angular/core";
import { ReactiveFormsModule } from "@angular/forms";
import { BrowserAnimationsModule } from "@angular/platform-browser/animations";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { PremiumUpgradePromptService } from "@vowkey/common/vault/abstractions/premium-upgrade-prompt.service";
import { IconModule, SpinnerComponent } from "@vowkey/components";

import { SshAgentService } from "../autofill/services/ssh-agent.service";
import { DesktopPremiumUpgradePromptService } from "../billing/services/desktop-premium-upgrade-prompt.service";

import { AvatarComponent } from "./components/avatar.component";
import { QuickBarComponent } from "./components/quick-bar.component";
import { ServicesModule } from "./services/services.module";

@NgModule({
  imports: [
    BrowserAnimationsModule,
    JslibModule,
    IconModule,
    SpinnerComponent,
    ReactiveFormsModule,
    OverlayModule,
    ServicesModule,
    QuickBarComponent,
  ],
  declarations: [AvatarComponent],
  exports: [
    BrowserAnimationsModule,
    JslibModule,
    IconModule,
    SpinnerComponent,
    ReactiveFormsModule,
    OverlayModule,
    AvatarComponent,
    QuickBarComponent,
  ],
  providers: [
    SshAgentService,
    {
      provide: PremiumUpgradePromptService,
      useClass: DesktopPremiumUpgradePromptService,
    },
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
  ],
})
export class OssModule {}
