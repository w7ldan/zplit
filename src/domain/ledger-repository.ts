import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  debtorShareLinks,
  debtorShareReceipts,
  expenseReceipts,
  expenseShares,
  expenses,
  friends,
  outings,
  repaymentAllocations,
  repayments,
} from "../db/schema";
import { buildLedgerSummary, LedgerIntegrityError } from "./ledger-summary";
import { buildDebtorStatement, DebtorStatementIntegrityError } from "./debtor-statement";
import { validateLedgerExportSnapshot, LedgerExportIntegrityError, type LedgerExportSnapshot } from "./ledger-export";
import type { RepaymentAllocationInput } from "./repayment-allocation-input";
import { MAX_RUPIAH } from "./rupiah";
import {
  buildLedgerHistory,
  LedgerHistoryError,
  LedgerHistoryIntegrityError,
  parseLedgerHistoryCursor,
  type LedgerHistoryExpenseRecord,
  type LedgerHistoryRepaymentRecord,
  type LedgerHistoryResult,
  type LedgerHistoryType,
} from "./ledger-history";

export type LedgerErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OWNER"
  | "NOT_FOUND"
  | "SHARE_TOTAL_EXCEEDED"
  | "REPAYMENT_AMOUNT_TOO_LOW"
  | "REPAYMENT_FRIEND_LOCKED"
  | "REPAYMENT_ALLOCATION_AMOUNT_EXCEEDED"
  | "REPAYMENT_ALLOCATION_SHARE_EXCEEDED"
  | "OUTING_HAS_EXPENSES"
  | "EXPENSE_HAS_ALLOCATIONS"
  | "REPAYMENT_HAS_ALLOCATIONS"
  | "PERSISTENCE_ERROR";

export class LedgerRepositoryError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerRepositoryError";
  }
}

export class LedgerNotFoundError extends LedgerRepositoryError {
  constructor() {
    super("NOT_FOUND", "Ledger record not found");
    this.name = "LedgerNotFoundError";
  }
}

export class ExpenseShareInvariantError extends LedgerRepositoryError {
  constructor() {
    super("SHARE_TOTAL_EXCEEDED", "Assigned shares cannot exceed the expense amount.");
    this.name = "ExpenseShareInvariantError";
  }
}

export class RepaymentAmountInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_AMOUNT_TOO_LOW", "Repayment amount cannot be lower than its allocated amount.");
    this.name = "RepaymentAmountInvariantError";
  }
}

export class RepaymentFriendInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_FRIEND_LOCKED", "The friend cannot be changed after this repayment has allocations.");
    this.name = "RepaymentFriendInvariantError";
  }
}

export class RepaymentAllocationAmountInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_ALLOCATION_AMOUNT_EXCEEDED", "Allocated amount cannot exceed the repayment amount.");
    this.name = "RepaymentAllocationAmountInvariantError";
  }
}

export class RepaymentAllocationShareInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_ALLOCATION_SHARE_EXCEEDED", "An allocation cannot exceed the share's remaining balance.");
    this.name = "RepaymentAllocationShareInvariantError";
  }
}

export class OutingDeletionInvariantError extends LedgerRepositoryError {
  constructor() {
    super("OUTING_HAS_EXPENSES", "Move or delete this outing's expenses first.");
    this.name = "OutingDeletionInvariantError";
  }
}

export class ExpenseDeletionInvariantError extends LedgerRepositoryError {
  constructor() {
    super("EXPENSE_HAS_ALLOCATIONS", "Remove repayment allocations before deleting this expense.");
    this.name = "ExpenseDeletionInvariantError";
  }
}

export class RepaymentDeletionInvariantError extends LedgerRepositoryError {
  constructor() {
    super("REPAYMENT_HAS_ALLOCATIONS", "Remove this repayment's allocations before deleting it.");
    this.name = "RepaymentDeletionInvariantError";
  }
}

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
};
export type CreateOutingInput = OutingMutationInput;
export type UpdateOutingInput = OutingMutationInput;
export type ExpenseMutationInput = {
  description: string;
  amount: number;
  outingId: string;
};
export type CreateExpenseInput = ExpenseMutationInput;
export type UpdateExpenseInput = ExpenseMutationInput;
export type ExpenseShareInput = {
  friendId: string;
  amountOwed: number;
};
export type RepaymentMutationInput = {
  friendId: string;
  amount: number;
  paidAt: Date;
  paymentMethod: string | null;
  notes: string | null;
};
export type CreateRepaymentInput = RepaymentMutationInput;
export type UpdateRepaymentInput = RepaymentMutationInput;
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

export type RepaymentAllocationPlan = RepaymentRecord & {
  allocatedAmount: number;
  unallocatedAmount: number;
  shares: RepaymentAllocationShare[];
};

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

function assertInput(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger input is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(input, "ownerUserId") || Object.prototype.hasOwnProperty.call(input, "owner_user_id")) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Ledger ownership is server managed");
  }
}

function assertFriendInput(input: unknown): asserts input is FriendMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["name", "phoneNumber", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Friend fields are invalid");
  }
}

function assertFriendId(friendId: string) {
  if (typeof friendId !== "string" || !friendId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A friend ID is required");
  }
}

function assertOutingInput(input: unknown): asserts input is OutingMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.some((key) => !["title", "occurredAt", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Outing fields are invalid");
  }
  if (
    typeof input.title !== "string" ||
    !(input.occurredAt instanceof Date) ||
    Number.isNaN(input.occurredAt.getTime()) ||
    (input.notes !== null && typeof input.notes !== "string")
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Outing fields are invalid");
  }
}

function assertOutingId(outingId: string) {
  if (typeof outingId !== "string" || !outingId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An outing ID is required");
  }
}

function assertExpenseInput(input: unknown): asserts input is ExpenseMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.length !== 3 || keys.some((key) => !["description", "amount", "outingId"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense fields are invalid");
  }
  if (
    typeof input.description !== "string" ||
    !input.description.trim() ||
    input.description.length > 200 ||
    typeof input.amount !== "number" ||
    !Number.isInteger(input.amount) ||
    input.amount <= 0 ||
    input.amount > 2_147_483_647 ||
    typeof input.outingId !== "string" ||
    !input.outingId.trim()
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense fields are invalid");
  }
}

function assertExpenseId(expenseId: string) {
  if (typeof expenseId !== "string" || !expenseId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "An expense ID is required");
  }
}

function assertRepaymentId(repaymentId: string) {
  if (typeof repaymentId !== "string" || !repaymentId.trim()) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A repayment ID is required");
  }
}

function assertRepaymentInput(input: unknown): asserts input is RepaymentMutationInput {
  assertInput(input);
  const keys = Object.keys(input);
  if (keys.length !== 5 || keys.some((key) => !["friendId", "amount", "paidAt", "paymentMethod", "notes"].includes(key))) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Repayment fields are invalid");
  }
  if (
    typeof input.friendId !== "string" ||
    !input.friendId.trim() ||
    typeof input.amount !== "number" ||
    !Number.isSafeInteger(input.amount) ||
    input.amount <= 0 ||
    !(input.paidAt instanceof Date) ||
    Number.isNaN(input.paidAt.getTime()) ||
    (input.paymentMethod !== null && typeof input.paymentMethod !== "string") ||
    (input.notes !== null && typeof input.notes !== "string")
  ) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Repayment fields are invalid");
  }
}

function assertRepaymentAllocationsInput(input: unknown): asserts input is RepaymentAllocationInput[] {
  if (!Array.isArray(input)) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
  const seen = new Set<string>();
  for (const allocation of input) {
    if (
      allocation === null ||
      typeof allocation !== "object" ||
      Array.isArray(allocation) ||
      Object.keys(allocation).some((key) => !["expenseShareId", "amount"].includes(key)) ||
      typeof (allocation as RepaymentAllocationInput).expenseShareId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((allocation as RepaymentAllocationInput).expenseShareId) ||
      typeof (allocation as RepaymentAllocationInput).amount !== "number" ||
      !Number.isSafeInteger((allocation as RepaymentAllocationInput).amount) ||
      (allocation as RepaymentAllocationInput).amount <= 0 ||
      (allocation as RepaymentAllocationInput).amount > MAX_RUPIAH
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
    }
    const expenseShareId = (allocation as RepaymentAllocationInput).expenseShareId.toLowerCase();
    if (seen.has(expenseShareId)) throw new LedgerRepositoryError("INVALID_INPUT", "Each expense share can appear only once.");
    seen.add(expenseShareId);
  }
}

function assertExpenseSharesInput(shares: unknown): asserts shares is ExpenseShareInput[] {
  if (!Array.isArray(shares)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
  }
  const seen = new Set<string>();
  for (const share of shares) {
    if (
      share === null ||
      typeof share !== "object" ||
      Array.isArray(share) ||
      Object.keys(share).some((key) => !["friendId", "amountOwed"].includes(key)) ||
      typeof (share as ExpenseShareInput).friendId !== "string" ||
      !(share as ExpenseShareInput).friendId.trim() ||
      typeof (share as ExpenseShareInput).amountOwed !== "number" ||
      !Number.isInteger((share as ExpenseShareInput).amountOwed) ||
      (share as ExpenseShareInput).amountOwed <= 0 ||
      (share as ExpenseShareInput).amountOwed > 2_147_483_647
    ) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Expense shares are invalid");
    }
    const friendId = (share as ExpenseShareInput).friendId.trim().toLowerCase();
    if (seen.has(friendId)) throw new LedgerRepositoryError("INVALID_INPUT", "Each friend can have only one share per expense.");
    seen.add(friendId);
  }
}

function notFound(): never {
  throw new LedgerNotFoundError();
}

function persistenceError(error: unknown): never {
  if (error instanceof LedgerRepositoryError || error instanceof LedgerIntegrityError || error instanceof DebtorStatementIntegrityError || error instanceof LedgerExportIntegrityError || error instanceof LedgerHistoryError) throw error;
  throw new LedgerRepositoryError("PERSISTENCE_ERROR", "Ledger operation failed");
}

export function createLedgerRepository(database: Database, ownerUserId: string) {
  const owner = ownerUserId.trim();
  if (!owner) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger owner is required");

  async function createFriend(input: CreateFriendInput) {
    assertFriendInput(input);
    try {
      const [friend] = await database.insert(friends).values({ ...input, ownerUserId: owner }).returning();
      if (!friend) return persistenceError(new Error("friend insert returned no row"));
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getFriend(friendId: string) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .select()
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listFriends({ archived = false }: { archived?: boolean } = {}) {
    try {
      return await database
        .select()
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), archived ? isNotNull(friends.archivedAt) : isNull(friends.archivedAt)))
        .orderBy(asc(friends.name), asc(friends.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateFriend(friendId: string, input: UpdateFriendInput) {
    assertFriendId(friendId);
    assertFriendInput(input);
    try {
      const [friend] = await database
        .update(friends)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function setFriendArchived(friendId: string, archived: boolean) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createOuting(input: CreateOutingInput) {
    assertOutingInput(input);
    try {
      const [outing] = await database.insert(outings).values({ ...input, ownerUserId: owner }).returning();
      if (!outing) return persistenceError(new Error("outing insert returned no row"));
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getOuting(outingId: string) {
    assertOutingId(outingId);
    try {
      const [outing] = await database
        .select()
        .from(outings)
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .limit(1);
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listOutings() {
    try {
      return await database.select().from(outings).where(eq(outings.ownerUserId, owner)).orderBy(desc(outings.occurredAt), asc(outings.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateOuting(outingId: string, input: UpdateOutingInput) {
    assertOutingId(outingId);
    assertOutingInput(input);
    try {
      const [outing] = await database
        .update(outings)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
        .returning();
      if (!outing) return notFound();
      return outing;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteOuting(outingId: string) {
    assertOutingId(outingId);
    try {
      return await database.transaction(async (transaction) => {
        const [outing] = await transaction
          .select({ id: outings.id })
          .from(outings)
          .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
          .limit(1)
          .for("update");
        if (!outing) return notFound();

        const dependentExpenses = await transaction
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.outingId, outingId)))
          .orderBy(asc(expenses.id))
          .for("update");
        if (dependentExpenses.length > 0) throw new OutingDeletionInvariantError();

        const deleted = await transaction
          .delete(outings)
          .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
          .returning({ id: outings.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: [] as string[] };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function expenseSelection() {
    return {
      id: expenses.id,
      ownerUserId: expenses.ownerUserId,
      outingId: expenses.outingId,
      description: expenses.description,
      amount: expenses.amount,
      createdAt: expenses.createdAt,
      updatedAt: expenses.updatedAt,
      outingTitle: outings.title,
      outingOccurredAt: outings.occurredAt,
    };
  }

  async function assertOwnedOuting(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], outingId: string) {
    const [outing] = await transaction
      .select({ id: outings.id })
      .from(outings)
      .where(and(eq(outings.ownerUserId, owner), eq(outings.id, outingId)))
      .limit(1);
    if (!outing) return notFound();
  }

  async function createExpense(input: CreateExpenseInput) {
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedOuting(transaction, input.outingId);
        const [expense] = await transaction.insert(expenses).values({ ...input, ownerUserId: owner }).returning();
        if (!expense) return persistenceError(new Error("expense insert returned no row"));
        const [created] = await transaction
          .select(expenseSelection())
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expense.id)))
          .limit(1);
        if (!created) return persistenceError(new Error("expense insert lookup returned no row"));
        return created;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getExpense(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return expense;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listExpenses() {
    try {
      return await database
        .select(expenseSelection())
        .from(expenses)
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(eq(expenses.ownerUserId, owner))
        .orderBy(desc(outings.occurredAt), desc(expenses.createdAt), asc(expenses.id));
    } catch (error) {
      return persistenceError(error);
    }
  }

  type HistoryRow = {
    event_type: string;
    record_id: string;
    effective_at: Date | string;
    description: string | null;
    outing_title: string | null;
    friend_id: string | null;
    friend_name: string | null;
    total_amount: number | string | null;
    shares: unknown;
    allocations: unknown;
  };

  function historyAmount(value: unknown, label: string) {
    const result = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
    if (!Number.isSafeInteger(result) || result < 0) throw new LedgerHistoryIntegrityError(`${label} is not a safe whole-rupiah amount.`);
    return result;
  }

  function historyArray(value: unknown, label: string) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch { throw new LedgerHistoryIntegrityError(`${label} is invalid.`); }
    }
    if (!Array.isArray(value)) throw new LedgerHistoryIntegrityError(`${label} is invalid.`);
    return value;
  }

  async function listLedgerHistory({ cursor, type = "all", limit = 30 }: { cursor?: string; type?: LedgerHistoryType; limit?: number } = {}): Promise<LedgerHistoryResult> {
    if (type !== "all" && type !== "expense" && type !== "repayment") throw new LedgerHistoryError("Ledger history type is invalid.");
    const requestedLimit = typeof limit === "number" && Number.isFinite(limit) ? Math.trunc(limit) : 30;
    const pageLimit = Math.min(50, Math.max(1, requestedLimit));
    const parsedCursor = cursor === undefined ? undefined : parseLedgerHistoryCursor(cursor);
    const typeClause = type === "all" ? sql`true` : sql`event_type = ${type}`;
    const cursorClause = parsedCursor
      ? sql`(
          effective_at < ${parsedCursor.effectiveAt} OR
          (effective_at = ${parsedCursor.effectiveAt} AND event_type > ${parsedCursor.eventType}) OR
          (effective_at = ${parsedCursor.effectiveAt} AND event_type = ${parsedCursor.eventType} AND record_id > ${parsedCursor.recordId})
        )`
      : sql`true`;
    try {
      const result = await database.execute<HistoryRow>(sql`
        WITH share_data AS (
          SELECT
            es.owner_user_id,
            es.id,
            es.expense_id,
            es.friend_id,
            es.amount_owed,
            COALESCE(SUM(ra.amount), 0) AS allocated_amount
          FROM expense_shares es
          LEFT JOIN repayment_allocations ra
            ON ra.owner_user_id = es.owner_user_id
            AND ra.expense_share_id = es.id
          WHERE es.owner_user_id = ${owner}
          GROUP BY es.owner_user_id, es.id, es.expense_id, es.friend_id, es.amount_owed
        ), expense_events AS (
          SELECT
            'expense'::text AS event_type,
            e.id AS record_id,
            o.occurred_at AS effective_at,
            e.description,
            o.title AS outing_title,
            NULL::uuid AS friend_id,
            NULL::text AS friend_name,
            e.amount AS total_amount,
            COALESCE(jsonb_agg(jsonb_build_object(
              'id', sd.id,
              'friendId', sd.friend_id,
              'amountOwed', sd.amount_owed,
              'allocatedAmount', sd.allocated_amount
            ) ORDER BY sd.id) FILTER (WHERE sd.id IS NOT NULL), '[]'::jsonb) AS shares,
            '[]'::jsonb AS allocations
          FROM expenses e
          INNER JOIN outings o
            ON o.owner_user_id = e.owner_user_id
            AND o.id = e.outing_id
          LEFT JOIN share_data sd
            ON sd.owner_user_id = e.owner_user_id
            AND sd.expense_id = e.id
          WHERE e.owner_user_id = ${owner}
          GROUP BY e.id, o.occurred_at, e.description, o.title, e.amount
        ), repayment_events AS (
          SELECT
            'repayment'::text AS event_type,
            r.id AS record_id,
            r.paid_at AS effective_at,
            NULL::text AS description,
            NULL::text AS outing_title,
            f.id AS friend_id,
            f.name AS friend_name,
            r.amount AS total_amount,
            '[]'::jsonb AS shares,
            COALESCE(jsonb_agg(jsonb_build_object(
              'expenseShareId', ra.expense_share_id,
              'amount', ra.amount,
              'friendId', sd.friend_id,
              'shareAmountOwed', sd.amount_owed,
              'shareAllocatedAmount', sd.allocated_amount
            ) ORDER BY ra.expense_share_id) FILTER (WHERE ra.expense_share_id IS NOT NULL), '[]'::jsonb) AS allocations
          FROM repayments r
          INNER JOIN friends f
            ON f.owner_user_id = r.owner_user_id
            AND f.id = r.friend_id
          LEFT JOIN repayment_allocations ra
            ON ra.owner_user_id = r.owner_user_id
            AND ra.repayment_id = r.id
          LEFT JOIN share_data sd
            ON sd.owner_user_id = r.owner_user_id
            AND sd.id = ra.expense_share_id
          WHERE r.owner_user_id = ${owner}
          GROUP BY r.id, r.paid_at, f.id, f.name, r.amount
        ), events AS (
          SELECT * FROM expense_events
          UNION ALL
          SELECT * FROM repayment_events
        )
        SELECT event_type, record_id, effective_at, description, outing_title, friend_id, friend_name, total_amount, shares, allocations
        FROM events
        WHERE ${typeClause} AND ${cursorClause}
        ORDER BY effective_at DESC, event_type ASC, record_id ASC
        LIMIT ${pageLimit + 1}
      `);

      const expenses: LedgerHistoryExpenseRecord[] = [];
      const repayments: LedgerHistoryRepaymentRecord[] = [];
      const historyRows = (Array.isArray(result) ? result : result.rows) as HistoryRow[];
      for (const row of historyRows) {
        if (row.event_type === "expense") {
          if (row.description === null || row.outing_title === null || row.total_amount === null) throw new LedgerHistoryIntegrityError("Expense history row is incomplete.");
          expenses.push({
            id: row.record_id,
            description: row.description,
            outingTitle: row.outing_title,
            outingOccurredAt: row.effective_at,
            amount: historyAmount(row.total_amount, `Expense ${row.record_id} amount`),
            shares: historyArray(row.shares, `Expense ${row.record_id} shares`) as LedgerHistoryExpenseRecord["shares"],
          });
        } else if (row.event_type === "repayment") {
          if (row.friend_id === null || row.friend_name === null || row.total_amount === null) throw new LedgerHistoryIntegrityError("Repayment history row is incomplete.");
          repayments.push({
            id: row.record_id,
            friendId: row.friend_id,
            friendName: row.friend_name,
            paidAt: row.effective_at,
            amount: historyAmount(row.total_amount, `Repayment ${row.record_id} amount`),
            allocations: historyArray(row.allocations, `Repayment ${row.record_id} allocations`) as LedgerHistoryRepaymentRecord["allocations"],
          });
        } else {
          throw new LedgerHistoryIntegrityError("Ledger history event type is invalid.");
        }
      }
      return buildLedgerHistory({ expenses, repayments }, { type, limit: pageLimit, allocationsComplete: false });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getLedgerSummary() {
    try {
      const [friendRows, expenseRows, shareRows, repaymentRows, allocationRows] = await Promise.all([
        database
          .select({ id: friends.id, name: friends.name, archivedAt: friends.archivedAt })
          .from(friends)
          .where(eq(friends.ownerUserId, owner)),
        database
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(eq(expenses.ownerUserId, owner)),
        database
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(eq(expenseShares.ownerUserId, owner)),
        database
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(eq(repayments.ownerUserId, owner)),
        database
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(eq(repaymentAllocations.ownerUserId, owner)),
      ]);

      return buildLedgerSummary({
        friends: friendRows,
        expenses: expenseRows,
        expenseShares: shareRows,
        repayments: repaymentRows,
        repaymentAllocations: allocationRows,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getLedgerExportSnapshot(): Promise<LedgerExportSnapshot> {
    try {
      const [friendRows, expenseRows, shareRows, repaymentRows, allocationRows] = await Promise.all([
        database
          .select({ id: friends.id, name: friends.name, archivedAt: friends.archivedAt })
          .from(friends)
          .where(eq(friends.ownerUserId, owner)),
        database
          .select({
            id: expenses.id,
            description: expenses.description,
            amount: expenses.amount,
            outingTitle: outings.title,
            outingOccurredAt: outings.occurredAt,
          })
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(eq(expenses.ownerUserId, owner)),
        database
          .select({ id: expenseShares.id, expenseId: expenseShares.expenseId, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(eq(expenseShares.ownerUserId, owner)),
        database
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount, paidAt: repayments.paidAt, paymentMethod: repayments.paymentMethod })
          .from(repayments)
          .where(eq(repayments.ownerUserId, owner)),
        database
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(eq(repaymentAllocations.ownerUserId, owner)),
      ]);
      const snapshot = {
        friends: friendRows,
        expenses: expenseRows,
        expenseShares: shareRows,
        repayments: repaymentRows,
        repaymentAllocations: allocationRows,
      };
      validateLedgerExportSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listEligibleDebtorShareReceipts(friendId: string): Promise<EligibleDebtorShareReceiptGroup[]> {
    assertFriendId(friendId);
    try {
      const rows = await database
        .select({
          expenseId: expenses.id,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          id: expenseReceipts.id,
          originalFilename: expenseReceipts.originalFilename,
          mediaType: expenseReceipts.mediaType,
          createdAt: expenseReceipts.createdAt,
        })
        .from(expenseReceipts)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseReceipts.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .innerJoin(expenseShares, and(
          eq(expenseShares.ownerUserId, owner),
          eq(expenseShares.expenseId, expenseReceipts.expenseId),
          eq(expenseShares.friendId, friendId),
        ))
        .where(eq(expenseReceipts.ownerUserId, owner))
        .orderBy(asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseReceipts.createdAt), asc(expenseReceipts.id));
      const groups = new Map<string, EligibleDebtorShareReceiptGroup>();
      for (const row of rows) {
        const group = groups.get(row.expenseId) ?? { expenseId: row.expenseId, expenseDescription: row.expenseDescription, outingTitle: row.outingTitle, receipts: [] };
        group.receipts.push({ id: row.id, originalFilename: row.originalFilename, mediaType: row.mediaType, createdAt: row.createdAt });
        groups.set(row.expenseId, group);
      }
      return [...groups.values()];
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getFriendDebtorStatement(friendId: string, asOf = new Date(), debtorShareLinkId?: string) {
    assertFriendId(friendId);
    try {
      const [friend] = await database
        .select({ id: friends.id, name: friends.name })
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!friend) return notFound();

      const shares = await database
        .select({
          id: expenseShares.id,
          friendId: expenseShares.friendId,
          expenseId: expenseShares.expenseId,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
        })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.friendId, friendId)));

      const repaymentRows = await database
        .select({
          repaymentId: repayments.id,
          repaymentFriendId: repayments.friendId,
          repaymentAmount: repayments.amount,
          expenseShareId: repaymentAllocations.expenseShareId,
          allocationAmount: repaymentAllocations.amount,
        })
        .from(repayments)
        .leftJoin(
          repaymentAllocations,
          and(
            eq(repaymentAllocations.ownerUserId, owner),
            eq(repaymentAllocations.repaymentId, repayments.id),
          ),
        )
        .leftJoin(
          expenseShares,
          and(
            eq(expenseShares.ownerUserId, owner),
            eq(expenseShares.id, repaymentAllocations.expenseShareId),
            eq(expenseShares.friendId, friendId),
          ),
        )
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.friendId, friendId)));

      const repaymentById = new Map<string, { id: string; friendId: string; amount: number }>();
      const allocations = [] as { repaymentId: string; expenseShareId: string; amount: number }[];
      for (const row of repaymentRows) {
        repaymentById.set(row.repaymentId, {
          id: row.repaymentId,
          friendId: row.repaymentFriendId,
          amount: row.repaymentAmount,
        });
        if (row.expenseShareId !== null && row.allocationAmount !== null) {
          allocations.push({ repaymentId: row.repaymentId, expenseShareId: row.expenseShareId, amount: row.allocationAmount });
        }
      }

      const publicReceipts = debtorShareLinkId && shares.length > 0
        ? await database
            .select({ publicId: debtorShareReceipts.id, expenseId: debtorShareReceipts.expenseId, mediaType: expenseReceipts.mediaType })
            .from(debtorShareReceipts)
            .innerJoin(debtorShareLinks, and(
              eq(debtorShareLinks.id, debtorShareReceipts.debtorShareLinkId),
              eq(debtorShareLinks.ownerUserId, owner),
              isNull(debtorShareLinks.revokedAt),
              gt(debtorShareLinks.expiresAt, asOf),
            ))
            .innerJoin(expenseReceipts, and(
              eq(expenseReceipts.ownerUserId, owner),
              eq(expenseReceipts.expenseId, debtorShareReceipts.expenseId),
              eq(expenseReceipts.id, debtorShareReceipts.expenseReceiptId),
            ))
            .innerJoin(expenseShares, and(
              eq(expenseShares.ownerUserId, owner),
              eq(expenseShares.expenseId, debtorShareReceipts.expenseId),
              eq(expenseShares.friendId, friendId),
            ))
            .where(and(
              eq(debtorShareReceipts.ownerUserId, owner),
              eq(debtorShareReceipts.debtorShareLinkId, debtorShareLinkId),
              inArray(debtorShareReceipts.expenseId, shares.map((share) => share.expenseId)),
            ))
        : [];

      return buildDebtorStatement({
        friend,
        shares,
        repayments: [...repaymentById.values()],
        allocations,
        publicReceipts,
        asOf,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateExpense(expenseId: string, input: UpdateExpenseInput) {
    assertExpenseId(expenseId);
    assertExpenseInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [currentExpense] = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!currentExpense) return notFound();

        const currentShares = await transaction
          .select({ amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const assignedTotal = currentShares.reduce((total, share) => total + share.amountOwed, 0);
        if (input.amount < assignedTotal) throw new ExpenseShareInvariantError();

        await assertOwnedOuting(transaction, input.outingId);
        const [expense] = await transaction
          .update(expenses)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning();
        if (!expense) return notFound();
        const [updated] = await transaction
          .select(expenseSelection())
          .from(expenses)
          .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1);
        if (!updated) return persistenceError(new Error("expense update returned no row"));
        return updated;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteExpense(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!expense) return notFound();

        const shares = await transaction
          .select({ id: expenseShares.id, friendId: expenseShares.friendId })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
          .orderBy(asc(expenseShares.id))
          .for("update");
        const shareIds = shares.map((share) => share.id);
        if (shareIds.length > 0) {
          const allocations = await transaction
            .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId })
            .from(repaymentAllocations)
            .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
            .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
            .for("update");
          if (allocations.length > 0) throw new ExpenseDeletionInvariantError();
        }

        const deleted = await transaction
          .delete(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .returning({ id: expenses.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: [...new Set(shares.map((share) => share.friendId))] };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function shareSelection() {
    return {
      id: expenseShares.id,
      friendId: friends.id,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
      amountOwed: expenseShares.amountOwed,
    };
  }

  async function listExpenseSharesFor(transaction: Pick<Database, "select">, expenseId: string) {
    return transaction
      .select(shareSelection())
      .from(expenseShares)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
      .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)))
      .orderBy(asc(friends.name), asc(expenseShares.id));
  }

  async function listExpenseShares(expenseId: string) {
    assertExpenseId(expenseId);
    try {
      const [expense] = await database
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
        .limit(1);
      if (!expense) return notFound();
      return await listExpenseSharesFor(database, expenseId);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listOpenExpenseSharesByFriend(): Promise<OpenExpenseSharesByFriend> {
    try {
      const shares = await database
        .select({
          id: expenseShares.id,
          friendId: friends.id,
          friendName: friends.name,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
        })
        .from(expenseShares)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, expenseShares.friendId)))
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(eq(expenseShares.ownerUserId, owner))
        .orderBy(asc(friends.name), asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id));
      const allocations = shares.length
        ? await database
            .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
            .from(repaymentAllocations)
            .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shares.map((share) => share.id))))
        : [];
      const repaidByShare = new Map<string, number>();
      for (const allocation of allocations) {
        if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
        const total = (repaidByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
        if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
        repaidByShare.set(allocation.expenseShareId, total);
      }
      const grouped: OpenExpenseSharesByFriend = {};
      for (const share of shares) {
        const repaidAmount = repaidByShare.get(share.id) ?? 0;
        const remainingAmount = share.amountOwed - repaidAmount;
        if (remainingAmount < 0) throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
        if (remainingAmount > 0) (grouped[share.friendId] ??= []).push({ ...share, repaidAmount, remainingAmount });
      }
      return grouped;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function replaceExpenseShares(expenseId: string, shares: ExpenseShareInput[]) {
    assertExpenseId(expenseId);
    assertExpenseSharesInput(shares);
    try {
      return await database.transaction(async (transaction) => {
        const [expense] = await transaction
          .select({ id: expenses.id, amount: expenses.amount })
          .from(expenses)
          .where(and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseId)))
          .limit(1)
          .for("update");
        if (!expense) return notFound();

        const currentShares = await transaction
          .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
          .from(expenseShares)
          .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId)));
        const currentByFriend = new Map(currentShares.map((share) => [share.friendId, share]));
        const requested = shares.map((share) => ({ ...share, friendId: share.friendId.trim().toLowerCase() }));

        const friendIds = requested.map((share) => share.friendId);
        const ownedFriends = friendIds.length
          ? await transaction
              .select({ id: friends.id, archivedAt: friends.archivedAt })
              .from(friends)
              .where(and(eq(friends.ownerUserId, owner), inArray(friends.id, friendIds)))
          : [];
        if (ownedFriends.length !== new Set(friendIds).size) return notFound();
        for (const friend of ownedFriends) {
          if (friend.archivedAt !== null && !currentByFriend.has(friend.id)) {
            throw new LedgerRepositoryError("INVALID_INPUT", "Archived friends cannot be newly assigned.");
          }
        }
        const total = requested.reduce((sum, share) => sum + share.amountOwed, 0);
        if (total > expense.amount) throw new ExpenseShareInvariantError();

        const requestedByFriend = new Map(requested.map((share) => [share.friendId, share.amountOwed]));
        for (const current of currentShares) {
          const amountOwed = requestedByFriend.get(current.friendId);
          if (amountOwed === undefined) continue;
          if (amountOwed !== current.amountOwed) {
            await transaction
              .update(expenseShares)
              .set({ amountOwed })
              .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.id, current.id)));
          }
        }

        const newShares = requested.filter((share) => !currentByFriend.has(share.friendId));
        if (newShares.length > 0) {
          await transaction.insert(expenseShares).values(
            newShares.map((share) => ({ ownerUserId: owner, expenseId, friendId: share.friendId, amountOwed: share.amountOwed })),
          );
        }

        const omittedIds = currentShares.filter((share) => !requestedByFriend.has(share.friendId)).map((share) => share.id);
        if (omittedIds.length > 0) {
          await transaction
            .delete(expenseShares)
            .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.expenseId, expenseId), inArray(expenseShares.id, omittedIds)));
        }

        return await listExpenseSharesFor(transaction, expenseId);
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  function repaymentSelection() {
    return {
      id: repayments.id,
      ownerUserId: repayments.ownerUserId,
      friendId: repayments.friendId,
      amount: repayments.amount,
      paidAt: repayments.paidAt,
      paymentMethod: repayments.paymentMethod,
      notes: repayments.notes,
      createdAt: repayments.createdAt,
      friendName: friends.name,
      friendArchivedAt: friends.archivedAt,
    };
  }

  async function withRepaymentTotals(
    transaction: Pick<Database, "select">,
    rows: RepaymentRecord[],
    repaymentId?: string,
  ) {
    const allocations = await transaction
      .select({ repaymentId: repaymentAllocations.repaymentId, amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(
        repaymentId
          ? and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId))
          : eq(repaymentAllocations.ownerUserId, owner),
      );
    const allocatedByRepayment = new Map<string, number>();
    for (const allocation of allocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is invalid.`);
      }
      const total = (allocatedByRepayment.get(allocation.repaymentId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for repayment ${allocation.repaymentId} is unsafe.`);
      allocatedByRepayment.set(allocation.repaymentId, total);
    }
    return rows.map((repayment) => {
      if (!Number.isSafeInteger(repayment.amount) || repayment.amount < 0) {
        throw new LedgerIntegrityError(`Repayment ${repayment.id} amount is invalid.`);
      }
      const allocatedAmount = allocatedByRepayment.get(repayment.id) ?? 0;
      if (allocatedAmount > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repayment.id}.`);
      return {
        ...repayment,
        allocatedAmount,
        unallocatedAmount: repayment.amount - allocatedAmount,
      };
    });
  }

  async function assertOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
      .limit(1);
    if (!friend) return notFound();
  }

  async function createRepayment(input: CreateRepaymentInput) {
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        return repayment;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function lockOwnedFriend(transaction: Pick<Database, "select">, friendId: string) {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) return notFound();
  }

  async function createRepaymentWithAllocations(input: CreateRepaymentInput, allocations: RepaymentAllocationInput[]) {
    assertRepaymentInput(input);
    assertRepaymentAllocationsInput(allocations);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    const normalizedAllocations = allocations.map((allocation) => ({ ...allocation, expenseShareId: allocation.expenseShareId.trim().toLowerCase() }));
    try {
      return await database.transaction(async (transaction) => {
        await lockOwnedFriend(transaction, requested.friendId);
        const shareIds = normalizedAllocations.map((allocation) => allocation.expenseShareId).sort();
        const lockedShares = shareIds.length
          ? await transaction
              .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
              .from(expenseShares)
              .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, shareIds)))
              .orderBy(asc(expenseShares.id))
              .for("update")
          : [];
        if (lockedShares.length !== shareIds.length || lockedShares.some((share) => share.friendId !== requested.friendId)) return notFound();
        const existingAllocations = shareIds.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
              .from(repaymentAllocations)
              .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
              .orderBy(asc(repaymentAllocations.expenseShareId), asc(repaymentAllocations.repaymentId))
              .for("update")
          : [];
        const allocatedByShare = new Map<string, number>();
        for (const allocation of existingAllocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is invalid.`);
          const total = (allocatedByShare.get(allocation.expenseShareId) ?? 0) + allocation.amount;
          if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocation for share ${allocation.expenseShareId} is unsafe.`);
          allocatedByShare.set(allocation.expenseShareId, total);
        }
        const requestedTotal = normalizedAllocations.reduce((total, allocation) => total + allocation.amount, 0);
        if (!Number.isSafeInteger(requestedTotal) || requestedTotal > requested.amount) throw new RepaymentAllocationAmountInvariantError();
        const shareById = new Map(lockedShares.map((share) => [share.id, share]));
        for (const allocation of normalizedAllocations) {
          const share = shareById.get(allocation.expenseShareId);
          if (!share) return notFound();
          if (allocation.amount > share.amountOwed - (allocatedByShare.get(share.id) ?? 0)) throw new RepaymentAllocationShareInvariantError();
        }
        const [repayment] = await transaction.insert(repayments).values({ ...requested, ownerUserId: owner }).returning();
        if (!repayment) return persistenceError(new Error("repayment insert returned no row"));
        if (normalizedAllocations.length > 0) {
          await transaction.insert(repaymentAllocations).values(normalizedAllocations.map((allocation) => ({ ownerUserId: owner, repaymentId: repayment.id, ...allocation })));
        }
        return repayment;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function getRepayment(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      const [repayment] = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
        .limit(1);
      if (!repayment) return notFound();
      return (await withRepaymentTotals(database, [repayment], repaymentId))[0]!;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listRepayments() {
    try {
      const rows = await database
        .select(repaymentSelection())
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(eq(repayments.ownerUserId, owner))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id));
      return await withRepaymentTotals(database, rows);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateRepayment(repaymentId: string, input: UpdateRepaymentInput) {
    assertRepaymentId(repaymentId);
    assertRepaymentInput(input);
    const requested = { ...input, friendId: input.friendId.trim().toLowerCase() };
    try {
      return await database.transaction(async (transaction) => {
        const [current] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!current) return notFound();

        const allocations = await transaction
          .select({ amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
          .for("update");
        if (!Number.isSafeInteger(current.amount) || current.amount < 0) throw new LedgerIntegrityError(`Repayment ${repaymentId} amount is invalid.`);
        let allocatedAmount = 0;
        for (const allocation of allocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount < 0) {
            throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
          }
          allocatedAmount += allocation.amount;
          if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
        }
        if (allocatedAmount > current.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);
        if (requested.amount < allocatedAmount) throw new RepaymentAmountInvariantError();
        if (allocations.length > 0 && requested.friendId !== current.friendId) throw new RepaymentFriendInvariantError();

        await assertOwnedFriend(transaction, requested.friendId);
        const [repayment] = await transaction
          .update(repayments)
          .set(requested)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .returning();
        if (!repayment) return notFound();

        const [updated] = await transaction
          .select(repaymentSelection())
          .from(repayments)
          .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1);
        if (!updated) return persistenceError(new Error("repayment update lookup returned no row"));
        return (await withRepaymentTotals(transaction, [updated], repaymentId))[0]!;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteRepayment(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const allocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)))
          .orderBy(asc(repaymentAllocations.expenseShareId))
          .for("update");
        if (allocations.length > 0) throw new RepaymentDeletionInvariantError();

        const deleted = await transaction
          .delete(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .returning({ id: repayments.id });
        if (deleted.length === 0) return notFound();
        return { friendIds: [repayment.friendId] };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function allocationPlanFor(transaction: Pick<Database, "select">, repaymentId: string): Promise<RepaymentAllocationPlan> {
    const [repayment] = await transaction
      .select(repaymentSelection())
      .from(repayments)
      .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
      .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
      .limit(1);
    if (!repayment) return notFound();

    const currentAllocations = await transaction
      .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
      .from(repaymentAllocations)
      .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
    const eligibleShares = await transaction
      .select({
        id: expenseShares.id,
        expenseDescription: expenses.description,
        expenseCreatedAt: expenses.createdAt,
        outingTitle: outings.title,
        outingOccurredAt: outings.occurredAt,
        amountOwed: expenseShares.amountOwed,
      })
      .from(expenseShares)
      .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
      .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
      .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.friendId, repayment.friendId)))
      .orderBy(asc(outings.occurredAt), asc(expenses.createdAt), asc(expenseShares.id));

    const eligibleById = new Map(eligibleShares.map((share) => [share.id, share]));
    const currentByShare = new Map<string, number>();
    let allocatedAmount = 0;
    for (const allocation of currentAllocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
        throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is invalid.`);
      }
      if (!eligibleById.has(allocation.expenseShareId)) {
        throw new LedgerIntegrityError(`Repayment ${repaymentId} references an unavailable expense share.`);
      }
      currentByShare.set(allocation.expenseShareId, allocation.amount);
      allocatedAmount += allocation.amount;
      if (!Number.isSafeInteger(allocatedAmount)) throw new LedgerIntegrityError(`Allocated amount for repayment ${repaymentId} is unsafe.`);
    }
    if (allocatedAmount > repayment.amount) throw new LedgerIntegrityError(`Allocations exceed repayment ${repaymentId}.`);

    const shareIds = eligibleShares.map((share) => share.id);
    const allAllocations = shareIds.length
      ? await transaction
          .select({ repaymentId: repaymentAllocations.repaymentId, expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.expenseShareId, shareIds)))
      : [];
    const allocatedByOther = new Map<string, number>();
    for (const allocation of allAllocations) {
      if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
        throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is invalid.`);
      }
      if (allocation.repaymentId === repaymentId) continue;
      const total = (allocatedByOther.get(allocation.expenseShareId) ?? 0) + allocation.amount;
      if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is unsafe.`);
      allocatedByOther.set(allocation.expenseShareId, total);
    }

    return {
      ...repayment,
      allocatedAmount,
      unallocatedAmount: repayment.amount - allocatedAmount,
      shares: eligibleShares
        .map((share) => {
          const allocatedByOtherRepayments = allocatedByOther.get(share.id) ?? 0;
          const capacityAvailable = share.amountOwed - allocatedByOtherRepayments;
          if (!Number.isSafeInteger(capacityAvailable) || capacityAvailable < 0) {
            throw new LedgerIntegrityError(`Allocations exceed expense share ${share.id}.`);
          }
          return {
            id: share.id,
            expenseShareId: share.id,
            expenseDescription: share.expenseDescription,
            outingTitle: share.outingTitle,
            outingOccurredAt: share.outingOccurredAt,
            amountOwed: share.amountOwed,
            allocatedByOtherRepayments,
            currentAllocation: currentByShare.get(share.id) ?? 0,
            capacityAvailable,
          };
        })
        .filter((share) => share.capacityAvailable > 0 || share.currentAllocation > 0),
    };
  }

  async function getRepaymentAllocationPlan(repaymentId: string) {
    assertRepaymentId(repaymentId);
    try {
      return await allocationPlanFor(database, repaymentId);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function replaceRepaymentAllocations(repaymentId: string, allocations: RepaymentAllocationInput[]) {
    assertRepaymentId(repaymentId);
    assertRepaymentAllocationsInput(allocations);
    const requested = allocations.map((allocation) => ({
      expenseShareId: allocation.expenseShareId.trim().toLowerCase(),
      amount: allocation.amount,
    }));
    try {
      return await database.transaction(async (transaction) => {
        const [repayment] = await transaction
          .select({ id: repayments.id, friendId: repayments.friendId, amount: repayments.amount })
          .from(repayments)
          .where(and(eq(repayments.ownerUserId, owner), eq(repayments.id, repaymentId)))
          .limit(1)
          .for("update");
        if (!repayment) return notFound();

        const currentAllocations = await transaction
          .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
          .from(repaymentAllocations)
          .where(and(eq(repaymentAllocations.ownerUserId, owner), eq(repaymentAllocations.repaymentId, repaymentId)));
        const lockedShareIds = [...new Set([...currentAllocations.map((allocation) => allocation.expenseShareId), ...requested.map((allocation) => allocation.expenseShareId)])].sort();
        const lockedShares = lockedShareIds.length
          ? await transaction
              .select({ id: expenseShares.id, friendId: expenseShares.friendId, amountOwed: expenseShares.amountOwed })
              .from(expenseShares)
              .where(and(eq(expenseShares.ownerUserId, owner), inArray(expenseShares.id, lockedShareIds)))
              .orderBy(asc(expenseShares.id))
              .for("update")
          : [];
        if (lockedShares.length !== lockedShareIds.length) return notFound();
        if (lockedShares.some((share) => share.friendId !== repayment.friendId)) return notFound();

        const otherAllocations = lockedShareIds.length
          ? await transaction
              .select({ expenseShareId: repaymentAllocations.expenseShareId, amount: repaymentAllocations.amount })
              .from(repaymentAllocations)
              .where(and(
                eq(repaymentAllocations.ownerUserId, owner),
                inArray(repaymentAllocations.expenseShareId, lockedShareIds),
                ne(repaymentAllocations.repaymentId, repaymentId),
              ))
          : [];
        const allocatedByOther = new Map<string, number>();
        for (const allocation of otherAllocations) {
          if (!Number.isSafeInteger(allocation.amount) || allocation.amount <= 0) {
            throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is invalid.`);
          }
          const total = (allocatedByOther.get(allocation.expenseShareId) ?? 0) + allocation.amount;
          if (!Number.isSafeInteger(total)) throw new LedgerIntegrityError(`Allocated amount for share ${allocation.expenseShareId} is unsafe.`);
          allocatedByOther.set(allocation.expenseShareId, total);
        }

        const requestedTotal = requested.reduce((total, allocation) => total + allocation.amount, 0);
        if (!Number.isSafeInteger(requestedTotal)) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment allocations are invalid");
        if (requestedTotal > repayment.amount) throw new RepaymentAllocationAmountInvariantError();
        const sharesById = new Map(lockedShares.map((share) => [share.id, share]));
        for (const allocation of requested) {
          const share = sharesById.get(allocation.expenseShareId);
          if (!share) return notFound();
          const capacityAvailable = share.amountOwed - (allocatedByOther.get(share.id) ?? 0);
          if (allocation.amount > capacityAvailable) throw new RepaymentAllocationShareInvariantError();
        }

        const currentById = new Map(currentAllocations.map((allocation) => [allocation.expenseShareId, allocation]));
        for (const allocation of requested) {
          if (currentById.has(allocation.expenseShareId)) {
            const current = currentById.get(allocation.expenseShareId)!;
            if (current.amount !== allocation.amount) {
              await transaction
                .update(repaymentAllocations)
                .set({ amount: allocation.amount })
                .where(and(
                  eq(repaymentAllocations.ownerUserId, owner),
                  eq(repaymentAllocations.repaymentId, repaymentId),
                  eq(repaymentAllocations.expenseShareId, allocation.expenseShareId),
                ));
            }
          } else {
            await transaction.insert(repaymentAllocations).values({
              ownerUserId: owner,
              repaymentId,
              expenseShareId: allocation.expenseShareId,
              amount: allocation.amount,
            });
          }
        }

        const requestedIds = new Set(requested.map((allocation) => allocation.expenseShareId));
        const omittedIds = currentAllocations.map((allocation) => allocation.expenseShareId).filter((id) => !requestedIds.has(id));
        if (omittedIds.length > 0) {
          await transaction
            .delete(repaymentAllocations)
            .where(and(
              eq(repaymentAllocations.ownerUserId, owner),
              eq(repaymentAllocations.repaymentId, repaymentId),
              inArray(repaymentAllocations.expenseShareId, omittedIds),
            ));
        }

        return await allocationPlanFor(transaction, repaymentId);
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    createFriend,
    getFriend,
    listFriends,
    updateFriend,
    setFriendArchived,
    createOuting,
    getOuting,
    listOutings,
    updateOuting,
    deleteOuting,
    createExpense,
    getExpense,
    listExpenses,
    listLedgerHistory,
    getLedgerSummary,
    getLedgerExportSnapshot,
    listEligibleDebtorShareReceipts,
    getFriendDebtorStatement,
    updateExpense,
    deleteExpense,
    listExpenseShares,
    listOpenExpenseSharesByFriend,
    replaceExpenseShares,
    createRepayment,
    createRepaymentWithAllocations,
    getRepayment,
    listRepayments,
    updateRepayment,
    deleteRepayment,
    getRepaymentAllocationPlan,
    replaceRepaymentAllocations,
  };
}
