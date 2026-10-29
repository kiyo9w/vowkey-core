import { defineConfig } from "@playwright/test";

import { baseConfig } from "./playwright.base";

/** The live demo is one long test: it opens the apps and waits until the presenter is done. */
export default defineConfig({
  ...baseConfig,
  testDir: "./tests/demo",
  timeout: 0,
  reporter: [["list"]],
  use: { trace: "off", video: "off", screenshot: "off" },
});
