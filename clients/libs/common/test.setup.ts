import "core-js/proposals/explicit-resource-management";

import { webcrypto } from "crypto";

import { addCustomMatchers } from "./spec";

Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
});

// Add custom matchers
addCustomMatchers();
