import { Pipe, PipeTransform } from "@angular/core";

import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { OrganizationId } from "@vowkey/sdk-internal";

@Pipe({
  name: "orgNameFromId",
  pure: true,
})
export class GetOrgNameFromIdPipe implements PipeTransform {
  transform(value: string | OrganizationId, organizations: Organization[]) {
    const orgName = organizations?.find((o) => o.id === value)?.name;
    return orgName;
  }
}
