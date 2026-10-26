import { NgModule } from "@angular/core";

import { PremiumBadgeComponent } from "@vowkey/angular/billing/components/premium-badge";
import { PopoverModule, SearchModule } from "@vowkey/components";
import { CoachmarkComponent } from "@vowkey/vault";

import { SharedModule } from "../../../../shared";

import { VaultFilterSectionComponent } from "./components/vault-filter-section.component";

@NgModule({
  imports: [SharedModule, SearchModule, PremiumBadgeComponent, PopoverModule, CoachmarkComponent],
  declarations: [VaultFilterSectionComponent],
  exports: [SharedModule, VaultFilterSectionComponent, SearchModule],
})
export class VaultFilterSharedModule {}
