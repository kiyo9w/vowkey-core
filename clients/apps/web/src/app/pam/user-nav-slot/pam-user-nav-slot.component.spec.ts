import { NO_ERRORS_SCHEMA } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { BehaviorSubject } from "rxjs";

import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { UserId } from "@vowkey/common/types/guid";
import { I18nMockService, NavigationModule } from "@vowkey/components";

import { PamUserNavSlotComponent } from "./pam-user-nav-slot.component";

describe("PamUserNavSlotComponent", () => {
  let fixture: ComponentFixture<PamUserNavSlotComponent>;
  let pamEnabled$: BehaviorSubject<boolean>;
  let organizations$: BehaviorSubject<Organization[]>;
  let getFeatureFlag$: jest.Mock;

  const pamOrg = { usePam: true } as Organization;
  const nonPamOrg = { usePam: false } as Organization;

  beforeEach(async () => {
    pamEnabled$ = new BehaviorSubject<boolean>(true);
    organizations$ = new BehaviorSubject<Organization[]>([pamOrg]);
    getFeatureFlag$ = jest.fn().mockReturnValue(pamEnabled$);

    await TestBed.configureTestingModule({
      imports: [PamUserNavSlotComponent],
      providers: [
        { provide: ConfigService, useValue: { getFeatureFlag$ } },
        {
          provide: AccountService,
          useValue: { activeAccount$: new BehaviorSubject({ id: "user-id" as UserId }) },
        },
        { provide: OrganizationService, useValue: { organizations$: () => organizations$ } },
        {
          provide: I18nService,
          useValue: new I18nMockService({
            pamAccessRequestsTitle: "Access requests",
          }),
        },
      ],
    })
      // Stub the nav components so the test covers this component's gating, not their rendering.
      .overrideComponent(PamUserNavSlotComponent, {
        remove: { imports: [NavigationModule] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PamUserNavSlotComponent);
  });

  const navItem = () => fixture.debugElement.query(By.css("bit-nav-item"));

  it("gates on the PAM feature flag", () => {
    fixture.detectChanges();
    expect(getFeatureFlag$).toHaveBeenCalledWith(FeatureFlag.Pam);
  });

  it("renders the nav item when the flag is on and the user is in a PAM-enabled org", () => {
    fixture.detectChanges();
    expect(navItem()).not.toBeNull();
  });

  it("renders nothing when the flag is off", () => {
    pamEnabled$.next(false);
    fixture.detectChanges();
    expect(navItem()).toBeNull();
  });

  it("renders nothing when no organization has PAM enabled", () => {
    organizations$.next([nonPamOrg]);
    fixture.detectChanges();
    expect(navItem()).toBeNull();
  });

  it("generates no box of its own, so rendering nothing takes up no space", () => {
    organizations$.next([nonPamOrg]);
    fixture.detectChanges();

    expect(navItem()).toBeNull();
    expect(fixture.debugElement.nativeElement.classList).toContain("tw-contents");
  });
});
