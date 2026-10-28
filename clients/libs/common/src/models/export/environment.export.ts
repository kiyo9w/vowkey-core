// eslint-disable-next-line no-restricted-imports
import { EncString } from "@vowkey/legacy-crypto";

import { Environment as EnvironmentDomain } from "../../vault/models/domain/environment";
import { EnvironmentMember, EnvironmentView } from "../../vault/models/view/environment.view";

import { safeGetString } from "./utils";

export class EnvironmentExport {
  static template(): EnvironmentExport {
    const req = new EnvironmentExport();
    req.members = [{ name: "EXAMPLE_API_KEY", itemId: "00000000-0000-0000-0000-000000000000" }];
    return req;
  }

  static toView(
    req?: EnvironmentExport,
    view = new EnvironmentView(),
  ): EnvironmentView | undefined {
    if (req == null) {
      return undefined;
    }

    view.members = Array.isArray(req.members) ? req.members : [];
    return view;
  }

  static toDomain(req: EnvironmentExport, domain = new EnvironmentDomain()) {
    // An encrypted export carries the EncString as it is stored; a plain export never reaches here.
    domain.members = typeof req.members === "string" ? new EncString(req.members) : undefined;
    return domain;
  }

  /** The members in a plain export, the stored EncString in an encrypted one. */
  members: EnvironmentMember[] | string | undefined = undefined;

  constructor(o?: EnvironmentView | EnvironmentDomain) {
    if (o == null) {
      return;
    }

    this.members = o instanceof EnvironmentView ? o.members : safeGetString(o.members);
  }
}
