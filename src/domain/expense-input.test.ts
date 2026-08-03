import { describe, expect, it } from "vitest";
import { validateExpenseInput } from "./expense-input";

const valid = {
  description: "  Dinner  ",
  amountRupiah: "84.000",
  occurredAtLocal: "2026-01-02T10:30",
  timezoneOffsetMinutes: "-480",
  outingId: "11111111-1111-4111-8111-111111111111",
};

describe("expense input", () => {
  it("normalizes rupiah, optional outing, and browser-local time", () => {
    const result = validateExpenseInput(valid);

    expect(result).toMatchObject({ ok: true, values: { description: "Dinner", amountRupiah: "84.000" } });
    if (result.ok) {
      expect(result.value.amount).toBe(84000);
      expect(result.value.outingId).toBe(valid.outingId);
      expect(result.value.occurredAt.toISOString()).toBe("2026-01-02T02:30:00.000Z");
    }

    const withoutOuting = validateExpenseInput({ ...valid, amountRupiah: "84000", outingId: " " });
    if (withoutOuting.ok) expect(withoutOuting.value.outingId).toBeNull();
  });

  it("accepts whole rupiah and rejects malformed monetary values", () => {
    for (const amount of ["84000", "84.000", "1.000.000"]) {
      expect(validateExpenseInput({ ...valid, amountRupiah: amount }).ok).toBe(true);
    }
    for (const amount of ["84.00", "84,000", "+84000", "-84000", "84 000", "84.000.00", "abc"]) {
      expect(validateExpenseInput({ ...valid, amountRupiah: amount })).toMatchObject({ ok: false, errors: { amountRupiah: expect.any(String) } });
    }
    expect(validateExpenseInput({ ...valid, amountRupiah: "0" })).toMatchObject({ ok: false, errors: { amountRupiah: "Amount must be greater than zero." } });
    expect(validateExpenseInput({ ...valid, amountRupiah: "2147483648" })).toMatchObject({ ok: false, errors: { amountRupiah: "Amount is too large." } });
  });

  it("returns field errors for dates, offsets, IDs, and limits", () => {
    const result = validateExpenseInput({
      ...valid,
      description: "x".repeat(201),
      occurredAtLocal: "2026-02-30T10:30",
      timezoneOffsetMinutes: "841",
      outingId: "not-a-uuid",
    });

    expect(result).toMatchObject({
      ok: false,
      errors: {
        description: "Description must be 200 characters or fewer.",
        occurredAtLocal: "Enter a valid date and time.",
        timezoneOffsetMinutes: "Timezone offset must be between -840 and 840 minutes.",
        outingId: "Select a valid outing.",
      },
    });
  });
});
