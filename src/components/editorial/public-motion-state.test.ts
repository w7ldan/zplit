import { describe, expect, it } from "vitest";
import {
  clampPublicLandingIndex,
  firstPublicLandingIndexForSection,
  nearestPublicLandingIndex,
  nextPublicLandingIndex,
  PUBLIC_LANDING_STATES,
  publicLandingAriaCurrent,
  publicLandingStep,
  publicLandingTimelineRatio,
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
    expect(nextPublicLandingIndex(0, 1)).toBe(1);
    expect(nextPublicLandingIndex(1, -1)).toBe(0);
    expect(nextPublicLandingIndex(1, 1)).toBe(2);
    expect(nextPublicLandingIndex(0, -1)).toBe(0);
    expect(nextPublicLandingIndex(PUBLIC_LANDING_STATES.length - 1, 1)).toBe(PUBLIC_LANDING_STATES.length - 1);
    expect(clampPublicLandingIndex(-4)).toBe(0);
    expect(clampPublicLandingIndex(100)).toBe(PUBLIC_LANDING_STATES.length - 1);
  });

  it("reports boundary steps without a state change", () => {
    expect(publicLandingStep(0, -1)).toEqual({ settledIndex: 0, nextIndex: 0, changed: false });
    expect(publicLandingStep(PUBLIC_LANDING_STATES.length - 1, 1)).toEqual({
      settledIndex: PUBLIC_LANDING_STATES.length - 1,
      nextIndex: PUBLIC_LANDING_STATES.length - 1,
      changed: false,
    });
    expect(publicLandingStep(1, -1)).toEqual({ settledIndex: 1, nextIndex: 0, changed: true });
  });

  it("keeps adjacent forward and reverse requests based on the latest settled state", () => {
    const first = publicLandingStep(0, 1);
    const second = publicLandingStep(first.nextIndex, 1);
    const reverse = publicLandingStep(second.nextIndex, -1);

    expect(first.nextIndex).toBe(1);
    expect(second.nextIndex).toBe(2);
    expect(reverse.nextIndex).toBe(1);
  });

  it("uses one ratio for the timeline marker and every node", () => {
    expect(publicLandingTimelineRatio(0, 13)).toBe(0);
    expect(publicLandingTimelineRatio(6, 13)).toBe(0.5);
    expect(publicLandingTimelineRatio(12, 13)).toBe(1);
  });

  it("maps native scroll positions to the nearest landing state", () => {
    expect(nearestPublicLandingIndex(0, [0, 100, 200])).toBe(0);
    expect(nearestPublicLandingIndex(149, [0, 100, 200])).toBe(1);
    expect(nearestPublicLandingIndex(151, [0, 100, 200])).toBe(2);
  });

  it("keeps timeline current semantics meaningful", () => {
    expect(publicLandingAriaCurrent(true)).toBe("step");
    expect(publicLandingAriaCurrent(false)).toBeUndefined();
  });
});
