import { SAMPLE_SCENARIO_LIST } from "@vowkey/common/vault/profile/sample-walkthrough";

import {
  handTypingPlan,
  readOnboarding,
  typingFrames,
  writeOnboarding,
} from "./vowkey-onboarding.component";

/** A frame shorter than the one before it is a backspace. */
function backspaces(frames: string[]): number {
  return frames.filter((frame, i) => i > 0 && frame.length < frames[i - 1].length).length;
}

describe("onboarding progress", () => {
  beforeEach(() => localStorage.clear());

  it("is absent on a first launch and round-trips the step it stopped on", () => {
    expect(readOnboarding()).toBeNull();
    writeOnboarding({ step: "permissions", done: false });
    expect(readOnboarding()).toEqual({ step: "permissions", done: false });
  });

  it("starts again when the saved record is unreadable or names an unknown step", () => {
    localStorage.setItem("vk.onboarding", "{not json");
    expect(readOnboarding()).toBeNull();
    localStorage.setItem("vk.onboarding", JSON.stringify({ step: "billing", done: true }));
    expect(readOnboarding()).toBeNull();
  });
});

describe("hand typing in the demo", () => {
  it("ends every field on its exact value and fixes a typo with two backspaces", () => {
    const frames = typingFrames("23/04/1956", true);
    expect(frames.at(-1)).toBe("23/04/1956");
    expect(backspaces(frames)).toBe(2);
    expect(frames).toContain("23/40");
    expect(backspaces(typingFrames("23/04/1956", false))).toBe(0);
  });

  it.each(SAMPLE_SCENARIO_LIST.map((spec) => [spec.id, spec] as const))(
    "makes exactly the two typos the %s verdict promises",
    (_id, spec) => {
      const plan = handTypingPlan(spec.fields.map((f) => f.practiceFillValue));
      expect(plan.map((frames) => frames.at(-1))).toEqual(
        spec.fields.slice(0, 3).map((f) => f.practiceFillValue),
      );
      expect(plan.reduce((sum, frames) => sum + backspaces(frames) / 2, 0)).toBe(2);
    },
  );
});
