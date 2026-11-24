export type UsageCount = {
  event: "page_view" | "fill_outcome";
  surface: "web" | "extension" | "desktop" | "ios" | "android";
  os: string;
  locale: string;
  page: string;
  count?: number;
};

export type FillOutcome = { filled: number; close: number; left: number };


/** Records a count only while the switch is on. The body is the allowlist and nothing else. */
export function sendUsageCount(enabled: boolean, count: UsageCount, post: (body: string) => void): void {
  if (!enabled) return;
  post(JSON.stringify({ event: count.event, surface: count.surface, os: count.os, locale: count.locale, page: count.page, count: count.count ?? 1 }));
}

/** Fill outcomes travel as three numbers: filled, close, left. No URL and no field value. */
export function sendFillOutcome(
  enabled: boolean,
  surface: UsageCount["surface"],
  outcome: FillOutcome,
  post: (body: string) => void,
  os = "",
  locale = "",
): void {
  sendUsageCount(
    enabled,
    { event: "fill_outcome", surface, os, locale, page: `${outcome.filled}:${outcome.close}:${outcome.left}` },
    post,
  );
}

