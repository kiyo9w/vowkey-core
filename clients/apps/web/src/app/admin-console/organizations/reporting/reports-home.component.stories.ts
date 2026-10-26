import { ChangeDetectionStrategy, Component, importProvidersFrom } from "@angular/core";
import { ActivatedRoute, NavigationEnd, Router } from "@angular/router";
import { applicationConfig, Meta, moduleMetadata, StoryObj } from "@storybook/angular";
import { of } from "rxjs";

import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ProductTierType } from "@vowkey/common/billing/enums";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { OrganizationId } from "@vowkey/common/types/guid";
import { featureFlagModes } from "@vowkey/storybook";
import { Vfo1I18nPipe } from "@vowkey/vault";

import { PreloadedEnglishI18nModule } from "../../../core/tests";
import { ReportsSharedModule } from "../../../dirt/reports";
import { SharedModule } from "../../../shared/shared.module";

import { ReportsHomeComponent } from "./reports-home.component";

const mockOrganizationId = "org-123" as OrganizationId;

@Component({
  selector: "app-header",
  standalone: true,
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class StubHeaderComponent {}

export default {
  title: "Admin Console/Organizations/Reports/Reports Home",
  component: ReportsHomeComponent,
  decorators: [
    moduleMetadata({
      imports: [
        SharedModule,
        ReportsSharedModule,
        StubHeaderComponent,
        Vfo1I18nPipe,
        ReportsHomeComponent,
      ],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            params: of({ organizationId: mockOrganizationId }),
            data: of({ titleId: "reports" }),
          },
        },
      ],
    }),
    applicationConfig({
      providers: [
        importProvidersFrom(PreloadedEnglishI18nModule),
        {
          provide: AccountService,
          useValue: {
            activeAccount$: of({ id: "user-1", email: "user@example.com", name: "Test User" }),
          },
        },
        {
          provide: OrganizationService,
          useValue: {
            organizations$: () =>
              of([
                {
                  id: mockOrganizationId,
                  name: "Acme Corp",
                  enabled: true,
                  productTierType: ProductTierType.Enterprise,
                },
              ]),
          },
        },
        {
          provide: Router,
          useValue: {
            url: "/organizations/org-123/reports",
            events: of(
              new NavigationEnd(
                1,
                "/organizations/org-123/reports",
                "/organizations/org-123/reports",
              ),
            ),
          },
        },
      ],
    }),
  ],
} satisfies Meta<ReportsHomeComponent>;

type Story = StoryObj<ReportsHomeComponent>;

const render: Story["render"] = () => ({
  template: "<app-org-reports-home></app-org-reports-home>",
});

export const Default: Story = {
  render,
  parameters: {
    chromatic: { modes: featureFlagModes(FeatureFlag.VFO1Foundation) },
  },
};

export const FlagOn: Story = {
  render,
  globals: featureFlagModes(FeatureFlag.VFO1Foundation)["flag on"],
};

export const FlagOff: Story = {
  render,
  globals: featureFlagModes(FeatureFlag.VFO1Foundation)["flag off"],
};
