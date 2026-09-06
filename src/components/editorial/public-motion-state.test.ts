import { describe, expect, it } from "vitest";
import {
  clampPublicLandingIndex,
  firstPublicLandingIndexForSection,
  mobileLandingSnapPoints,
  mobileLandingStateMap,
  mobileLandingStateY,
  nearestPublicLandingIndex,
  nextPublicLandingIndex,
  PUBLIC_LANDING_STATES,
  publicLandingAriaCurrent,
  publicLandingStep,
  publicLandingTimelineRatio,
  publicRecordLifecycleState,
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
      "records:2",
      "finale:0",
    ]);
    expect(firstPublicLandingIndexForSection("record-flow")).toBe(1);
    expect(firstPublicLandingIndexForSection("records")).toBe(10);
  });

  it("maps the records scene to one dominant representation", () => {
    expect([0, 1, 2].map(publicRecordLifecycleState)).toEqual(["owner", "share", "history"]);
    expect(publicRecordLifecycleState(3)).toBe("owner");
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

  it("maps every global state to its normalized mobile scene position", () => {
    const points = mobileLandingStateMap();
    expect(points.filter((point) => point.scene === "record-flow").map((point) => point.localProgress)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(points.filter((point) => point.scene === "contexts").map((point) => point.localProgress)).toEqual([0, 0.5, 1]);
    expect(points.filter((point) => point.scene === "records").map((point) => point.localProgress)).toEqual([0, 0.5, 1]);
    expect(points[0]).toMatchObject({ stateIndex: 0, scene: "hero", step: 0, localProgress: 0 });
  });

  it("builds exact local snap points and derives state positions from scene geometry", () => {
    expect(mobileLandingSnapPoints(4)).toEqual([0, 1 / 3, 2 / 3, 1]);
    expect(mobileLandingSnapPoints(1)).toEqual([0]);
    expect(mobileLandingStateY(240, 480, 1 / 3)).toBe(400);
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
