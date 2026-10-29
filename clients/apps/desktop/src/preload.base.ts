import tools from "./app/tools/preload";
import auth from "./auth/preload";
import autofill from "./autofill/preload";
import capture from "./capture/preload";
import keyManagement from "./key-management/preload";
import localVault from "./local-vault/preload";
import platform from "./platform/preload";
import quickBar from "./quick-bar/preload";

export const ipc = {
  auth,
  autofill,
  capture,
  localVault,
  platform,
  quickBar,
  keyManagement,
  tools,
};
