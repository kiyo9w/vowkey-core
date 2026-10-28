import { ReferenceError } from "./references";
import { resolveRunEnvironment, RunEnvironmentError } from "./run-environment";

const values: Record<string, string> = {
  "k1/key.value": "sk-from-key-one",
  "k2/key.value": "sk-from-key-two",
};
const resolve = jest.fn(async ({ itemId, fieldPath }: { itemId: string; fieldPath: string }) => {
  const value = values[`${itemId}/${fieldPath}`];
  if (value == null) {
    throw new ReferenceError("not-found", "not-found");
  }
  return value;
});

beforeEach(() => resolve.mockClear());

describe("resolveRunEnvironment", () => {
  it("overlays the parent, then the files in order, then the environments in order", async () => {
    const { env } = await resolveRunEnvironment({
      parentEnv: { A: "parent", B: "parent", C: "parent", PATH: "/bin" },
      envFileTexts: ["A=file1\nB=file1", "B=file2"],
      environments: [[{ name: "C", itemId: "k1" }], [{ name: "C", itemId: "k2" }]],
      resolve,
    });
    expect(env).toEqual({ A: "file1", B: "file2", C: "sk-from-key-two", PATH: "/bin" });
  });

  it("lets an environment overlay a file of the same name, and a file overlay the parent", async () => {
    const { env } = await resolveRunEnvironment({
      parentEnv: { OPENAI_API_KEY: "literal-parent" },
      envFileTexts: ["OPENAI_API_KEY=@vk:k1/key.value"],
      environments: [[{ name: "OPENAI_API_KEY", itemId: "k2" }]],
      resolve,
    });
    expect(env.OPENAI_API_KEY).toBe("sk-from-key-two");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("resolves a reference from a file and hands the child the value, not the reference", async () => {
    const { env, secrets } = await resolveRunEnvironment({
      parentEnv: {},
      envFileTexts: ["TOKEN=@vk:k1/key.value\nPLAIN=hello"],
      environments: [],
      resolve,
    });
    expect(env).toEqual({ TOKEN: "sk-from-key-one", PLAIN: "hello" });
    expect(secrets).toEqual(["sk-from-key-one"]);
  });

  it("does not resolve a reference that something overrode", async () => {
    await expect(
      resolveRunEnvironment({
        parentEnv: { STALE: "@vk:missing/key.value" },
        envFileTexts: ["STALE=now-literal"],
        environments: [],
        resolve,
      }),
    ).resolves.toMatchObject({ env: { STALE: "now-literal" } });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves a reference the parent shell carries", async () => {
    const { env } = await resolveRunEnvironment({
      parentEnv: { FROM_SHELL: "@vk:k1/key.value" },
      envFileTexts: [],
      environments: [],
      resolve,
    });
    expect(env.FROM_SHELL).toBe("sk-from-key-one");
  });

  it("strips the vault's own authentication variables from every source", async () => {
    const { env } = await resolveRunEnvironment({
      parentEnv: { VOWKEY_SESSION: "s", VOWKEY_PASSWORD: "p", KEEP: "1" },
      envFileTexts: ["VOWKEY_CLIENTSECRET=x\nVOWKEY_DECISION_KEY=y"],
      environments: [],
      resolve,
    });
    expect(Object.keys(env)).toEqual(["KEEP"]);
  });

  it("expands $VAR in a file from the sanitized parent only", async () => {
    const { env } = await resolveRunEnvironment({
      parentEnv: { HOME: "/home/me", VOWKEY_SESSION: "secret-session" },
      envFileTexts: ["A=$HOME/x\nB=$VOWKEY_SESSION"],
      environments: [],
      resolve,
    });
    expect(env.A).toBe("/home/me/x");
    expect(env.B).toBe("");
  });

  it("fails before anything runs, naming the variable and the reference, for every bad one", async () => {
    const promise = resolveRunEnvironment({
      parentEnv: {},
      envFileTexts: ["A=@vk:gone/key.value\nB=@vk:k1/key.value\nC=@vk:alsogone/notes"],
      environments: [],
      resolve,
    });
    await expect(promise).rejects.toBeInstanceOf(RunEnvironmentError);
    await expect(promise).rejects.toThrow("A: @vk:gone/key.value does not resolve (not-found)");
    await expect(promise).rejects.toThrow("C: @vk:alsogone/notes does not resolve (not-found)");
  });

  it("keeps the secret out of a failure message", async () => {
    const failing = jest.fn(async () => {
      throw new Error("decrypt failed for sk-from-key-one");
    });
    await expect(
      resolveRunEnvironment({
        parentEnv: {},
        envFileTexts: ["A=@vk:k1/key.value"],
        environments: [],
        resolve: failing,
      }),
    ).rejects.toThrow(/\(unavailable\)$/);
  });

  it("rejects an environment member with an invalid name", async () => {
    await expect(
      resolveRunEnvironment({
        parentEnv: {},
        envFileTexts: [],
        environments: [[{ name: "BAD=NAME", itemId: "k1" }]],
        resolve,
      }),
    ).rejects.toThrow("variable name");
  });
});
