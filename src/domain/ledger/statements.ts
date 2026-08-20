import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
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
} from "../../db/schema";
import { LedgerIntegrityError, type FriendBalance, type LedgerSummary } from "../ledger-summary";
import {
  buildDebtorStatement,
  buildPagedDebtorStatement,
  DEBTOR_STATEMENT_PAGE_SIZE,
  DebtorStatementIntegrityError,
} from "../debtor-statement";
import { validateLedgerExportSnapshot, type LedgerExportSnapshot } from "../ledger-export";
import { ledgerDifference, ledgerInteger, notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import { assertFriendId } from "./validation";
import { clampPage, normalizePage } from "../record-retrieval";
import type { DebtorStatementPageOptions, EligibleDebtorShareReceiptGroup, LedgerOverviewSummary } from "./types";

type LedgerAggregateRow = {
  total_expense_amount: unknown;
  total_assigned_amount: unknown;
  total_repaid_amount: unknown;
  total_received_amount: unknown;
  owner_portion_amount: unknown;
  total_assigned_friend_count: unknown;
  invalid_cross_friend_allocations: unknown;
  invalid_repayment_allocations: unknown;
  invalid_share_allocations: unknown;
  invalid_owner_portions: unknown;
  friend_balances: unknown;
};

function ledgerText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value;
}

function ledgerJson(value: unknown, label: string) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new LedgerIntegrityError(`${label} is invalid.`); }
  }
  if (!Array.isArray(value)) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value;
}

function parseFriendBalances(value: unknown): FriendBalance[] {
  const seen = new Set<string>();
  return ledgerJson(value, "Friend balances").map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new LedgerIntegrityError(`Friend balance ${index} is invalid.`);
    const record = row as Record<string, unknown>;
    const friendId = ledgerText(record.friendId, `Friend balance ${index} ID`);
    if (seen.has(friendId)) throw new LedgerIntegrityError(`Friend balance ${friendId} is duplicated.`);
    seen.add(friendId);
    const name = ledgerText(record.name, `Friend balance ${friendId} name`);
    if (typeof record.archived !== "boolean") throw new LedgerIntegrityError(`Friend balance ${friendId} archive state is invalid.`);
    const assignedAmount = ledgerInteger(record.assignedAmount, `Assigned amount for friend ${friendId}`);
    const repaidAmount = ledgerInteger(record.repaidAmount, `Repaid amount for friend ${friendId}`);
    return {
      friendId,
      name,
      archived: record.archived,
      assignedAmount,
      repaidAmount,
      outstandingAmount: ledgerDifference(assignedAmount, repaidAmount, `Outstanding amount for friend ${friendId}`),
    };
  });
}

function emptyLedgerAggregate(): LedgerAggregateRow {
  return {
    total_expense_amount: "0",
    total_assigned_amount: "0",
    total_repaid_amount: "0",
    total_received_amount: "0",
    owner_portion_amount: "0",
    total_assigned_friend_count: "0",
    invalid_cross_friend_allocations: "0",
    invalid_repayment_allocations: "0",
    invalid_share_allocations: "0",
    invalid_owner_portions: "0",
    friend_balances: [],
  };
}

function parseLedgerAggregate(row: LedgerAggregateRow): LedgerOverviewSummary {
  for (const [value, label] of [
    [row.invalid_cross_friend_allocations, "Cross-friend allocations"],
    [row.invalid_repayment_allocations, "Repayment allocations"],
    [row.invalid_share_allocations, "Expense share allocations"],
    [row.invalid_owner_portions, "Owner portions"],
  ] as const) {
    if (ledgerInteger(value, label) > 0) throw new LedgerIntegrityError(`${label} violate ledger integrity.`);
  }

  const totalExpenseAmount = ledgerInteger(row.total_expense_amount, "Total expense amount");
  const totalAssignedAmount = ledgerInteger(row.total_assigned_amount, "Total assigned amount");
  const totalRepaidAmount = ledgerInteger(row.total_repaid_amount, "Total repaid amount");
  const totalReceivedAmount = ledgerInteger(row.total_received_amount, "Total received amount");
  const ownerPortionAmount = ledgerInteger(row.owner_portion_amount, "Owner portion amount");
  const totalAssignedFriendCount = ledgerInteger(row.total_assigned_friend_count, "Assigned friend count");
  const friendBalances = parseFriendBalances(row.friend_balances);

  return {
    totalExpenseAmount,
    totalAssignedAmount,
    totalRepaidAmount,
    totalReceivedAmount,
    totalUnallocatedRepaymentAmount: ledgerDifference(totalReceivedAmount, totalRepaidAmount, "Total unallocated repayment amount"),
    totalOutstandingAmount: ledgerDifference(totalAssignedAmount, totalRepaidAmount, "Total outstanding amount"),
    ownerPortionAmount,
    totalAssignedFriendCount,
    friendBalances,
  };
}

function ledgerAggregateQuery(owner: string, friendLimit?: number) {
  const limit = friendLimit === undefined ? sql`` : sql`LIMIT ${friendLimit}`;
  return sql<LedgerAggregateRow>`
    WITH expense_totals AS (
      SELECT e.id, e.amount::numeric AS amount, COALESCE(SUM(s.amount_owed::numeric), 0) AS assigned_amount
      FROM expenses e
      LEFT JOIN expense_shares s
        ON s.owner_user_id = e.owner_user_id
        AND s.expense_id = e.id
      WHERE e.owner_user_id = ${owner}
      GROUP BY e.id, e.amount
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = s.owner_user_id
        AND a.expense_share_id = s.id
      WHERE s.owner_user_id = ${owner}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = r.owner_user_id
        AND a.repayment_id = r.id
      WHERE r.owner_user_id = ${owner}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      LEFT JOIN repayments r
        ON r.owner_user_id = a.owner_user_id
        AND r.id = a.repayment_id
      LEFT JOIN expense_shares s
        ON s.owner_user_id = a.owner_user_id
        AND s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    friend_totals AS (
      SELECT f.id, f.name, f.archived_at,
        COALESCE((SELECT SUM(s.amount_owed::numeric) FROM expense_shares s WHERE s.owner_user_id = f.owner_user_id AND s.friend_id = f.id), 0) AS assigned_amount,
        COALESCE((SELECT SUM(a.amount::numeric) FROM repayment_allocations a INNER JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id WHERE a.owner_user_id = f.owner_user_id AND s.friend_id = f.id), 0) AS repaid_amount
      FROM friends f
      WHERE f.owner_user_id = ${owner}
    ),
    friend_balances AS (
      SELECT id, name, archived_at, assigned_amount, repaid_amount, assigned_amount - repaid_amount AS outstanding_amount
      FROM friend_totals
      WHERE assigned_amount > 0
    ),
    integrity AS (
      SELECT
        (SELECT COUNT(*) FROM allocation_links WHERE repayment_friend_id IS NULL OR share_friend_id IS NULL OR repayment_friend_id <> share_friend_id)::text AS invalid_cross_friend_allocations,
        (SELECT COUNT(*) FROM repayment_allocation_totals WHERE allocated_amount > amount)::text AS invalid_repayment_allocations,
        (SELECT COUNT(*) FROM share_allocation_totals WHERE allocated_amount > amount_owed)::text AS invalid_share_allocations,
        (SELECT COUNT(*) FROM expense_totals WHERE assigned_amount > amount)::text AS invalid_owner_portions
    ),
    totals AS (
      SELECT
        COALESCE((SELECT SUM(amount) FROM expense_totals), 0)::text AS total_expense_amount,
        COALESCE((SELECT SUM(amount_owed) FROM share_allocation_totals), 0)::text AS total_assigned_amount,
        COALESCE((SELECT SUM(allocated_amount) FROM repayment_allocation_totals), 0)::text AS total_repaid_amount,
        COALESCE((SELECT SUM(amount::numeric) FROM repayments WHERE owner_user_id = ${owner}), 0)::text AS total_received_amount,
        COALESCE((SELECT SUM(amount - assigned_amount) FROM expense_totals), 0)::text AS owner_portion_amount
    )
    SELECT totals.*, (SELECT COUNT(*) FROM friend_balances)::text AS total_assigned_friend_count,
      integrity.invalid_cross_friend_allocations,
      integrity.invalid_repayment_allocations,
      integrity.invalid_share_allocations,
      integrity.invalid_owner_portions,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'friendId', id,
          'name', name,
          'archived', archived_at IS NOT NULL,
          'assignedAmount', assigned_amount::text,
          'repaidAmount', repaid_amount::text
        ) ORDER BY outstanding_amount DESC, name ASC, id ASC)
        FROM (SELECT * FROM friend_balances ORDER BY outstanding_amount DESC, name ASC, id ASC ${limit}) selected_friend_balances
      ), '[]'::jsonb) AS friend_balances
    FROM totals CROSS JOIN integrity
  `;
}

function friendBalancesQuery(owner: string, friendIds: string[]) {
  const friendFilter = sql.join(friendIds.map((friendId) => sql`${friendId}`), sql`, `);
  return sql<LedgerAggregateRow>`
    WITH selected_friends AS (
      SELECT f.id, f.name, f.archived_at
      FROM friends f
      WHERE f.owner_user_id = ${owner} AND f.id IN (${friendFilter})
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      INNER JOIN selected_friends f ON f.id = s.friend_id
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = s.owner_user_id
        AND a.expense_share_id = s.id
      WHERE s.owner_user_id = ${owner}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    repayment_ids AS (
      SELECT DISTINCT a.repayment_id
      FROM repayment_allocations a
      INNER JOIN share_allocation_totals s ON s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      INNER JOIN repayment_ids ids ON ids.repayment_id = r.id
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = r.owner_user_id
        AND a.repayment_id = r.id
      WHERE r.owner_user_id = ${owner}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      INNER JOIN repayment_ids ids ON ids.repayment_id = a.repayment_id
      LEFT JOIN repayments r ON r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id
      LEFT JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    friend_balances AS (
      SELECT f.id, f.name, f.archived_at,
        COALESCE(SUM(s.amount_owed), 0) AS assigned_amount,
        COALESCE(SUM(s.allocated_amount), 0) AS repaid_amount
      FROM selected_friends f
      LEFT JOIN share_allocation_totals s ON s.friend_id = f.id
      GROUP BY f.id, f.name, f.archived_at
      HAVING COALESCE(SUM(s.amount_owed), 0) > 0
    ),
    integrity AS (
      SELECT
        (SELECT COUNT(*) FROM allocation_links WHERE repayment_friend_id IS NULL OR share_friend_id IS NULL OR repayment_friend_id <> share_friend_id)::text AS invalid_cross_friend_allocations,
        (SELECT COUNT(*) FROM repayment_allocation_totals WHERE allocated_amount > amount)::text AS invalid_repayment_allocations,
        (SELECT COUNT(*) FROM share_allocation_totals WHERE allocated_amount > amount_owed)::text AS invalid_share_allocations,
        (SELECT COUNT(*) FROM friend_balances WHERE assigned_amount - repaid_amount < 0)::text AS invalid_owner_portions
    )
    SELECT
      '0' AS total_expense_amount,
      '0' AS total_assigned_amount,
      '0' AS total_repaid_amount,
      '0' AS total_received_amount,
      '0' AS owner_portion_amount,
      '0' AS total_assigned_friend_count,
      integrity.invalid_cross_friend_allocations,
      integrity.invalid_repayment_allocations,
      integrity.invalid_share_allocations,
      integrity.invalid_owner_portions,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'friendId', id,
          'name', name,
          'archived', archived_at IS NOT NULL,
          'assignedAmount', assigned_amount::text,
          'repaidAmount', repaid_amount::text
        ) ORDER BY assigned_amount - repaid_amount DESC, name ASC, id ASC)
        FROM friend_balances
      ), '[]'::jsonb) AS friend_balances
    FROM integrity
  `;
}



export function createLedgerStatementRepository(database: Database, owner: string) {
async function getLedgerSummary() {
    try {
      const result = await database.execute(ledgerAggregateQuery(owner));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      const aggregate = parseLedgerAggregate(row ?? emptyLedgerAggregate());
      return {
        totalExpenseAmount: aggregate.totalExpenseAmount,
        totalAssignedAmount: aggregate.totalAssignedAmount,
        totalRepaidAmount: aggregate.totalRepaidAmount,
        totalReceivedAmount: aggregate.totalReceivedAmount,
        totalUnallocatedRepaymentAmount: aggregate.totalUnallocatedRepaymentAmount,
        totalOutstandingAmount: aggregate.totalOutstandingAmount,
        ownerPortionAmount: aggregate.ownerPortionAmount,
        friendBalances: aggregate.friendBalances,
      } satisfies LedgerSummary;
    } catch (error) {
      return persistenceError(error);
    }
  }

async function getLedgerOverviewSummary(): Promise<LedgerOverviewSummary> {
    try {
      const result = await database.execute(ledgerAggregateQuery(owner, 8));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      return parseLedgerAggregate(row ?? emptyLedgerAggregate());
    } catch (error) {
      return persistenceError(error);
    }
  }

async function getFriendBalances(friendIds: string[]): Promise<FriendBalance[]> {
    const normalizedIds = [...new Set(friendIds.map((friendId) => {
      assertFriendId(friendId);
      return friendId.trim().toLowerCase();
    }))];
    if (normalizedIds.length === 0) return [];
    try {
      const result = await database.execute(friendBalancesQuery(owner, normalizedIds));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      return parseLedgerAggregate(row ?? emptyLedgerAggregate()).friendBalances;
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

async function getPublicFriendDebtorStatement(
    friendId: string,
    asOf = new Date(),
    debtorShareLinkId: string,
    options: DebtorStatementPageOptions = {},
  ) {
    assertFriendId(friendId);
    try {
      const assignedAmount = sql<number>`coalesce((select sum(${expenseShares.amountOwed}) from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId}), 0)`.mapWith(Number);
      const repaidAmount = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.expenseShareId} in (select ${expenseShares.id} from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId})), 0)`.mapWith(Number);
      const [summary] = await database
        .select({
          id: friends.id,
          name: friends.name,
          assignedAmount,
          repaidAmount,
          expenseCount: sql<number>`(select count(*) from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId})`.mapWith(Number),
          repaymentCount: sql<number>`(select count(*) from ${repayments} where ${repayments.ownerUserId} = ${owner} and ${repayments.friendId} = ${friendId})`.mapWith(Number),
          invalidShareAllocations: sql<number>`(select count(*) from "expense_shares" statement_shares where statement_shares.owner_user_id = ${owner} and statement_shares.friend_id = ${friendId} and coalesce((select sum(statement_allocations.amount) from "repayment_allocations" statement_allocations where statement_allocations.owner_user_id = ${owner} and statement_allocations.expense_share_id = statement_shares.id), 0) > statement_shares.amount_owed)`.mapWith(Number),
          invalidRepaymentAllocations: sql<number>`(select count(*) from "repayments" statement_repayments where statement_repayments.owner_user_id = ${owner} and statement_repayments.friend_id = ${friendId} and coalesce((select sum(statement_allocations.amount) from "repayment_allocations" statement_allocations inner join "expense_shares" statement_shares on statement_shares.owner_user_id = statement_allocations.owner_user_id and statement_shares.id = statement_allocations.expense_share_id and statement_shares.friend_id = statement_repayments.friend_id where statement_allocations.owner_user_id = ${owner} and statement_allocations.repayment_id = statement_repayments.id), 0) > statement_repayments.amount)`.mapWith(Number),
        })
        .from(friends)
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId)))
        .limit(1);
      if (!summary) return notFound();

      const assignedTotal = safeRetrievalInteger(summary.assignedAmount, "Assigned amount");
      const repaidTotal = safeRetrievalInteger(summary.repaidAmount, "Repaid amount");
      if (safeRetrievalInteger(summary.invalidShareAllocations, "Expense share allocation integrity") > 0) throw new LedgerIntegrityError("Allocations exceed an expense share.");
      if (safeRetrievalInteger(summary.invalidRepaymentAllocations, "Repayment allocation integrity") > 0) throw new LedgerIntegrityError("Allocations exceed a repayment.");
      if (repaidTotal > assignedTotal) throw new DebtorStatementIntegrityError("Repaid amount exceeds assigned amount.");
      const expenseTotalItems = safeRetrievalInteger(summary.expenseCount, "Expense share count");
      const repaymentTotalItems = safeRetrievalInteger(summary.repaymentCount, "Repayment count");
      const expensePage = clampPage(normalizePage(options.expensePage), expenseTotalItems, DEBTOR_STATEMENT_PAGE_SIZE);
      const repaymentPage = clampPage(normalizePage(options.repaymentPage), repaymentTotalItems, DEBTOR_STATEMENT_PAGE_SIZE);

      const expenseRepaidAmount = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.expenseShareId} = ${expenseShares.id}), 0)`.mapWith(Number);
      const expenseRows = await database
        .select({
          id: expenseShares.id,
          friendId: expenseShares.friendId,
          expenseId: expenseShares.expenseId,
          expenseDescription: expenses.description,
          outingTitle: outings.title,
          outingOccurredAt: outings.occurredAt,
          amountOwed: expenseShares.amountOwed,
          repaidAmount: expenseRepaidAmount,
        })
        .from(expenseShares)
        .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
        .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
        .where(and(eq(expenseShares.ownerUserId, owner), eq(expenseShares.friendId, friendId)))
        .orderBy(
          sql`case when ${expenseRepaidAmount} < ${expenseShares.amountOwed} then 0 else 1 end`,
          desc(outings.occurredAt),
          asc(expenses.description),
          asc(expenseShares.id),
        )
        .limit(DEBTOR_STATEMENT_PAGE_SIZE)
        .offset((expensePage - 1) * DEBTOR_STATEMENT_PAGE_SIZE);

      const repaymentAllocatedAmount = sql<number>`coalesce((select sum(${repaymentAllocations.amount}) from ${repaymentAllocations} where ${repaymentAllocations.ownerUserId} = ${owner} and ${repaymentAllocations.repaymentId} = ${repayments.id} and ${repaymentAllocations.expenseShareId} in (select ${expenseShares.id} from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friendId})), 0)`.mapWith(Number);
      const repaymentRows = await database
        .select({
          id: repayments.id,
          friendId: repayments.friendId,
          amount: repayments.amount,
          paidAt: repayments.paidAt,
          paymentMethod: repayments.paymentMethod,
          allocatedAmount: repaymentAllocatedAmount,
        })
        .from(repayments)
        .innerJoin(friends, and(eq(friends.ownerUserId, owner), eq(friends.id, repayments.friendId)))
        .where(and(eq(repayments.ownerUserId, owner), eq(repayments.friendId, friendId)))
        .orderBy(desc(repayments.paidAt), desc(repayments.createdAt), asc(repayments.id))
        .limit(DEBTOR_STATEMENT_PAGE_SIZE)
        .offset((repaymentPage - 1) * DEBTOR_STATEMENT_PAGE_SIZE);

      const repaymentIds = repaymentRows.map((repayment) => repayment.id);
      const allocationRows = repaymentIds.length > 0
        ? await database
            .select({
              repaymentId: repaymentAllocations.repaymentId,
              expenseShareId: repaymentAllocations.expenseShareId,
              amount: repaymentAllocations.amount,
              expenseDescription: expenses.description,
              outingTitle: outings.title,
            })
            .from(repaymentAllocations)
            .innerJoin(expenseShares, and(
              eq(expenseShares.ownerUserId, owner),
              eq(expenseShares.id, repaymentAllocations.expenseShareId),
              eq(expenseShares.friendId, friendId),
            ))
            .innerJoin(expenses, and(eq(expenses.ownerUserId, owner), eq(expenses.id, expenseShares.expenseId)))
            .innerJoin(outings, and(eq(outings.ownerUserId, owner), eq(outings.id, expenses.outingId)))
            .where(and(eq(repaymentAllocations.ownerUserId, owner), inArray(repaymentAllocations.repaymentId, repaymentIds)))
            .orderBy(asc(repaymentAllocations.repaymentId), desc(outings.occurredAt), asc(expenses.description), asc(expenseShares.id))
        : [];

      const expenseIds = expenseRows.map((share) => share.expenseId);
      const publicReceipts = debtorShareLinkId && expenseIds.length > 0
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
              inArray(debtorShareReceipts.expenseId, expenseIds),
            ))
            .orderBy(asc(debtorShareReceipts.id))
        : [];

      const allocationsByRepayment = new Map<string, typeof allocationRows>();
      for (const allocation of allocationRows) {
        const allocations = allocationsByRepayment.get(allocation.repaymentId) ?? [];
        allocations.push(allocation);
        allocationsByRepayment.set(allocation.repaymentId, allocations);
      }
      return buildPagedDebtorStatement({
        friend: { id: summary.id, name: summary.name },
        shares: expenseRows,
        repayments: repaymentRows.map((repayment) => ({
          ...repayment,
          allocations: allocationsByRepayment.get(repayment.id) ?? [],
        })),
        publicReceipts,
        assignedAmount: assignedTotal,
        repaidAmount: repaidTotal,
        expensePage: { page: expensePage, totalItems: expenseTotalItems },
        repaymentPage: { page: repaymentPage, totalItems: repaymentTotalItems },
        asOf,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    getLedgerSummary,
    getLedgerOverviewSummary,
    getFriendBalances,
    getLedgerExportSnapshot,
    listEligibleDebtorShareReceipts,
    getFriendDebtorStatement,
    getPublicFriendDebtorStatement,
  };
}
