import { describe, expect, it } from "vitest";
import { damp, sampleCameraPath, type CameraCue } from "./landing-camera-path";

const cues: CameraCue[] = [
  { progress: 0, position: [0, 0, 10], target: [0, 0, 0] },
  { progress: 0.5, position: [4, 2, 0], target: [1, 0, -10] },
  { progress: 1, position: [0, 0, -20], target: [0, 0, -30] },
];

describe("landing camera path", () => {
  it("is a pure reversible sample of normalized page state", () => {
    const forward = sampleCameraPath(cues, 0.35);
    sampleCameraPath(cues, 0.9);
    expect(sampleCameraPath(cues, 0.35)).toEqual(forward);
  });

  it("clamps skipped scroll positions to deliberate endpoints", () => {
    expect(sampleCameraPath(cues, -2).position).toEqual([0, 0, 10]);
    expect(sampleCameraPath(cues, 4).position).toEqual([0, 0, -20]);
  });

  it("uses elapsed time for frame-rate-independent smoothing", () => {
    const oneFrame = damp(0, 1, 8, 1 / 60);
    const twoHalfFrames = damp(damp(0, 1, 8, 1 / 120), 1, 8, 1 / 120);
    expect(twoHalfFrames).toBeCloseTo(oneFrame, 10);
  });
});
