import { CollectionView } from "@vowkey/common/admin-console/models/collections";
import { CollectionWithIdExport } from "@vowkey/common/models/export/collection-with-id.export";

import { BaseResponse } from "../../../models/response/base.response";

export class CollectionResponse extends CollectionWithIdExport implements BaseResponse {
  object: string;

  constructor(o: CollectionView) {
    super();
    this.object = "collection";
    this.build(o);
  }
}
