import { Component, inject } from "@angular/core";
import { toObservable } from "@angular/core/rxjs-interop";
import { combineLatest, map, Observable, startWith, switchMap } from "rxjs";

import { NudgesService } from "@vowkey/angular/vault";
import {
  VaultInactive,
  VaultActive,
  SettingsInactive,
  SettingsActive,
} from "@vowkey/assets/svg";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { AutofillSettingsServiceAbstraction } from "@vowkey/common/autofill/services/autofill-settings.service";
import { BottomNavigationButton } from "@vowkey/components";
import {
  ALL_ITEMS_SCOPE,
  parseVaultScope,
  VAULT_BASE_ROUTE,
  vaultScopeCommands,
} from "@vowkey/vault";

import { VaultPopupListTableFiltersService } from "../vault/popup/services/vault-popup-list-table-filters.service";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-tabs-v2",
  templateUrl: "./tabs-v2.component.html",
  standalone: false,
})
export class TabsV2Component {
  constructor(
    private nudgesService: NudgesService,
    private accountService: AccountService,
    private autofillSettingsService: AutofillSettingsServiceAbstraction,
  ) {}

  private readonly listFiltersService = inject(VaultPopupListTableFiltersService);
  private readonly vaultBasePath = inject(VAULT_BASE_ROUTE);

  private userId$ = this.accountService.activeAccount$.pipe(getUserId);
  private hasActiveBadges$ = this.userId$.pipe(
    switchMap((userId) => this.nudgesService.hasActiveBadges$(userId)),
  );

  private showSettingsBerry$ = combineLatest([
    this.hasActiveBadges$,
    this.autofillSettingsService.showClipboardSettingUpdateNotification$,
  ]).pipe(map(([hasBadges, showClipboard]) => hasBadges || showClipboard));

  protected navButtons$: Observable<BottomNavigationButton[]> = combineLatest([
    this.showSettingsBerry$.pipe(startWith(false)),
    toObservable(this.listFiltersService.cachedVaultScopeId).pipe(startWith(null)),
  ]).pipe(
    map(([showBerry, scopeId]) => {
      const scope = parseVaultScope(scopeId) ?? ALL_ITEMS_SCOPE;
      const vaultPage = vaultScopeCommands(scope, this.vaultBasePath).join("/");
      const buttons: BottomNavigationButton[] = [
        {
          label: "vault",
          page: vaultPage,
          icon: VaultInactive,
          iconActive: VaultActive,
        },
        {
          label: "settings",
          page: "/tabs/settings",
          icon: SettingsInactive,
          iconActive: SettingsActive,
          showBerry: false,
        },
      ];
      return buttons;
    }),
  );
}
