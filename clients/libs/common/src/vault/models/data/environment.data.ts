import { EnvironmentApi } from "../api/environment.api";

export class EnvironmentData {
  members?: string;

  constructor(data?: EnvironmentApi) {
    if (data == null) {
      return;
    }

    this.members = data.members;
  }
}
