import { Pipe, PipeTransform } from "@angular/core";

import { CollectionView } from "@vowkey/common/admin-console/models/collections";

@Pipe({
  name: "collectionNameFromId",
  pure: true,
})
export class GetCollectionNameFromIdPipe implements PipeTransform {
  transform(value: string, collections: CollectionView[]) {
    return collections.find((o) => o.id === value)?.name;
  }
}
