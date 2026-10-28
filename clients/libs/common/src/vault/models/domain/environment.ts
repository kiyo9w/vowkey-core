import { Jsonify } from "type-fest";

// eslint-disable-next-line no-restricted-imports
import { EncString } from "@vowkey/legacy-crypto";
import { Environment as SdkEnvironment } from "@vowkey/sdk-internal";

import Domain from "../../../platform/models/domain/domain-base";
import { conditionalEncString, encStringFrom } from "../../utils/domain-utils";
import { EnvironmentData } from "../data/environment.data";

export class Environment extends Domain {
  members?: EncString;

  constructor(obj?: EnvironmentData) {
    super();
    if (obj == null) {
      return;
    }

    this.members = conditionalEncString(obj.members);
  }

  toEnvironmentData(): EnvironmentData {
    const c = new EnvironmentData();
    this.buildDataModel(this, c, {
      members: null,
    });
    return c;
  }

  static fromJSON(obj: Jsonify<Environment> | undefined): Environment | undefined {
    if (obj == null) {
      return undefined;
    }

    const environment = new Environment();
    environment.members = encStringFrom(obj.members);

    return environment;
  }

  toSdkEnvironment(): SdkEnvironment {
    return {
      members: this.members?.toSdk(),
    };
  }

  static fromSdkEnvironment(obj?: SdkEnvironment): Environment | undefined {
    if (!obj) {
      return undefined;
    }

    const environment = new Environment();
    environment.members = encStringFrom(obj.members);

    return environment;
  }
}
