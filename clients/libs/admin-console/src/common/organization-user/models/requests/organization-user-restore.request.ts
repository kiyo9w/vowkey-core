import { EncString } from "@vowkey/sdk-internal";

export class OrganizationUserRestoreRequest {
  defaultUserCollectionName: EncString | undefined;

  constructor(defaultUserCollectionName?: EncString) {
    this.defaultUserCollectionName = defaultUserCollectionName;
  }
}
