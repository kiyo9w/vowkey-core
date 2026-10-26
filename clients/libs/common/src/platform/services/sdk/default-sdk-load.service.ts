import * as sdk from "@vowkey/sdk-internal";
import * as vowkeyModule from "@vowkey/sdk-internal/vowkey_wasm_internal_bg.wasm";

import { SdkLoadService } from "../../abstractions/sdk/sdk-load.service";

/**
 * Directly imports the Vowkey SDK and initializes it.
 *
 * **Warning**: This requires WASM support and will fail if the environment does not support it.
 */
export class DefaultSdkLoadService extends SdkLoadService {
  async load(): Promise<void> {
    (sdk as any).init(vowkeyModule);
  }
}
