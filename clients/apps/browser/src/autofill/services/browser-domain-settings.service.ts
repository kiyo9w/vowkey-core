import { distinctUntilChanged, map, Observable, of, shareReplay, switchMap } from "rxjs";

import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import {
  DefaultDomainSettingsService,
  DomainSettingsService,
} from "@vowkey/common/autofill/services/domain-settings.service";
import { FormContent, TargetingRulesByDomain } from "@vowkey/common/autofill/types";
import {
  EquivalentDomains,
  NeverDomains,
  UriMatchStrategy,
  UriMatchStrategySetting,
} from "@vowkey/common/models/domain/domain-service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { StateProvider } from "@vowkey/common/platform/state";
import { UserId } from "@vowkey/common/types/guid";

export class BrowserDomainSettingsService implements DomainSettingsService {
  private readonly inner: DefaultDomainSettingsService;

  readonly showFavicons$: Observable<boolean>;
  readonly neverDomains$: Observable<NeverDomains>;
  readonly blockedInteractionsUris$: Observable<NeverDomains>;
  readonly equivalentDomains$: Observable<EquivalentDomains>;
  readonly defaultUriMatchStrategy$: Observable<UriMatchStrategySetting>;
  readonly defaultUriMatchStrategyPolicy$: Observable<UriMatchStrategySetting>;
  readonly resolvedDefaultUriMatchStrategy$: Observable<UriMatchStrategySetting>;
  readonly enableFillAssist$: Observable<boolean>;
  readonly fillAssistPolicy$: Observable<{ rulesUrl?: string } | null>;
  readonly effectiveFillAssistRulesUrl$: Observable<string>;
  readonly resolvedEnableFillAssist$: Observable<boolean>;
  readonly targetingRules$: Observable<TargetingRulesByDomain | null>;

  constructor(
    stateProvider: StateProvider,
    policyService: PolicyService,
    accountService: AccountService,
    configService: ConfigService,
    environmentService: EnvironmentService,
    authService: AuthService,
  ) {
    this.inner = new DefaultDomainSettingsService(
      stateProvider,
      policyService,
      accountService,
      configService,
      environmentService,
      authService,
    );

    const withGuestDefault = <T>(stream$: Observable<T>, guestValue: T): Observable<T> =>
      accountService.activeAccount$.pipe(
        map((account) => account?.id ?? null),
        distinctUntilChanged(),
        switchMap((userId) => (userId == null ? of(guestValue) : stream$)),
      );

    this.showFavicons$ = this.inner.showFavicons$;
    this.neverDomains$ = this.inner.neverDomains$;
    this.blockedInteractionsUris$ = this.inner.blockedInteractionsUris$;
    this.equivalentDomains$ = withGuestDefault(this.inner.equivalentDomains$, null);
    this.defaultUriMatchStrategy$ = withGuestDefault(
      this.inner.defaultUriMatchStrategy$,
      UriMatchStrategy.Domain,
    );
    this.defaultUriMatchStrategyPolicy$ = withGuestDefault(
      this.inner.defaultUriMatchStrategyPolicy$,
      null,
    ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    this.resolvedDefaultUriMatchStrategy$ = withGuestDefault(
      this.inner.resolvedDefaultUriMatchStrategy$,
      UriMatchStrategy.Domain,
    ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
    this.enableFillAssist$ = this.inner.enableFillAssist$;
    this.fillAssistPolicy$ = this.inner.fillAssistPolicy$;
    this.effectiveFillAssistRulesUrl$ = this.inner.effectiveFillAssistRulesUrl$;
    this.resolvedEnableFillAssist$ = this.inner.resolvedEnableFillAssist$;
    this.targetingRules$ = this.inner.targetingRules$;
  }

  setShowFavicons = (newValue: boolean): Promise<void> => this.inner.setShowFavicons(newValue);

  setNeverDomains = (newValue: NeverDomains): Promise<void> => this.inner.setNeverDomains(newValue);

  setBlockedInteractionsUris = (newValue: NeverDomains): Promise<void> =>
    this.inner.setBlockedInteractionsUris(newValue);

  setEquivalentDomains = (newValue: EquivalentDomains, userId: UserId): Promise<void> =>
    this.inner.setEquivalentDomains(newValue, userId);

  setDefaultUriMatchStrategy = (newValue: UriMatchStrategySetting): Promise<void> =>
    this.inner.setDefaultUriMatchStrategy(newValue);

  getUrlEquivalentDomains = (url: string): Observable<Set<string>> =>
    this.equivalentDomains$.pipe(
      map((equivalentDomains) => {
        const domain = Utils.getDomain(url);
        if (domain == null || equivalentDomains == null) {
          return new Set<string>();
        }
        const equivalents = equivalentDomains.filter((ed) => ed.includes(domain)).flat();
        return new Set(equivalents);
      }),
    );

  setEnableFillAssist = (newValue: boolean): Promise<void> =>
    this.inner.setEnableFillAssist(newValue);

  setTargetingRules = (rules: TargetingRulesByDomain, effectiveUrl?: string): Promise<void> =>
    this.inner.setTargetingRules(rules, effectiveUrl);

  getTargetingRulesForUrl = (url: string): Promise<FormContent[] | null> =>
    this.inner.getTargetingRulesForUrl(url);
}
