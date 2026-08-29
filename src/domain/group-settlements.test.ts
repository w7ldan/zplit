import { describe, expect, it } from "vitest";
import {
  allocateGroupSettlement,
  GroupSettlementAllocationError,
  GroupSettlementInputError,
  normalizeGroupSettlementInput,
} from "./group-settlements";

const senderParticipantId = "11111111-1111-4111-8111-111111111111";
const recipientParticipantId = "22222222-2222-4222-8222-222222222222";

describe("Group settlement domain", () => {
  it("allocates oldest obligations first, including partial and progressive applications", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const at = (day: number) => new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`);
    expect(allocateGroupSettlement(100, [
      { id: second, authoritativeAt: at(2), originalAmount: 70, appliedAmount: 0 },
      { id: first, authoritativeAt: at(1), originalAmount: 60, appliedAmount: 0 },
    ])).toEqual([
      { obligationId: first, amount: 60 },
      { obligationId: second, amount: 40 },
    ]);
    expect(allocateGroupSettlement(30, [
      { id: first, authoritativeAt: at(1), originalAmount: 60, appliedAmount: 30 },
    ])).toEqual([{ obligationId: first, amount: 30 }]);
  });

  it("uses the obligation ID as the stable tie-break and rejects over-application", () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const authoritativeAt = new Date("2026-08-01T00:00:00.000Z");
    expect(allocateGroupSettlement(10, [
      { id: second, authoritativeAt, originalAmount: 10, appliedAmount: 0 },
      { id: first, authoritativeAt, originalAmount: 10, appliedAmount: 0 },
    ])).toEqual([{ obligationId: first, amount: 10 }]);
    expect(() => allocateGroupSettlement(11, [
      { id: first, authoritativeAt, originalAmount: 10, appliedAmount: 10 },
    ])).toThrow(GroupSettlementAllocationError);
  });

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
