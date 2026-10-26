import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import * as sdk from "@vowkey/sdk-internal";

export class MainSdkLoadService extends SdkLoadService {
  async load(): Promise<void> {
    const module = await import("@vowkey/sdk-internal/vowkey_wasm_internal_bg.wasm");
    (sdk as any).init(module);
  }
}
