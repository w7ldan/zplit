import { calculateShareBreakdown, formatPercentageBasisPoints, parsePercentageBasisPoints, type ExpenseShareChargeInput, type ExpenseShareChargeValues, type ExpenseShareInputValues } from "@/domain/expense-share-input";
import { MAX_RUPIAH, parseRupiah } from "@/domain/rupiah";

export type ExpenseSplitFriend = {
  id: string;
  name: string;
  archivedAt: Date | null;
  baseAmount?: number;
  amountOwed?: number;
  expenseShareId?: string;
  remainingAmount?: number;
  settled?: boolean;
};

export type ExpenseSplitChargeDefinition = Omit<ExpenseShareChargeValues, "percentage"> & { percentageBasisPoints: number };

export type ExpenseSplitDraft = {
  friends: ExpenseSplitFriend[];
  amounts: Record<string, string>;
  charges: ExpenseShareChargeValues[];
};

export type ExpenseSplitPrevious = {
  friends: ExpenseSplitFriend[];
  charges: ExpenseSplitChargeDefinition[];
};

export type ExpenseSplitUndo =
  | { kind: "friend"; friend: ExpenseSplitFriend; amountRupiah: string; index: number; targetedCharges: Array<{ index: number; name: string; percentage: string; scope: ExpenseShareChargeValues["scope"] }> }
  | { kind: "charge"; charge: ExpenseShareChargeValues; index: number };

export type ExpenseSplitBreakdown = {
  friendId: string;
  baseAmount: number;
  charges: Array<{ name: string; percentageBasisPoints: number; amount: number }>;
  finalAmount: number;
};

export type ExpenseSplitTotals = {
  breakdowns: ExpenseSplitBreakdown[];
  totalOwed: number;
  ownerPortion: number;
  overAllocated: boolean;
  allocationProgress: number;
};

function initialAmount(friend: ExpenseSplitFriend) {
  return (friend.baseAmount ?? friend.amountOwed)?.toString() ?? "";
}

function copyCharge(charge: ExpenseShareChargeValues): ExpenseShareChargeValues {
  return { name: charge.name, percentage: charge.percentage, scope: charge.scope, friendIds: [...charge.friendIds] };
}

export function createExpenseSplitDraft(friends: ExpenseSplitFriend[], charges: ExpenseSplitChargeDefinition[] = []): ExpenseSplitDraft {
  return {
    friends: [...friends],
    amounts: Object.fromEntries(friends.map((friend) => [friend.id, initialAmount(friend)])),
    charges: charges.map(({ name, percentageBasisPoints, scope, friendIds }) => ({ name, percentage: formatPercentageBasisPoints(percentageBasisPoints), scope, friendIds: [...friendIds] })),
  };
}

export function serializeExpenseSplit(draft: ExpenseSplitDraft): { values: ExpenseShareInputValues; charges: ExpenseShareChargeValues[]; chargesJson: string } {
  const charges = draft.charges.map(copyCharge);
  return {
    values: draft.friends.map((friend) => ({ friendId: friend.id, amountRupiah: draft.amounts[friend.id] ?? "" })),
    charges,
    chargesJson: JSON.stringify(charges),
  };
}

export function expenseSplitDraftKey(draft: ExpenseSplitDraft) {
  return JSON.stringify({
    friends: draft.friends.map((friend) => [friend.id.toLowerCase(), parseRupiah(draft.amounts[friend.id] ?? "") ?? (draft.amounts[friend.id] ?? "").trim()]).sort(([left], [right]) => String(left).localeCompare(String(right))),
    charges: draft.charges.map((charge) => [
      charge.name.trim(),
      parsePercentageBasisPoints(charge.percentage) ?? charge.percentage.trim(),
      charge.scope,
      charge.scope === "selected" ? [...charge.friendIds].map((id) => id.toLowerCase()).sort() : [],
    ]),
  });
}

export function addFriendToSplit(draft: ExpenseSplitDraft, friend: ExpenseSplitFriend): ExpenseSplitDraft {
  if (friend.archivedAt !== null || draft.friends.some((selected) => selected.id === friend.id)) return draft;
  return {
    friends: [...draft.friends, friend],
    amounts: { ...draft.amounts, [friend.id]: "" },
    charges: draft.charges,
  };
}

export function addFriendsToSplit(draft: ExpenseSplitDraft, friends: ExpenseSplitFriend[]) {
  const selectedIds = new Set(draft.friends.map((friend) => friend.id));
  const additions = friends.filter((friend) => friend.archivedAt === null && !selectedIds.has(friend.id));
  if (additions.length === 0) return { draft, addedFriends: [] };
  return {
    draft: {
      friends: [...draft.friends, ...additions],
      amounts: { ...draft.amounts, ...Object.fromEntries(additions.map((friend) => [friend.id, ""])) },
      charges: draft.charges,
    },
    addedFriends: additions,
  };
}

export function updateFriendShare(draft: ExpenseSplitDraft, friendId: string, amountRupiah: string): ExpenseSplitDraft {
  return { ...draft, amounts: { ...draft.amounts, [friendId]: amountRupiah } };
}

export function removeFriendFromSplit(draft: ExpenseSplitDraft, friendId: string): { draft: ExpenseSplitDraft; undo: ExpenseSplitUndo } | null {
  const index = draft.friends.findIndex((friend) => friend.id === friendId);
  const friend = draft.friends[index];
  if (!friend) return null;
  return {
    undo: {
      kind: "friend",
      friend,
      amountRupiah: draft.amounts[friendId] ?? "",
      index,
      targetedCharges: draft.charges.flatMap((charge, chargeIndex) => charge.scope === "selected" && charge.friendIds.includes(friendId)
        ? [{ index: chargeIndex, name: charge.name, percentage: charge.percentage, scope: charge.scope }]
        : []),
    },
    draft: {
      friends: draft.friends.filter((friend) => friend.id !== friendId),
      amounts: Object.fromEntries(Object.entries(draft.amounts).filter(([id]) => id !== friendId)),
      charges: draft.charges.map((charge) => ({ ...charge, friendIds: charge.friendIds.filter((id) => id !== friendId) })),
    },
  };
}

export function restoreFriendToSplit(draft: ExpenseSplitDraft, undo: ExpenseSplitUndo): ExpenseSplitDraft {
  if (undo.kind !== "friend" || draft.friends.some((friend) => friend.id === undo.friend.id)) return draft;
  return {
    friends: [...draft.friends.slice(0, undo.index), undo.friend, ...draft.friends.slice(undo.index)],
    amounts: draft.amounts[undo.friend.id] !== undefined ? draft.amounts : { ...draft.amounts, [undo.friend.id]: undo.amountRupiah },
    charges: draft.charges.map((charge, index) => {
      const targeted = undo.targetedCharges.find((previous) => previous.index === index || (previous.name === charge.name && previous.percentage === charge.percentage && previous.scope === charge.scope));
      if (!targeted || charge.scope !== "selected" || charge.friendIds.includes(undo.friend.id)) return charge;
      return { ...charge, friendIds: [...charge.friendIds, undo.friend.id] };
    }),
  };
}

export function splitExpenseEvenly(draft: ExpenseSplitDraft, expenseAmount: number): ExpenseSplitDraft {
  if (draft.friends.length === 0) return draft;
  const baseAmount = Math.floor(expenseAmount / (draft.friends.length + 1));
  return { ...draft, amounts: Object.fromEntries(draft.friends.map((friend) => [friend.id, String(baseAmount)])) };
}

export function addChargeToSplit(draft: ExpenseSplitDraft): ExpenseSplitDraft {
  return { ...draft, charges: [...draft.charges, { name: "", percentage: "", scope: "all", friendIds: [] }] };
}

export function updateChargeInSplit(draft: ExpenseSplitDraft, index: number, update: Partial<ExpenseShareChargeValues>): ExpenseSplitDraft {
  return { ...draft, charges: draft.charges.map((charge, chargeIndex) => chargeIndex === index ? { ...charge, ...update } : charge) };
}

export function removeChargeFromSplit(draft: ExpenseSplitDraft, index: number): { draft: ExpenseSplitDraft; undo: ExpenseSplitUndo } | null {
  const charge = draft.charges[index];
  if (!charge) return null;
  return {
    draft: { ...draft, charges: draft.charges.filter((_, chargeIndex) => chargeIndex !== index) },
    undo: { kind: "charge", charge: copyCharge(charge), index },
  };
}

function sameCharge(left: ExpenseShareChargeValues, right: ExpenseShareChargeValues) {
  return left.name === right.name && left.percentage === right.percentage && left.scope === right.scope && left.friendIds.join(",") === right.friendIds.join(",");
}

export function restoreChargeToSplit(draft: ExpenseSplitDraft, undo: ExpenseSplitUndo): ExpenseSplitDraft {
  if (undo.kind !== "charge" || draft.charges.some((charge) => sameCharge(charge, undo.charge))) return draft;
  const charges = [...draft.charges];
  charges.splice(Math.min(undo.index, charges.length), 0, copyCharge(undo.charge));
  return { ...draft, charges };
}

export function replaceWithPreviousSplit(draft: ExpenseSplitDraft, previousSplit: ExpenseSplitPrevious | null | undefined): { draft: ExpenseSplitDraft; firstFriendId?: string; message?: string } {
  if (!previousSplit) return { draft };
  const friends = previousSplit.friends.filter((friend, index, all) => friend.archivedAt === null && all.findIndex((candidate) => candidate.id === friend.id) === index);
  if (friends.length === 0) return { draft, message: "No active friends from the previous split are available." };
  const friendIds = new Set(friends.map((friend) => friend.id));
  const charges = previousSplit.charges.flatMap((charge) => {
    const targetIds = charge.scope === "all" ? [] : [...new Set(charge.friendIds.filter((friendId) => friendIds.has(friendId)))];
    return charge.scope === "selected" && targetIds.length === 0 ? [] : [{ name: charge.name, percentage: formatPercentageBasisPoints(charge.percentageBasisPoints), scope: charge.scope, friendIds: targetIds }];
  });
  return {
    draft: { friends, amounts: Object.fromEntries(friends.map((friend) => [friend.id, String(friend.baseAmount)])), charges },
    firstFriendId: friends[0]!.id,
  };
}

function validChargeInputs(charges: ExpenseShareChargeValues[]): ExpenseShareChargeInput[] {
  return charges.flatMap((charge) => {
    const percentageBasisPoints = parsePercentageBasisPoints(charge.percentage);
    return percentageBasisPoints === null ? [] : [{ name: charge.name, percentageBasisPoints, scope: charge.scope, friendIds: charge.friendIds }];
  });
}

export function deriveExpenseSplitTotals(draft: ExpenseSplitDraft, expenseAmount: number): ExpenseSplitTotals {
  const charges = validChargeInputs(draft.charges);
  const breakdowns = draft.friends.map((friend) => {
    const baseAmount = parseRupiah(draft.amounts[friend.id] ?? "") ?? 0;
    try {
      return { friendId: friend.id, ...calculateShareBreakdown(baseAmount, charges, friend.id) };
    } catch {
      return { friendId: friend.id, baseAmount, charges: [], finalAmount: MAX_RUPIAH + 1 };
    }
  });
  const totalOwed = breakdowns.reduce((total, breakdown) => total + breakdown.finalAmount, 0);
  return {
    breakdowns,
    totalOwed,
    overAllocated: totalOwed > expenseAmount,
    ownerPortion: Math.max(expenseAmount - totalOwed, 0),
    allocationProgress: expenseAmount > 0 ? Math.min(Math.max(totalOwed / expenseAmount, 0), 1) : 0,
  };
}
