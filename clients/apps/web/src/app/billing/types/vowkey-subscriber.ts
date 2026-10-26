import { map } from "rxjs";

import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { Provider } from "@vowkey/common/admin-console/models/domain/provider";
import { Account } from "@vowkey/common/auth/abstractions/account.service";

export type VowkeySubscriber =
  | { type: "account"; data: Account }
  | { type: "organization"; data: Organization }
  | { type: "provider"; data: Provider };

export type NonIndividualSubscriber = Exclude<VowkeySubscriber, { type: "account" }>;

export const mapAccountToSubscriber = map<Account | null, VowkeySubscriber>((account) => {
  if (!account) {
    throw new Error("Account not found");
  }
  return {
    type: "account",
    data: account,
  };
});

export const mapOrganizationToSubscriber = map<Organization | undefined, VowkeySubscriber>(
  (organization) => {
    if (!organization) {
      throw new Error("Organization not found");
    }
    return {
      type: "organization",
      data: organization,
    };
  },
);

export const mapProviderToSubscriber = map<Provider | null, VowkeySubscriber>((provider) => {
  if (!provider) {
    throw new Error("Organization not found");
  }
  return {
    type: "provider",
    data: provider,
  };
});
