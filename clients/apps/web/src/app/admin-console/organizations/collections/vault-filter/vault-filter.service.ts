import { Injectable, OnDestroy } from "@angular/core";
import { map, Observable, ReplaySubject, Subject } from "rxjs";

import { CollectionService } from "@vowkey/admin-console/common";
import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { CollectionAdminView } from "@vowkey/common/admin-console/models/collections";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { StateProvider } from "@vowkey/common/platform/state";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { TreeNode } from "@vowkey/common/vault/models/domain/tree-node";
import {
  VaultFilterService as BaseVaultFilterService,
  CollectionFilter,
  Vfo1TerminologyService,
} from "@vowkey/vault";

@Injectable()
export class VaultFilterService extends BaseVaultFilterService implements OnDestroy {
  private destroy$ = new Subject<void>();
  private _collections = new ReplaySubject<CollectionAdminView[]>(1);

  filteredCollections$: Observable<CollectionAdminView[]> = this._collections.asObservable();

  collectionTree$: Observable<TreeNode<CollectionFilter>> = this.filteredCollections$.pipe(
    map((collections) => this.buildCollectionTree(collections)),
  );

  constructor(
    organizationService: OrganizationService,
    folderService: FolderService,
    cipherService: CipherService,
    policyService: PolicyService,
    i18nService: I18nService,
    stateProvider: StateProvider,
    collectionService: CollectionService,
    accountService: AccountService,
    configService: ConfigService,
    vfo1TerminologyService: Vfo1TerminologyService,
  ) {
    super(
      organizationService,
      folderService,
      cipherService,
      policyService,
      i18nService,
      stateProvider,
      collectionService,
      accountService,
      configService,
      vfo1TerminologyService,
    );
  }

  async reloadCollections(collections: CollectionAdminView[]) {
    this._collections.next(collections);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
