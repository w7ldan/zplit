import { describe, expect, it } from "vitest";
import { validateTripInput } from "./trip-input";

describe("trip input", () => {
  it.each([
    [{ name: "No dates", startsOn: "", endsOn: "", notes: "" }, { startsOn: null, endsOn: null, notes: null }],
    [{ name: "Start only", startsOn: "2026-04-12", endsOn: "", notes: "" }, { startsOn: "2026-04-12", endsOn: null, notes: null }],
    [{ name: "End only", startsOn: "", endsOn: "2026-04-16", notes: "" }, { startsOn: null, endsOn: "2026-04-16", notes: null }],
    [{ name: "Range", startsOn: "2026-04-12", endsOn: "2026-04-16", notes: " Notes " }, { startsOn: "2026-04-12", endsOn: "2026-04-16", notes: "Notes" }],
    [{ name: "Same day", startsOn: "2026-04-12", endsOn: "2026-04-12", notes: "" }, { startsOn: "2026-04-12", endsOn: "2026-04-12", notes: null }],
  ])("accepts valid calendar values", (input, expected) => {
    const result = validateTripInput(input);
    expect(result).toMatchObject({ ok: true, value: { name: input.name, ...expected } });
  });

  it("rejects malformed dates and reversed ranges", () => {
    expect(validateTripInput({ name: "Trip", startsOn: "2026-02-30", endsOn: "2026-04-16", notes: "" })).toMatchObject({ ok: false, errors: { startsOn: "Enter a valid start date." } });
    expect(validateTripInput({ name: "Trip", startsOn: "2026-04-16", endsOn: "2026-04-12", notes: "" })).toMatchObject({ ok: false, errors: { endsOn: "End date must be on or after the start date." } });
  });

  it("preserves submitted values and enforces name and notes limits", () => {
    const result = validateTripInput({ name: "  ", startsOn: "2026-4-2", endsOn: "", notes: "x".repeat(4001) });
    expect(result).toMatchObject({ ok: false, errors: { name: "Name is required.", startsOn: "Enter a valid start date.", notes: "Notes must be 4000 characters or fewer." }, values: { name: "", startsOn: "2026-4-2", notes: "x".repeat(4001) } });
    expect(validateTripInput({ name: "x".repeat(161), startsOn: "", endsOn: "", notes: "" })).toMatchObject({ ok: false, errors: { name: "Name must be 160 characters or fewer." } });
  });
});
