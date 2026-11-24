import { Routes } from "@angular/router";

import { canAccessMembersTab } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { safeProvider } from "@vowkey/ui-common";

import { organizationPermissionsGuard } from "../guards/org-permissions.guard";

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
];
