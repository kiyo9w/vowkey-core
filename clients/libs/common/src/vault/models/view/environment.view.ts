import { Jsonify } from "type-fest";

import {
  EnvironmentMember as SdkEnvironmentMember,
  EnvironmentView as SdkEnvironmentView,
} from "@vowkey/sdk-internal";

import { ItemView } from "./item.view";

/** A variable of an environment and the key item that supplies its value. */
export type EnvironmentMember = SdkEnvironmentMember;

export class EnvironmentView extends ItemView implements SdkEnvironmentView {
  members: EnvironmentMember[] = [];

  get subTitle(): string {
    return this.members.map((m) => m.name).join(", ");
  }

  static fromJSON(obj: Partial<Jsonify<EnvironmentView>> | undefined): EnvironmentView {
    const view = Object.assign(new EnvironmentView(), obj);
    view.members = obj?.members ?? [];
    return view;
  }

  static fromSdkEnvironmentView(obj: SdkEnvironmentView): EnvironmentView {
    const view = new EnvironmentView();
    view.members = obj.members ?? [];
    return view;
  }

  toSdkEnvironmentView(): SdkEnvironmentView {
    return this;
  }
}
