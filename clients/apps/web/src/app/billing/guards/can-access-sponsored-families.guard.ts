import { inject } from "@angular/core";
import { ActivatedRouteSnapshot, CanActivateFn } from "@angular/router";
import { firstValueFrom, switchMap, filter } from "rxjs";

import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { getById } from "@vowkey/common/platform/misc";

import { FreeFamiliesPolicyService } from "../services/free-families-policy.service";

export const canAccessSponsoredFamilies: CanActivateFn = async (route: ActivatedRouteSnapshot) => {
  const freeFamiliesPolicyService = inject(FreeFamiliesPolicyService);
  const organizationService = inject(OrganizationService);
  const accountService = inject(AccountService);

  const org = accountService.activeAccount$.pipe(
    getUserId,
    switchMap((userId) => organizationService.organizations$(userId)),
    getById(route.params.organizationId),
    filter((org): org is Organization => org !== undefined),
  );

  return await firstValueFrom(freeFamiliesPolicyService.showSponsoredFamiliesDropdown$(org));
};
