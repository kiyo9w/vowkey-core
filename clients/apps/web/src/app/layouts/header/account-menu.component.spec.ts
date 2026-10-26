import { Component, input, ChangeDetectionStrategy } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { RouterTestingModule } from "@angular/router/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { LogoutService } from "@vowkey/auth/common";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import {
  VaultTimeoutAction,
  VaultTimeoutSettingsService,
} from "@vowkey/common/key-management/vault-timeout";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { FakeAccountService, mockAccountServiceWith } from "@vowkey/common/spec";
import { UserId } from "@vowkey/common/types/guid";
import { LockService } from "@vowkey/unlock";
import { DynamicAvatarComponent } from "@vowkey/web-vault/app/components/dynamic-avatar.component";
import { AccountMenuComponent } from "@vowkey/web-vault/app/layouts/header/account-menu.component";
import { SharedModule } from "@vowkey/web-vault/app/shared";

@Component({
  selector: "dynamic-avatar",
  standalone: true,
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class MockDynamicAvatarComponent {
  readonly text = input<string | undefined>();
  readonly size = input<string | undefined>();
}

describe("AccountMenuComponent", () => {
  const userId = "UserId" as UserId;

  let fixture: ComponentFixture<AccountMenuComponent>;
  let component: AccountMenuComponent;

  let logoutService: MockProxy<LogoutService>;
  let lockService: MockProxy<LockService>;
  let accountService: FakeAccountService;
  let vaultTimeoutSettingsService: MockProxy<VaultTimeoutSettingsService>;
  let platformUtilsService: MockProxy<PlatformUtilsService>;

  beforeEach(async () => {
    logoutService = mock<LogoutService>();
    lockService = mock<LockService>();
    accountService = mockAccountServiceWith(userId);
    vaultTimeoutSettingsService = mock<VaultTimeoutSettingsService>();
    vaultTimeoutSettingsService.availableVaultTimeoutActions$.mockReturnValue(
      of([VaultTimeoutAction.Lock]),
    );
    platformUtilsService = mock<PlatformUtilsService>();
    platformUtilsService.isSelfHost.mockReturnValue(false);

    await TestBed.configureTestingModule({
      imports: [SharedModule, RouterTestingModule, AccountMenuComponent],
      providers: [
        { provide: LogoutService, useValue: logoutService },
        { provide: LockService, useValue: lockService },
        { provide: AccountService, useValue: accountService },
        { provide: VaultTimeoutSettingsService, useValue: vaultTimeoutSettingsService },
        { provide: PlatformUtilsService, useValue: platformUtilsService },
        { provide: I18nService, useValue: { t: (key: string) => key } },
      ],
    })
      .overrideComponent(AccountMenuComponent, {
        remove: { imports: [DynamicAvatarComponent] },
        add: { imports: [MockDynamicAvatarComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(AccountMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe("logout", () => {
    it("logs out the active user with the userInitiated reason", async () => {
      await component["logout"]();

      expect(logoutService.logout).toHaveBeenCalledWith(userId, "userInitiated");
    });

    it("does not call logout when there is no active account", async () => {
      accountService.activeAccountSubject.next(null);
      fixture.detectChanges();

      await component["logout"]();

      expect(logoutService.logout).not.toHaveBeenCalled();
    });
  });
});
