import { describe, expect, it } from "vitest";
import { validateRepaymentInput } from "./repayment-input";

const friendId = "11111111-1111-4111-8111-111111111111";

describe("repayment input", () => {
  it("normalizes values and converts browser-local time using the offset", () => {
    const result = validateRepaymentInput({
      friendId: `  ${friendId.toUpperCase()}  `,
      amountRupiah: "84.000",
      paidAtLocal: "2026-01-02T10:30",
      timezoneOffsetMinutes: "-480",
      paymentMethod: "  Bank transfer  ",
      notes: "  Received in full  ",
    });

    expect(result).toEqual({
      ok: true,
      values: { friendId, amountRupiah: "84.000", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "-480", paymentMethod: "Bank transfer", notes: "Received in full" },
      value: { friendId, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", notes: "Received in full" },
    });
  });

  it("turns blank optional fields into null", () => {
    const result = validateRepaymentInput({ friendId, amountRupiah: "1", paidAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", paymentMethod: " ", notes: " " });
    expect(result.ok && result.value).toMatchObject({ paymentMethod: null, notes: null });
  });

  it("returns field errors and preserves normalized values", () => {
    const result = validateRepaymentInput({
      friendId: "not-a-uuid",
      amountRupiah: "0",
      paidAtLocal: "2026-02-30T10:30",
      timezoneOffsetMinutes: "841",
      paymentMethod: "x".repeat(41),
      notes: "x".repeat(4001),
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        friendId: "Select a valid friend.",
        amountRupiah: "Amount must be greater than zero.",
        paidAtLocal: "Enter a valid date and time.",
        timezoneOffsetMinutes: "Timezone offset must be between -840 and 840 minutes.",
        paymentMethod: "Payment method must be 40 characters or fewer.",
        notes: "Notes must be 4000 characters or fewer.",
      },
      values: {
        friendId: "not-a-uuid",
        amountRupiah: "0",
        paidAtLocal: "2026-02-30T10:30",
        timezoneOffsetMinutes: "841",
        paymentMethod: "x".repeat(41),
        notes: "x".repeat(4001),
      },
    });
  });
});
