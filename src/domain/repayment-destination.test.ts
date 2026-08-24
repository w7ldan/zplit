import { describe, expect, it } from "vitest";
import { parseRepaymentDestination, REPAYMENT_DESTINATION_LIMITS } from "./repayment-destination";

describe("repayment destination input", () => {
  it.each(["bank_account", "e_wallet", "other"])("accepts the %s type", (type) => {
    const result = parseRepaymentDestination({ type, name: "  Wise  ", identifier: "  details  ", accountName: "  Ada  ", note: "  pay here  ", shareOnBalanceLinks: "on" });
    expect(result).toMatchObject({ ok: true, value: { type, name: "Wise", identifier: "details", accountName: "Ada", note: "pay here", shareOnBalanceLinks: true } });
  });

  it("allows free-form names and turns blank optional fields into null", () => {
    const result = parseRepaymentDestination({ type: "other", name: "Cash at the cafe", identifier: "Ask the cashier", accountName: " ", note: " " });
    expect(result).toMatchObject({ ok: true, value: { name: "Cash at the cafe", accountName: null, note: null, shareOnBalanceLinks: false } });
  });

  it("requires an identifier and rejects invalid types and bounds", () => {
    const result = parseRepaymentDestination({ type: "paypal", name: "", identifier: "", accountName: "x".repeat(REPAYMENT_DESTINATION_LIMITS.accountName + 1), note: "x".repeat(REPAYMENT_DESTINATION_LIMITS.note + 1) });
    expect(result).toMatchObject({ ok: false, errors: { type: expect.any(String), name: expect.any(String), identifier: expect.any(String), accountName: expect.any(String), note: expect.any(String) } });
  });
});
