import { sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { LedgerIntegrityError } from "../ledger-summary";
import { persistenceError, recentActivityDate, safeRetrievalInteger } from "./query-utils";
import { escapeLikePattern, normalizeText, parseAmountSearch } from "../record-retrieval";
import type { GlobalSearchRecord, GlobalSearchRow } from "./types";

export function createLedgerSearchRepository(database: Database, owner: string) {
async function searchGlobalRecords(input: unknown): Promise<GlobalSearchRecord[]> {
    const query = normalizeText(input);
    if (!query) return [];
    const pattern = `%${escapeLikePattern(query)}%`;
    const amount = parseAmountSearch(query);
    const amountMatch = amount === undefined ? sql`false` : sql`e.amount = ${amount}`;
    const repaymentAmountMatch = amount === undefined ? sql`false` : sql`r.amount = ${amount}`;
    try {
      const result = await database.execute<GlobalSearchRow>(sql`
        WITH friend_results AS (
          SELECT 'friend'::text AS record_kind, f.id::text AS record_id, f.name::text AS title_source,
            NULL::text AS detail_source, NULL::text AS context_source, NULL::integer AS amount, NULL::timestamptz AS occurred_at
          FROM friends f
          WHERE f.owner_user_id = ${owner} AND f.name ILIKE ${pattern} ESCAPE ${"\\"}
          ORDER BY f.name ASC, f.id ASC
          LIMIT 5
        ), trip_results AS (
          SELECT 'trip'::text AS record_kind, t.id::text AS record_id, t.name::text AS title_source,
            NULLIF(concat_ws(' — ', t.starts_on::text, t.ends_on::text), '') AS detail_source,
            NULL::text AS context_source, NULL::integer AS amount, NULL::timestamptz AS occurred_at
          FROM trips t
          WHERE t.owner_user_id = ${owner} AND t.name ILIKE ${pattern} ESCAPE ${"\\"}
          ORDER BY t.starts_on DESC NULLS LAST, t.name ASC, t.id ASC
          LIMIT 5
        ), outing_results AS (
          SELECT 'outing'::text AS record_kind, o.id::text AS record_id, o.title::text AS title_source,
            NULL::text AS detail_source, t.name::text AS context_source, NULL::integer AS amount, o.occurred_at
          FROM outings o
          LEFT JOIN trips t ON t.owner_user_id = o.owner_user_id AND t.id = o.trip_id
          WHERE o.owner_user_id = ${owner} AND o.title ILIKE ${pattern} ESCAPE ${"\\"}
          ORDER BY o.occurred_at DESC, o.title ASC, o.id ASC
          LIMIT 5
        ), expense_results AS (
          SELECT 'expense'::text AS record_kind, e.id::text AS record_id, e.description::text AS title_source,
            o.title::text AS detail_source, NULL::text AS context_source, e.amount, NULL::timestamptz AS occurred_at
          FROM expenses e
          INNER JOIN outings o ON o.owner_user_id = e.owner_user_id AND o.id = e.outing_id
          WHERE e.owner_user_id = ${owner}
            AND (e.description ILIKE ${pattern} ESCAPE ${"\\"} OR o.title ILIKE ${pattern} ESCAPE ${"\\"} OR ${amountMatch})
          ORDER BY e.updated_at DESC, e.description ASC, e.id ASC
          LIMIT 5
        ), repayment_results AS (
          SELECT 'repayment'::text AS record_kind, r.id::text AS record_id, f.name::text AS title_source,
            NULL::text AS detail_source, NULL::text AS context_source, r.amount, r.paid_at AS occurred_at
          FROM repayments r
          INNER JOIN friends f ON f.owner_user_id = r.owner_user_id AND f.id = r.friend_id
          WHERE r.owner_user_id = ${owner}
            AND (f.name ILIKE ${pattern} ESCAPE ${"\\"} OR r.payment_method ILIKE ${pattern} ESCAPE ${"\\"} OR ${repaymentAmountMatch})
          ORDER BY r.paid_at DESC, r.created_at DESC, r.id ASC
          LIMIT 5
        )
        SELECT record_kind, record_id, title_source, detail_source, context_source, amount, occurred_at
        FROM (
          SELECT * FROM friend_results
          UNION ALL SELECT * FROM trip_results
          UNION ALL SELECT * FROM outing_results
          UNION ALL SELECT * FROM expense_results
          UNION ALL SELECT * FROM repayment_results
        ) results
        ORDER BY CASE record_kind
          WHEN 'friend' THEN 0 WHEN 'trip' THEN 1 WHEN 'outing' THEN 2 WHEN 'expense' THEN 3 ELSE 4
        END, title_source ASC, record_id ASC
        LIMIT 20
      `);
      const rows = (Array.isArray(result) ? result : result.rows) as GlobalSearchRow[];
      return rows.map((row) => {
        if (!['friend', 'trip', 'outing', 'expense', 'repayment'].includes(String(row.record_kind))) throw new LedgerIntegrityError("Global search record type is invalid.");
        if (typeof row.record_id !== "string" || !row.record_id.trim() || typeof row.title_source !== "string" || !row.title_source.trim()) throw new LedgerIntegrityError("Global search record is invalid.");
        const amountValue = row.amount === null || row.amount === undefined ? undefined : safeRetrievalInteger(row.amount, "Global search amount");
        const date = row.occurred_at === null || row.occurred_at === undefined ? undefined : recentActivityDate(row.occurred_at, "Global search date").toISOString();
        const detail = typeof row.detail_source === "string" && row.detail_source ? row.detail_source : undefined;
        const context = typeof row.context_source === "string" && row.context_source ? row.context_source : undefined;
        return { kind: row.record_kind as GlobalSearchRecord["kind"], id: row.record_id, title: row.title_source, ...(detail ? { detail } : {}), ...(context ? { context } : {}), ...(amountValue === undefined ? {} : { amount: amountValue }), ...(date ? { date } : {}) };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { searchGlobalRecords };
}
