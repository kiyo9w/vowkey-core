import { A11yModule } from "@angular/cdk/a11y";
import { NgModule } from "@angular/core";
import { RouterModule } from "@angular/router";

import { NavigationModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { SharedModule } from "../../shared";

import { NavigationProductSwitcherComponent } from "./navigation-switcher/navigation-switcher.component";
import { ProductSwitcherContentComponent } from "./product-switcher-content.component";
import { ProductSwitcherComponent } from "./product-switcher.component";

@NgModule({
  imports: [
    SharedModule,
    A11yModule,
    RouterModule,
    NavigationModule,
    I18nPipe,
    NavigationProductSwitcherComponent,
  ],
  declarations: [ProductSwitcherComponent, ProductSwitcherContentComponent],
  exports: [ProductSwitcherComponent, NavigationProductSwitcherComponent],
})
export class ProductSwitcherModule {}
