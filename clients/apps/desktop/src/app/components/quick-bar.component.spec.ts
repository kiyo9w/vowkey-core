import { Router } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { LoginView } from "@vowkey/common/vault/models/view/login.view";

import { QuickBarComponent } from "./quick-bar.component";

describe("QuickBarComponent", () => {
  let component: QuickBarComponent;
  let accountService: MockProxy<AccountService>;
  let authService: MockProxy<AuthService>;
  let cipherService: MockProxy<CipherService>;
  let platformUtilsService: MockProxy<PlatformUtilsService>;
  let router: MockProxy<Router>;

  const userId = "user-1" as UserId;

  beforeEach(() => {
    accountService = mock<AccountService>();
    accountService.activeAccount$ = of({
      id: userId,
      email: "linh@example.com",
      emailVerified: true,
      name: "Linh",
    });
    authService = mock<AuthService>();
    authService.activeAccountStatus$ = of(AuthenticationStatus.Unlocked);
    cipherService = mock<CipherService>();
    platformUtilsService = mock<PlatformUtilsService>();
    router = mock<Router>();

    const identityCipher = new CipherView();
    identityCipher.id = "cipher-id-1";
    identityCipher.name = "在留カード";
    identityCipher.type = CipherType.Identity;
    identityCipher.identity = Object.assign(new IdentityView(), {
      firstName: "LINH",
      lastName: "NGUYEN",
      passportNumber: "C9482710",
      address1: "1-2-3 Shinjuku",
      city: "Tokyo",
      phone: "080-1234-5678",
    });

    const loginCipher = new CipherView();
    loginCipher.id = "cipher-login-1";
    loginCipher.name = "Mizuho Direct";
    loginCipher.type = CipherType.Login;
    loginCipher.login = Object.assign(new LoginView(), {
      username: "linh.nguyen",
      password: "correct-horse-battery",
    });

    cipherService.getAllDecrypted.mockResolvedValue([identityCipher, loginCipher]);

    (global as any).ipc = {
      autofill: {
        autotypeMvp: {
          listenRequest: jest.fn(),
          execute: jest.fn(),
        },
      },
    };

    component = new QuickBarComponent(
      accountService,
      authService,
      cipherService,
      platformUtilsService,
      router,
    );
  });

  it("loads decrypted Vault details when unlocked and filters by query", async () => {
    component.ngOnInit();
    await component.openBar();

    expect(component.isOpen).toBe(true);
    expect(component.allHits.length).toBeGreaterThanOrEqual(5);

    component.query = "C9482710";
    component.onQueryChange();
    expect(component.filteredHits).toHaveLength(1);
    expect(component.filteredHits[0].label).toBe("Passport number");
  });

  it("inserts the selected detail into the active window via native autotype", async () => {
    component.ngOnInit();
    await component.openBar();

    const loginHit = component.allHits.find((h) => h.label === "Login")!;
    component.insertHit(loginHit);

    expect(platformUtilsService.copyToClipboard).toHaveBeenCalledWith("linh.nguyen");
    expect((global as any).ipc.autofill.autotypeMvp.execute).toHaveBeenCalledWith({
      username: "linh.nguyen",
      password: "correct-horse-battery",
    });
    expect(component.slot).toBe("done");
  });

  it("prompts and resolves an agent access request", () => {
    component.ngOnInit();
    component.promptAgentAccess({
      agentName: "Claude Code",
      detailLabel: "Số sổ Nenkin",
      goal: "Fill 委任状.xlsx",
      reason: "C14 basic pension number",
    });

    expect(component.isOpen).toBe(true);
    expect(component.slot).toBe("req");

    component.resolveAgentRequest("once");
    expect(component.lastAgentDecision).toBe("once");
    expect(component.slot).toBe("search");
  });
});
