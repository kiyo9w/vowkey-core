import { AbstractControl, AsyncValidatorFn, FormControl, ValidationErrors } from "@angular/forms";
import { combineLatest, map, Observable, of } from "rxjs";

import { Collection } from "@vowkey/common/admin-console/models/collections";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { getById } from "@vowkey/common/platform/misc";

export function freeOrgCollectionLimitValidator(
  organizations$: Observable<Organization[]>,
  collections$: Observable<Collection[]>,
  i18nService: I18nService,
  vfo1Enabled = false,
): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    if (!(control instanceof FormControl)) {
      return of(null);
    }

    const orgId = control.value;

    if (!orgId) {
      return of(null);
    }

    return combineLatest([organizations$.pipe(getById(orgId)), collections$]).pipe(
      map(([organization, collections]) => {
        if (!organization) {
          return null;
        }

        const orgCollections = collections.filter(
          (collection: Collection) => collection.organizationId === organization.id,
        );
        const hasReachedLimit = organization.maxCollections === orgCollections.length;

        if (hasReachedLimit) {
          return {
            cannotCreateCollections: {
              message: i18nService.t(
                vfo1Enabled ? "cannotCreateSharedFolder" : "cannotCreateCollection",
              ),
            },
          };
        }

        return null;
      }),
    );
  };
}
