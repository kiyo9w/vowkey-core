import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";

export function isDefaultPasswordManagerPromptFeatureEnabled(
  configService: ConfigService,
): Promise<boolean> {
  return configService.getFeatureFlag(FeatureFlag.DefaultPasswordManagerPrompt);
}
