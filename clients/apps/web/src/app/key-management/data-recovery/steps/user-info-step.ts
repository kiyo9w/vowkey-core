import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptionType } from "@vowkey/legacy-crypto";

import { LogRecorder } from "../log-recorder";

import { RecoveryStep, RecoveryWorkingData } from "./recovery-step";

export class UserInfoStep implements RecoveryStep {
  title = "recoveryStepUserInfoTitle";

  constructor(
    private accountService: AccountService,
    private keyService: KeyService,
  ) {}

  async runDiagnostics(workingData: RecoveryWorkingData, logger: LogRecorder): Promise<boolean> {
    const activeAccount = await firstValueFrom(this.accountService.activeAccount$);
    if (!activeAccount) {
      logger.record("No active account found");
      return false;
    }
    const userId = activeAccount.id;
    workingData.userId = userId;
    logger.record(`User ID: ${userId}`);

    const userKey = await firstValueFrom(this.keyService.userKey$(userId));
    if (!userKey) {
      logger.record("No user key found");
      return false;
    }
    workingData.userKey = userKey;
    logger.record(
      `User encryption type: ${userKey.inner().type === EncryptionType.AesCbc256_HmacSha256_B64 ? "V1" : userKey.inner().type === EncryptionType.CoseEncrypt0 ? "Cose" : "Unknown"}`,
    );

    return true;
  }

  canRecover(workingData: RecoveryWorkingData): boolean {
    return false;
  }

  runRecovery(workingData: RecoveryWorkingData, logger: LogRecorder): Promise<void> {
    return Promise.resolve();
  }
}
