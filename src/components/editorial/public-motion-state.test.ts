import { describe, expect, it } from "vitest";
import {
  clampPublicLandingIndex,
  firstPublicLandingIndexForSection,
  nextPublicLandingIndex,
  PUBLIC_LANDING_STATES,
} from "./public-motion-state";

describe("public landing motion states", () => {
  it("keeps the landing sequence ordered and anchored by scene", () => {
    expect(PUBLIC_LANDING_STATES.map((state) => `${state.scene}:${state.step}`)).toEqual([
      "hero:0",
      "record-flow:0",
      "record-flow:1",
      "record-flow:2",
      "record-flow:3",
      "contexts:0",
      "contexts:1",
      "contexts:2",
      "collaboration:0",
      "proof:0",
      "records:0",
      "records:1",
      "finale:0",
    ]);
    expect(firstPublicLandingIndexForSection("record-flow")).toBe(1);
    expect(firstPublicLandingIndexForSection("records")).toBe(10);
  });

  it("advances exactly one state and clamps at the sequence edges", () => {
    expect(nextPublicLandingIndex(1, 1)).toBe(2);
    expect(nextPublicLandingIndex(1, -1)).toBe(0);
    expect(nextPublicLandingIndex(0, -1)).toBe(0);
    expect(nextPublicLandingIndex(PUBLIC_LANDING_STATES.length - 1, 1)).toBe(PUBLIC_LANDING_STATES.length - 1);
    expect(clampPublicLandingIndex(-4)).toBe(0);
    expect(clampPublicLandingIndex(100)).toBe(PUBLIC_LANDING_STATES.length - 1);
  });
});
