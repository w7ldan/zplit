"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpenseShareActionState } from "@/app/app/expenses/actions";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import {
  addChargeToSplit,
  addFriendToSplit,
  addFriendsToSplit,
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
  type ExpenseSplitDraft,
  type ExpenseSplitFriend,
  type ExpenseSplitPrevious,
  type ExpenseSplitUndo,
} from "./expense-split-draft";

type UseExpenseSplitDraftOptions = {
  initialDraft: ExpenseSplitDraft;
  initialFriendOptions?: SearchableOption[];
  actionState: ExpenseShareActionState;
  expenseAmount: number;
  previousSplit?: ExpenseSplitPrevious | null;
};

function friendFromOption(option: SearchableOption): ExpenseSplitFriend {
  return { id: option.id, name: option.label, archivedAt: null };
}

export function useExpenseSplitDraft({ initialDraft, initialFriendOptions = [], actionState, expenseAmount, previousSplit }: UseExpenseSplitDraftOptions) {
  const [draft, setDraft] = useState(initialDraft);
  const [undoRemoval, setUndoRemoval] = useState<ExpenseSplitUndo | null>(null);
  const [previousSplitMessage, setPreviousSplitMessage] = useState("");
  const [initialDraftKey] = useState(() => expenseSplitDraftKey(initialDraft));
  const previousStateRef = useRef(actionState);
  const friendLookupRef = useRef(new Map<string, ExpenseSplitFriend>([
    ...initialDraft.friends.map((friend) => [friend.id, friend] as const),
    ...initialFriendOptions.map((option) => [option.id, friendFromOption(option)] as const),
  ]));

  useEffect(() => {
    if (previousStateRef.current === actionState) return;
    previousStateRef.current = actionState;
    const friends = actionState.values.map((value) => friendLookupRef.current.get(value.friendId) ?? { id: value.friendId, name: value.friendId, archivedAt: null });
    setDraft({
      friends,
      amounts: Object.fromEntries(actionState.values.map((value) => [value.friendId, value.amountRupiah])),
      charges: actionState.charges ?? [],
    });
    if (!actionState.formError && Object.keys(actionState.fieldErrors).length === 0) setUndoRemoval(null);
  }, [actionState]);

  const addFriend = useCallback((option: SearchableOption) => {
    if (option.archived) return null;
    const friend = friendFromOption(option);
    const nextDraft = addFriendToSplit(draft, friend);
    if (nextDraft === draft) return null;
    friendLookupRef.current.set(friend.id, friend);
    setDraft(nextDraft);
    return friend.id;
  }, [draft]);

  const addFriends = useCallback((options: SearchableOption[]) => {
    const friends = options.filter((option) => !option.archived).map(friendFromOption);
    const result = addFriendsToSplit(draft, friends);
    if (result.addedFriends.length === 0) return null;
    result.addedFriends.forEach((friend) => friendLookupRef.current.set(friend.id, friend));
    setDraft(result.draft);
    return result.addedFriends[0]!.id;
  }, [draft]);

  const updateFriendAmount = useCallback((friendId: string, amountRupiah: string) => {
    setDraft((current) => updateFriendShare(current, friendId, amountRupiah));
  }, []);

  const removeFriend = useCallback((friendId: string) => {
    const result = removeFriendFromSplit(draft, friendId);
    if (!result) return;
    setUndoRemoval(result.undo);
    setDraft(result.draft);
  }, [draft]);

  const splitEvenly = useCallback(() => {
    setDraft((current) => splitExpenseEvenly(current, expenseAmount));
  }, [expenseAmount]);

  const applyPreviousSplit = useCallback(() => {
    const result = replaceWithPreviousSplit(draft, previousSplit);
    if (result.message) {
      setPreviousSplitMessage(result.message);
      return null;
    }
    if (result.draft === draft) return null;
    result.draft.friends.forEach((friend) => friendLookupRef.current.set(friend.id, friend));
    setDraft(result.draft);
    setPreviousSplitMessage("");
    return result.firstFriendId ?? null;
  }, [draft, previousSplit]);

  const addCharge = useCallback(() => {
    setDraft((current) => addChargeToSplit(current));
  }, []);

  const updateCharge = useCallback((index: number, update: Parameters<typeof updateChargeInSplit>[2]) => {
    setDraft((current) => updateChargeInSplit(current, index, update));
  }, []);

  const removeCharge = useCallback((index: number) => {
    const result = removeChargeFromSplit(draft, index);
    if (!result) return;
    setUndoRemoval(result.undo);
    setDraft(result.draft);
  }, [draft]);

  const undoLastRemoval = useCallback(() => {
    const operation = undoRemoval;
    if (!operation) return;
    setUndoRemoval(null);
    if (operation.kind === "friend" && !friendLookupRef.current.has(operation.friend.id)) return;
    setDraft((current) => operation.kind === "friend" ? restoreFriendToSplit(current, operation) : restoreChargeToSplit(current, operation));
  }, [undoRemoval]);

  const selectedIds = useMemo(() => new Set(draft.friends.map((friend) => friend.id)), [draft.friends]);
  const totals = useMemo(() => deriveExpenseSplitTotals(draft, expenseAmount), [draft, expenseAmount]);
  const serializedDraft = useMemo(() => serializeExpenseSplit(draft), [draft]);

  return {
    selectedFriends: draft.friends,
    draftAmounts: draft.amounts,
    draftCharges: draft.charges,
    selectedIds,
    undoRemoval,
    previousSplitMessage,
    isDirty: expenseSplitDraftKey(draft) !== initialDraftKey,
    breakdowns: totals.breakdowns,
    totalOwed: totals.totalOwed,
    ownerPortion: totals.ownerPortion,
    overAllocated: totals.overAllocated,
    allocationProgress: totals.allocationProgress,
    serializedDraft,
    addFriend,
    addFriends,
    updateFriendAmount,
    removeFriend,
    splitEvenly,
    applyPreviousSplit,
    addCharge,
    updateCharge,
    removeCharge,
    undoLastRemoval,
  };
}
