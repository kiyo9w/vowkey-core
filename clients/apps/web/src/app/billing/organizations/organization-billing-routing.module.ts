import { NgModule } from "@angular/core";
import { RouterModule, Routes } from "@angular/router";

import { canAccessBillingTab } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";

import { organizationPermissionsGuard } from "../../admin-console/organizations/guards/org-permissions.guard";
import { BusinessPlanComponent } from "../business-plan.component";

const routes: Routes = [
  {
    path: "",
    canActivate: [organizationPermissionsGuard(canAccessBillingTab)],
    children: [
      {
        path: "",
        pathMatch: "full",
        component: BusinessPlanComponent,
        data: { titleId: "subscription" },
      },
      { path: "subscription", redirectTo: "", pathMatch: "full" },
      { path: "payment-details", redirectTo: "", pathMatch: "full" },
      { path: "history", redirectTo: "", pathMatch: "full" },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class OrganizationBillingRoutingModule {}
