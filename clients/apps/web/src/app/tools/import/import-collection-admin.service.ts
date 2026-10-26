import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { CollectionAdminService } from "@vowkey/admin-console/common";
import { CollectionAdminView } from "@vowkey/common/admin-console/models/collections";
import { ImportCollectionServiceAbstraction } from "@vowkey/importer-core";
import { UserId } from "@vowkey/user-core";

@Injectable()
export class ImportCollectionAdminService implements ImportCollectionServiceAbstraction {
  constructor(private collectionAdminService: CollectionAdminService) {}

  async getAllAdminCollections(
    organizationId: string,
    userId: UserId,
  ): Promise<CollectionAdminView[]> {
    return await firstValueFrom(
      this.collectionAdminService.collectionAdminViews$(organizationId, userId),
    );
  }
}
