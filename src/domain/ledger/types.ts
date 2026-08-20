import { trips } from "../../db/schema";
import type { ExpenseShareChargeInput, ExpenseShareInput as ExpenseShareBaseInput } from "../expense-share-input";
import type { FriendBalance, LedgerSummary } from "../ledger-summary";

export type FriendMutationInput = {
  name: string;
  phoneNumber: string | null;
  notes: string | null;
};

export type CreateFriendInput = FriendMutationInput;
export type UpdateFriendInput = FriendMutationInput;
export type OutingMutationInput = {
  title: string;
  occurredAt: Date;
  notes: string | null;
  tripId?: string | null;
};
export type CreateOutingInput = OutingMutationInput;
export type UpdateOutingInput = OutingMutationInput;
export type OutingSelectorOption = { id: string; title: string; recent?: boolean };
export type TripMutationInput = {
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
};
export type CreateTripInput = TripMutationInput;
export type UpdateTripInput = TripMutationInput;
export type TripSelectorOption = { id: string; name: string };
export type TripSummary = {
  outingCount: number;
  expenseCount: number;
  expenseTotal: number;
};
export type TripFinancialSummary = TripSummary & {
  totalAssignedAmount: number;
  ownerPortionAmount: number;
  totalOutstandingAmount: number;
};
export type TripListRecord = typeof trips.$inferSelect & TripSummary;
export type ExpenseMutationInput = {
  description: string;
  amount: number;
  outingId: string;
};
export type CreateExpenseInput = ExpenseMutationInput;
export type UpdateExpenseInput = ExpenseMutationInput;
export type ExpenseShareInput = ExpenseShareBaseInput;
export type ExpenseChargeInput = ExpenseShareChargeInput;
export type ExpenseChargeRecord = ExpenseChargeInput & { id: string };
export type ExpenseShareRecord = {
  id: string;
  friendId: string;
  friendName: string;
  friendArchivedAt: Date | null;
  baseAmount: number;
  amountOwed: number;
  appliedAmount: number;
  remainingAmount: number;
  settled: boolean;
};
export type ExpenseSplitFriendDefinition = Pick<ExpenseShareRecord, "friendId" | "friendName" | "friendArchivedAt" | "baseAmount">;
export type ExpenseSplitDefinition = { friends: ExpenseSplitFriendDefinition[]; charges: ExpenseChargeInput[] };
export type RepaymentMutationInput = {
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
};
export type CreateRepaymentInput = RepaymentMutationInput;
export type UpdateRepaymentInput = RepaymentMutationInput;
export type FriendSelectorOption = { id: string; name: string; archived: boolean };
export type FriendArchiveReversalReceipt = {
  version: 1;
  friendId: string;
  archivedAt: string;
  updatedAt: string;
};
export type RepaymentAllocationReversalReceipt = {
  version: 1;
  reversalId: string;
  allocationId: string;
  repaymentId: string;
  expenseShareId: string;
  friendId: string;
  amount: number;
};
export type RepaymentRecord = {
  id: string;
  ownerUserId: string;
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: Date;
  friendName: string;
  friendArchivedAt: Date | null;
};

export type RepaymentListRecord = RepaymentRecord & {
  allocatedAmount: number;
  unallocatedAmount: number;
};

export type FriendExpenseShareRecord = {
  id: string;
  expenseId: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
  appliedAmount: number;
  remainingAmount: number;
  settled: boolean;
};

export type LedgerOverviewSummary = Omit<LedgerSummary, "friendBalances"> & {
  totalAssignedFriendCount: number;
  friendBalances: FriendBalance[];
};

export type RecentActivityRecord = {
  kind: "Expense" | "Repayment";
  id: string;
  title: string;
  detail: string;
  amount: number;
  date: Date;
};

export type GlobalSearchRecord = {
  kind: "friend" | "trip" | "outing" | "expense" | "repayment";
  id: string;
  title: string;
  detail?: string;
  context?: string;
  amount?: number;
  date?: string;
};

export type RepaymentAllocationShare = {
  id: string;
  expenseShareId: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
  allocatedByOtherRepayments: number;
  currentAllocation: number;
  capacityAvailable: number;
};

export type RepaymentAllocationPage = {
  items: RepaymentAllocationShare[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export const REPAYMENT_ALLOCATION_PAGE_SIZE = 10 as const;

export type RepaymentAllocationPlan = RepaymentRecord & {
  allocatedAmount: number;
  unallocatedAmount: number;
  shares: RepaymentAllocationShare[];
  sharePage?: RepaymentAllocationPage;
};

export type DeleteRecordOptions = { cascadeDependents: boolean; expectedImpactRevision?: string };

export type OutingDeletionImpact = {
  recordType: "outing";
  expenseCount: number;
  expenseTotal: number;
  receiptCount: number;
  shareCount: number;
  allocationCount: number;
  affectedRepaymentCount: number;
  affectedRepaymentIds: string[];
  affectedFriendIds: string[];
};

export type ExpenseDeletionImpact = {
  recordType: "expense";
  receiptCount: number;
  shareCount: number;
  allocationCount: number;
  affectedRepaymentCount: number;
  affectedRepaymentIds: string[];
  affectedFriendIds: string[];
};

export type RepaymentDeletionImpact = {
  recordType: "repayment";
  allocationCount: number;
  friendId: string;
};

export type DeletionImpact = OutingDeletionImpact | ExpenseDeletionImpact | RepaymentDeletionImpact;

export type LedgerDeletionConfirmationReason =
  | "cascade_confirmation_required"
  | "impact_changed"
  | "cascade_confirmation_obsolete";

export type OpenExpenseShare = {
  id: string;
  friendId: string;
  friendName: string;
  expenseDescription: string;
  outingTitle: string;
  outingOccurredAt: Date;
  amountOwed: number;
  repaidAmount: number;
  remainingAmount: number;
};

export type OpenExpenseSharesByFriend = Record<string, OpenExpenseShare[]>;

export type RepaymentFriendContext = {
  option: FriendSelectorOption;
  outstandingAmount: number;
  openExpenseShares: OpenExpenseShare[];
};

export type EligibleDebtorShareReceipt = {
  id: string;
  originalFilename: string;
  mediaType: string;
  createdAt: Date;
};

export type EligibleDebtorShareReceiptGroup = {
  expenseId: string;
  expenseDescription: string;
  outingTitle: string;
  receipts: EligibleDebtorShareReceipt[];
};

export type DebtorStatementPageOptions = {
  expensePage?: unknown;
  repaymentPage?: unknown;
};
