import type { QuickBarVaultItem } from "../quick-bar/types";

import type { BridgeOp, FillBridge, Screenshot, WindowScan } from "./fill-bridge";

export interface ToolContent {
  type: "text" | "image";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface FillOutcome {
  status: "done" | "partial" | "nothing_to_fill" | "failed";
  summary: string;
  filled: number;
  skipped: Array<{ field: string; reason: string }>;
}

export interface VaultDetail {
  kind: string;
  label: string;
  value: string;
  profile?: string;
  username?: string;
  password?: string;
  totp?: string;
  uris?: string[];
  cardholder?: string;
  cardNumber?: string;
  cardExp?: string;
  cardCode?: string;
}

/** An Ask-first detail, card or key the person has not allowed on this run. A login keeps its credentials. */
function held(item: QuickBarVaultItem, allowedIds?: ReadonlySet<string>): boolean {
  if (item.agentRule === "fill" || allowedIds?.has(item.id)) {
    return false;
  }
  return item.kind === "detail" || item.kind === "card" || item.kind === "key";
}

/**
 * What an AI fill hands the agent. A chosen profile's details go through; with no profile chosen,
 * every profile's details stay out so two people are not combined. A detail set to "Don't fill"
 * stays out entirely. An Ask-first detail, card or key keeps its label and drops its value until
 * this run's allow list names it. A login keeps its username, password and code.
 */
export function vaultForAgent(
  items: QuickBarVaultItem[],
  profileId?: string,
  allowedIds?: ReadonlySet<string>,
): VaultDetail[] {
  return items
    .filter((item) => item.kind !== "detail" || (Boolean(profileId) && item.agentRule !== "never"))
    .filter((item) => item.kind !== "detail" || item.profileId === profileId)
    .slice(0, 500)
    .map((item) => {
      const keep = !held(item, allowedIds);
      return {
        kind: item.kind,
        label: item.label,
        value: item.kind === "login" || !keep ? "" : (item.value ?? "").slice(0, 800),
        profile: item.profile,
        username: keep ? item.username : undefined,
        password: keep ? item.password : undefined,
        totp: keep ? item.totp : undefined,
        uris: item.uris,
        cardholder: keep ? item.cardholder : undefined,
        cardNumber: keep ? item.cardNumber : undefined,
        cardExp: keep ? item.cardExp : undefined,
        cardCode: keep ? item.cardCode : undefined,
      };
    });
}

export interface SiteGrant {
  site: string;
  itemId: string;
}

/** The site or app a grant belongs to. A page without either is not remembered. */
export function grantSite(front: { url?: string; host?: string; appName?: string } | null): string {
  try {
    return front?.url ? new URL(front.url).origin : front?.host || front?.appName || "";
  } catch {
    return front?.host || front?.appName || "";
  }
}

/** Item ids the person already allowed on this site. Don't fill is never one of them. */
export function grantedIds(items: QuickBarVaultItem[], grants: SiteGrant[], site: string): Set<string> {
  const held = new Set(items.filter((item) => item.agentRule === "never").map((item) => item.id));
  return new Set(grants.filter((grant) => grant.site === site && !held.has(grant.itemId)).map((grant) => grant.itemId));
}

/**
 * The labels of details the person set to "Don't fill", so the agent can say why it left a field
 * empty. Only the label goes; the value never does.
 */
export function withheldFromAgent(items: QuickBarVaultItem[], profileId?: string): string[] {
  const labels = items
    .filter((item) => item.kind === "detail" && item.agentRule === "never")
    .filter((item) => !profileId || item.profileId === profileId)
    .map((item) => item.label);
  return [...new Set(labels)];
}

/** What the agent is reported doing, for the progress line in the pill. */
export type FillProgress = { step: string; detail?: string };

const point = { type: "number" };

export const FILL_TOOLS: ToolDefinition[] = [
  {
    name: "read_window",
    description:
      "Reads the target window through macOS Accessibility: every field, dropdown, checkbox, radio, button and visible text, each with an id, label, current value and screen frame. Ids change when the window changes, so read again after navigation or scrolling.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "fill_fields",
    description:
      "Fills many fields at once by id from the latest read_window. Text fields and combo boxes get the value typed in as real input; popup buttons choose the option whose text matches. Each result reports ok, how it was written and the value read back. Prefer one call with every field.",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, value: { type: "string" } },
            required: ["id", "value"],
          },
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "select_option",
    description: "Opens a dropdown/popup by id and chooses the option with this visible text.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, option: { type: "string" } },
      required: ["id", "option"],
    },
  },
  {
    name: "press",
    description:
      "Presses an element by id: toggles a checkbox, picks a radio button, opens a popup or presses a button.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "screenshot",
    description:
      "Captures the target window as an image. Coordinates for click and scroll are pixels in this image (top-left is 0,0). Use it to check the result, and whenever read_window shows no fields or does not match what is on screen (canvas apps, Word/PowerPoint/Excel documents, remote desktops, custom-drawn UI).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "click",
    description:
      "Clicks at a point of the latest screenshot (image pixels). count 2 double-clicks (selects a word), 3 triple-clicks (selects a line or paragraph).",
    inputSchema: {
      type: "object",
      properties: { x: point, y: point, count: { type: "integer", minimum: 1, maximum: 3 } },
      required: ["x", "y"],
    },
  },
  {
    name: "screen_steps",
    description:
      "Runs several screen actions in one call, in order: click (x, y from the latest screenshot, optional count), type (text), key (with optional modifiers and count) and wait (ms). Use it to fill a document or canvas quickly, e.g. click after a label, select the placeholder, type, next field, then take one screenshot to check.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["click", "type", "key", "wait"] },
              x: point,
              y: point,
              count: { type: "integer", minimum: 1, maximum: 40 },
              text: { type: "string" },
              key: { type: "string" },
              modifiers: { type: "array", items: { type: "string" } },
              ms: { type: "number" },
            },
            required: ["action"],
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "type_text",
    description:
      "Types text into whatever has keyboard focus in the target window (pasted as one input, so it is instant and keeps accents, CJK and emoji). It replaces the current selection.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "press_key",
    description:
      "Presses a key in the target window: tab, return, escape, up, down, left, right, home, end, pageup, pagedown, delete, space, or a letter/digit, with optional modifiers cmd, shift, alt, ctrl (cmd+a selects all). count repeats it.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        modifiers: { type: "array", items: { type: "string" } },
        count: { type: "integer", minimum: 1, maximum: 40 },
      },
      required: ["key"],
    },
  },
  {
    name: "scroll",
    description:
      "Scrolls at a point of the latest screenshot. Positive dy scrolls down (reveals content below), in pixels.",
    inputSchema: {
      type: "object",
      properties: { x: point, y: point, dy: { type: "number" }, dx: { type: "number" } },
      required: ["dy"],
    },
  },
  {
    name: "search_vault",
    description:
      "Searches every saved detail, login, card and note of the person by words (label or value) when the details in the instructions do not cover a field.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "finish",
    description:
      "Ends the task. Call exactly once, after checking the window: status done (everything fillable is filled), partial, nothing_to_fill or failed, a one-sentence summary in the person's language, the number of fields filled, and what was left empty with the reason.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["done", "partial", "nothing_to_fill", "failed"] },
        summary: { type: "string" },
        filled: { type: "integer", minimum: 0 },
        skipped: {
          type: "array",
          items: {
            type: "object",
            properties: { field: { type: "string" }, reason: { type: "string" } },
            required: ["field", "reason"],
          },
        },
      },
      required: ["status", "summary", "filled"],
    },
  },
];

const text = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

const failure = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** Compact JSON for the agent: drops empty keys and rounds frames. */
export function compactScan(scan: WindowScan): unknown {
  return {
    app: scan.appName,
    window: scan.windowTitle,
    windowFrame: scan.window,
    note: scan.note,
    truncated: scan.truncated || undefined,
    elements: scan.elements.map((e) => {
      const out: Record<string, unknown> = { id: e.id, role: e.role.replace(/^AX/, "") };
      if (e.subrole && e.subrole !== "AXSecureTextField") out.subrole = e.subrole.replace(/^AX/, "");
      if (e.label) out.label = e.label;
      if (e.value) out.value = e.value;
      if (e.placeholder) out.placeholder = e.placeholder;
      if (e.secure) out.secure = true;
      if (e.enabled === false) out.disabled = true;
      if (e.focused) out.focused = true;
      if (e.options?.length) out.options = e.options;
      if (e.frame) {
        out.frame = [e.frame.x, e.frame.y, e.frame.w, e.frame.h].map((n) => Math.round(n));
      }
      return out;
    }),
  };
}

/**
 * Carries out the agent's tool calls against one target window. One session per fill run.
 */
export class FillToolSession {
  private shot: Screenshot | null = null;
  outcome: FillOutcome | null = null;
  calls = 0;

  constructor(
    private readonly bridge: FillBridge,
    private readonly pid: number,
    private readonly vault: VaultDetail[],
    private readonly onProgress: (progress: FillProgress) => void,
  ) {}

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls++;
    try {
      switch (name) {
        case "read_window": {
          this.onProgress({ step: "reading" });
          return text(compactScan(await this.bridge.scan(this.pid)));
        }
        case "fill_fields": {
          const fields = Array.isArray(args.fields) ? (args.fields as Array<{ id: string; value: string }>) : [];
          this.onProgress({ step: "filling", detail: String(fields.length) });
          return text(
            await this.bridge.act(
              this.pid,
              fields.map((f) => ({ op: "fill", id: String(f.id), value: String(f.value ?? "") })),
            ),
          );
        }
        case "select_option":
          this.onProgress({ step: "filling" });
          return text(
            await this.bridge.act(this.pid, [
              { op: "select", id: String(args.id), value: String(args.option ?? "") },
            ]),
          );
        case "press":
          return text(await this.bridge.act(this.pid, [{ op: "press", id: String(args.id) }]));
        case "screenshot": {
          this.onProgress({ step: "looking" });
          const shot = await this.bridge.screenshot(this.pid);
          this.shot = shot;
          return {
            content: [
              { type: "image", data: shot.png.toString("base64"), mimeType: "image/png" },
              {
                type: "text",
                text: `Window screenshot ${shot.width}x${shot.height} px. Use these pixel coordinates for click and scroll.`,
              },
            ],
          };
        }
        case "click": {
          this.onProgress({ step: "filling" });
          const p = this.toScreen(Number(args.x), Number(args.y));
          return text(await this.bridge.act(this.pid, [{ op: "click", x: p.x, y: p.y, count: Number(args.count ?? 1) }]));
        }
        case "screen_steps": {
          const steps = Array.isArray(args.steps) ? (args.steps as Array<Record<string, unknown>>) : [];
          this.onProgress({ step: "filling", detail: String(steps.length) });
          const ops: BridgeOp[] = steps.map((step) => {
            switch (step.action) {
              case "click": {
                const p = this.toScreen(Number(step.x), Number(step.y));
                return { op: "click", x: p.x, y: p.y, count: Number(step.count ?? 1) };
              }
              case "type":
                return { op: "type", value: String(step.text ?? "") };
              case "key":
                return {
                  op: "key",
                  key: String(step.key ?? ""),
                  modifiers: Array.isArray(step.modifiers) ? (step.modifiers as string[]) : [],
                  count: Number(step.count ?? 1),
                };
              default:
                return { op: "wait", dy: Number(step.ms ?? 300) };
            }
          });
          return text(await this.bridge.act(this.pid, ops));
        }
        case "type_text":
          this.onProgress({ step: "filling" });
          return text(await this.bridge.act(this.pid, [{ op: "type", value: String(args.text ?? "") }]));
        case "press_key":
          return text(
            await this.bridge.act(this.pid, [
              {
                op: "key",
                key: String(args.key ?? ""),
                modifiers: Array.isArray(args.modifiers) ? (args.modifiers as string[]) : [],
                count: Number(args.count ?? 1),
              },
            ]),
          );
        case "scroll": {
          const op: BridgeOp = { op: "scroll", dy: Number(args.dy ?? 0), dx: Number(args.dx ?? 0) };
          if (args.x != null && args.y != null) {
            const p = this.toScreen(Number(args.x), Number(args.y));
            op.x = p.x;
            op.y = p.y;
          }
          return text(await this.bridge.act(this.pid, [op]));
        }
        case "search_vault": {
          const words = String(args.query ?? "")
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
          const hits = this.vault
            .filter((item) => {
              const hay = [item.label, item.value, item.profile, item.username, ...(item.uris ?? [])]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
              return words.some((w) => hay.includes(w));
            })
            .slice(0, 40);
          return text(hits.length ? hits : "Nothing saved matches.");
        }
        case "finish": {
          this.outcome = {
            status: (["done", "partial", "nothing_to_fill", "failed"] as const).includes(
              args.status as FillOutcome["status"],
            )
              ? (args.status as FillOutcome["status"])
              : "done",
            summary: String(args.summary ?? ""),
            filled: Number(args.filled ?? 0),
            skipped: Array.isArray(args.skipped) ? (args.skipped as FillOutcome["skipped"]) : [],
          };
          return text("Finished. Stop now.");
        }
        default:
          return failure(`Unknown tool ${name}.`);
      }
    } catch (error) {
      return failure(error instanceof Error ? error.message : String(error));
    }
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const shot = this.shot;
    if (!shot) {
      throw new Error("Take a screenshot first; click and scroll use its pixel coordinates.");
    }
    return { x: shot.origin.x + x * shot.scale, y: shot.origin.y + y * shot.scale };
  }
}
