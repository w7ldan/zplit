import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { LedgerIntegrityError } from "../ledger-summary";
import { LedgerRepositoryError } from "./errors";
import {
  buildLedgerHistory,
  LedgerHistoryError,
  LedgerHistoryIntegrityError,
  parseLedgerHistoryCursor,
  type LedgerHistoryExpenseRecord,
  type LedgerHistoryRepaymentRecord,
  type LedgerHistoryResult,
  type LedgerHistoryType,
} from "../ledger-history";
import { persistenceError, recentActivityDate } from "./query-utils";
import type { RecentActivityRecord } from "./types";

type RecentActivityRow = {
  event_kind: unknown;
  record_id: unknown;
  title_source: unknown;
  detail_source: unknown;
  amount: unknown;
  effective_at: unknown;
  created_at: unknown;
  allocated_amount: unknown;
};

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

function recentActivityText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new LedgerIntegrityError(`${label} is invalid.`);
  return value;
}

function recentActivityAmount(value: unknown, label: string) {
  const amount = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 0) throw new LedgerIntegrityError(`${label} is not a safe whole-rupiah amount.`);
  return amount;
}

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

export function createLedgerHistoryRepository(database: Database, owner: string) {
async function listRecentActivity({ limit = 6 }: { limit?: number } = {}): Promise<RecentActivityRecord[]> {
    if (typeof limit !== "number" || !Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new LedgerRepositoryError("INVALID_INPUT", "Recent activity limit is invalid.");
    }
    try {
      const result = await database.execute<RecentActivityRow>(sql`
        WITH expense_candidates AS MATERIALIZED (
          SELECT
            'Expense'::text AS event_kind,
            e.id AS record_id,
            e.description AS title_source,
            o.title AS detail_source,
            e.amount,
            o.occurred_at AS effective_at,
            e.created_at,
            0::bigint AS allocated_amount
          FROM expenses e
          INNER JOIN outings o
            ON o.owner_user_id = e.owner_user_id
            AND o.id = e.outing_id
          WHERE e.owner_user_id = ${owner}
            AND o.owner_user_id = ${owner}
          ORDER BY o.occurred_at DESC, e.created_at DESC, e.id ASC
          LIMIT ${limit}
        ),
        repayment_candidates AS MATERIALIZED (
          SELECT
            'Repayment'::text AS event_kind,
            r.id AS record_id,
            f.name AS title_source,
            'Money received'::text AS detail_source,
            r.amount,
            r.paid_at AS effective_at,
            r.created_at,
            0::bigint AS allocated_amount
          FROM repayments r
          INNER JOIN friends f
            ON f.owner_user_id = r.owner_user_id
            AND f.id = r.friend_id
          WHERE r.owner_user_id = ${owner}
            AND f.owner_user_id = ${owner}
          ORDER BY r.paid_at DESC, r.created_at DESC, r.id ASC
          LIMIT ${limit}
        ),
        bounded_activity AS MATERIALIZED (
          SELECT * FROM expense_candidates
          UNION ALL
          SELECT * FROM repayment_candidates
        ),
        final_activity AS MATERIALIZED (
          SELECT activity.*
          FROM bounded_activity activity
          ORDER BY
            activity.effective_at DESC,
            CASE WHEN activity.event_kind = 'Expense' THEN 0 ELSE 1 END ASC,
            activity.created_at DESC,
            activity.record_id ASC
          LIMIT ${limit}
        ),
        repayment_totals AS (
          SELECT
            ra.owner_user_id,
            ra.repayment_id,
            COALESCE(SUM(ra.amount), 0) AS allocated_amount
          FROM repayment_allocations ra
          INNER JOIN final_activity activity
            ON activity.event_kind = 'Repayment'
            AND activity.record_id = ra.repayment_id
          WHERE ra.owner_user_id = ${owner}
          GROUP BY ra.owner_user_id, ra.repayment_id
        )
        SELECT
          activity.event_kind,
          activity.record_id,
          activity.title_source,
          activity.detail_source,
          activity.amount,
          activity.effective_at,
          activity.created_at,
          COALESCE(rt.allocated_amount, 0)::bigint AS allocated_amount
        FROM final_activity activity
        LEFT JOIN repayment_totals rt
          ON rt.owner_user_id = ${owner}
          AND rt.repayment_id = activity.record_id
        ORDER BY
          activity.effective_at DESC,
          CASE WHEN activity.event_kind = 'Expense' THEN 0 ELSE 1 END ASC,
          activity.created_at DESC,
          activity.record_id ASC
      `);

      const activityRows = (Array.isArray(result) ? result : result.rows) as RecentActivityRow[];
      return activityRows.map((row) => {
        if (row.event_kind !== "Expense" && row.event_kind !== "Repayment") {
          throw new LedgerIntegrityError("Recent activity event kind is invalid.");
        }
        const id = recentActivityText(row.record_id, "Recent activity record ID");
        const title = recentActivityText(row.title_source, `Recent activity ${row.event_kind} title`);
        const detailSource = recentActivityText(row.detail_source, `Recent activity ${row.event_kind} detail`);
        const amount = recentActivityAmount(row.amount, `Recent activity ${id} amount`);
        const allocatedAmount = recentActivityAmount(row.allocated_amount, `Allocation for repayment ${id}`);
        const date = recentActivityDate(row.effective_at, `Recent activity ${id} date`);
        recentActivityDate(row.created_at, `Recent activity ${id} creation time`);
        if (row.event_kind === "Repayment" && allocatedAmount > amount) {
          throw new LedgerIntegrityError(`Allocations exceed repayment ${id}.`);
        }
        return {
          kind: row.event_kind,
          id,
          title,
          detail: row.event_kind === "Repayment" && amount - allocatedAmount > 0
            ? `${detailSource} · unallocated remains open`
            : detailSource,
          amount,
          date,
        };
      });
    } catch (error) {
      return persistenceError(error);
    }
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

  return { listRecentActivity, listLedgerHistory };
}
