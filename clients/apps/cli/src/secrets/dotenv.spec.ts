import { DotenvError, formatDotenvLine, MAX_DOTENV_BYTES, parseDotenv } from "./dotenv";

const parent = { HOME: "/home/me", TOKEN: "abc", EMPTY: "" };

describe("parseDotenv", () => {
  it("reads NAME=VALUE lines and skips blanks and comments", () => {
    const env = parseDotenv("# header\n\nA=1\n  B = two  \n# end\n");
    expect([...env]).toEqual([
      ["A", "1"],
      ["B", "two"],
    ]);
  });

  it("strips one leading export", () => {
    expect(parseDotenv("export A=1\nexport  B=2").get("B")).toBe("2");
  });

  it("treats an unquoted # as the start of a comment", () => {
    expect(parseDotenv("A=value # note").get("A")).toBe("value");
    expect(parseDotenv("A=va#lue").get("A")).toBe("va");
  });

  it("keeps quoted whitespace and # inside quotes", () => {
    const env = parseDotenv(`A="  spaced # not a comment  "\nB='  single  '`);
    expect(env.get("A")).toBe("  spaced # not a comment  ");
    expect(env.get("B")).toBe("  single  ");
  });

  it("allows a comment after a closing quote and rejects other text", () => {
    expect(parseDotenv(`A="x" # note`).get("A")).toBe("x");
    expect(() => parseDotenv(`A="x" y`)).toThrow(DotenvError);
  });

  it("reads empty values as empty strings", () => {
    const env = parseDotenv("A=\nB=''\nC=\"\"");
    expect([...env.values()]).toEqual(["", "", ""]);
  });

  it("expands $VAR and ${VAR} from the parent, but not inside single quotes", () => {
    const env = parseDotenv(
      `A=$HOME/x\nB="\${TOKEN}-y"\nC='$HOME'\nD=$MISSING.\nE=$ alone`,
      parent,
    );
    expect(env.get("A")).toBe("/home/me/x");
    expect(env.get("B")).toBe("abc-y");
    expect(env.get("C")).toBe("$HOME");
    expect(env.get("D")).toBe(".");
    expect(env.get("E")).toBe("$ alone");
  });

  it("expands before a reference is tested, so a reference can be built from a variable", () => {
    const env = parseDotenv("K=@vk:${ITEM}/key.value", { ITEM: "abc-123" });
    expect(env.get("K")).toBe("@vk:abc-123/key.value");
  });

  it("handles backslash escapes in double quotes and unquoted values", () => {
    const env = parseDotenv('A="line1\\nline2 \\"q\\" \\$HOME"\nB=a\\#b\\$C');
    expect(env.get("A")).toBe('line1\nline2 "q" $HOME');
    expect(env.get("B")).toBe("a#b$C");
  });

  it("reads a quoted value that spans lines", () => {
    const env = parseDotenv('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1');
    expect(env.get("KEY")).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(env.get("NEXT")).toBe("1");
  });

  it("rejects an empty name, a missing =, and an unterminated quote with the line", () => {
    expect(() => parseDotenv("=x")).toThrow("line 1: the variable name is empty");
    expect(() => parseDotenv("A=1\njust text")).toThrow("line 2: expected NAME=VALUE");
    expect(() => parseDotenv('A="never closed')).toThrow("unterminated double quote");
    expect(() => parseDotenv("A='never closed")).toThrow("unterminated single quote");
  });

  it("rejects NUL in a name or a value", () => {
    expect(() => parseDotenv("A\0B=1")).toThrow("NUL");
    expect(() => parseDotenv("A=x\0y")).toThrow("NUL");
  });

  it("rejects a file larger than 1 MiB", () => {
    expect(() => parseDotenv("A=" + "x".repeat(MAX_DOTENV_BYTES))).toThrow("larger than 1 MiB");
  });

  it("lets a later duplicate win within one file", () => {
    expect(parseDotenv("A=1\nA=2").get("A")).toBe("2");
  });

  it("ignores a managed-file ownership comment", () => {
    expect(parseDotenv("# Vowkey managed: 5d0c\nA=1").size).toBe(1);
  });
});

describe("formatDotenvLine", () => {
  it.each([
    "plain",
    "has space",
    'has "quote"',
    "has#hash",
    "multi\nline",
    "$DOLLAR and \\ backslash",
    "",
    "tab\there",
  ])("writes %j so that it reads back the same", (value) => {
    const line = formatDotenvLine("NAME", value);
    expect(parseDotenv(line, { DOLLAR: "should-not-expand" }).get("NAME")).toBe(value);
  });

  it("leaves a plain value unquoted", () => {
    expect(formatDotenvLine("A", "sk-abc_123")).toBe("A=sk-abc_123");
  });
});
