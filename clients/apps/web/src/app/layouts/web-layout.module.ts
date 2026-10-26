import { NgModule } from "@angular/core";

import { NavigationModule } from "@vowkey/components";

import { WebLayoutComponent } from "./web-layout.component";
import { WebSideNavComponent } from "./web-side-nav.component";

@NgModule({
  imports: [WebLayoutComponent, WebSideNavComponent],
  exports: [NavigationModule, WebLayoutComponent, WebSideNavComponent],
  declarations: [],
  providers: [],
})
export class WebLayoutModule {}
