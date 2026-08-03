import { describe, expect, it } from "vitest";
import { validateExpenseInput } from "./expense-input";

const valid = {
  description: "  Dinner  ",
  amountRupiah: "84.000",
  outingId: "11111111-1111-4111-8111-111111111111",
};

describe("expense input", () => {
  it("requires an owner-selected outing and normalizes values", () => {
    const result = validateExpenseInput({ ...valid, outingId: valid.outingId.toUpperCase() });

    expect(result).toMatchObject({
      ok: true,
      values: { description: "Dinner", amountRupiah: "84.000", outingId: valid.outingId.toUpperCase() },
    });
    if (result.ok) expect(result.value).toEqual({ description: "Dinner", amount: 84000, outingId: valid.outingId });

    expect(validateExpenseInput({ ...valid, outingId: " " })).toMatchObject({
      ok: false,
      errors: { outingId: "Outing is required." },
    });
  });

  it("accepts whole rupiah and rejects malformed monetary values", () => {
    for (const amount of ["84000", "84.000", "1.000.000"]) {
      expect(validateExpenseInput({ ...valid, amountRupiah: amount }).ok).toBe(true);
    }
    for (const amount of ["84.00", "84,000", "+84000", "-84000", "84 000", "84.000.00", "abc"]) {
      expect(validateExpenseInput({ ...valid, amountRupiah: amount })).toMatchObject({
        ok: false,
        errors: { amountRupiah: expect.any(String) },
      });
    }
    expect(validateExpenseInput({ ...valid, amountRupiah: "0" })).toMatchObject({ ok: false, errors: { amountRupiah: "Amount must be greater than zero." } });
    expect(validateExpenseInput({ ...valid, amountRupiah: "2147483648" })).toMatchObject({ ok: false, errors: { amountRupiah: "Amount is too large." } });
  });

  it("contains no independent date or timezone fields", () => {
    const result = validateExpenseInput({ ...valid, occurredAtLocal: "2026-02-30T10:30", timezoneOffsetMinutes: "841" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ description: "Dinner", amount: 84000, outingId: valid.outingId });
    expect(result.values).not.toHaveProperty("occurredAtLocal");
    expect(result.values).not.toHaveProperty("timezoneOffsetMinutes");
  });
});
