import { inject, Injectable } from "@angular/core";

import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherViewLike } from "@vowkey/common/vault/utils/cipher-view-like-utils";
import { DialogService } from "@vowkey/components";
import { ShareItemPresenter } from "@vowkey/tools-share";

import { ShareItemDesktopComponent } from "./share-item-desktop.component";

/** Presents sharing in the desktop app's dialog. */
@Injectable()
export class DesktopShareItemPresenter implements ShareItemPresenter {
  private cipherService = inject(CipherService);
  private dialogService = inject(DialogService);

  async present(cipher: CipherViewLike): Promise<void> {
    const cipherView = await this.cipherService.getFullCipherView(cipher);

    await ShareItemDesktopComponent.open(this.dialogService, cipherView);
  }
}
