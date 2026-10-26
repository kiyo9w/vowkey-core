import "core-js/proposals/explicit-resource-management";

import { webcrypto } from "crypto";

import { addCustomMatchers } from "@vowkey/common/spec";

Object.defineProperty(window, "crypto", {
  value: webcrypto,
});

// Add custom matchers
addCustomMatchers();
