import { Account } from "@vowkey/common/auth/abstractions/account.service";
import { UserId } from "@vowkey/common/types/guid";

export const GUEST_GENERATOR_USER_ID = "__vowkey_guest__" as UserId;

export const GUEST_GENERATOR_ACCOUNT: Account = {
  id: GUEST_GENERATOR_USER_ID,
  email: "",
  emailVerified: false,
  name: "Local Vault",
  creationDate: undefined,
};

export function isGuestGeneratorUserId(userId: UserId | null | undefined): boolean {
  return !userId || userId === GUEST_GENERATOR_USER_ID;
}

export function resolveGeneratorAccount(account: Account | null | undefined): Account {
  return account ?? GUEST_GENERATOR_ACCOUNT;
}
