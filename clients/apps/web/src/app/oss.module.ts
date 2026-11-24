import { OVERLAY_DEFAULT_CONFIG } from "@angular/cdk/overlay";
import { NgModule } from "@angular/core";

import { AuthModule } from "./auth";
import { HeaderModule } from "./layouts/header/header.module";
import { SharedModule } from "./shared";
import { AccessComponent } from "./tools/send/send-access/access.component";
import { OrganizationBadgeModule } from "./vault/individual-vault/organization-badge/organization-badge.module";
import { VaultFilterModule } from "./vault/individual-vault/vault-filter/vault-filter.module";

// Register the locales for the application
import "./shared/locales";

@NgModule({
  imports: [
    SharedModule,
    HeaderModule,
    VaultFilterModule,
    OrganizationBadgeModule,
    AuthModule,
    AccessComponent,
  ],
  exports: [
    SharedModule,
    HeaderModule,
    VaultFilterModule,
    OrganizationBadgeModule,
    AccessComponent,
  ],
  bootstrap: [],
  providers: [{ provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } }],
})
export class OssModule {}
