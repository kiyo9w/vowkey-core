// eslint-disable-next-line no-restricted-imports
import { EncString } from "@vowkey/legacy-crypto";

import { ApiKey as ApiKeyDomain } from "../../vault/models/domain/api-key";
import { ApiKeyView } from "../../vault/models/view/api-key.view";

import { safeGetString } from "./utils";

export class ApiKeyExport {
  static template(): ApiKeyExport {
    const req = new ApiKeyExport();
    req.value = "sk-example-0123456789";
    req.sendStyle = "bearer";
    req.allowedHosts = ["api.example.com"];
    return req;
  }

  static toView(req?: ApiKeyExport, view = new ApiKeyView()): ApiKeyView | undefined {
    if (req == null) {
      return undefined;
    }

    view.value = req.value;
    view.sendStyle = req.sendStyle;
    view.allowedHosts = Array.isArray(req.allowedHosts) ? req.allowedHosts : [];
    view.headerName = req.headerName;
    view.basicUsername = req.basicUsername;
    return view;
  }

  static toDomain(req: ApiKeyExport, domain = new ApiKeyDomain()) {
    domain.value = req.value ? new EncString(req.value) : undefined;
    domain.sendStyle = req.sendStyle ? new EncString(req.sendStyle) : undefined;
    // An encrypted export carries the EncString as it is stored; a plain export never reaches here.
    domain.allowedHosts =
      typeof req.allowedHosts === "string" ? new EncString(req.allowedHosts) : undefined;
    domain.headerName = req.headerName ? new EncString(req.headerName) : undefined;
    domain.basicUsername = req.basicUsername != null ? new EncString(req.basicUsername) : undefined;
    return domain;
  }

  value: string | undefined = undefined;
  sendStyle: string | undefined = undefined;
  /** The hosts in a plain export, the stored EncString in an encrypted one. */
  allowedHosts: string[] | string | undefined = undefined;
  headerName: string | undefined = undefined;
  basicUsername: string | undefined = undefined;

  constructor(o?: ApiKeyView | ApiKeyDomain) {
    if (o == null) {
      return;
    }

    this.value = safeGetString(o.value);
    this.sendStyle = safeGetString(o.sendStyle);
    this.headerName = safeGetString(o.headerName);
    this.basicUsername = safeGetString(o.basicUsername);
    this.allowedHosts = o instanceof ApiKeyView ? o.allowedHosts : safeGetString(o.allowedHosts);
  }
}
