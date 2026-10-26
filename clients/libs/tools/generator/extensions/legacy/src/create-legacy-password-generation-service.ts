// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { StateProvider } from "@vowkey/common/platform/state";
import { engine, services, strategies } from "@vowkey/generator-core";
import { LocalGeneratorHistoryService } from "@vowkey/generator-history";
import { DefaultGeneratorNavigationService } from "@vowkey/generator-navigation";

import { LegacyPasswordGenerationService } from "./legacy-password-generation.service";
import { PasswordGenerationServiceAbstraction } from "./password-generation.service.abstraction";

const { PassphraseGeneratorStrategy, PasswordGeneratorStrategy } = strategies;
const { SdkRandomizer, PasswordRandomizer } = engine;

const DefaultGeneratorService = services.DefaultGeneratorService;

export function legacyPasswordGenerationServiceFactory(
  policyService: PolicyService,
  accountService: AccountService,
  stateProvider: StateProvider,
  sdkService: SdkService,
): PasswordGenerationServiceAbstraction {
  const randomizer = new SdkRandomizer();
  const passwordRandomizer = new PasswordRandomizer(randomizer, Date.now);

  const passwords = new DefaultGeneratorService(
    new PasswordGeneratorStrategy(passwordRandomizer, stateProvider),
    policyService,
  );

  const passphrases = new DefaultGeneratorService(
    new PassphraseGeneratorStrategy(passwordRandomizer, stateProvider),
    policyService,
  );

  const navigation = new DefaultGeneratorNavigationService(stateProvider, policyService);

  const history = new LocalGeneratorHistoryService(stateProvider, sdkService);

  return new LegacyPasswordGenerationService(
    accountService,
    navigation,
    passwords,
    passphrases,
    history,
  );
}
