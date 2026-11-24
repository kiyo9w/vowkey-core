import {
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  Observable,
  of,
  switchMap,
} from "rxjs";

import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AutofillOverlayVisibility, ClearClipboardDelay } from "@vowkey/common/autofill/constants";
import {
  AutofillSettingsService,
  AutofillSettingsServiceAbstraction,
} from "@vowkey/common/autofill/services/autofill-settings.service";
import {
  ClearClipboardDelaySetting,
  GuestGeneratedPasswordEntry,
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

const GUEST_AUTOFILL_ON_PAGE_LOAD = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestAutofillOnPageLoad",
  {
    deserializer: (value) => value ?? false,
  },
);

const GUEST_AUTOFILL_ON_PAGE_LOAD_DEFAULT = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestAutofillOnPageLoadDefault",
  {
    deserializer: (value) => value ?? false,
  },
);

const GUEST_AUTO_COPY_TOTP = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestAutoCopyTotp",
  {
    deserializer: (value) => value ?? true,
  },
);

const GUEST_SHOW_INLINE_MENU_IDENTITIES = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestShowInlineMenuIdentities",
  {
    deserializer: (value) => value ?? true,
  },
);

const GUEST_SHOW_INLINE_MENU_CARDS = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestShowInlineMenuCards",
  {
    deserializer: (value) => value ?? true,
  },
);

const GUEST_SHOW_INLINE_MENU_SSH_KEYS = new KeyDefinition<boolean>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestShowInlineMenuSshKeys",
  {
    deserializer: (value) => value ?? true,
  },
);

const GUEST_CLEAR_CLIPBOARD_DELAY = new KeyDefinition<ClearClipboardDelaySetting>(
  AUTOFILL_SETTINGS_DISK_LOCAL,
  "guestClearClipboardDelay",
  {
    deserializer: (value) => value ?? ClearClipboardDelay.FiveMinutes,
  },
);

export class BrowserAutofillSettingsService implements AutofillSettingsServiceAbstraction {
  private readonly inner: AutofillSettingsService;
  private readonly inlineMenuVisibilityCustomizedState: GlobalState<boolean>;
  private readonly guestAutofillOnPageLoadState: GlobalState<boolean>;
  private readonly guestAutofillOnPageLoadDefaultState: GlobalState<boolean>;
  private readonly guestAutoCopyTotpState: GlobalState<boolean>;
  private readonly guestShowInlineMenuIdentitiesState: GlobalState<boolean>;
  private readonly guestShowInlineMenuCardsState: GlobalState<boolean>;
  private readonly guestShowInlineMenuSshKeysState: GlobalState<boolean>;
  private readonly guestClearClipboardDelayState: GlobalState<ClearClipboardDelaySetting>;

  readonly autofillOnPageLoad$: Observable<boolean>;
  readonly autofillOnPageLoadDefault$: Observable<boolean>;
  readonly autofillOnPageLoadCalloutIsDismissed$: Observable<boolean>;
  readonly activateAutofillOnPageLoadFromPolicy$: Observable<boolean>;
  readonly autofillOnPageLoadPolicyToastHasDisplayed$: Observable<boolean>;
  readonly autoCopyTotp$: Observable<boolean>;
  readonly inlineMenuVisibility$: Observable<InlineMenuVisibilitySetting>;
  readonly autoOpenInlineMenu$: Observable<boolean>;
  readonly guestGeneratedPasswordHistory$: Observable<GuestGeneratedPasswordEntry[]>;
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
    private readonly accountService: AccountService,
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

    const withGuestState = <T>(
      stream$: Observable<T>,
      guestState: GlobalState<T>,
      defaultValue: T,
    ): Observable<T> =>
      accountService.activeAccount$.pipe(
        map((account) => account?.id ?? null),
        distinctUntilChanged(),
        switchMap((userId) =>
          userId == null ? guestState.state$.pipe(map((v) => v ?? defaultValue)) : stream$,
        ),
      );

    this.inlineMenuVisibilityCustomizedState = stateProvider.getGlobal(
      INLINE_MENU_VISIBILITY_CUSTOMIZED,
    );
    this.guestAutofillOnPageLoadState = stateProvider.getGlobal(GUEST_AUTOFILL_ON_PAGE_LOAD);
    this.guestAutofillOnPageLoadDefaultState = stateProvider.getGlobal(
      GUEST_AUTOFILL_ON_PAGE_LOAD_DEFAULT,
    );
    this.guestAutoCopyTotpState = stateProvider.getGlobal(GUEST_AUTO_COPY_TOTP);
    this.guestShowInlineMenuIdentitiesState = stateProvider.getGlobal(
      GUEST_SHOW_INLINE_MENU_IDENTITIES,
    );
    this.guestShowInlineMenuCardsState = stateProvider.getGlobal(GUEST_SHOW_INLINE_MENU_CARDS);
    this.guestShowInlineMenuSshKeysState = stateProvider.getGlobal(GUEST_SHOW_INLINE_MENU_SSH_KEYS);
    this.guestClearClipboardDelayState = stateProvider.getGlobal(GUEST_CLEAR_CLIPBOARD_DELAY);

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

    this.autoOpenInlineMenu$ = this.inner.autoOpenInlineMenu$;
    this.guestGeneratedPasswordHistory$ = this.inner.guestGeneratedPasswordHistory$;

    this.autofillOnPageLoad$ = withGuestState(
      this.inner.autofillOnPageLoad$,
      this.guestAutofillOnPageLoadState,
      false,
    );
    this.autofillOnPageLoadDefault$ = withGuestState(
      this.inner.autofillOnPageLoadDefault$,
      this.guestAutofillOnPageLoadDefaultState,
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
    this.autoCopyTotp$ = withGuestState(
      this.inner.autoCopyTotp$,
      this.guestAutoCopyTotpState,
      true,
    );
    this.showInlineMenuIdentities$ = withGuestState(
      this.inner.showInlineMenuIdentities$,
      this.guestShowInlineMenuIdentitiesState,
      true,
    );
    this.showInlineMenuCards$ = withGuestState(
      this.inner.showInlineMenuCards$,
      this.guestShowInlineMenuCardsState,
      true,
    );
    this.showInlineMenuSshKeys$ = withGuestState(
      this.inner.showInlineMenuSshKeys$,
      this.guestShowInlineMenuSshKeysState,
      true,
    );
    this.honorVowkeyIgnoreAttribute$ = this.inner.honorVowkeyIgnoreAttribute$;
    this.honorVowkeyAutofillAttribute$ = this.inner.honorVowkeyAutofillAttribute$;
    this.enableBasicAuthResponse$ = withGuestDefault(this.inner.enableBasicAuthResponse$, false);
    this.resolvedEnableBasicAuthResponse$ = this.inner.resolvedEnableBasicAuthResponse$;
    this.enableContextMenu$ = this.inner.enableContextMenu$;
    this.clearClipboardDelay$ = withGuestState(
      this.inner.clearClipboardDelay$,
      this.guestClearClipboardDelayState,
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

  private async isGuestMode(): Promise<boolean> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    return account == null;
  }

  setAutofillOnPageLoad = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestAutofillOnPageLoadState.update(() => newValue);
      return;
    }
    await this.inner.setAutofillOnPageLoad(newValue);
  };

  setAutofillOnPageLoadDefault = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestAutofillOnPageLoadDefaultState.update(() => newValue);
      return;
    }
    await this.inner.setAutofillOnPageLoadDefault(newValue);
  };

  setAutofillOnPageLoadCalloutIsDismissed = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      return;
    }
    await this.inner.setAutofillOnPageLoadCalloutIsDismissed(newValue);
  };

  setAutofillOnPageLoadPolicyToastHasDisplayed = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      return;
    }
    await this.inner.setAutofillOnPageLoadPolicyToastHasDisplayed(newValue);
  };

  setAutoCopyTotp = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestAutoCopyTotpState.update(() => newValue);
      return;
    }
    await this.inner.setAutoCopyTotp(newValue);
  };

  setInlineMenuVisibility = async (newValue: InlineMenuVisibilitySetting): Promise<void> => {
    await this.inlineMenuVisibilityCustomizedState.update(() => true);
    await this.inner.setInlineMenuVisibility(newValue);
  };

  setAutoOpenInlineMenu = (newValue: boolean): Promise<void> =>
    this.inner.setAutoOpenInlineMenu(newValue);

  recordGuestGeneratedPassword = (entry: GuestGeneratedPasswordEntry): Promise<void> =>
    this.inner.recordGuestGeneratedPassword(entry);

  setShowInlineMenuIdentities = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestShowInlineMenuIdentitiesState.update(() => newValue);
      return;
    }
    await this.inner.setShowInlineMenuIdentities(newValue);
  };

  setShowInlineMenuCards = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestShowInlineMenuCardsState.update(() => newValue);
      return;
    }
    await this.inner.setShowInlineMenuCards(newValue);
  };

  setShowInlineMenuSshKeys = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestShowInlineMenuSshKeysState.update(() => newValue);
      return;
    }
    await this.inner.setShowInlineMenuSshKeys(newValue);
  };

  setHonorVowkeyIgnoreAttribute = (newValue: boolean): Promise<void> =>
    this.inner.setHonorVowkeyIgnoreAttribute(newValue);

  setHonorVowkeyAutofillAttribute = (newValue: boolean): Promise<void> =>
    this.inner.setHonorVowkeyAutofillAttribute(newValue);

  setEnableBasicAuthResponse = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      return;
    }
    await this.inner.setEnableBasicAuthResponse(newValue);
  };

  setEnableContextMenu = (newValue: boolean): Promise<void> =>
    this.inner.setEnableContextMenu(newValue);

  setClearClipboardDelay = async (newValue: ClearClipboardDelaySetting): Promise<void> => {
    if (await this.isGuestMode()) {
      await this.guestClearClipboardDelayState.update(() => newValue);
      return;
    }
    await this.inner.setClearClipboardDelay(newValue);
  };

  setClipboardSettingUpdatedNotificationDismissed = async (newValue: boolean): Promise<void> => {
    if (await this.isGuestMode()) {
      return;
    }
    await this.inner.setClipboardSettingUpdatedNotificationDismissed(newValue);
  };
}
