import { describe, expect, it } from "vitest";
import { buildGroupObligations, GroupAccountingInputError, normalizeGroupExpenseInput } from "./group-accounting";

const payer = "11111111-1111-4111-8111-111111111111";
const debtor = "22222222-2222-4222-8222-222222222222";
const otherDebtor = "33333333-3333-4333-8333-333333333333";

function input(overrides: Record<string, unknown> = {}) {
  return {
    description: "Dinner",
    occurredAt: "2026-08-27T12:00:00.000Z",
    totalAmount: 100_000,
    payerParticipantId: payer,
    shares: [{ participantId: debtor, amount: 50_000 }, { participantId: payer, amount: 50_000 }],
    ...overrides,
  };
}

describe("Group accounting domain", () => {
  it("accepts exact whole-rupiah allocation and payer-owned shares", () => {
    const values = normalizeGroupExpenseInput(input());
    expect(values.totalAmount).toBe(100_000);
    expect(buildGroupObligations(values.payerParticipantId, values.shares)).toEqual([{ debtorParticipantId: debtor, creditorParticipantId: payer, originalAmount: 50_000 }]);
  });

  it.each([99_999, 100_001])("rejects %s under- or over-allocation", (totalAmount) => {
    expect(() => normalizeGroupExpenseInput(input({ totalAmount }))).toThrow(GroupAccountingInputError);
  });

  it.each([0, -1, 2_147_483_648])("rejects invalid share amount %s", (amount) => {
    expect(() => normalizeGroupExpenseInput(input({ totalAmount: 100_000, shares: [{ participantId: debtor, amount }] }))).toThrow(GroupAccountingInputError);
  });

  it("keeps reciprocal obligations independent instead of netting them", () => {
    expect(buildGroupObligations(payer, [
      { id: "share-a", participantId: debtor, amount: 50 },
      { id: "share-b", participantId: payer, amount: 20 },
      { id: "share-c", participantId: otherDebtor, amount: 30 },
    ])).toEqual([
      { sourceShareId: "share-a", debtorParticipantId: debtor, creditorParticipantId: payer, originalAmount: 50 },
      { sourceShareId: "share-c", debtorParticipantId: otherDebtor, creditorParticipantId: payer, originalAmount: 30 },
    ]);
  });
});
