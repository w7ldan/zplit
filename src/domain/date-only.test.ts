import { describe, expect, it } from "vitest";
import { isValidDateOnly } from "./date-only";

describe("date-only values", () => {
  it.each([
    ["2026-02-28", true],
    ["2026-02-29", false],
    ["2028-02-29", true],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["bad", false],
  ])("validates %s as %s", (value, expected) => {
    expect(isValidDateOnly(value)).toBe(expected);
  });
});
