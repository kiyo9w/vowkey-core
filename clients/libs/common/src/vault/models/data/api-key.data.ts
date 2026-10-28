import { ApiKeyApi } from "../api/api-key.api";

export class ApiKeyData {
  value?: string;
  sendStyle?: string;
  allowedHosts?: string;
  headerName?: string;
  basicUsername?: string;

  constructor(data?: ApiKeyApi) {
    if (data == null) {
      return;
    }

    this.value = data.value;
    this.sendStyle = data.sendStyle;
    this.allowedHosts = data.allowedHosts;
    this.headerName = data.headerName;
    this.basicUsername = data.basicUsername;
  }
}
