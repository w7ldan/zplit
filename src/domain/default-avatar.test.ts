import { describe, expect, it } from "vitest";
import { getDefaultAvatarMotif } from "./default-avatar";

describe("default avatar motif", () => {
  it("is stable, bounded, and does not use runtime randomness", () => {
    const first = getDefaultAvatarMotif("user-a");
    expect(first).toEqual(getDefaultAvatarMotif("user-a"));
    expect(first.variant).toBeGreaterThanOrEqual(0);
    expect(first.variant).toBeLessThan(4);
    expect(first.accent).toBeGreaterThanOrEqual(0);
    expect(first.accent).toBeLessThan(4);
    expect(first.split).toBeGreaterThanOrEqual(12);
    expect(first.split).toBeLessThan(52);
  });

  it("can produce different motifs for different IDs", () => {
    expect(getDefaultAvatarMotif("user-a")).not.toEqual(getDefaultAvatarMotif("user-b"));
  });
});
