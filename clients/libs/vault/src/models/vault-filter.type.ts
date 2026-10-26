import { CollectionAdminView } from "@vowkey/common/admin-console/models/collections";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { CipherType } from "@vowkey/common/vault/enums";
import { ITreeNodeObject } from "@vowkey/common/vault/models/domain/tree-node";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { VowkeyIcon } from "@vowkey/components";

export type CipherStatus = "all" | "favorites" | "archive" | "trash" | CipherType;

export type CipherTypeFilter = ITreeNodeObject & { type: CipherStatus; icon?: VowkeyIcon };
export type CollectionFilter = CollectionAdminView & {
  icon?: VowkeyIcon;
};
export type FolderFilter = FolderView & {
  icon?: VowkeyIcon;
  /**
   * Full folder name.
   *
   * Used for when the folder `name` property is be separated into parts.
   */
  fullName?: string;
};
export type OrganizationFilter = Organization & { icon?: VowkeyIcon; hideOptions?: boolean };
