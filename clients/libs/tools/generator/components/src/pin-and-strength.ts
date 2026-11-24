import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PasswordStrengthServiceAbstraction } from "@vowkey/common/tools/password-strength";

export const PIN_GENERATOR_MODE = "pin";
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;
export const PIN_DEFAULT_LENGTH = 6;
const PIN_STORAGE_KEY = "vowkey_generator_pin_length";

export type PasswordStrengthBadge = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: "weak" | "fair" | "good" | "strong";
};

export function clampPinLength(raw: unknown): number {
  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed)) {
    return PIN_DEFAULT_LENGTH;
  }
  return Math.max(PIN_MIN_LENGTH, Math.min(PIN_MAX_LENGTH, parsed));
}

export function readSavedPinLength(): number {
  try {
    const raw = globalThis.localStorage?.getItem(PIN_STORAGE_KEY);
    if (!raw) {
      return PIN_DEFAULT_LENGTH;
    }
    return clampPinLength(raw);
  } catch {
    return PIN_DEFAULT_LENGTH;
  }
}

export function savePinLength(length: number): number {
  const clamped = clampPinLength(length);
  try {
    globalThis.localStorage?.setItem(PIN_STORAGE_KEY, String(clamped));
  } catch {
    // Ignore storage quota or sandbox errors.
  }
  return clamped;
}

export function generateSecurePin(length: number): string {
  const count = clampPinLength(length);
  const digits: string[] = [];
  const buf = new Uint8Array(32);
  while (digits.length < count) {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && digits.length < count; i++) {
      // 250 is the largest multiple of 10 <= 255, avoiding modulo bias.
      if (buf[i] < 250) {
        digits.push(String(buf[i] % 10));
      }
    }
  }
  return digits.join("");
}

function tOr(i18n: I18nService, key: string, fallback: string): string {
  const translated = i18n.t(key);
  return translated && translated !== key ? translated : fallback;
}

function estimateFallbackScore(value: string): 0 | 1 | 2 | 3 | 4 {
  if (!value || value.length < 6 || /^(.)\1+$/.test(value)) {
    return 0;
  }
  let pool = 0;
  if (/[a-z]/.test(value)) {
    pool += 26;
  }
  if (/[A-Z]/.test(value)) {
    pool += 26;
  }
  if (/\d/.test(value)) {
    pool += 10;
  }
  if (/[^A-Za-z0-9]/.test(value)) {
    pool += 32;
  }
  const bits = value.length * Math.log2(Math.max(pool, 10));
  if (bits < 28) {
    return 1;
  }
  if (bits < 45) {
    return 2;
  }
  if (bits < 65) {
    return 3;
  }
  return 4;
}

export function evaluatePasswordStrengthBadge(
  value: string | null | undefined,
  i18n: I18nService,
  strengthService?: PasswordStrengthServiceAbstraction | null,
): PasswordStrengthBadge | null {
  if (!value || value === "-") {
    return null;
  }
  let rawScore: number | undefined;
  try {
    rawScore = strengthService?.getPasswordStrength(value)?.score;
  } catch {
    rawScore = undefined;
  }
  const score = (
    typeof rawScore === "number" && rawScore >= 0 && rawScore <= 4
      ? rawScore
      : estimateFallbackScore(value)
  ) as 0 | 1 | 2 | 3 | 4;

  if (score <= 1) {
    return { score, label: tOr(i18n, "vkStrengthWeak", tOr(i18n, "weak", "Weak")), tone: "weak" };
  }
  if (score === 2) {
    return { score, label: tOr(i18n, "vkStrengthFair", "Fair"), tone: "fair" };
  }
  if (score === 3) {
    return { score, label: tOr(i18n, "vkStrengthGood", tOr(i18n, "good", "Good")), tone: "good" };
  }
  return {
    score,
    label: tOr(i18n, "vkStrengthStrong", tOr(i18n, "strong", "Strong")),
    tone: "strong",
  };
}
