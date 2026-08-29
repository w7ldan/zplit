import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { LedgerIntegrityError, type FriendBalance, type LedgerSummary } from "../ledger-summary";
import { ledgerDifference, ledgerInteger, persistenceError } from "./query-utils";
import { assertFriendId } from "./validation";
import type { LedgerOverviewSummary } from "./types";

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

type LedgerOverviewAggregateRow = LedgerAggregateRow & { scope_id: unknown };

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

function ledgerAggregateQuery(scope: string, friendLimit?: number) {
  const limit = friendLimit === undefined ? sql`` : sql`LIMIT ${friendLimit}`;
  return sql<LedgerAggregateRow>`
    WITH expense_totals AS (
      SELECT e.id, e.amount::numeric AS amount, COALESCE(SUM(s.amount_owed::numeric), 0) AS assigned_amount
      FROM expenses e
      LEFT JOIN expense_shares s
        ON s.ledger_scope_id = e.ledger_scope_id
        AND s.expense_id = e.id
      WHERE e.ledger_scope_id = ${scope}
      GROUP BY e.id, e.amount
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      LEFT JOIN repayment_allocations a
        ON a.ledger_scope_id = s.ledger_scope_id
        AND a.expense_share_id = s.id
      WHERE s.ledger_scope_id = ${scope}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      LEFT JOIN repayment_allocations a
        ON a.ledger_scope_id = r.ledger_scope_id
        AND a.repayment_id = r.id
      WHERE r.ledger_scope_id = ${scope}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      LEFT JOIN repayments r
        ON r.ledger_scope_id = a.ledger_scope_id
        AND r.id = a.repayment_id
      LEFT JOIN expense_shares s
        ON s.ledger_scope_id = a.ledger_scope_id
        AND s.id = a.expense_share_id
      WHERE a.ledger_scope_id = ${scope}
    ),
    friend_totals AS (
      SELECT f.id, f.name, f.archived_at,
        COALESCE((SELECT SUM(s.amount_owed::numeric) FROM expense_shares s WHERE s.ledger_scope_id = f.ledger_scope_id AND s.friend_id = f.id), 0) AS assigned_amount,
        COALESCE((SELECT SUM(a.amount::numeric) FROM repayment_allocations a INNER JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE a.ledger_scope_id = f.ledger_scope_id AND s.friend_id = f.id), 0) AS repaid_amount
      FROM friends f
      WHERE f.ledger_scope_id = ${scope}
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
        COALESCE((SELECT SUM(amount::numeric) FROM repayments WHERE ledger_scope_id = ${scope}), 0)::text AS total_received_amount,
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

function ledgerOverviewSummariesQuery(scopeIds: string[]) {
  const scopeValues = sql.join(scopeIds.map((scopeId) => sql`${scopeId}`), sql`, `);
  return sql<LedgerOverviewAggregateRow>`
    WITH selected_scopes AS (
      SELECT value AS scope_id
      FROM unnest(ARRAY[${scopeValues}]::uuid[]) AS scope_values(value)
    ),
    expense_totals AS (
      SELECT e.ledger_scope_id AS scope_id, e.id, e.amount::numeric AS amount, COALESCE(SUM(s.amount_owed::numeric), 0) AS assigned_amount
      FROM expenses e
      LEFT JOIN expense_shares s
        ON s.ledger_scope_id = e.ledger_scope_id
        AND s.expense_id = e.id
      WHERE e.ledger_scope_id IN (SELECT scope_id FROM selected_scopes)
      GROUP BY e.ledger_scope_id, e.id, e.amount
    ),
    share_allocation_totals AS (
      SELECT s.ledger_scope_id AS scope_id, s.id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      LEFT JOIN repayment_allocations a
        ON a.ledger_scope_id = s.ledger_scope_id
        AND a.expense_share_id = s.id
      WHERE s.ledger_scope_id IN (SELECT scope_id FROM selected_scopes)
      GROUP BY s.ledger_scope_id, s.id, s.amount_owed
    ),
    repayment_allocation_totals AS (
      SELECT r.ledger_scope_id AS scope_id, r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      LEFT JOIN repayment_allocations a
        ON a.ledger_scope_id = r.ledger_scope_id
        AND a.repayment_id = r.id
      WHERE r.ledger_scope_id IN (SELECT scope_id FROM selected_scopes)
      GROUP BY r.ledger_scope_id, r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.ledger_scope_id AS scope_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      LEFT JOIN repayments r
        ON r.ledger_scope_id = a.ledger_scope_id
        AND r.id = a.repayment_id
      LEFT JOIN expense_shares s
        ON s.ledger_scope_id = a.ledger_scope_id
        AND s.id = a.expense_share_id
      WHERE a.ledger_scope_id IN (SELECT scope_id FROM selected_scopes)
    ),
    integrity AS (
      SELECT selected.scope_id,
        (SELECT COUNT(*) FROM allocation_links WHERE scope_id = selected.scope_id AND (repayment_friend_id IS NULL OR share_friend_id IS NULL OR repayment_friend_id <> share_friend_id))::text AS invalid_cross_friend_allocations,
        (SELECT COUNT(*) FROM repayment_allocation_totals WHERE scope_id = selected.scope_id AND allocated_amount > amount)::text AS invalid_repayment_allocations,
        (SELECT COUNT(*) FROM share_allocation_totals WHERE scope_id = selected.scope_id AND allocated_amount > amount_owed)::text AS invalid_share_allocations,
        (SELECT COUNT(*) FROM expense_totals WHERE scope_id = selected.scope_id AND assigned_amount > amount)::text AS invalid_owner_portions
      FROM selected_scopes selected
    ),
    totals AS (
      SELECT selected.scope_id,
        COALESCE((SELECT SUM(amount) FROM expense_totals WHERE scope_id = selected.scope_id), 0)::text AS total_expense_amount,
        COALESCE((SELECT SUM(amount_owed) FROM share_allocation_totals WHERE scope_id = selected.scope_id), 0)::text AS total_assigned_amount,
        COALESCE((SELECT SUM(allocated_amount) FROM repayment_allocation_totals WHERE scope_id = selected.scope_id), 0)::text AS total_repaid_amount,
        COALESCE((SELECT SUM(amount - assigned_amount) FROM expense_totals WHERE scope_id = selected.scope_id), 0)::text AS owner_portion_amount
      FROM selected_scopes selected
    )
    SELECT totals.scope_id,
      totals.total_expense_amount,
      totals.total_assigned_amount,
      totals.total_repaid_amount,
      '0' AS total_received_amount,
      totals.owner_portion_amount,
      '0' AS total_assigned_friend_count,
      integrity.invalid_cross_friend_allocations,
      integrity.invalid_repayment_allocations,
      integrity.invalid_share_allocations,
      integrity.invalid_owner_portions,
      '[]'::jsonb AS friend_balances
    FROM totals
    INNER JOIN integrity ON integrity.scope_id = totals.scope_id
  `;
}

export type LedgerFinancialOverview = Pick<
  LedgerOverviewSummary,
  "totalExpenseAmount" | "totalRepaidAmount" | "totalOutstandingAmount"
>;

export async function readLedgerOverviewSummaries(
  database: Database,
  scopeIds: string[],
): Promise<Map<string, LedgerFinancialOverview>> {
  const normalizedScopeIds = [
    ...new Set(scopeIds.map((scopeId) => scopeId.trim()).filter(Boolean)),
  ];
  if (normalizedScopeIds.length === 0) return new Map();
  try {
    const result = await database.execute(ledgerOverviewSummariesQuery(normalizedScopeIds));
    const rows = (Array.isArray(result) ? result : result.rows) as LedgerOverviewAggregateRow[];
    return new Map(
      rows.map((row) => {
        const scopeId = ledgerText(row.scope_id, "Ledger scope ID");
        const summary = parseLedgerAggregate(row);
        return [scopeId, {
          totalExpenseAmount: summary.totalExpenseAmount,
          totalRepaidAmount: summary.totalRepaidAmount,
          totalOutstandingAmount: summary.totalOutstandingAmount,
        }];
      }),
    );
  } catch (error) {
    return persistenceError(error);
  }
}

function friendBalancesQuery(scope: string, friendIds: string[]) {
  const friendFilter = sql.join(friendIds.map((friendId) => sql`${friendId}`), sql`, `);
  return sql<LedgerAggregateRow>`
    WITH selected_friends AS (
      SELECT f.id, f.name, f.archived_at
      FROM friends f
      WHERE f.ledger_scope_id = ${scope} AND f.id IN (${friendFilter})
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      INNER JOIN selected_friends f ON f.id = s.friend_id
      LEFT JOIN repayment_allocations a
        ON a.ledger_scope_id = s.ledger_scope_id
        AND a.expense_share_id = s.id
      WHERE s.ledger_scope_id = ${scope}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    repayment_ids AS (
      SELECT DISTINCT a.repayment_id
      FROM repayment_allocations a
      INNER JOIN share_allocation_totals s ON s.id = a.expense_share_id
      WHERE a.ledger_scope_id = ${scope}
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      INNER JOIN repayment_ids ids ON ids.repayment_id = r.id
      LEFT JOIN repayment_allocations a
        ON a.ledger_scope_id = r.ledger_scope_id
        AND a.repayment_id = r.id
      WHERE r.ledger_scope_id = ${scope}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      INNER JOIN repayment_ids ids ON ids.repayment_id = a.repayment_id
      LEFT JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id
      LEFT JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id
      WHERE a.ledger_scope_id = ${scope}
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

export function createLedgerSummaryRepository(database: Database, scope: string) {
  async function getLedgerSummary() {
    try {
      const result = await database.execute(ledgerAggregateQuery(scope));
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
      const result = await database.execute(ledgerAggregateQuery(scope, 8));
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
      const result = await database.execute(friendBalancesQuery(scope, normalizedIds));
      const [row] = (Array.isArray(result) ? result : result.rows) as LedgerAggregateRow[];
      return parseLedgerAggregate(row ?? emptyLedgerAggregate()).friendBalances;
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { getLedgerSummary, getLedgerOverviewSummary, getFriendBalances };
}
