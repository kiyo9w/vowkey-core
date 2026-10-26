import { Opaque } from "type-fest";

export const IntegrationIds = [
  "anonaddy",
  "duckduckgo",
  "fastmail",
  "firefoxrelay",
  "forwardemail",
  "simplelogin",
] as const;

/** Identifies a vendor integrated into vowkey */
export type IntegrationId = Opaque<string, "IntegrationId">;
