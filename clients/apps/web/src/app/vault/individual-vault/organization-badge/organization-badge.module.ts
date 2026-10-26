import { NgModule } from "@angular/core";

import { ChipActionComponent } from "@vowkey/components";
import { OrganizationNameBadgeComponent } from "@vowkey/vault";

import { SharedModule } from "../../../shared/shared.module";

/**
 * @deprecated Use `OrganizationNameBadgeComponent` directly since it is now standalone.
 */
@NgModule({
  imports: [SharedModule, OrganizationNameBadgeComponent, ChipActionComponent],
  exports: [OrganizationNameBadgeComponent],
})
export class OrganizationBadgeModule {}
