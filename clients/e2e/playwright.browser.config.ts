import { defineConfig } from "@playwright/test";

import { baseConfig } from "./playwright.base";

export default defineConfig({
  ...baseConfig,
  testDir: "./tests/browser",
  // The fixture launches its own persistent context and records the trace itself.
  use: { ...baseConfig.use, trace: "off" },
});
