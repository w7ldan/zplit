import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RepaymentActionState, RepaymentFriendContext } from "@/app/app/repayments/actions";
import type { SearchableOption } from "@/components/records/searchable-combobox";
import type { OpenExpenseShare } from "@/domain/ledger-repository";
import type { RepaymentInputValues } from "@/domain/repayment-input";
import { formatRupiah } from "@/domain/rupiah";
import type { RepaymentAllocationStrategy } from "@/domain/repayment-allocation-strategy";
import {
  addRepaymentAllocation,
  applyRepaymentAllocationStrategy,
  createRepaymentAllocationDraft,
  deriveRepaymentAllocationTotals,
  removeRepaymentAllocation,
  serializeRepaymentAllocations,
  updateRepaymentAllocationDraft,
  type RepaymentAllocationDraftState,
} from "./repayment-allocation-draft";

type AmountInputRef = { current: HTMLInputElement | null };

type UseRepaymentAllocationDraftOptions = {
  actionState: RepaymentActionState;
  amountRef: AmountInputRef;
  friendOptions: SearchableOption[];
  initialAllocationIds: string[];
  initialAllocationStrategy: RepaymentAllocationStrategy;
  initialFriendContext?: RepaymentFriendContext;
  initialValues: RepaymentInputValues;
  loadFriendContext?: (friendId: string, includeOpenExpenseShares?: boolean, tripId?: string) => Promise<RepaymentFriendContext>;
  mode: "create" | "edit";
  openExpenseSharesByFriend: Record<string, OpenExpenseShare[]>;
  outstandingByFriend: Record<string, number>;
  tripContextId?: string;
};

const emptyOpenExpenseShares: OpenExpenseShare[] = [];

export function useRepaymentAllocationDraft({
  actionState,
  amountRef,
  friendOptions,
  initialAllocationIds,
  initialAllocationStrategy,
  initialFriendContext,
  initialValues,
  loadFriendContext,
  mode,
  openExpenseSharesByFriend,
  outstandingByFriend,
  tripContextId,
}: UseRepaymentAllocationDraftOptions) {
  const [selectedFriendId, setSelectedFriendId] = useState(initialValues.friendId || friendOptions[0]?.id || "");
  const [selectedFriend, setSelectedFriend] = useState<SearchableOption | undefined>(() => friendOptions.find((friend) => friend.id === initialValues.friendId) ?? friendOptions[0]);
  const [friendContext, setFriendContext] = useState(initialFriendContext);
  const [loadingFriendContext, setLoadingFriendContext] = useState(false);
  const contextRequestRef = useRef(0);
  const [allocationStrategy, setAllocationStrategy] = useState<RepaymentAllocationStrategy>(initialAllocationStrategy);
  const [amountRupiah, setAmountRupiah] = useState(initialValues.amountRupiah);
  const [draftState, setDraftState] = useState<RepaymentAllocationDraftState>(() => createRepaymentAllocationDraft(actionState.allocations, initialAllocationIds));
  const previousActionStateRef = useRef(actionState);
  const friendActionStateRef = useRef(actionState);

  const { selectedAllocationIds, draftAllocations } = draftState;
  const selectedContext = friendContext?.option.id === selectedFriendId ? friendContext : undefined;
  const selectedShares = useMemo(() => selectedContext?.openExpenseShares ?? openExpenseSharesByFriend[selectedFriendId] ?? emptyOpenExpenseShares, [openExpenseSharesByFriend, selectedContext, selectedFriendId]);
  const selectedAllocationIdSet = useMemo(() => new Set(selectedAllocationIds), [selectedAllocationIds]);
  const selectedAllocationRows = useMemo(() => selectedAllocationIds.map((id) => selectedShares.find((share) => share.id === id)).filter((share): share is OpenExpenseShare => Boolean(share)), [selectedAllocationIds, selectedShares]);
  const availableAllocationShares = useMemo(() => selectedShares.filter((share) => !selectedAllocationIdSet.has(share.id)), [selectedAllocationIdSet, selectedShares]);
  const allocationOptions = useMemo(() => availableAllocationShares.slice(0, 20).map((share) => ({ id: share.id, label: `${share.expenseDescription} · ${share.outingTitle} · ${formatRupiah(share.remainingAmount)} remaining` })), [availableAllocationShares]);
  const friendOptionsWithSelection = useMemo(() => selectedFriend && !friendOptions.some((friend) => friend.id === selectedFriend.id) ? [...friendOptions, selectedFriend] : friendOptions, [friendOptions, selectedFriend]);
  const allocationRows = useMemo(() => serializeRepaymentAllocations(selectedAllocationIds, draftAllocations), [draftAllocations, selectedAllocationIds]);
  const allocationTotals = useMemo(() => deriveRepaymentAllocationTotals(amountRupiah, draftAllocations), [amountRupiah, draftAllocations]);
  const allocationDisclosureOpen = allocationStrategy !== "manual" || initialAllocationIds.length > 0 || (actionState.allocations ?? []).some((allocation) => allocation.amountRupiah.trim() !== "") || Object.keys(actionState.allocationFieldErrors ?? {}).length > 0;

  const recalculateAutomaticAllocations = useCallback((strategy: RepaymentAllocationStrategy, amount: string, shares: OpenExpenseShare[]) => {
    const next = applyRepaymentAllocationStrategy(amount, shares, strategy);
    if (next) setDraftState(next);
  }, []);

  const handleAmountChange = useCallback((nextAmountRupiah: string) => {
    setAmountRupiah(nextAmountRupiah);
    if (amountRef.current) amountRef.current.value = nextAmountRupiah;
    if (allocationStrategy !== "manual") recalculateAutomaticAllocations(allocationStrategy, nextAmountRupiah, selectedShares);
  }, [allocationStrategy, amountRef, recalculateAutomaticAllocations, selectedShares]);

  useEffect(() => {
    if (allocationStrategy !== "manual") recalculateAutomaticAllocations(allocationStrategy, amountRef.current?.value ?? initialValues.amountRupiah, selectedShares);
  }, [allocationStrategy, amountRef, initialValues.amountRupiah, recalculateAutomaticAllocations, selectedFriendId, selectedShares]);

  const refreshFriendContext = useCallback(async (friendId: string) => {
    if (!loadFriendContext) return;
    const request = ++contextRequestRef.current;
    try {
      const context = tripContextId ? await loadFriendContext(friendId, mode === "create", tripContextId) : await loadFriendContext(friendId, mode === "create");
      if (request === contextRequestRef.current) {
        setFriendContext(context);
        if (allocationStrategy !== "manual") recalculateAutomaticAllocations(allocationStrategy, amountRef.current?.value ?? initialValues.amountRupiah, context.openExpenseShares);
      }
    } finally {
      if (request === contextRequestRef.current) setLoadingFriendContext(false);
    }
  }, [allocationStrategy, amountRef, initialValues.amountRupiah, loadFriendContext, mode, recalculateAutomaticAllocations, tripContextId]);

  const handleFriendChange = useCallback((friend: SearchableOption) => {
    setSelectedFriendId(friend.id);
    setSelectedFriend(friend);
    setFriendContext(undefined);
    setDraftState(createRepaymentAllocationDraft([], []));
    if (loadFriendContext) {
      setLoadingFriendContext(true);
      void refreshFriendContext(friend.id);
    }
  }, [loadFriendContext, refreshFriendContext]);

  const updateAllocationAmount = useCallback((expenseShareId: string, nextAmountRupiah: string) => {
    setDraftState((current) => updateRepaymentAllocationDraft(current, expenseShareId, nextAmountRupiah));
  }, []);

  const addAllocation = useCallback((expenseShareId: string) => {
    setDraftState((current) => addRepaymentAllocation(current, expenseShareId));
  }, []);

  const removeAllocation = useCallback((expenseShareId: string) => {
    setDraftState((current) => removeRepaymentAllocation(current, expenseShareId));
  }, []);

  const searchOutstandingExpenses = useCallback(async (query: string) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return availableAllocationShares
      .filter((share) => `${share.expenseDescription} ${share.outingTitle}`.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, 20)
      .map((share) => ({ id: share.id, label: `${share.expenseDescription} · ${share.outingTitle} · ${formatRupiah(share.remainingAmount)} remaining` }));
  }, [availableAllocationShares]);

  useEffect(() => {
    if (actionState === friendActionStateRef.current || !actionState.values.friendId) return;
    friendActionStateRef.current = actionState;
    setSelectedFriendId(actionState.values.friendId);
    setAmountRupiah(actionState.values.amountRupiah);
    if (loadFriendContext) void refreshFriendContext(actionState.values.friendId);
  }, [actionState, loadFriendContext, refreshFriendContext]);

  useEffect(() => {
    if (actionState === previousActionStateRef.current) return;
    setDraftState(createRepaymentAllocationDraft(actionState.allocations));
    setAmountRupiah(actionState.values.amountRupiah);
  }, [actionState]);

  return {
    addAllocation,
    allocationDisclosureOpen,
    allocationOptions,
    allocationRows,
    allocationStrategy,
    allocationTotals,
    availableAllocationShares,
    draftAllocations,
    friendOptionsWithSelection,
    friendContext,
    handleAmountChange,
    handleFriendChange,
    loadingFriendContext,
    outstandingAmount: selectedContext?.outstandingAmount ?? outstandingByFriend[selectedFriendId] ?? 0,
    removeAllocation,
    searchOutstandingExpenses,
    selectedAllocationIdSet,
    selectedAllocationIds,
    selectedAllocationRows,
    selectedContext,
    selectedFriendId,
    selectedShares,
    setAllocationStrategy,
    updateAllocationAmount,
  };
}
