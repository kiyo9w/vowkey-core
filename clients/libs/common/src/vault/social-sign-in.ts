import { FieldType } from "./enums";
import { CipherView } from "./models/view/cipher.view";
import { FieldView } from "./models/view/field.view";

export const VOWKEY_SIGN_IN_WITH_FIELD = "vowkey:sign_in_with";

export const SOCIAL_SIGN_IN_PROVIDERS = ["google", "apple", "github", "microsoft"] as const;

export type SocialSignInProvider = (typeof SOCIAL_SIGN_IN_PROVIDERS)[number];

export interface SocialSignInInfo {
  provider: SocialSignInProvider;
  hint?: string;
}

const INTERNAL_FIELD_NAMES = new Set<string>([
  VOWKEY_SIGN_IN_WITH_FIELD,
  "vk.meta",
  "vk.sample",
]);

export function isInternalCipherFieldName(name: string | null | undefined): boolean {
  return typeof name === "string" && INTERNAL_FIELD_NAMES.has(name.trim());
}

export function isSocialSignInProvider(value: string | null | undefined): value is SocialSignInProvider {
  if (!value) {
    return false;
  }
  return (SOCIAL_SIGN_IN_PROVIDERS as readonly string[]).includes(value);
}

export function socialSignInProviderLabel(provider: SocialSignInProvider): string {
  switch (provider) {
    case "google":
      return "Google";
    case "apple":
      return "Apple";
    case "github":
      return "GitHub";
    case "microsoft":
      return "Microsoft";
  }
}

export function parseSocialSignInValue(raw: string | null | undefined): SocialSignInInfo | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const colonIdx = trimmed.indexOf(":");
  const providerCandidate = (colonIdx >= 0 ? trimmed.slice(0, colonIdx) : trimmed)
    .trim()
    .toLowerCase();
  if (!isSocialSignInProvider(providerCandidate)) {
    return null;
  }
  const hint = colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : "";
  return hint ? { provider: providerCandidate, hint } : { provider: providerCandidate };
}

export function parseSocialSignIn(
  cipher: Pick<CipherView, "fields"> | null | undefined,
): SocialSignInInfo | null {
  const fields = cipher?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }
  for (const field of fields) {
    if (field?.name === VOWKEY_SIGN_IN_WITH_FIELD) {
      const parsed = parseSocialSignInValue(field.value);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}

export function formatSocialSignInValue(
  provider: SocialSignInProvider | "" | null | undefined,
  hint?: string | null,
): string | null {
  if (!provider || !isSocialSignInProvider(provider)) {
    return null;
  }
  const trimmedHint = typeof hint === "string" ? hint.trim() : "";
  return trimmedHint ? `${provider}:${trimmedHint}` : provider;
}

export function applySocialSignIn(
  cipher: CipherView,
  provider: SocialSignInProvider | "" | null | undefined,
  hint?: string | null,
): CipherView {
  const remaining = (cipher.fields ?? []).filter((f) => f?.name !== VOWKEY_SIGN_IN_WITH_FIELD);
  const formatted = formatSocialSignInValue(provider, hint);
  if (formatted) {
    const field = new FieldView();
    field.name = VOWKEY_SIGN_IN_WITH_FIELD;
    field.value = formatted;
    field.type = FieldType.Text;
    cipher.fields = [...remaining, field];
  } else {
    cipher.fields = remaining.length > 0 ? remaining : null;
  }
  return cipher;
}

export function formatSocialSignInSummary(
  info: SocialSignInInfo,
  translate?: (key: string, p1?: string) => string,
): string {
  const label = socialSignInProviderLabel(info.provider);
  const translated = translate?.("vkSignInWithProvider", label);
  const base =
    translated && translated !== "vkSignInWithProvider" ? translated : `Sign in with ${label}`;
  return info.hint ? `${base} (${info.hint})` : base;
}
