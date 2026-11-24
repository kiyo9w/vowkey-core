import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";

import { BusinessPlanComponent } from "../business-plan.component";

const routes: Routes = [
  {
    path: "",
    component: BusinessPlanComponent,
    data: { titleId: "subscription" },
  },
  { path: "user-subscription", redirectTo: "", pathMatch: "full" },
  { path: "premium", redirectTo: "", pathMatch: "full" },
  { path: "payment-details", redirectTo: "", pathMatch: "full" },
  { path: "billing-history", redirectTo: "", pathMatch: "full" },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class IndividualBillingRoutingModule {}
