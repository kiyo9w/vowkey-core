// contains logic that constructs generator services dynamically given
// a generator id.

import { BehaviorSubject, firstValueFrom, of, shareReplay, switchMap } from "rxjs";
import { Jsonify } from "type-fest";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { StateProvider } from "@vowkey/common/platform/state";
import { LegacyEncryptorProvider } from "@vowkey/common/tools/cryptography/legacy-encryptor-provider";
import { UserEncryptor } from "@vowkey/common/tools/cryptography/user-encryptor.abstraction";
import { RestClient } from "@vowkey/common/tools/integration/rpc";
import { SystemServiceProvider } from "@vowkey/common/tools/providers";
import { UserStateSubjectDependencyProvider } from "@vowkey/common/tools/state/user-state-subject-dependency-provider";
import { UserId } from "@vowkey/common/types/guid";
// eslint-disable-next-line no-restricted-imports
import { EncString } from "@vowkey/legacy-crypto";

import { CredentialGeneratorService, Randomizer } from "./abstractions";
import { SdkRandomizer } from "./engine/sdk-randomizer";
import { isGuestGeneratorUserId } from "./guest-account";
import { BuiltIn } from "./metadata";
import {
  CredentialGeneratorProviders,
  GeneratorDependencyProvider,
  GeneratorMetadataProvider,
  GeneratorProfileProvider,
} from "./providers";
import { DefaultCredentialGeneratorService } from "./services";

export function createRandomizer(): Randomizer {
  return new SdkRandomizer();
}

/** Instantiates a `CredentialGeneratorService` without Angular DI.
 *  @param system cross-cutting services required by the generator
 *  @param random randomness source
 *  @param encryptor encryption provider
 *  @param state state provider
 *  @param i18n internationalization service
 *  @param api API client
 *  @param sdkService SDK service exposing the static (user-less) client
 */
class GuestUserEncryptor extends UserEncryptor {
  constructor(readonly userId: UserId) {
    super();
  }

  async encrypt<Secret>(secret: Jsonify<Secret>): Promise<EncString> {
    if (secret === null || secret === undefined) {
      throw new Error("Secret cannot be null or undefined.");
    }
    const payload = encodeURIComponent(JSON.stringify(secret));
    const b64 = typeof btoa === "function" ? btoa(payload) : Buffer.from(payload, "utf8").toString("base64");
    return new EncString(`0.${b64}`);
  }

  async decrypt<Secret>(secret: EncString): Promise<Jsonify<Secret>> {
    if (!secret?.data) {
      throw new Error("Encrypted secret cannot be null or undefined.");
    }
    const raw =
      typeof atob === "function"
        ? atob(secret.data)
        : Buffer.from(secret.data, "base64").toString("utf8");
    return JSON.parse(decodeURIComponent(raw)) as Jsonify<Secret>;
  }
}

function wrapGuestEncryptorProvider(inner: LegacyEncryptorProvider): LegacyEncryptorProvider {
  return {
    userEncryptor$: (frameSize, dependencies) =>
      dependencies.singleUserId$.pipe(
        switchMap((userId) => {
          if (isGuestGeneratorUserId(userId)) {
            return new BehaviorSubject({
              userId,
              encryptor: new GuestUserEncryptor(userId),
            });
          }
          return inner.userEncryptor$(frameSize, { singleUserId$: of(userId) });
        }),
      ),
    organizationEncryptor$: (frameSize, dependencies) =>
      inner.organizationEncryptor$(frameSize, dependencies),
  };
}

export async function createCredentialGeneratorService(
  system: SystemServiceProvider,
  random: Randomizer,
  encryptor: LegacyEncryptorProvider,
  state: StateProvider,
  i18n: I18nService,
  api: ApiService,
  sdkService: SdkService,
): Promise<CredentialGeneratorService> {
  const userState: UserStateSubjectDependencyProvider = {
    encryptor: wrapGuestEncryptorProvider(encryptor),
    state,
    log: system.log,
    now: Date.now,
  };

  const metadata = new GeneratorMetadataProvider(userState, system, Object.values(BuiltIn));
  const profile = new GeneratorProfileProvider(userState, system.policy);

  // Hold a single warm subscription to `sdkService.client$` so each generator
  // invocation replays the cached client instead of re-running the inner
  // `concatMap` (which would re-pay `createSdkClient` and `loadFeatureFlags`).
  // `refCount: false` keeps the upstream subscription alive even when no
  // downstream subscribers exist between `firstValueFrom` calls. Environment
  // changes still propagate because the inner `client$` is wired to
  // `environmentService.environment$`. Trade-off: an SDK initialization
  // failure becomes sticky — every subsequent `sdk()` call resolves to the
  // cached error. This matches today's observable behavior (a broken SDK
  // already breaks every downstream consumer).
  const sharedClient$ = sdkService.client$.pipe(shareReplay({ refCount: false, bufferSize: 1 }));

  const generator: GeneratorDependencyProvider = {
    randomizer: random,
    client: new RestClient(api, i18n),
    i18nService: i18n,
    sdk: () => firstValueFrom(sharedClient$),
    now: Date.now,
  };

  const provide: CredentialGeneratorProviders = { userState, generator, profile, metadata };
  return new DefaultCredentialGeneratorService(provide, system);
}
