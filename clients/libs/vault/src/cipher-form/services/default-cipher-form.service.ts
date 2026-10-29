// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { inject, Injectable } from "@angular/core";
import { firstValueFrom, map } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { UserId, OrganizationId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { cloneProfileEnvelope, prepareProfileSave } from "@vowkey/common/vault/profile/vk-meta";
import { SecurityTaskType, TaskService } from "@vowkey/common/vault/tasks";

import { CipherFormConfig } from "../abstractions/cipher-form-config.service";
import { CipherFormService } from "../abstractions/cipher-form.service";

function isSetEqual(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

@Injectable()
export class DefaultCipherFormService implements CipherFormService {
  private cipherService: CipherService = inject(CipherService);
  private accountService: AccountService = inject(AccountService);
  private taskService: TaskService = inject(TaskService);
  private localVault = inject(LocalVaultService, { optional: true });

  async decryptCipher(cipher: Cipher): Promise<CipherView> {
    const account = await firstValueFrom(this.accountService.activeAccount$);
    if (account == null) {
      const local = (await this.localVault?.list())?.find((item) => item.id === cipher.id);
      if (local == null) { throw new Error("The local item is unavailable."); }
      return CipherView.fromSdkCipherView(local.toSdkCipherView())!;
    }
    const activeUserId = account.id;
    return await this.cipherService.decrypt(cipher, activeUserId);
  }

  async saveCipher(cipher: CipherView, config: CipherFormConfig): Promise<CipherView> {
    if (config.vault === "local") {
      if (this.localVault == null || await firstValueFrom(this.accountService.activeAccount$) != null) {
        throw new Error("The active vault changed. Open the item again.");
      }
      prepareProfileSave(cipher);
      return this.localVault.save(cipher);
    }
    const activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));

    let savedCipher: Cipher;

    // Creating a new cipher. A clone of a profile remints its inner ids first, so the copy does
    // not follow the original's detail references. Share keeps those ids and does not come here.
    if (cipher.id == null || cipher.id === "") {
      if (config.mode === "clone" && cipher.type === CipherType.Identity) {
        cloneProfileEnvelope(cipher);
      }
      prepareProfileSave(cipher);
      return await this.cipherService.createWithServer(cipher, activeUserId, config.admin);
    }

    prepareProfileSave(cipher);

    if (config.originalCipher == null) {
      throw new Error("Original cipher is required for updating an existing cipher");
    }
    const originalCipherView = await this.decryptCipher(config.originalCipher);

    // Updating an existing cipher

    const originalCollectionIds = new Set(config.originalCipher.collectionIds ?? []);
    const newCollectionIds = new Set(cipher.collectionIds ?? []);

    // Call shareWithServer if the owner is changing from a user to an organization
    if (config.originalCipher.organizationId == null && cipher.organizationId != null) {
      // shareWithServer expects the cipher to have no organizationId set
      const organizationId = cipher.organizationId as OrganizationId;
      cipher.organizationId = null;

      savedCipher = await this.cipherService.shareWithServer(
        cipher,
        organizationId,
        cipher.collectionIds,
        activeUserId,
        originalCipherView,
      );
      // If the collectionIds are the same, update the cipher normally
    } else if (isSetEqual(originalCollectionIds, newCollectionIds)) {
      const savedCipherView = await this.cipherService.updateWithServer(
        cipher,
        activeUserId,
        originalCipherView,
        config.admin,
      );
      savedCipher = await this.cipherService
        .encrypt(savedCipherView, activeUserId)
        .then((res) => res.cipher);
    } else {
      // Updating a cipher with collection changes is not supported with a single request currently
      // Save the new collectionIds before overwriting
      const newCollectionIdsToSave = cipher.collectionIds;

      // First update the cipher with the original collectionIds
      cipher.collectionIds = config.originalCipher.collectionIds;
      const newCipher = await this.cipherService.updateWithServer(
        cipher,
        activeUserId,
        originalCipherView,
        config.admin || originalCollectionIds.size === 0,
      );

      // Then save the new collection changes separately
      newCipher.collectionIds = newCollectionIdsToSave;

      // TODO: Remove after migrating all SDK ops
      const { cipher: encryptedCipher } = await this.cipherService.encrypt(newCipher, activeUserId);
      if (config.admin || originalCollectionIds.size === 0) {
        // When using an admin config or the cipher was unassigned, update collections as an admin
        savedCipher = await this.cipherService.saveCollectionsWithServerAdmin(encryptedCipher);
      } else {
        savedCipher = await this.cipherService.saveCollectionsWithServer(
          encryptedCipher,
          activeUserId,
        );
      }
    }

    await this.markAssociatedTaskAsComplete(activeUserId, cipher, config);

    // Its possible the cipher was made no longer available due to collection assignment changes
    // e.g. The cipher was moved to a collection that the user no longer has access to
    if (savedCipher == null) {
      return null;
    }

    return await this.cipherService.decrypt(savedCipher, activeUserId);
  }

  /**
   * When a cipher has an associated pending `UpdateAtRiskCredential` task
   * and the password has changed, mark the task as complete.
   */
  private async markAssociatedTaskAsComplete(
    userId: UserId,
    updatedCipher: CipherView,
    config: CipherFormConfig,
  ) {
    const decryptedOriginalCipherCipher = await this.cipherService.decrypt(
      config.originalCipher,
      userId,
    );

    const associatedPendingTask = await firstValueFrom(
      this.taskService
        .pendingTasks$(userId)
        .pipe(
          map((tasks) =>
            tasks.find(
              (task) =>
                task.type === SecurityTaskType.UpdateAtRiskCredential &&
                task.cipherId === updatedCipher.id,
            ),
          ),
        ),
    );

    const passwordHasChanged =
      updatedCipher.type === CipherType.Login &&
      updatedCipher.login.password &&
      updatedCipher.login.password !== decryptedOriginalCipherCipher?.login?.password;

    // When there is not an associated pending task or the password has not changed,
    // no action needed-return early.
    if (!associatedPendingTask || !passwordHasChanged) {
      return;
    }

    // If the cipher is a login and the password has changed, mark the associated task as complete
    await this.taskService.markAsComplete(associatedPendingTask.id, userId);
  }
}
