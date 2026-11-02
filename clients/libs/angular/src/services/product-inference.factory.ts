import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { TokenService } from "@vowkey/common/auth/abstractions/token.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ProductInference } from "@vowkey/common/vault/local/product-inference";

const DECISION_RELAY_URL = "https://decision.vowkey.app";

export function productInferenceFactory(
  vault: LocalVaultService, accounts: AccountService, tokens: TokenService, environments: EnvironmentService,
): ProductInference {
  return new ProductInference(async () => {
    const account = await firstValueFrom(accounts.activeAccount$);
    const environment = await firstValueFrom(account == null
      ? environments.environment$ : environments.getEnvironment$(account.id));
    return {
      installationId: account == null ? await vault.installationId() : account.id,
      identityUrl: environment.getIdentityUrl(),
      accountToken: account == null ? null : await tokens.getAccessToken(account.id),
    };
  }, DECISION_RELAY_URL);
}
