import * as sdk from "@vowkey/sdk-internal";
import * as wasm from "@vowkey/sdk-internal/vowkey_wasm_internal_bg.wasm";

import { GlobalWithWasmInit } from "./browser-sdk-load.service";

(globalThis as GlobalWithWasmInit).initSdk = () => {
  (sdk as any).init(wasm);
};
