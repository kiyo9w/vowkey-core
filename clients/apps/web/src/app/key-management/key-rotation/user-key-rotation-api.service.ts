import { inject, Injectable } from "@angular/core";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { UserId } from "@vowkey/common/types/guid";

import { RotateUserAccountKeysRequest } from "./request/rotate-user-account-keys.request";

@Injectable()
export class UserKeyRotationApiService {
  readonly apiService = inject(ApiService);

  getAgentRotationRecords(userId: UserId): Promise<unknown> {
    return this.apiService.send("GET", "/agent/rotation", null, userId, true);
  }

  postUserKeyUpdate(request: RotateUserAccountKeysRequest): Promise<any> {
    return this.apiService.send(
      "POST",
      "/accounts/key-management/rotate-user-account-keys",
      request,
      true,
      false,
    );
  }
}
