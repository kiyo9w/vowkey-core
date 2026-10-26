import { mock, MockProxy } from "jest-mock-extended";
import { firstValueFrom, of } from "rxjs";

import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { GovModeService } from "@vowkey/common/platform/abstractions/gov-mode.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { mockAccountServiceWith } from "@vowkey/common/spec";
import { UserId } from "@vowkey/common/types/guid";
import { DialogService } from "@vowkey/components";

import { FamiliesPolicyService } from "../../../billing/services/families-policy.service";

import { MoreFromVowkeyPageComponent } from "./more-from-vowkey-page.component";

describe("MoreFromVowkeyPageComponent", () => {
  const userId = Utils.newGuid() as UserId;
  let organizationService: MockProxy<OrganizationService>;
  let govModeService: MockProxy<GovModeService>;

  const createComponent = () =>
    new MoreFromVowkeyPageComponent(
      mock<DialogService>(),
      mock<EnvironmentService>(),
      organizationService,
      mock<FamiliesPolicyService>(),
      mockAccountServiceWith(userId),
      govModeService,
    );

  beforeEach(() => {
    organizationService = mock<OrganizationService>();
    organizationService.familySponsorshipAvailable$.mockReturnValue(of(true));
    govModeService = mock<GovModeService>();
  });

  describe("familySponsorshipAvailable$", () => {
    it("emits true when sponsorship is available outside gov mode", async () => {
      govModeService.isGovMode$.mockReturnValue(of(false));

      const result = await firstValueFrom(createComponent()["familySponsorshipAvailable$"]);

      expect(result).toBe(true);
    });

    it("emits false in gov mode", async () => {
      govModeService.isGovMode$.mockReturnValue(of(true));

      const result = await firstValueFrom(createComponent()["familySponsorshipAvailable$"]);

      expect(result).toBe(false);
    });

    it("emits false when sponsorship is unavailable", async () => {
      organizationService.familySponsorshipAvailable$.mockReturnValue(of(false));
      govModeService.isGovMode$.mockReturnValue(of(false));

      const result = await firstValueFrom(createComponent()["familySponsorshipAvailable$"]);

      expect(result).toBe(false);
    });
  });
});
