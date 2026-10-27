import tools from "./app/tools/preload";
import auth from "./auth/preload";
import autofill from "./autofill/preload";
import capture from "./capture/preload";
import keyManagement from "./key-management/preload";
import platform from "./platform/preload";

export const ipc = {
  auth,
  autofill,
  capture,
  platform,
  keyManagement,
  tools,
};
