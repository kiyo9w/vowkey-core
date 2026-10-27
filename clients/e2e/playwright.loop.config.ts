import { defineConfig } from "@playwright/test";

import { baseConfig } from "./playwright.base";

/**
 * Fills the demo forms in the browser extension from a vault that the desktop app filled from
 * documents (scripts/e2e-loop.sh runs the two in turn against one server).
 */
export default defineConfig({
  ...baseConfig,
  testDir: "./tests/loop",
  // The fixture launches its own persistent context and records the trace itself.
  use: { ...baseConfig.use, trace: "off" },
});
