import { NgModule } from "@angular/core";

import { SearchModule } from "@vowkey/components";

import { SharedModule } from "../../../shared/shared.module";

import { AccessSelectorModule } from "./components/access-selector/access-selector.module";

@NgModule({
  imports: [SharedModule, AccessSelectorModule, SearchModule],
  declarations: [],
  exports: [SharedModule, AccessSelectorModule, SearchModule],
})
export class SharedOrganizationModule {}
