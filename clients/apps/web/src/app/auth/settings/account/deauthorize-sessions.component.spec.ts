import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import mock, { MockProxy } from "jest-mock-extended/lib/Mock";

import { LogoutService } from "@vowkey/auth/common";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { UserVerificationService } from "@vowkey/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { FakeAccountService, mockAccountServiceWith } from "@vowkey/common/spec";
import { UserId } from "@vowkey/common/types/guid";
import { ToastService } from "@vowkey/components";
import { DeauthorizeSessionsComponent } from "@vowkey/web-vault/app/auth/settings/account/deauthorize-sessions.component";
import { SharedModule } from "@vowkey/web-vault/app/shared";

describe("DeauthorizeSessionsComponent", () => {
  const userId = "UserId" as UserId;

  let component: DeauthorizeSessionsComponent;
  let fixture: ComponentFixture<DeauthorizeSessionsComponent>;

  let apiService: MockProxy<ApiService>;
  let userVerificationService: MockProxy<UserVerificationService>;
  let logoutService: MockProxy<LogoutService>;
  let accountService: FakeAccountService;
  let logService: MockProxy<LogService>;
  let toastService: MockProxy<ToastService>;

  beforeEach(async () => {
    apiService = mock<ApiService>();
    userVerificationService = mock<UserVerificationService>();
    logoutService = mock<LogoutService>();
    accountService = mockAccountServiceWith(userId);
    logService = mock<LogService>();
    toastService = mock<ToastService>();

    await TestBed.configureTestingModule({
      imports: [ReactiveFormsModule, SharedModule, DeauthorizeSessionsComponent],
      providers: [
        { provide: ApiService, useValue: apiService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
        { provide: FormBuilder, useClass: FormBuilder },
        { provide: UserVerificationService, useValue: userVerificationService },
        { provide: LogoutService, useValue: logoutService },
        { provide: AccountService, useValue: accountService },
        { provide: LogService, useValue: logService },
        { provide: ToastService, useValue: toastService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeauthorizeSessionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe("submit", () => {
    beforeEach(() => {
      userVerificationService.buildRequest.mockResolvedValue({} as any);
      apiService.postSecurityStamp.mockResolvedValue(undefined);
      logoutService.logout.mockResolvedValue(undefined);
    });

    it("posts the security stamp with the built verification request", async () => {
      await component.submit();

      expect(userVerificationService.buildRequest).toHaveBeenCalled();
      expect(apiService.postSecurityStamp).toHaveBeenCalled();
    });

    it("logs out the active user with the deauthorizedSessions reason", async () => {
      await component.submit();

      expect(logoutService.logout).toHaveBeenCalledWith(userId, "deauthorizedSessions");
    });

    it("swallows errors and logs them without invoking logout", async () => {
      const error = new Error("boom");
      apiService.postSecurityStamp.mockRejectedValue(error);

      await component.submit();

      expect(logService.error).toHaveBeenCalledWith(error);
      expect(logoutService.logout).not.toHaveBeenCalled();
    });
  });
});
