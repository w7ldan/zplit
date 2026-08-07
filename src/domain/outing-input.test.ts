import { describe, expect, it } from "vitest";
import { validateOutingInput } from "./outing-input";

describe("outing input", () => {
  it("trims values, converts browser local time to UTC, and turns blank notes into null", () => {
    const result = validateOutingInput({
      title: "  Jakarta dinner  ",
      occurredAtLocal: "2026-01-02T10:30",
      timezoneOffsetMinutes: "-480",
      notes: "  Shared notes  ",
    });

    expect(result).toMatchObject({ ok: true, values: { title: "Jakarta dinner", notes: "Shared notes" } });
    if (result.ok) expect(result.value.occurredAt.toISOString()).toBe("2026-01-02T02:30:00.000Z");

    const blankNotes = validateOutingInput({ title: "Dinner", occurredAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "330", notes: " " });
    if (blankNotes.ok) expect(blankNotes.value).toMatchObject({ notes: null, occurredAt: new Date("2026-01-02T16:00:00.000Z") });
  });

  it("rejects invalid local dates and impossible timezone offsets", () => {
    const result = validateOutingInput({ title: "Outing", occurredAtLocal: "2026-02-30T10:30", timezoneOffsetMinutes: "841", notes: "" });

    expect(result).toMatchObject({
      ok: false,
      errors: {
        occurredAtLocal: "Enter a valid date and time.",
        timezoneOffsetMinutes: "Timezone offset must be between -840 and 840 minutes.",
      },
    });
  });

  it("returns field-specific errors for required and length limits", () => {
    const result = validateOutingInput({ title: "x".repeat(161), occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "x".repeat(4001) });

    expect(result).toMatchObject({
      ok: false,
      errors: {
        title: "Title must be 160 characters or fewer.",
        occurredAtLocal: "Date and time is required.",
        timezoneOffsetMinutes: "Timezone offset is required.",
        notes: "Notes must be 4000 characters or fewer.",
      },
    });
  });

  it("keeps Trip optional and rejects an untrusted Trip value", () => {
    const withoutTrip = validateOutingInput({ title: "Dinner", occurredAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", notes: "" });
    expect(withoutTrip).toMatchObject({ ok: true, value: { tripId: null } });
    const invalid = validateOutingInput({ title: "Dinner", occurredAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", notes: "", tripId: "foreign" });
    expect(invalid).toMatchObject({ ok: false, errors: { tripId: "Select a valid trip." }, values: { tripId: "foreign" } });
  });
});
