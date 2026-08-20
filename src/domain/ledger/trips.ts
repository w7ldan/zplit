import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenses, friends, outings, trips } from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import { ledgerDifference, ledgerInteger, literalContains, notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import { clampPage, normalizeText, normalizeUuid, pageResult, RECORD_PAGE_SIZE, type RecordPage } from "../record-retrieval";
import { assertTripId, assertTripInput } from "./validation";
import type { CreateTripInput, TripFinancialSummary, TripListRecord, TripSelectorOption, UpdateTripInput } from "./types";

type TripAggregateRow = {
  trip_id: unknown;
  outing_count: unknown;
  expense_count: unknown;
  total_spending_amount: unknown;
  total_assigned_amount: unknown;
  total_repaid_amount: unknown;
  owner_portion_amount: unknown;
  total_outstanding_amount: unknown;
  invalid_cross_friend_allocations: unknown;
  invalid_repayment_allocations: unknown;
  invalid_share_allocations: unknown;
  invalid_owner_portions: unknown;
  friend_settlements: unknown;
};

function tripAggregateQuery(owner: string, tripId: string) {
  return sql<TripAggregateRow>`
    WITH trip_outings AS (
      SELECT o.id
      FROM outings o
      INNER JOIN trips t
        ON t.owner_user_id = o.owner_user_id
        AND t.id = o.trip_id
      WHERE o.owner_user_id = ${owner}
        AND t.owner_user_id = ${owner}
        AND t.id = ${tripId}
    ),
    trip_expenses AS (
      SELECT e.id, e.amount::numeric AS amount, COALESCE(SUM(s.amount_owed::numeric), 0) AS assigned_amount
      FROM expenses e
      INNER JOIN trip_outings o ON o.id = e.outing_id
      LEFT JOIN expense_shares s
        ON s.owner_user_id = e.owner_user_id
        AND s.expense_id = e.id
      WHERE e.owner_user_id = ${owner}
      GROUP BY e.id, e.amount
    ),
    share_allocation_totals AS (
      SELECT s.id, s.friend_id, s.amount_owed::numeric AS amount_owed, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM expense_shares s
      INNER JOIN trip_expenses e ON e.id = s.expense_id
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = s.owner_user_id
        AND a.expense_share_id = s.id
      WHERE s.owner_user_id = ${owner}
      GROUP BY s.id, s.friend_id, s.amount_owed
    ),
    friend_settlements AS (
      SELECT s.friend_id, f.name AS friend_name,
        SUM(s.amount_owed)::text AS amount_owed,
        SUM(s.allocated_amount)::text AS allocated_amount,
        SUM(s.amount_owed - s.allocated_amount)::text AS outstanding_amount
      FROM share_allocation_totals s
      INNER JOIN friends f
        ON f.owner_user_id = ${owner}
        AND f.id = s.friend_id
      GROUP BY s.friend_id, f.name
    ),
    trip_repayment_ids AS (
      SELECT DISTINCT a.repayment_id
      FROM repayment_allocations a
      INNER JOIN share_allocation_totals s ON s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    repayment_allocation_totals AS (
      SELECT r.id, r.amount::numeric AS amount, COALESCE(SUM(a.amount::numeric), 0) AS allocated_amount
      FROM repayments r
      INNER JOIN trip_repayment_ids ids ON ids.repayment_id = r.id
      LEFT JOIN repayment_allocations a
        ON a.owner_user_id = r.owner_user_id
        AND a.repayment_id = r.id
      WHERE r.owner_user_id = ${owner}
      GROUP BY r.id, r.amount
    ),
    allocation_links AS (
      SELECT a.repayment_id, a.expense_share_id, r.friend_id AS repayment_friend_id, s.friend_id AS share_friend_id
      FROM repayment_allocations a
      INNER JOIN trip_repayment_ids ids ON ids.repayment_id = a.repayment_id
      LEFT JOIN repayments r
        ON r.owner_user_id = a.owner_user_id
        AND r.id = a.repayment_id
      LEFT JOIN expense_shares s
        ON s.owner_user_id = a.owner_user_id
        AND s.id = a.expense_share_id
      WHERE a.owner_user_id = ${owner}
    ),
    totals AS (
      SELECT
        (SELECT COUNT(*) FROM trip_outings)::text AS outing_count,
        (SELECT COUNT(*) FROM trip_expenses)::text AS expense_count,
        COALESCE((SELECT SUM(amount) FROM trip_expenses), 0)::text AS total_spending_amount,
        COALESCE((SELECT SUM(assigned_amount) FROM trip_expenses), 0)::text AS total_assigned_amount,
        COALESCE((SELECT SUM(allocated_amount) FROM share_allocation_totals), 0)::text AS total_repaid_amount,
        COALESCE((SELECT SUM(amount - assigned_amount) FROM trip_expenses), 0)::text AS owner_portion_amount,
        COALESCE((SELECT SUM(amount_owed - allocated_amount) FROM share_allocation_totals), 0)::text AS total_outstanding_amount,
        (SELECT COUNT(*) FROM allocation_links WHERE repayment_friend_id IS NULL OR share_friend_id IS NULL OR repayment_friend_id <> share_friend_id)::text AS invalid_cross_friend_allocations,
        (SELECT COUNT(*) FROM repayment_allocation_totals WHERE allocated_amount > amount)::text AS invalid_repayment_allocations,
        (SELECT COUNT(*) FROM share_allocation_totals WHERE allocated_amount > amount_owed)::text AS invalid_share_allocations,
        (SELECT COUNT(*) FROM trip_expenses WHERE assigned_amount > amount)::text AS invalid_owner_portions,
        COALESCE((SELECT json_agg(json_build_object(
          'friend_id', friend_id,
          'friend_name', friend_name,
          'amount_owed', amount_owed,
          'allocated_amount', allocated_amount,
          'outstanding_amount', outstanding_amount
        ) ORDER BY friend_name, friend_id) FROM friend_settlements), '[]'::json) AS friend_settlements
    )
    SELECT t.id AS trip_id, totals.*
    FROM trips t
    CROSS JOIN totals
    WHERE t.owner_user_id = ${owner}
      AND t.id = ${tripId}
  `;
}

function parseTripSettlements(value: unknown) {
  if (!Array.isArray(value)) throw new LedgerIntegrityError("Trip friend settlements are invalid.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new LedgerIntegrityError(`Trip friend settlement ${index} is invalid.`);
    const row = entry as Record<string, unknown>;
    if (typeof row.friend_id !== "string" || !row.friend_id || typeof row.friend_name !== "string") throw new LedgerIntegrityError(`Trip friend settlement ${index} is invalid.`);
    const amountOwed = ledgerInteger(row.amount_owed, `Trip friend ${row.friend_id} amount owed`);
    const allocatedAmount = ledgerInteger(row.allocated_amount, `Trip friend ${row.friend_id} allocated amount`);
    const outstandingAmount = ledgerInteger(row.outstanding_amount, `Trip friend ${row.friend_id} outstanding amount`);
    if (outstandingAmount !== ledgerDifference(amountOwed, allocatedAmount, `Trip friend ${row.friend_id} outstanding amount`)) throw new LedgerIntegrityError(`Trip friend ${row.friend_id} outstanding amount is inconsistent.`);
    return { friendId: row.friend_id, friendName: row.friend_name, amountOwed, allocatedAmount, outstandingAmount };
  });
}

function parseTripAggregate(row: TripAggregateRow): TripFinancialSummary {
  for (const [value, label] of [
    [row.invalid_cross_friend_allocations, "Cross-friend allocations"],
    [row.invalid_repayment_allocations, "Repayment allocations"],
    [row.invalid_share_allocations, "Expense share allocations"],
    [row.invalid_owner_portions, "Owner portions"],
  ] as const) {
    if (ledgerInteger(value, label) > 0) throw new LedgerIntegrityError(`${label} violate ledger integrity.`);
  }

  const totalSpendingAmount = ledgerInteger(row.total_spending_amount, "Trip total spending amount");
  const totalAssignedAmount = ledgerInteger(row.total_assigned_amount, "Trip assigned amount");
  const totalRepaidAmount = ledgerInteger(row.total_repaid_amount, "Trip repaid amount");
  const ownerPortionAmount = ledgerInteger(row.owner_portion_amount, "Trip owner portion amount");
  const totalOutstandingAmount = ledgerInteger(row.total_outstanding_amount, "Trip outstanding amount");
  if (ownerPortionAmount !== ledgerDifference(totalSpendingAmount, totalAssignedAmount, "Trip owner portion amount")) {
    throw new LedgerIntegrityError("Trip owner portion is inconsistent.");
  }
  if (totalOutstandingAmount !== ledgerDifference(totalAssignedAmount, totalRepaidAmount, "Trip outstanding amount")) {
    throw new LedgerIntegrityError("Trip outstanding amount is inconsistent.");
  }

  return {
    outingCount: ledgerInteger(row.outing_count, "Trip outing count"),
    expenseCount: ledgerInteger(row.expense_count, "Trip expense count"),
    expenseTotal: totalSpendingAmount,
    totalAssignedAmount,
    ownerPortionAmount,
    totalOutstandingAmount,
    friendSettlements: parseTripSettlements(row.friend_settlements ?? []),
  };
}

export function createTripsReadRepository(database: Database, owner: string) {
async function getTrip(tripId: string) {
    assertTripId(tripId);
    try {
      const [trip] = await database
        .select()
        .from(trips)
        .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
        .limit(1);
      if (!trip) return notFound();
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

async function searchTrips(options: { q?: unknown; selectedId?: unknown } = {}): Promise<TripSelectorOption[]> {
    const query = normalizeText(options.q);
    const selectedId = normalizeUuid(options.selectedId);
    const conditions = [
      eq(trips.ownerUserId, owner),
      ...(query ? [selectedId ? or(literalContains(trips.name, query), eq(trips.id, selectedId)) : literalContains(trips.name, query)] : []),
    ];
    try {
      return await database
        .select({ id: trips.id, name: trips.name })
        .from(trips)
        .where(and(...conditions))
        .orderBy(
          ...(selectedId ? [sql`case when ${trips.id} = ${selectedId} then 0 else 1 end`] : []),
          sql`${trips.startsOn} DESC NULLS LAST`,
          desc(trips.createdAt),
          asc(trips.name),
          asc(trips.id),
        )
        .limit(20);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listTripRecords(options: { q?: unknown; page?: unknown } = {}): Promise<RecordPage<TripListRecord>> {
    const query = normalizeText(options.q);
    const conditions = [eq(trips.ownerUserId, owner), ...(query ? [literalContains(trips.name, query)] : [])];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(trips)
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Trip count");
      const page = clampPage(options.page === undefined ? 1 : Number(options.page), totalItems);
      const pageTrips = database
        .select({ id: trips.id, ownerUserId: trips.ownerUserId })
        .from(trips)
        .where(and(...conditions))
        .orderBy(sql`${trips.startsOn} DESC NULLS LAST`, desc(trips.createdAt), asc(trips.name), asc(trips.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE)
        .as("trip_page");
      const totals = database
        .select({
          tripId: outings.tripId,
          outingCount: sql<number>`count(distinct ${outings.id})`.mapWith(Number).as("outing_count"),
          expenseCount: sql<number>`count(${expenses.id})`.mapWith(Number).as("expense_count"),
          expenseTotal: sql<number>`coalesce(sum(${expenses.amount}), 0)`.mapWith(Number).as("expense_total"),
        })
        .from(outings)
        .innerJoin(pageTrips, and(eq(pageTrips.id, outings.tripId), eq(pageTrips.ownerUserId, outings.ownerUserId)))
        .leftJoin(expenses, and(eq(expenses.ownerUserId, outings.ownerUserId), eq(expenses.outingId, outings.id)))
        .where(eq(outings.ownerUserId, owner))
        .groupBy(outings.ownerUserId, outings.tripId)
        .as("trip_totals");
      const rows = await database
        .select({ trip: trips, outingCount: totals.outingCount, expenseCount: totals.expenseCount, expenseTotal: totals.expenseTotal })
        .from(trips)
        .innerJoin(pageTrips, and(eq(pageTrips.id, trips.id), eq(pageTrips.ownerUserId, trips.ownerUserId)))
        .leftJoin(totals, and(eq(totals.tripId, trips.id)))
        .where(eq(trips.ownerUserId, owner))
        .orderBy(sql`${trips.startsOn} DESC NULLS LAST`, desc(trips.createdAt), asc(trips.name), asc(trips.id));
      const items = rows.map((row) => {
        const raw = row as unknown as Record<string, unknown>;
        return {
          ...row.trip,
          outingCount: safeRetrievalInteger(raw.outing_count ?? row.outingCount ?? 0, "Trip outing count"),
          expenseCount: safeRetrievalInteger(raw.expense_count ?? row.expenseCount ?? 0, "Trip expense count"),
          expenseTotal: safeRetrievalInteger(raw.expense_total ?? row.expenseTotal ?? 0, "Trip expense total"),
        };
      });
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

async function getTripSummary(tripId: string): Promise<TripFinancialSummary> {
    assertTripId(tripId);
    try {
      const result = await database.execute(tripAggregateQuery(owner, tripId));
      const [row] = (Array.isArray(result) ? result : result.rows) as TripAggregateRow[];
      if (!row) return notFound();
      return parseTripAggregate(row);
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { getTrip, searchTrips, listTripRecords, getTripSummary };
}

export function createTripsMutationRepository(database: Database, owner: string) {
async function createTrip(input: CreateTripInput) {
    assertTripInput(input);
    try {
      const [trip] = await database.insert(trips).values({ ...input, ownerUserId: owner }).returning();
      if (!trip) return persistenceError(new Error("trip insert returned no row"));
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

async function updateTrip(tripId: string, input: UpdateTripInput) {
    assertTripId(tripId);
    assertTripInput(input);
    try {
      const [trip] = await database
        .update(trips)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
        .returning();
      if (!trip) return notFound();
      return trip;
    } catch (error) {
      return persistenceError(error);
    }
  }

async function deleteTrip(tripId: string) {
    assertTripId(tripId);
    try {
      return await database.transaction(async (transaction) => {
        const [trip] = await transaction
          .select({ id: trips.id })
          .from(trips)
          .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
          .limit(1)
          .for("update");
        if (!trip) return notFound();
        const detached = await transaction
          .update(outings)
          .set({ tripId: null, updatedAt: new Date() })
          .where(and(eq(outings.ownerUserId, owner), eq(outings.tripId, tripId)))
          .returning({ id: outings.id });
        const deleted = await transaction
          .delete(trips)
          .where(and(eq(trips.ownerUserId, owner), eq(trips.id, tripId)))
          .returning({ id: trips.id });
        if (deleted.length === 0) return notFound();
        return { detachedOutingCount: detached.length };
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { createTrip, updateTrip, deleteTrip };
}
