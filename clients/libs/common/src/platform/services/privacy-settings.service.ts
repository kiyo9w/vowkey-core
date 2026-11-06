import { map, Observable } from "rxjs";

import { KeyDefinition, PRIVACY_SETTINGS_DISK, StateProvider } from "@vowkey/state";

const SHARE_USAGE_COUNTS = new KeyDefinition<boolean>(PRIVACY_SETTINGS_DISK, "shareUsageCounts", {
  deserializer: (value) => value === true,
});
const SEND_CRASH_REPORTS = new KeyDefinition<boolean>(PRIVACY_SETTINGS_DISK, "sendCrashReports", {
  deserializer: (value) => value === true,
});

/** Both switches stay off until the person turns one on. A missing value is off. */
export class PrivacySettingsService {
  readonly shareUsageCounts$: Observable<boolean>;
  readonly sendCrashReports$: Observable<boolean>;

  constructor(private readonly stateProvider: StateProvider) {
    this.shareUsageCounts$ = this.stateProvider
      .getGlobal(SHARE_USAGE_COUNTS)
      .state$.pipe(map((value) => value === true));
    this.sendCrashReports$ = this.stateProvider
      .getGlobal(SEND_CRASH_REPORTS)
      .state$.pipe(map((value) => value === true));
  }

  setShareUsageCounts(enabled: boolean): Promise<boolean> {
    return this.stateProvider.getGlobal(SHARE_USAGE_COUNTS).update(() => enabled);
  }

  setSendCrashReports(enabled: boolean): Promise<boolean> {
    return this.stateProvider.getGlobal(SEND_CRASH_REPORTS).update(() => enabled);
  }
}
