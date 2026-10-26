import { Injectable } from "@angular/core";
import { Observable } from "rxjs";

import { UserId } from "@vowkey/common/types/guid";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { CipherListView } from "@vowkey/sdk-internal";
import { VaultFilterService } from "@vowkey/vault";

/**
 * Includes PAM-gated ("partial") ciphers in the folder tree, matching the web vault list, which
 * renders them. Other clients keep the base behavior and exclude them.
 */
@Injectable()
export class WebIndividualVaultFilterService extends VaultFilterService {
  protected override folderFilterCiphers$(
    userId: UserId,
  ): Observable<CipherView[] | CipherListView[]> {
    return this.cipherService.cipherListViewsWithPartials$(userId);
  }
}
