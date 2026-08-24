import { describe, expect, it } from "vitest";
import {
  addChargeToSplit,
  addFriendToSplit,
  createExpenseSplitDraft,
  deriveExpenseSplitTotals,
  expenseSplitDraftKey,
  removeChargeFromSplit,
  removeFriendFromSplit,
  replaceWithPreviousSplit,
  restoreChargeToSplit,
  restoreFriendToSplit,
  serializeExpenseSplit,
  splitExpenseEvenly,
  updateChargeInSplit,
  updateFriendShare,
  type ExpenseSplitChargeDefinition,
  type ExpenseSplitFriend,
} from "./expense-split-draft";

const friendA: ExpenseSplitFriend = { id: "friend-a", name: "Rani", archivedAt: null, amountOwed: 40000 };
const friendB: ExpenseSplitFriend = { id: "friend-b", name: "Bima", archivedAt: null, amountOwed: 20000 };
const charge: ExpenseSplitChargeDefinition = { name: "Service", percentageBasisPoints: 750, scope: "all", friendIds: [] };

describe("expense split draft", () => {
  it("creates and serializes the existing friend and charge form shape", () => {
    const draft = createExpenseSplitDraft([friendA], [charge]);

    expect(draft.amounts).toEqual({ "friend-a": "40000" });
    expect(serializeExpenseSplit(draft)).toEqual({
      values: [{ friendId: "friend-a", amountRupiah: "40000" }],
      charges: [{ name: "Service", percentage: "7.5", scope: "all", friendIds: [] }],
      chargesJson: '[{"name":"Service","percentage":"7.5","scope":"all","friendIds":[]}]',
    });
  });

  it("adds, edits, removes, and restores friend state and selected charge targets", () => {
    const draft = updateChargeInSplit(
      addChargeToSplit(addFriendToSplit(createExpenseSplitDraft([friendA]), friendB)),
      0,
      { name: "Tip", percentage: "10", scope: "selected", friendIds: [friendB.id] },
    );
    const removed = removeFriendFromSplit(draft, friendB.id);

    expect(removed?.draft).toMatchObject({ friends: [friendA], amounts: { [friendA.id]: "40000" }, charges: [{ friendIds: [] }] });
    expect(removed?.undo.kind).toBe("friend");
    expect(restoreFriendToSplit(removed!.draft, removed!.undo)).toEqual(draft);
  });

  it("keeps equal splits whole-rupiah with the owner remainder", () => {
    const draft = splitExpenseEvenly(createExpenseSplitDraft([friendA, friendB]), 100);

    expect(draft.amounts).toEqual({ "friend-a": "33", "friend-b": "33" });
    expect(deriveExpenseSplitTotals(draft, 100)).toMatchObject({ totalOwed: 66, ownerPortion: 34, overAllocated: false });
  });

  it("preserves named charge arithmetic and selected-target behavior", () => {
    let draft = createExpenseSplitDraft([friendA, friendB], [charge]);
    draft = updateFriendShare(draft, friendA.id, "40000");
    draft = updateFriendShare(draft, friendB.id, "20000");
    draft = updateChargeInSplit(draft, 0, { scope: "selected", friendIds: [friendA.id] });
    const totals = deriveExpenseSplitTotals(draft, 100000);

    expect(totals.breakdowns).toEqual([
      { friendId: friendA.id, baseAmount: 40000, charges: [{ name: "Service", percentageBasisPoints: 750, amount: 3000 }], finalAmount: 43000 },
      { friendId: friendB.id, baseAmount: 20000, charges: [], finalAmount: 20000 },
    ]);
    expect(totals.ownerPortion).toBe(37000);
  });

  it("applies a previous split while dropping archived friends and stale selected targets", () => {
    const previous = replaceWithPreviousSplit(createExpenseSplitDraft([friendA]), {
      friends: [{ ...friendB, baseAmount: 20000 }, { ...friendA, archivedAt: new Date() }, { ...friendB, baseAmount: 20000 }],
      charges: [
        charge,
        { name: "Targeted", percentageBasisPoints: 1000, scope: "selected", friendIds: [friendB.id, "missing"] },
      ],
    });

    expect(previous.firstFriendId).toBe(friendB.id);
    expect(previous.draft).toEqual({
      friends: [{ ...friendB, baseAmount: 20000 }],
      amounts: { [friendB.id]: "20000" },
      charges: [
        { name: "Service", percentage: "7.5", scope: "all", friendIds: [] },
        { name: "Targeted", percentage: "10", scope: "selected", friendIds: [friendB.id] },
      ],
    });
  });

  it("restores a removed charge at its original position without duplication", () => {
    const draft = createExpenseSplitDraft([friendA], [charge, { ...charge, name: "VAT", percentageBasisPoints: 1000 }]);
    const removed = removeChargeFromSplit(draft, 0)!;

    expect(restoreChargeToSplit(removed.draft, removed.undo)).toEqual(draft);
    expect(restoreChargeToSplit(draft, removed.undo)).toBe(draft);
  });

  it("normalizes equivalent draft values for dirty tracking", () => {
    const first = updateFriendShare(createExpenseSplitDraft([{ ...friendA, id: "FRIEND-A", amountOwed: undefined }]), "FRIEND-A", "40.000");
    const second = updateFriendShare(createExpenseSplitDraft([{ ...friendA, id: "friend-a", amountOwed: undefined }]), "friend-a", "40000");

    expect(expenseSplitDraftKey(first)).toBe(expenseSplitDraftKey(second));
  });
});
