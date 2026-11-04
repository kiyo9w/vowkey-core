/** What the pill says after adding or filling a file or login. */
export type PillStatus = {
  good: boolean;
  title: string;
  subtitle: string;
  profileId?: string;
  sourceId?: string | null;
  filledPath?: string | null;
};

/** Screen-space bounds and Accessibility metadata of a focused `<input>` or native text field. */
export interface FocusedInputField {
  role: string;
  subrole?: string;
  title?: string;
  description?: string;
  placeholder?: string;
  isSecure?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Frontmost app, browser tab URL, focused `<input>`, or open document behind the Quick Bar. */
export interface FrontContext {
  appName?: string;
  bundleId?: string;
  pid?: number;
  hwnd?: string;
  windowTitle?: string;
  url?: string;
  host?: string;
  file?: { name: string; path: string };
  focusedField?: FocusedInputField;
  browserExtensionActive?: boolean;
}

/** A searchable item in the Quick Bar across logins, profile details, cards, keys, and notes. */
export interface QuickBarVaultItem {
  id: string;
  kind: "login" | "detail" | "card" | "key" | "note";
  label: string;
  value: string;
  displayValue?: string;
  subtitle?: string;
  profile?: string;
  profileId?: string;
  detailId?: string;
  variantId?: string;
  sourceId?: string;
  attribute?: string;
  /** The person's rule for AI agents on a profile detail; "never" keeps it from every agent. */
  agentRule?: "ask" | "fill" | "never";
  cipherId?: string;
  matched?: boolean;
  username?: string;
  password?: string;
  totp?: string;
  uris?: string[];
  cardholder?: string;
  cardNumber?: string;
  cardExp?: string;
  cardCode?: string;
}

/** Pending external AI agent pairing or @vk: field request surfaced in the Quick Bar capsule. */
export interface AgentApprovalPrompt {
  kind: "pair" | "request";
  connectionId?: string;
  requestId?: string;
  agentName: string;
  targetDisplay?: string;
  goal?: string;
  reason?: string;
  entries?: Array<{ entryId: string; label: string; reference: string }>;
}

/** Password credential entry exposed to the macOS AutoFill Credential Provider extension. */
export interface PasswordCredentialEntry {
  recordIdentifier: string;
  username: string;
  password?: string;
  totp?: string;
  serviceIdentifier: string;
  title: string;
}

/** Pika-inspired desktop presence and Quick Bar window behavior preferences. */
export type AppPresenceMode = "both" | "menubar" | "dock";
export type QuickBarWindowMode = "floating" | "popover";

export interface DesktopShellPreferences {
  appPresence: AppPresenceMode;
  quickBarMode: QuickBarWindowMode;
  floatAboveWindows: boolean;
  openAtLogin: boolean;
  /** Fill hands the window to an AI agent instead of the instant fill. */
  aiMode?: boolean;
  /** The agent AI mode uses; when unset or not installed, the first installed one. */
  aiAgent?: "claude-code" | "codex" | "gemini" | null;
}

/** An AI agent Vowkey can start to fill a window, as Settings lists it. */
export interface AiFillAgentOption {
  id: "claude-code" | "codex" | "gemini";
  name: string;
  path: string | null;
}

/** What the pill shows while an AI fill runs. */
export interface AiFillProgressMessage {
  agent: string;
  step: "starting" | "thinking" | "reading" | "filling" | "looking";
  detail?: string;
}

/** A request the pill makes of the vault, which lives in the main window. */
export type QuickBarRequest =
  | { kind: "details"; profileId?: string; front?: FrontContext | null }
  | { kind: "openProfile"; profileId: string; sourceId?: string; variantId?: string }
  | { kind: "openItem"; cipherId: string }
  | {
      kind: "process";
      name: string;
      path: string;
      bytes: Uint8Array;
      profileId?: string;
      intent?: "auto" | "document" | "fill";
    }
  | { kind: "unlock"; password?: string }
  | { kind: "protect"; password: string }
  | { kind: "filled" }
  | { kind: "dismissProtection" }
  | {
      kind: "agentDecision";
      decision: "allow_once" | "always_allow" | "deny";
      requestId?: string;
      entryIds?: string[];
      connectionId?: string;
    }
  | {
      kind: "passwordCredentials";
      serviceIdentifiers?: string[];
      recordIdentifier?: string;
    };
