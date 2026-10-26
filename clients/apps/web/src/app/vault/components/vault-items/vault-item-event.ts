import { CollectionView } from "@vowkey/common/admin-console/models/collections";
import { CipherViewLike } from "@vowkey/common/vault/utils/cipher-view-like-utils";
import { VaultItemEvent as BaseVaultItemEvent } from "@vowkey/vault";
import { CollectionPermission } from "@vowkey/web-vault/app/admin-console/organizations/shared/components/access-selector";

// Extend base events with web-specific events
export type VaultItemEvent<C extends CipherViewLike> =
  | BaseVaultItemEvent<C>
  | { type: "copyField"; item: C; field: "username" | "password" | "totp" }
  | {
      type: "viewCollectionAccess";
      item: CollectionView;
      readonly: boolean;
      initialPermission?: CollectionPermission;
    }
  | { type: "editCollection"; item: CollectionView; readonly: boolean };
