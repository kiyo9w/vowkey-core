import { CollectionView } from "@vowkey/common/admin-console/models/collections";
import { SafeInjectionToken } from "@vowkey/ui-common";

export const BulkEditCollectionAccessResult = Object.freeze({
  Saved: "saved",
  Canceled: "canceled",
} as const);
export type BulkEditCollectionAccessResult =
  (typeof BulkEditCollectionAccessResult)[keyof typeof BulkEditCollectionAccessResult];

export interface BulkEditCollectionAccessParams {
  organizationId: string;
  collections: CollectionView[];
}

export interface BulkEditCollectionAccessDialogRef {
  open(params: BulkEditCollectionAccessParams): Promise<BulkEditCollectionAccessResult>;
}

export const BULK_EDIT_COLLECTION_ACCESS_DIALOG =
  new SafeInjectionToken<BulkEditCollectionAccessDialogRef>("BULK_EDIT_COLLECTION_ACCESS_DIALOG");
