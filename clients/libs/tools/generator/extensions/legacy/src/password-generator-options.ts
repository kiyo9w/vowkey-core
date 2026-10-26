import { PassphraseGenerationOptions, PasswordGenerationOptions } from "@vowkey/generator-core";
import { GeneratorNavigation } from "@vowkey/generator-navigation";

/** Request format for credential generation.
 *  This type includes all properties suitable for reactive data binding.
 */
export type PasswordGeneratorOptions = PasswordGenerationOptions &
  PassphraseGenerationOptions &
  GeneratorNavigation & { policyUpdated?: boolean };
