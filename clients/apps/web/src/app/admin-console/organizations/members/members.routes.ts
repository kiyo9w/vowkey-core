import { Routes } from "@angular/router";

import { canAccessMembersTab } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { safeProvider } from "@vowkey/ui-common";

import { FreeVowkeyFamiliesComponent } from "../../../billing/members/free-vowkey-families.component";
import { organizationPermissionsGuard } from "../guards/org-permissions.guard";

import { canAccessSponsoredFamilies } from "./../../../billing/guards/can-access-sponsored-families.guard";
import { MembersComponent } from "./members.component";
import { UserStatusPipe } from "./pipes";
import { MemberExportService } from "./services";

export const membersRoutes: Routes = [
  {
    path: "",
    component: MembersComponent,
    canActivate: [organizationPermissionsGuard(canAccessMembersTab)],
    providers: [
      safeProvider({ provide: MemberExportService, useAngularDecorators: true }),
      safeProvider({ provide: UserStatusPipe, useAngularDecorators: true }),
    ],
    data: {
      titleId: "members",
    },
  },
  {
    path: "sponsored-families",
    component: FreeVowkeyFamiliesComponent,
    canActivate: [organizationPermissionsGuard(canAccessMembersTab), canAccessSponsoredFamilies],
    data: {
      titleId: "sponsoredFamilies",
    },
  },
];
