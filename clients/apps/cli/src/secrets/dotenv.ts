/** Largest dotenv file `vowkey run` reads. */
export const MAX_DOTENV_BYTES = 1024 * 1024;

export class DotenvError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(line == null ? message : `line ${line}: ${message}`);
    this.name = "DotenvError";
  }
}

export function assertValidName(name: string, line?: number) {
  if (name === "") {
    throw new DotenvError("the variable name is empty", line);
  }
  if (name.includes("=") || name.includes("\0")) {
    throw new DotenvError("the variable name contains = or NUL", line);
  }
}

/**
 * Parses dotenv text the way `op run` reads it: `KEY=VALUE` lines, `#` comments, an optional
 * leading `export `, single quotes that keep everything literal, double quotes with backslash
 * escapes that may span lines, and `$VAR` / `${VAR}` expansion from `parentEnv` everywhere but
 * inside single quotes.
 *
 * Values keep their `@vk:` references unresolved; expansion happens here, so a reference built
 * from a variable is complete before it is tested.
 */
export function parseDotenv(
  text: string,
  parentEnv: Record<string, string | undefined> = {},
): Map<string, string> {
  if (Buffer.byteLength(text, "utf8") > MAX_DOTENV_BYTES) {
    throw new DotenvError("the file is larger than 1 MiB");
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const result = new Map<string, string>();
  const n = text.length;
  let i = 0;
  let line = 1;

  const expand = (name: string): string => parentEnv[name] ?? "";

  const readDollar = (): string | null => {
    // text[i] === "$"
    if (text[i + 1] === "{") {
      const end = text.indexOf("}", i + 2);
      if (end === -1) {
        throw new DotenvError("unterminated ${", line);
      }
      const name = text.slice(i + 2, end);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new DotenvError("invalid variable name in ${}", line);
      }
      i = end + 1;
      return expand(name);
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i + 1));
    if (match == null) {
      return null;
    }
    i += 1 + match[0].length;
    return expand(match[0]);
  };

  const skipInlineSpace = () => {
    while (i < n && (text[i] === " " || text[i] === "\t")) {
      i++;
    }
  };

  const skipToEndOfLine = () => {
    while (i < n && text[i] !== "\n") {
      i++;
    }
  };

  while (i < n) {
    skipInlineSpace();
    if (i >= n) {
      break;
    }
    if (text[i] === "\n") {
      i++;
      line++;
      continue;
    }
    if (text[i] === "\r") {
      i++;
      continue;
    }
    if (text[i] === "#") {
      skipToEndOfLine();
      continue;
    }

    const startLine = line;
    if (text.startsWith("export", i) && (text[i + 6] === " " || text[i + 6] === "\t")) {
      i += 6;
      skipInlineSpace();
    }

    const eq = text.indexOf("=", i);
    const eol = text.indexOf("\n", i);
    if (eq === -1 || (eol !== -1 && eol < eq)) {
      throw new DotenvError("expected NAME=VALUE", startLine);
    }
    const name = text.slice(i, eq).trim();
    assertValidName(name, startLine);
    i = eq + 1;
    skipInlineSpace();

    let value = "";
    const quote = text[i];
    if (quote === "'") {
      i++;
      const close = text.indexOf("'", i);
      if (close === -1) {
        throw new DotenvError("unterminated single quote", startLine);
      }
      value = text.slice(i, close);
      line += (value.match(/\n/g) ?? []).length;
      i = close + 1;
      skipInlineSpace();
      if (i < n && text[i] !== "\n" && text[i] !== "\r" && text[i] !== "#") {
        throw new DotenvError("unexpected text after the closing quote", startLine);
      }
      skipToEndOfLine();
    } else if (quote === '"') {
      i++;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === "\\") {
          const next = text[i + 1];
          i += 2;
          switch (next) {
            case "n":
              value += "\n";
              break;
            case "r":
              value += "\r";
              break;
            case "t":
              value += "\t";
              break;
            case undefined:
              value += "\\";
              break;
            case "\\":
            case '"':
            case "$":
            case "`":
            case "'":
            case " ":
              value += next;
              break;
            default:
              value += "\\" + next;
              if (next === "\n") {
                line++;
              }
          }
          continue;
        }
        if (c === '"') {
          i++;
          closed = true;
          break;
        }
        if (c === "$") {
          const expanded = readDollar();
          if (expanded != null) {
            value += expanded;
            continue;
          }
        }
        if (c === "\n") {
          line++;
        }
        value += c;
        i++;
      }
      if (!closed) {
        throw new DotenvError("unterminated double quote", startLine);
      }
      skipInlineSpace();
      if (i < n && text[i] !== "\n" && text[i] !== "\r" && text[i] !== "#") {
        throw new DotenvError("unexpected text after the closing quote", startLine);
      }
      skipToEndOfLine();
    } else {
      while (i < n && text[i] !== "\n" && text[i] !== "\r" && text[i] !== "#") {
        const c = text[i];
        if (c === "\\" && i + 1 < n) {
          const next = text[i + 1];
          if ("\\#$\"' ".includes(next)) {
            value += next;
            i += 2;
            continue;
          }
          value += c;
          i++;
          continue;
        }
        if (c === "$") {
          const expanded = readDollar();
          if (expanded != null) {
            value += expanded;
            continue;
          }
        }
        value += c;
        i++;
      }
      value = value.replace(/[ \t]+$/, "");
      skipToEndOfLine();
    }

    if (value.includes("\0")) {
      throw new DotenvError("the value contains NUL", startLine);
    }
    result.set(name, value);
  }

  return result;
}

/** Writes one `NAME=value` line, quoting a value the parser above would otherwise misread. */
export function formatDotenvLine(name: string, value: string): string {
  assertValidName(name);
  if (value.includes("\0")) {
    throw new DotenvError("the value contains NUL");
  }
  const needsQuotes = /[#\s"'$\\`]/.test(value) || value === "";
  if (!needsQuotes) {
    return `${name}=${value}`;
  }
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `${name}="${escaped}"`;
}
