/** What the pill says after adding or filling a file. */
export type PillStatus = { good: boolean; title: string; subtitle: string };

/** A request the pill makes of the vault, which lives in the main window. */
export type QuickBarRequest =
  | { kind: "details"; profileId?: string }
  | { kind: "openProfile"; profileId: string; sourceId?: string; variantId?: string }
  | { kind: "process"; name: string; path: string; bytes: Uint8Array; profileId?: string }
  | { kind: "unlock"; password?: string }
  | { kind: "protect"; password: string }
  | { kind: "filled" }
  | { kind: "dismissProtection" };
