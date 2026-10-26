import { defineConfig } from "@playwright/test";

import { baseConfig } from "./playwright.base";
import { IS_LOCAL_SERVER, WEB_VAULT_URL } from "./src/server";

export default defineConfig({
  ...baseConfig,
  testDir: "./tests/web",
  use: {
    ...baseConfig.use,
    baseURL: WEB_VAULT_URL,
    ignoreHTTPSErrors: IS_LOCAL_SERVER,
  },
});
