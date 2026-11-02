import { combineLatest, distinctUntilChanged, map, Observable, of, switchMap } from "rxjs";

import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AutofillOverlayVisibility, ClearClipboardDelay } from "@vowkey/common/autofill/constants";
import {
  AutofillSettingsService,
  AutofillSettingsServiceAbstraction,
} from "@vowkey/common/autofill/services/autofill-settings.service";
import {
  ClearClipboardDelaySetting,
  InlineMenuVisibilitySetting,
} from "@vowkey/common/autofill/types";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import {
  AUTOFILL_SETTINGS_DISK_LOCAL,
  GlobalState,
  KeyDefinition,
  StateProvider,
} from "@vowkey/common/platform/state";
import { RestrictedItemTypesService } from "@vowkey/common/vault/services/restricted-item-types.service";

const INLINE_MENU_VISIBILITY_CUSTOMIZED = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "inlineMenuVisibilityCustomized",
  {
    deserializer: (value) => value ?? false,
  },
);

export class BrowserAutofillSettingsService implements AutofillSettingsServiceAbstraction {
  private readonly inner: AutofillSettingsService;
  private readonly inlineMenuVisibilityCustomizedState: GlobalState<boolean>;

  readonly autofillOnPageLoad$: Observable<boolean>;
  readonly autofillOnPageLoadDefault$: Observable<boolean>;
  readonly autofillOnPageLoadCalloutIsDismissed$: Observable<boolean>;
  readonly activateAutofillOnPageLoadFromPolicy$: Observable<boolean>;
  readonly autofillOnPageLoadPolicyToastHasDisplayed$: Observable<boolean>;
  readonly autoCopyTotp$: Observable<boolean>;
  readonly inlineMenuVisibility$: Observable<InlineMenuVisibilitySetting>;
  readonly showInlineMenuIdentities$: Observable<boolean>;
  readonly showInlineMenuCards$: Observable<boolean>;
  readonly showInlineMenuSshKeys$: Observable<boolean>;
  readonly honorVowkeyIgnoreAttribute$: Observable<boolean>;
  readonly honorVowkeyAutofillAttribute$: Observable<boolean>;
  readonly enableBasicAuthResponse$: Observable<boolean>;
  readonly resolvedEnableBasicAuthResponse$: Observable<boolean>;
  readonly enableContextMenu$: Observable<boolean>;
  readonly clearClipboardDelay$: Observable<ClearClipboardDelaySetting>;
  readonly hadPreMigrationClipboardValue$: Observable<boolean>;
  readonly clipboardSettingUpdatedNotificationDismissed$: Observable<boolean>;
  readonly showClipboardSettingUpdateNotification$: Observable<boolean>;

  constructor(
    stateProvider: StateProvider,
    policyService: PolicyService,
    accountService: AccountService,
    restrictedItemTypesService: RestrictedItemTypesService,
    configService: ConfigService,
  ) {
    this.inner = new AutofillSettingsService(
      stateProvider,
      policyService,
      accountService,
      restrictedItemTypesService,
      configService,
    );

    const withGuestDefault = <T>(stream$: Observable<T>, guestValue: T): Observable<T> =>
      accountService.activeAccount$.pipe(
        map((account) => account?.id ?? null),
        distinctUntilChanged(),
        switchMap((userId) => (userId == null ? of(guestValue) : stream$)),
      );

    this.inlineMenuVisibilityCustomizedState = stateProvider.getGlobal(
      INLINE_MENU_VISIBILITY_CUSTOMIZED,
    );

    this.inlineMenuVisibility$ = combineLatest([
      this.inner.inlineMenuVisibility$,
      this.inlineMenuVisibilityCustomizedState.state$,
    ]).pipe(
      map(([visibility, customized]) => {
        if (customized) {
          return visibility;
        }
        return visibility === AutofillOverlayVisibility.Off
          ? AutofillOverlayVisibility.OnFieldFocus
          : visibility;
      }),
      distinctUntilChanged(),
    );

    this.autofillOnPageLoad$ = withGuestDefault(this.inner.autofillOnPageLoad$, false);
    this.autofillOnPageLoadDefault$ = withGuestDefault(
      this.inner.autofillOnPageLoadDefault$,
      false,
    );
    this.autofillOnPageLoadCalloutIsDismissed$ = withGuestDefault(
      this.inner.autofillOnPageLoadCalloutIsDismissed$,
      false,
    );
    this.activateAutofillOnPageLoadFromPolicy$ = withGuestDefault(
      this.inner.activateAutofillOnPageLoadFromPolicy$,
      false,
    );
    this.autofillOnPageLoadPolicyToastHasDisplayed$ = withGuestDefault(
      this.inner.autofillOnPageLoadPolicyToastHasDisplayed$,
      false,
    );
    this.autoCopyTotp$ = withGuestDefault(this.inner.autoCopyTotp$, true);
    this.showInlineMenuIdentities$ = withGuestDefault(this.inner.showInlineMenuIdentities$, true);
    this.showInlineMenuCards$ = withGuestDefault(this.inner.showInlineMenuCards$, true);
    this.showInlineMenuSshKeys$ = withGuestDefault(this.inner.showInlineMenuSshKeys$, true);
    this.honorVowkeyIgnoreAttribute$ = this.inner.honorVowkeyIgnoreAttribute$;
    this.honorVowkeyAutofillAttribute$ = this.inner.honorVowkeyAutofillAttribute$;
    this.enableBasicAuthResponse$ = withGuestDefault(this.inner.enableBasicAuthResponse$, false);
    this.resolvedEnableBasicAuthResponse$ = this.inner.resolvedEnableBasicAuthResponse$;
    this.enableContextMenu$ = this.inner.enableContextMenu$;
    this.clearClipboardDelay$ = withGuestDefault(
      this.inner.clearClipboardDelay$,
      ClearClipboardDelay.FiveMinutes,
    );
    this.hadPreMigrationClipboardValue$ = withGuestDefault(
      this.inner.hadPreMigrationClipboardValue$,
      false,
    );
    this.clipboardSettingUpdatedNotificationDismissed$ = withGuestDefault(
      this.inner.clipboardSettingUpdatedNotificationDismissed$,
      false,
    );
    this.showClipboardSettingUpdateNotification$ = withGuestDefault(
      this.inner.showClipboardSettingUpdateNotification$,
      false,
    );
  }

  setAutofillOnPageLoad = (newValue: boolean): Promise<void> =>
    this.inner.setAutofillOnPageLoad(newValue);

  setAutofillOnPageLoadDefault = (newValue: boolean): Promise<void> =>
    this.inner.setAutofillOnPageLoadDefault(newValue);

  setAutofillOnPageLoadCalloutIsDismissed = (newValue: boolean): Promise<void> =>
    this.inner.setAutofillOnPageLoadCalloutIsDismissed(newValue);

  setAutofillOnPageLoadPolicyToastHasDisplayed = (newValue: boolean): Promise<void> =>
    this.inner.setAutofillOnPageLoadPolicyToastHasDisplayed(newValue);

  setAutoCopyTotp = (newValue: boolean): Promise<void> => this.inner.setAutoCopyTotp(newValue);

  setInlineMenuVisibility = async (newValue: InlineMenuVisibilitySetting): Promise<void> => {
    await this.inlineMenuVisibilityCustomizedState.update(() => true);
    await this.inner.setInlineMenuVisibility(newValue);
  };

  setShowInlineMenuIdentities = (newValue: boolean): Promise<void> =>
    this.inner.setShowInlineMenuIdentities(newValue);

  setShowInlineMenuCards = (newValue: boolean): Promise<void> =>
    this.inner.setShowInlineMenuCards(newValue);

  setShowInlineMenuSshKeys = (newValue: boolean): Promise<void> =>
    this.inner.setShowInlineMenuSshKeys(newValue);

  setHonorVowkeyIgnoreAttribute = (newValue: boolean): Promise<void> =>
    this.inner.setHonorVowkeyIgnoreAttribute(newValue);

  setHonorVowkeyAutofillAttribute = (newValue: boolean): Promise<void> =>
    this.inner.setHonorVowkeyAutofillAttribute(newValue);

  setEnableBasicAuthResponse = (newValue: boolean): Promise<void> =>
    this.inner.setEnableBasicAuthResponse(newValue);

  setEnableContextMenu = (newValue: boolean): Promise<void> =>
    this.inner.setEnableContextMenu(newValue);

  setClearClipboardDelay = (newValue: ClearClipboardDelaySetting): Promise<void> =>
    this.inner.setClearClipboardDelay(newValue);

  setClipboardSettingUpdatedNotificationDismissed = (newValue: boolean): Promise<void> =>
    this.inner.setClipboardSettingUpdatedNotificationDismissed(newValue);
}
