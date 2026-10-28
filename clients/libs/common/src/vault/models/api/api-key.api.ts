import { BaseResponse } from "../../../models/response/base.response";

export class ApiKeyApi extends BaseResponse {
  value: string | undefined = undefined;
  sendStyle: string | undefined = undefined;
  allowedHosts: string | undefined = undefined;
  headerName: string | undefined = undefined;
  basicUsername: string | undefined = undefined;

  constructor(data: any = null) {
    super(data);
    if (data == null) {
      return;
    }
    this.value = this.getResponseProperty("Value");
    this.sendStyle = this.getResponseProperty("SendStyle");
    this.allowedHosts = this.getResponseProperty("AllowedHosts");
    this.headerName = this.getResponseProperty("HeaderName");
    this.basicUsername = this.getResponseProperty("BasicUsername");
  }
}
