import { sendFillOutcome, sendUsageCount } from "./usage-counts";

describe("usage counts", () => {
  it("sends nothing while the switch is off", () => {
    const post = jest.fn();
    sendUsageCount(false, { event: "page_view", surface: "web", os: "macos", locale: "ja", page: "vault" }, post);
    sendFillOutcome(false, "extension", { filled: 3, close: 1, left: 2 }, post);
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the allowlisted fields, and a fill outcome as three numbers", () => {
    const post = jest.fn();
    sendFillOutcome(true, "desktop", { filled: 18, close: 2, left: 1 }, post);
    expect(JSON.parse(post.mock.calls[0][0])).toEqual({
      event: "fill_outcome",
      surface: "desktop",
      os: "",
      locale: "",
      page: "18:2:1",
      count: 1,
    });
  });
});
