import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import * as sdk from "@vowkey/sdk-internal";

export class CliSdkLoadService extends SdkLoadService {
  async load(): Promise<void> {
    // CLI uses stdout for user interaction / automations so we cannot log info / debug here.
    SdkLoadService.logLevel = sdk.LogLevel.Error;
    const module = await import("@vowkey/sdk-internal/vowkey_wasm_internal_bg.wasm");
    (sdk as any).init(module);
  }
}
