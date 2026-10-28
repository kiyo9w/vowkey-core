import { BaseResponse } from "../../../models/response/base.response";

export class EnvironmentApi extends BaseResponse {
  members: string | undefined = undefined;

  constructor(data: any = null) {
    super(data);
    if (data == null) {
      return;
    }
    this.members = this.getResponseProperty("Members");
  }
}
