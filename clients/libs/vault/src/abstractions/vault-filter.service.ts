// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Observable } from "rxjs";

import {
  CollectionAdminView,
  CollectionView,
} from "@vowkey/common/admin-console/models/collections";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { UserId } from "@vowkey/common/types/guid";
import { TreeNode } from "@vowkey/common/vault/models/domain/tree-node";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";

import {
  CipherTypeFilter,
  CollectionFilter,
  FolderFilter,
  OrganizationFilter,
} from "../models/vault-filter.type";

export abstract class VaultFilterService {
  collapsedFilterNodes$: Observable<Set<string>>;
  filteredFolders$: Observable<FolderView[]>;
  filteredCollections$: Observable<CollectionView[]>;
  organizationTree$: Observable<TreeNode<OrganizationFilter>>;
  folderTree$: Observable<TreeNode<FolderFilter>>;
  collectionTree$: Observable<TreeNode<CollectionFilter>>;
  cipherTypeTree$: Observable<TreeNode<CipherTypeFilter>>;
  cipherTypeFilters$: Observable<CipherTypeFilter[]>;
  abstract getCollectionNodeFromTree: (id: string) => Promise<TreeNode<CollectionFilter>>;
  abstract setCollapsedFilterNodes: (
    collapsedFilterNodes: Set<string>,
    userId: UserId,
  ) => Promise<void>;
  abstract expandOrgFilter: (userId: UserId) => Promise<void>;
  abstract getOrganizationFilter: () => Observable<Organization>;
  abstract setOrganizationFilter: (organization: Organization) => void;
  abstract buildTypeTree: (
    head: CipherTypeFilter,
    array: CipherTypeFilter[],
  ) => Observable<TreeNode<CipherTypeFilter>>;
  // TODO: Remove this from org vault when collection admin service adopts state management
  abstract reloadCollections?: (collections: CollectionAdminView[]) => void;
  abstract clearOrganizationFilter: () => void;
}
