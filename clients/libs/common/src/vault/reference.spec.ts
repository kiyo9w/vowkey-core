import { formatEnvironmentReference } from "./reference";

describe("formatEnvironmentReference", () => {
  it("copies the variable name and the key reference, never the value", () => {
    expect(formatEnvironmentReference("OPENAI_API_KEY", "key-uuid")).toBe(
      "OPENAI_API_KEY=@vk:key-uuid/key.value",
    );
  });
});
