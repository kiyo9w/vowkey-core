import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";

import type { EnvironmentSnapshot } from "./env-files";
import { SecretsError } from "./errors";
import { readFieldPath, ReferenceError, VkReference } from "./references";
import type { EnvironmentMemberDescriptor } from "./run-environment";

/** A key item as the proxy and the environment file read it. */
export interface KeyItem {
  itemId: string;
  name: string;
  value: string;
  sendStyle: string;
  allowedHosts: string[];
  headerName?: string;
  basicUsername?: string;
  revision: string;
}

/**
 * Reads the unlocked vault for developer secrets. It is the one place a reference turns into a
 * value, for `vowkey run`, the environment file and the proxy.
 */
export class VaultResolver {
  constructor(
    private readonly cipherService: CipherService,
    private readonly accountService: AccountService,
  ) {}

  async userId(): Promise<UserId> {
    return await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));
  }

  async view(itemId: string): Promise<CipherView> {
    const userId = await this.userId();
    let view: CipherView | null = null;
    if (Utils.isGuid(itemId)) {
      const cipher = await this.cipherService.get(itemId, userId);
      if (cipher != null) {
        view = await this.cipherService.decrypt(cipher, userId);
      }
    }
    if (view == null) {
      throw new ReferenceError("not-found", `not-found: ${itemId}`);
    }
    return view;
  }

  async scopeId(): Promise<string> {
    return await this.userId();
  }

  async environment(idOrName: string): Promise<EnvironmentSnapshot> {
    const view = await this.findEnvironment(idOrName);
    return {
      id: view.id,
      name: view.name,
      members: view.environment.members.map((m) => ({ name: m.name, itemId: m.itemId })),
      revision: view.revisionDate?.toISOString() ?? "",
      deleted: view.isDeleted,
    };
  }

  /** A readable item's revision, or null when it is gone, in the trash or no longer readable. */
  async revisionOf(itemId: string): Promise<string | null> {
    try {
      const view = await this.view(itemId);
      return view.isDeleted ? null : (view.revisionDate?.toISOString() ?? "");
    } catch {
      return null;
    }
  }

  resolve = async (reference: VkReference): Promise<string> => {
    const view = await this.view(reference.itemId);
    return readFieldPath(view, reference.fieldPath);
  };

  /** Members of an environment, found by id or by an exact, unique name. */
  environmentMembers = async (idOrName: string): Promise<EnvironmentMemberDescriptor[]> => {
    const view = await this.findEnvironment(idOrName);
    if (view.isDeleted) {
      throw new SecretsError("missing-ref", `The environment "${idOrName}" is in the trash.`);
    }
    return view.environment.members.map((m) => ({ name: m.name, itemId: m.itemId }));
  };

  async findEnvironment(idOrName: string): Promise<CipherView> {
    if (Utils.isGuid(idOrName)) {
      const view = await this.view(idOrName);
      if (view.type !== CipherType.Environment) {
        throw new SecretsError("missing-ref", `"${idOrName}" is not an environment.`);
      }
      return view;
    }
    const all = await this.cipherService.getAllDecrypted(await this.userId());
    const named = all.filter(
      (c) => c.type === CipherType.Environment && !c.isDeleted && c.name === idOrName,
    );
    if (named.length !== 1) {
      throw new SecretsError(
        "missing-ref",
        named.length === 0
          ? `No environment named "${idOrName}".`
          : `More than one environment is named "${idOrName}"; use its id.`,
      );
    }
    return named[0];
  }

  /** The key items the person can read, for the proxy. Trashed items are left out. */
  async keyItems(itemIds: string[]): Promise<KeyItem[]> {
    const items: KeyItem[] = [];
    for (const id of itemIds) {
      try {
        const view = await this.view(id);
        if (view.type !== CipherType.ApiKey || view.isDeleted) {
          continue;
        }
        items.push({
          itemId: view.id,
          name: view.name,
          value: view.apiKey.value ?? "",
          sendStyle: view.apiKey.sendStyle ?? "bearer",
          allowedHosts: view.apiKey.allowedHosts,
          headerName: view.apiKey.headerName,
          basicUsername: view.apiKey.basicUsername,
          revision: view.revisionDate?.toISOString() ?? "",
        });
      } catch {
        // An item that no longer resolves is left out; the caller sees it missing.
      }
    }
    return items;
  }
}
