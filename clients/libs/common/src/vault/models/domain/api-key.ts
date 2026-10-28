import { Jsonify } from "type-fest";

// eslint-disable-next-line no-restricted-imports
import { EncString } from "@vowkey/legacy-crypto";
import { ApiKey as SdkApiKey } from "@vowkey/sdk-internal";

import Domain from "../../../platform/models/domain/domain-base";
import { conditionalEncString, encStringFrom } from "../../utils/domain-utils";
import { ApiKeyData } from "../data/api-key.data";

export class ApiKey extends Domain {
  value?: EncString;
  sendStyle?: EncString;
  allowedHosts?: EncString;
  headerName?: EncString;
  basicUsername?: EncString;

  constructor(obj?: ApiKeyData) {
    super();
    if (obj == null) {
      return;
    }

    this.value = conditionalEncString(obj.value);
    this.sendStyle = conditionalEncString(obj.sendStyle);
    this.allowedHosts = conditionalEncString(obj.allowedHosts);
    this.headerName = conditionalEncString(obj.headerName);
    this.basicUsername = conditionalEncString(obj.basicUsername);
  }

  toApiKeyData(): ApiKeyData {
    const c = new ApiKeyData();
    this.buildDataModel(this, c, {
      value: null,
      sendStyle: null,
      allowedHosts: null,
      headerName: null,
      basicUsername: null,
    });
    return c;
  }

  static fromJSON(obj: Jsonify<ApiKey> | undefined): ApiKey | undefined {
    if (obj == null) {
      return undefined;
    }

    const apiKey = new ApiKey();
    apiKey.value = encStringFrom(obj.value);
    apiKey.sendStyle = encStringFrom(obj.sendStyle);
    apiKey.allowedHosts = encStringFrom(obj.allowedHosts);
    apiKey.headerName = encStringFrom(obj.headerName);
    apiKey.basicUsername = encStringFrom(obj.basicUsername);

    return apiKey;
  }

  toSdkApiKey(): SdkApiKey {
    return {
      value: this.value?.toSdk(),
      sendStyle: this.sendStyle?.toSdk(),
      allowedHosts: this.allowedHosts?.toSdk(),
      headerName: this.headerName?.toSdk(),
      basicUsername: this.basicUsername?.toSdk(),
    };
  }

  static fromSdkApiKey(obj?: SdkApiKey): ApiKey | undefined {
    if (!obj) {
      return undefined;
    }

    const apiKey = new ApiKey();
    apiKey.value = encStringFrom(obj.value);
    apiKey.sendStyle = encStringFrom(obj.sendStyle);
    apiKey.allowedHosts = encStringFrom(obj.allowedHosts);
    apiKey.headerName = encStringFrom(obj.headerName);
    apiKey.basicUsername = encStringFrom(obj.basicUsername);

    return apiKey;
  }
}
