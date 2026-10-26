import { ComponentFixture, TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { Account, AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { SendApiService } from "@vowkey/common/tools/send/services/send-api.service.abstraction";
import { SendService } from "@vowkey/common/tools/send/services/send.service.abstraction";
import { SendType } from "@vowkey/common/tools/send/types/send-type";
import { PremiumUpgradePromptService } from "@vowkey/common/vault/abstractions/premium-upgrade-prompt.service";
import { DialogService } from "@vowkey/components";
import { LogService } from "@vowkey/logging";
import { SendAddEditDialogComponent, SendFormService, SendPolicyService } from "@vowkey/send-ui";

import { NewSendDropdownComponent } from "./new-send-dropdown.component";

describe("NewSendDropdownComponent", () => {
  let component: NewSendDropdownComponent;
  let fixture: ComponentFixture<NewSendDropdownComponent>;
  const mockBillingAccountProfileStateService = mock<BillingAccountProfileStateService>();
  const mockAccountService = mock<AccountService>();
  const mockConfigService = mock<ConfigService>();
  const mockI18nService = mock<I18nService>();
  const mockSendService = mock<SendService>();
  const mockPremiumUpgradePromptService = mock<PremiumUpgradePromptService>();
  const mockSendApiService = mock<SendApiService>();
  const mockPolicyService = mock<PolicyService>();

  beforeAll(() => {
    mockBillingAccountProfileStateService.hasPremiumFromAnySource$.mockImplementation(() =>
      of(true),
    );
    mockAccountService.activeAccount$ = of({ id: "myTestAccount" } as Account);
    mockConfigService.getFeatureFlag$.mockReturnValue(of(false));
    mockPremiumUpgradePromptService.promptForPremium.mockImplementation(async () => {});
    mockPolicyService.policyAppliesToUser$.mockReturnValue(of(false));
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewSendDropdownComponent],
      declarations: [],
      providers: [
        {
          provide: BillingAccountProfileStateService,
          useValue: mockBillingAccountProfileStateService,
        },
        { provide: AccountService, useValue: mockAccountService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: I18nService, useValue: mockI18nService },
        { provide: SendService, useValue: mockSendService },
        { provide: PremiumUpgradePromptService, useValue: mockPremiumUpgradePromptService },
        { provide: SendApiService, useValue: mockSendApiService },
        { provide: LogService, useValue: mock<LogService>() },
        { provide: SendFormService, useValue: mock<SendFormService>() },
        { provide: PolicyService, useValue: mockPolicyService },
        { provide: OrganizationService, useValue: mock<OrganizationService>() },
        { provide: DialogService, useValue: mock<DialogService>() },
        {
          provide: SendPolicyService,
          useValue: {
            disableSend$: of(false),
            allowedSendTypes$: of([SendType.Text, SendType.File]),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NewSendDropdownComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });

  it("should open send dialog in drawer", async () => {
    const openSpy = jest.spyOn(SendAddEditDialogComponent, "open");
    const openDrawerSpy = jest.spyOn(SendAddEditDialogComponent, "openDrawer");
    const mockRef = { closed: of({}) };
    openDrawerSpy.mockReturnValue(mockRef as any);

    await component.createSend(SendType.Text);

    expect(openSpy).not.toHaveBeenCalled();
    expect(openDrawerSpy).toHaveBeenCalled();
  });
});
