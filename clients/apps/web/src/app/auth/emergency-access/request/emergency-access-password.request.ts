import {
  MasterPasswordAuthenticationData,
  MasterPasswordUnlockData,
} from "@vowkey/common/key-management/master-password/types/master-password.types";

export class EmergencyAccessPasswordRequest {
  constructor(
    readonly authenticationData: MasterPasswordAuthenticationData,
    readonly unlockData: MasterPasswordUnlockData,
  ) {}
}
