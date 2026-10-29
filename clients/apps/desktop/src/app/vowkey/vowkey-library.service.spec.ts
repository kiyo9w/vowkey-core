import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";

import { VowkeyLibrary } from "./vowkey-library.service";

describe("VowkeyLibrary", () => {
  it("clears decrypted rows on a vault cache reset and resumes after unlock", () => {
    const views = new BehaviorSubject<CipherView[] | null>([]);
    TestBed.configureTestingModule({
      providers: [
        VowkeyLibrary,
        { provide: AccountService, useValue: { activeAccount$: of({ id: "account-1" }) } },
        { provide: CipherService, useValue: { cipherViews$: () => views.asObservable() } },
      ],
    });
    const library = TestBed.inject(VowkeyLibrary);
    const login = (id: string, name: string) => {
      const cipher = new CipherView();
      cipher.id = id;
      cipher.type = CipherType.Login;
      cipher.name = name;
      return cipher;
    };

    views.next([login("work", "Work login")]);
    expect(library.rowsFor("logins", null, "", "name").map((row) => row.title)).toEqual([
      "Work login",
    ]);

    views.next(null);
    expect(library.rowsFor("all", null, "", "name")).toEqual([]);

    views.next([login("personal", "Personal login")]);
    expect(library.rowsFor("logins", null, "", "name").map((row) => row.title)).toEqual([
      "Personal login",
    ]);
  });
});
