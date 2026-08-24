import { describe, expect, it } from "vitest";
import { calculateSearchableComboboxPlacement } from "./searchable-combobox-placement";

describe("calculateSearchableComboboxPlacement", () => {
  it("keeps the full popup below when the clipping boundary has room", () => {
    const placement = calculateSearchableComboboxPlacement(
      { top: 120, right: 320, bottom: 160, left: 120, width: 200 },
      { top: 0, right: 800, bottom: 700, left: 0 },
      260,
    );

    expect(placement).toMatchObject({ direction: "down", top: 164, left: 120, width: 200, maxHeight: 260 });
  });

  it("flips the popup above when below space cannot fit it", () => {
    const placement = calculateSearchableComboboxPlacement(
      { top: 500, right: 320, bottom: 540, left: 120, width: 200 },
      { top: 0, right: 800, bottom: 700, left: 0 },
      260,
    );

    expect(placement).toMatchObject({ direction: "up", top: 236, left: 120, width: 200, maxHeight: 260 });
  });

  it("caps the options region to the larger available side when neither side fits", () => {
    const placement = calculateSearchableComboboxPlacement(
      { top: 170, right: 320, bottom: 210, left: 120, width: 200 },
      { top: 0, right: 800, bottom: 260, left: 0 },
      260,
    );

    expect(placement).toMatchObject({ direction: "up", top: 0, left: 120, width: 200, maxHeight: 166 });
  });

  it("keeps the popup within a narrow clipping boundary", () => {
    expect(calculateSearchableComboboxPlacement(
      { top: 20, right: 400, bottom: 60, left: 320, width: 200 },
      { top: 0, right: 360, bottom: 300, left: 100 },
      80,
    )).toMatchObject({ direction: "down", left: 160, width: 200, maxHeight: 80 });
  });
});
