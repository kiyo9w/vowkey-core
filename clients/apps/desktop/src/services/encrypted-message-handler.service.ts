// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { firstValueFrom, switchMap } from "rxjs";

import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { PolicyType } from "@vowkey/common/admin-console/enums";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { LoginUriView } from "@vowkey/common/vault/models/view/login-uri.view";
import { LoginView } from "@vowkey/common/vault/models/view/login.view";
import { PasswordGenerationServiceAbstraction } from "@vowkey/generator-legacy";

import { DecryptedCommandData } from "../models/native-messaging/decrypted-command-data";
import { CredentialCreatePayload } from "../models/native-messaging/encrypted-message-payloads/credential-create-payload";
import { CredentialRetrievePayload } from "../models/native-messaging/encrypted-message-payloads/credential-retrieve-payload";
import { CredentialUpdatePayload } from "../models/native-messaging/encrypted-message-payloads/credential-update-payload";
import { PasswordGeneratePayload } from "../models/native-messaging/encrypted-message-payloads/password-generate-payload";
import { AccountStatusResponse } from "../models/native-messaging/encrypted-message-responses/account-status-response";
import { CipherResponse } from "../models/native-messaging/encrypted-message-responses/cipher-response";
import { FailureStatusResponse } from "../models/native-messaging/encrypted-message-responses/failure-status-response";
import { GenerateResponse } from "../models/native-messaging/encrypted-message-responses/generate-response";
import { MessageResponseData } from "../models/native-messaging/encrypted-message-responses/message-response-data";
import { SuccessStatusResponse } from "../models/native-messaging/encrypted-message-responses/success-status-response";
import { UserStatusErrorResponse } from "../models/native-messaging/encrypted-message-responses/user-status-error-response";

export class EncryptedMessageHandlerService {
  constructor(
    private accountService: AccountService,
    private authService: AuthService,
    private cipherService: CipherService,
    private policyService: PolicyService,
    private messagingService: MessagingService,
    private passwordGenerationService: PasswordGenerationServiceAbstraction,
    private localVault?: LocalVaultService | null,
  ) {}

  async responseDataForCommand(commandData: DecryptedCommandData): Promise<MessageResponseData> {
    const { command, payload } = commandData;
    switch (command) {
      case "bw-status": {
        return await this.statusCommandHandler();
      }
      case "bw-credential-retrieval": {
        return await this.credentialRetrievalCommandHandler(payload as CredentialRetrievePayload);
      }
      case "bw-credential-create": {
        return await this.credentialCreateCommandHandler(payload as CredentialCreatePayload);
      }
      case "bw-credential-update": {
        return await this.credentialUpdateCommandHandler(payload as CredentialUpdatePayload);
      }
      case "bw-generate-password": {
        return await this.generateCommandHandler(payload as PasswordGeneratePayload);
      }
      default:
        return {
          error: "cannot-decrypt",
        };
    }
  }

  private async checkUserStatus(userId: string): Promise<string> {
    const activeUserId = await firstValueFrom(getUserId(this.accountService.activeAccount$));

    if (activeUserId == null && this.localVault != null) {
      if (userId != null && userId !== "" && userId !== "local") {
        return "not-active-user";
      }
      await this.localVault.initialize();
      if (this.localVault.state$.value === "persisted-locked") {
        return "locked";
      }
      return "valid";
    }

    if (userId !== activeUserId) {
      return "not-active-user";
    }

    const authStatus = await this.authService.getAuthStatus(activeUserId);
    if (authStatus !== AuthenticationStatus.Unlocked) {
      return "locked";
    }

    return "valid";
  }

  private async statusCommandHandler(): Promise<AccountStatusResponse[]> {
    const accounts = await firstValueFrom(this.accountService.accounts$);
    const activeUserId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    const accountIds = accounts ? Object.keys(accounts) : [];

    if (accountIds.length === 0) {
      if (this.localVault != null) {
        await this.localVault.initialize();
        const locked = this.localVault.state$.value === "persisted-locked";
        return [
          {
            id: "local" as UserId,
            email: "On this device",
            status: locked ? "locked" : "unlocked",
            active: true,
          },
        ];
      }
      return [];
    }

    return Promise.all(
      accountIds.map(async (userId: UserId) => {
        const authStatus = await this.authService.getAuthStatus(userId);
        const email = accounts[userId].email;

        return {
          id: userId,
          email,
          status: authStatus === AuthenticationStatus.Unlocked ? "unlocked" : "locked",
          active: userId === activeUserId,
        };
      }),
    );
  }

  private async credentialRetrievalCommandHandler(
    payload: CredentialRetrievePayload,
  ): Promise<CipherResponse[] | UserStatusErrorResponse> {
    if (payload.uri == null) {
      return [];
    }

    const ciphersResponse: CipherResponse[] = [];
    const activeUserId = await firstValueFrom(getUserId(this.accountService.activeAccount$));

    if (activeUserId == null && this.localVault != null) {
      await this.localVault.initialize();
      if (this.localVault.state$.value === "persisted-locked") {
        return { error: "locked" };
      }
      const targetDomain = Utils.getDomain(payload.uri)?.toLowerCase() ?? "";
      const targetHost = Utils.getHostname(payload.uri)?.toLowerCase() ?? "";
      const items = await this.localVault.list();
      const matching = items.filter((c) => {
        if (c.type !== CipherType.Login || c.login == null) {
          return false;
        }
        return (c.login.uris ?? []).some((u) => {
          if (!u?.uri) {
            return false;
          }
          const domain = Utils.getDomain(u.uri)?.toLowerCase() ?? "";
          const host = Utils.getHostname(u.uri)?.toLowerCase() ?? "";
          return (
            (targetDomain !== "" && domain === targetDomain) ||
            (targetHost !== "" && host === targetHost)
          );
        });
      });
      matching.sort((a, b) => this.cipherService.sortCiphersByLastUsedThenName(a, b));
      matching.forEach((c) => {
        ciphersResponse.push({
          userId: "local" as UserId,
          credentialId: c.id,
          userName: c.login.username,
          password: c.login.password,
          name: c.name,
        } as CipherResponse);
      });
      return ciphersResponse;
    }

    const authStatus = await this.authService.getAuthStatus(activeUserId);

    if (authStatus !== AuthenticationStatus.Unlocked) {
      return { error: "locked" };
    }

    const ciphers = await this.cipherService.getAllDecryptedForUrl(payload.uri, activeUserId);
    ciphers.sort((a, b) => this.cipherService.sortCiphersByLastUsedThenName(a, b));

    ciphers.forEach((c) => {
      ciphersResponse.push({
        userId: activeUserId,
        credentialId: c.id,
        userName: c.login.username,
        password: c.login.password,
        name: c.name,
      } as CipherResponse);
    });

    return ciphersResponse;
  }

  private async credentialCreateCommandHandler(
    payload: CredentialCreatePayload,
  ): Promise<SuccessStatusResponse | FailureStatusResponse | UserStatusErrorResponse> {
    const userStatus = await this.checkUserStatus(payload.userId);
    if (userStatus !== "valid") {
      return { error: userStatus } as UserStatusErrorResponse;
    }

    const credentialCreatePayload = payload as CredentialCreatePayload;
    const activeUserId = await firstValueFrom(getUserId(this.accountService.activeAccount$));

    if (activeUserId != null) {
      const policyApplies$ = this.accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) =>
          this.policyService.policyAppliesToUser$(PolicyType.OrganizationDataOwnership, userId),
        ),
      );

      if (credentialCreatePayload.name == null || (await firstValueFrom(policyApplies$))) {
        return { status: "failure" };
      }
    } else if (credentialCreatePayload.name == null) {
      return { status: "failure" };
    }

    const cipherView = new CipherView();
    cipherView.type = CipherType.Login;
    cipherView.name = payload.name;
    cipherView.login = new LoginView();
    cipherView.login.password = credentialCreatePayload.password;
    cipherView.login.username = credentialCreatePayload.userName;
    cipherView.login.uris = [new LoginUriView()];
    cipherView.login.uris[0].uri = credentialCreatePayload.uri;

    try {
      if (activeUserId == null && this.localVault != null) {
        cipherView.id = Utils.newGuid();
        await this.localVault.save(cipherView);
      } else {
        await this.cipherService.createWithServer(cipherView, activeUserId);
      }

      // Notify other clients of new login
      await this.messagingService.send("addedCipher");
      // Refresh Desktop ciphers list
      await this.messagingService.send("refreshCiphers");

      return { status: "success" };
    } catch {
      return { status: "failure" };
    }
  }

  private async credentialUpdateCommandHandler(
    payload: CredentialUpdatePayload,
  ): Promise<SuccessStatusResponse | FailureStatusResponse | UserStatusErrorResponse> {
    const userStatus = await this.checkUserStatus(payload.userId);
    if (userStatus !== "valid") {
      return { error: userStatus } as UserStatusErrorResponse;
    }

    const credentialUpdatePayload = payload as CredentialUpdatePayload;

    if (credentialUpdatePayload.name == null) {
      return { status: "failure" };
    }

    try {
      const activeUserId = await firstValueFrom(getUserId(this.accountService.activeAccount$));

      if (activeUserId == null && this.localVault != null) {
        const cipherView = await this.localVault.getCipher(credentialUpdatePayload.credentialId);
        if (cipherView == null || cipherView.login == null) {
          return { status: "failure" };
        }
        cipherView.name = credentialUpdatePayload.name;
        cipherView.login.password = credentialUpdatePayload.password;
        cipherView.login.username = credentialUpdatePayload.userName;
        if (!cipherView.login.uris?.length) {
          cipherView.login.uris = [new LoginUriView()];
        }
        cipherView.login.uris[0].uri = credentialUpdatePayload.uri;
        await this.localVault.save(cipherView);
      } else {
        const cipher = await this.cipherService.get(
          credentialUpdatePayload.credentialId,
          activeUserId,
        );
        if (cipher === null) {
          return { status: "failure" };
        }

        const cipherView = await this.cipherService.decrypt(cipher, activeUserId);
        cipherView.name = credentialUpdatePayload.name;
        cipherView.login.password = credentialUpdatePayload.password;
        cipherView.login.username = credentialUpdatePayload.userName;
        cipherView.login.uris[0].uri = credentialUpdatePayload.uri;

        await this.cipherService.updateWithServer(cipherView, activeUserId);
      }

      // Notify other clients of update
      await this.messagingService.send("editedCipher");
      // Refresh Desktop ciphers list
      await this.messagingService.send("refreshCiphers");

      return { status: "success" };
    } catch {
      return { status: "failure" };
    }
  }

  private async generateCommandHandler(
    payload: PasswordGeneratePayload,
  ): Promise<GenerateResponse | UserStatusErrorResponse> {
    const userStatus = await this.checkUserStatus(payload.userId);
    if (userStatus !== "valid") {
      return { error: userStatus } as UserStatusErrorResponse;
    }

    const options = (await this.passwordGenerationService.getOptions())[0];
    const generatedValue = await this.passwordGenerationService.generatePassword(options);
    await this.passwordGenerationService.addHistory(generatedValue);

    return { password: generatedValue };
  }
}
