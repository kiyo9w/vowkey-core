/** What the pill says after adding or filling a file. */
export type PillStatus = { good: boolean; title: string; subtitle: string };

/** A request the pill makes of the vault, which lives in the main window. */
export type QuickBarRequest =
  | { kind: "details" }
  | { kind: "process"; name: string; path: string; bytes: Uint8Array };
