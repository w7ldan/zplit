import { describe, expect, it } from "vitest";
import { GroupSettlementInputError, normalizeGroupSettlementInput } from "./group-settlements";

const senderParticipantId = "11111111-1111-4111-8111-111111111111";
const recipientParticipantId = "22222222-2222-4222-8222-222222222222";

describe("Group settlement domain", () => {
  it("normalizes whole-rupiah amounts and existing payment methods", () => {
    expect(normalizeGroupSettlementInput({
      senderParticipantId: senderParticipantId.toUpperCase(),
      recipientParticipantId,
      amount: "84.000",
      paymentMethodChoice: "GoPay",
      paymentMethodOther: "ignored",
    })).toEqual({ senderParticipantId, recipientParticipantId, amount: 84_000, paymentMethod: "GoPay" });
  });

  it("accepts the existing custom payment method vocabulary", () => {
    expect(normalizeGroupSettlementInput({ senderParticipantId, recipientParticipantId, amount: 1, paymentMethodChoice: "Other", paymentMethodOther: "Wallet" }).paymentMethod).toBe("Wallet");
  });

  it.each([
    [senderParticipantId, senderParticipantId, 1, "Cash"],
    [senderParticipantId, recipientParticipantId, 0, "Cash"],
    [senderParticipantId, recipientParticipantId, 1, ""],
  ])("rejects invalid settlement input", (sender, recipient, amount, paymentMethod) => {
    expect(() => normalizeGroupSettlementInput({ senderParticipantId: sender, recipientParticipantId: recipient, amount, paymentMethod })).toThrow(GroupSettlementInputError);
  });
});
