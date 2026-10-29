import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { of } from "rxjs";

import { Account, AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { UserId } from "@vowkey/common/types/guid";
import {
  CipherService,
  EncryptionContext,
} from "@vowkey/common/vault/abstractions/cipher.service";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { LoginView } from "@vowkey/common/vault/models/view/login.view";
import { readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import { SecurityTaskType, TaskService } from "@vowkey/common/vault/tasks";
import { CipherType } from "@vowkey/sdk-internal";

import { CipherFormConfig } from "../abstractions/cipher-form-config.service";

import { DefaultCipherFormService } from "./default-cipher-form.service";

describe("DefaultCipherFormService", () => {
  let service: DefaultCipherFormService;
  let testBed: TestBed;
  const cipherServiceMock = mock<CipherService>();

  let markAsCompleteMock: jest.Mock;
  let pendingTasks$: jest.Mock;

  beforeEach(() => {
    markAsCompleteMock = jest.fn().mockResolvedValue(undefined);
    pendingTasks$ = jest.fn().mockReturnValue(of([]));
    cipherServiceMock.encrypt.mockResolvedValue({} as EncryptionContext);

    testBed = TestBed.configureTestingModule({
      providers: [
        { provide: CipherService, useValue: cipherServiceMock },
        { provide: TaskService, useValue: { markAsComplete: markAsCompleteMock, pendingTasks$ } },
        {
          provide: AccountService,
          useValue: { activeAccount$: of({ id: "user-1" as UserId } as Account) },
        },
        DefaultCipherFormService,
      ],
    });

    service = testBed.inject(DefaultCipherFormService);
  });

  describe("markAssociatedTaskAsComplete", () => {
    it("does not call markAsComplete when the cipher is not a login", async () => {
      pendingTasks$.mockReturnValueOnce(
        of([
          {
            type: SecurityTaskType.UpdateAtRiskCredential,
            cipherId: "cipher-1",
            userId: "user-1" as UserId,
          },
        ]),
      );

      const cardCipher = new CipherView();
      cardCipher.type = CipherType.Card;
      cardCipher.id = "cipher-1";

      await service.saveCipher(cardCipher, {
        originalCipher: new Cipher(),
        admin: false,
      } as CipherFormConfig);

      expect(markAsCompleteMock).not.toHaveBeenCalled();
    });

    it("does not call markAsComplete when there is no associated credential tasks", async () => {
      pendingTasks$.mockReturnValueOnce(of([]));

      const originalCipher = new Cipher();
      originalCipher.type = CipherType.Login;

      const cipher = new CipherView();
      cipher.type = CipherType.Login;
      cipher.id = "cipher-1";
      cipher.login = new LoginView();
      cipher.login.password = "password123";

      cipherServiceMock.decrypt.mockResolvedValue({
        ...cipher,
        login: {
          ...cipher.login,
          password: "newPassword123",
        },
      } as CipherView);

      await service.saveCipher(cipher, {
        originalCipher: originalCipher,
        admin: false,
      } as CipherFormConfig);

      expect(markAsCompleteMock).not.toHaveBeenCalled();
    });

    it("does not call markAsComplete when the password has not changed", async () => {
      pendingTasks$.mockReturnValueOnce(
        of([
          {
            type: SecurityTaskType.UpdateAtRiskCredential,
            cipherId: "cipher-1",
            userId: "user-1" as UserId,
          },
        ]),
      );

      const cipher = new CipherView();
      cipher.type = CipherType.Login;
      cipher.id = "cipher-1";
      cipher.login = new LoginView();
      cipher.login.password = "password123";

      cipherServiceMock.decrypt.mockResolvedValue(cipher);

      await service.saveCipher(cipher, {
        originalCipher: new Cipher(),
        admin: false,
      } as CipherFormConfig);

      expect(markAsCompleteMock).not.toHaveBeenCalled();
    });

    it("calls markAsComplete when the cipher password has changed and there is an associated credential task", async () => {
      pendingTasks$.mockReturnValueOnce(
        of([
          {
            type: SecurityTaskType.UpdateAtRiskCredential,
            cipherId: "cipher-1",
            userId: "user-1" as UserId,
          },
        ]),
      );

      const cipher = new CipherView();
      cipher.type = CipherType.Login;
      cipher.id = "cipher-1";
      cipher.login = new LoginView();
      cipher.login.password = "password123";

      cipherServiceMock.decrypt.mockResolvedValue({
        ...cipher,
        login: {
          ...cipher.login,
          password: "newPassword123",
        },
      } as CipherView);

      await service.saveCipher(cipher, {
        originalCipher: new Cipher(),
        admin: false,
      } as CipherFormConfig);

      expect(markAsCompleteMock).toHaveBeenCalled();
    });
  });

  describe("profile save", () => {
    it("migrates a legacy identity and reconciles an edited passport number before updating", async () => {
      const cipher = new CipherView();
      cipher.type = CipherType.Identity;
      cipher.id = "profile-1";
      cipher.identity = new IdentityView();
      cipher.identity.passportNumber = "NEW999";
      cipherServiceMock.decrypt.mockImplementation(async () => cipher);
      cipherServiceMock.updateWithServer.mockImplementation(async (view) => view);
      cipherServiceMock.encrypt.mockImplementation(async (view) => ({ cipher: view }) as never);

      await service.saveCipher(cipher, {
        mode: "edit",
        originalCipher: new Cipher(),
        admin: false,
      } as CipherFormConfig);

      const sent = cipherServiceMock.updateWithServer.mock.calls[0][0] as CipherView;
      const envelope = readEnvelope(sent)!;
      expect(envelope.profileId).toBe("profile-1");
      expect(envelope.details.find((d) => d.attribute === "id.passport.number")?.agentRule).toBe(
        "ask",
      );
      expect(sent.identity.passportNumber).toBe("NEW999");
    });
  });
});
