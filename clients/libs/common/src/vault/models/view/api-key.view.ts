import { Jsonify } from "type-fest";

import { ApiKeyView as SdkApiKeyView } from "@vowkey/sdk-internal";

import { ItemView } from "./item.view";

/** How a proxy attaches a key to a request that goes to one of the key's hosts. */
export const ApiKeySendStyle = Object.freeze({
  Bearer: "bearer",
  Header: "header",
  Basic: "basic",
} as const);

export type ApiKeySendStyle = (typeof ApiKeySendStyle)[keyof typeof ApiKeySendStyle];

export class ApiKeyView extends ItemView implements SdkApiKeyView {
  value: string | undefined;
  sendStyle: string | undefined;
  allowedHosts: string[] = [];
  headerName: string | undefined;
  basicUsername: string | undefined;

  get subTitle(): string {
    return this.allowedHosts[0] ?? "";
  }

  static fromJSON(obj: Partial<Jsonify<ApiKeyView>> | undefined): ApiKeyView {
    const view = Object.assign(new ApiKeyView(), obj);
    view.allowedHosts = obj?.allowedHosts ?? [];
    return view;
  }

  static fromSdkApiKeyView(obj: SdkApiKeyView): ApiKeyView {
    const view = new ApiKeyView();

    view.value = obj.value;
    view.sendStyle = obj.sendStyle;
    view.allowedHosts = obj.allowedHosts ?? [];
    view.headerName = obj.headerName;
    view.basicUsername = obj.basicUsername;

    return view;
  }

  toSdkApiKeyView(): SdkApiKeyView {
    return this;
  }
}
