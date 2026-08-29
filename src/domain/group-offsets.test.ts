import { describe, expect, it } from "vitest";
import { allocateGroupOffset, GroupOffsetInputError, normalizeGroupOffsetInput, offsettableAmount } from "./group-offsets";

const second = "22222222-2222-4222-8222-222222222222";

function obligation(id: string, amount: number, paymentAppliedAmount = 0, offsetAppliedAmount = 0) {
  return {
    id,
    authoritativeAt: new Date(`2026-08-${id === "first" ? "01" : "02"}T00:00:00Z`),
    originalAmount: amount,
    paymentAppliedAmount,
    offsetAppliedAmount,
  };
}

describe("Group offset domain", () => {
  it("accepts only a counterparty and rejects malformed input", () => {
    expect(normalizeGroupOffsetInput({ counterpartyParticipantId: second })).toEqual({ counterpartyParticipantId: second });
    expect(() => normalizeGroupOffsetInput({ counterpartyParticipantId: "not-an-id" })).toThrow(GroupOffsetInputError);
  });

  it("calculates capacity after payment and previous offset applications", () => {
    expect(offsettableAmount([
      obligation("first", 100, 30, 20),
      obligation("second", 50),
    ])).toBe(100);
  });

  it("allocates oldest-first and partially fills the last obligation", () => {
    expect(allocateGroupOffset(120, [
      obligation("second", 100),
      obligation("first", 50),
    ])).toEqual([
      { obligationId: "first", amount: 50 },
      { obligationId: "second", amount: 70 },
    ]);
  });

  it("fails when the full stored amount is no longer supportable", () => {
    expect(() => allocateGroupOffset(80, [obligation("first", 70)])).toThrow("unallocatable");
  });
});
