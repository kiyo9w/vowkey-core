import { Observable } from "rxjs";

import { UserId } from "@vowkey/common/types/guid";

import { VaultOnboardingTasks } from "../vault-onboarding.service";

export abstract class VaultOnboardingService {
  abstract setVaultOnboardingTasks(userId: UserId, newState: VaultOnboardingTasks): Promise<void>;
  abstract vaultOnboardingState$(userId: UserId): Observable<VaultOnboardingTasks | null>;
}
