// eslint-disable-next-line no-restricted-imports
import { EncString } from "@vowkey/legacy-crypto";

import { LegacyMessage } from "./legacy-message";

export type LegacyMessageWrapper = {
  message: LegacyMessage | EncString;
  appId: string;
};
