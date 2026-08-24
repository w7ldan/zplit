import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { repaymentDestinations } from "../../db/schema";
import { parseRepaymentDestination, type RepaymentDestinationInput, type RepaymentDestinationType } from "../repayment-destination";
import { LedgerNotFoundError, LedgerRepositoryError } from "./errors";
import { persistenceError } from "./query-utils";

function assertDestinationId(id: string) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new LedgerRepositoryError("INVALID_INPUT", "A repayment destination ID is required");
  }
  return id.toLowerCase();
}

function assertInput(input: unknown): asserts input is RepaymentDestinationInput {
  const result = parseRepaymentDestination(input);
  if (!result.ok) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment destination fields are invalid");
}

function typedDestination<T extends { type: string }>(destination: T) {
  return { ...destination, type: destination.type as RepaymentDestinationType };
}

function orderedIds(value: unknown) {
  if (!Array.isArray(value)) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment destination order is invalid");
  const ids = value.map((id) => assertDestinationId(id));
  if (new Set(ids).size !== ids.length) throw new LedgerRepositoryError("INVALID_INPUT", "Repayment destination order contains duplicates");
  return ids;
}

export function createRepaymentDestinationRepository(database: Database, ownerUserId: string) {
  const owner = ownerUserId.trim();
  if (!owner) throw new LedgerRepositoryError("INVALID_OWNER", "A ledger owner is required");

  async function listRepaymentDestinations() {
    try {
      const destinations = await database
        .select()
        .from(repaymentDestinations)
        .where(eq(repaymentDestinations.ownerUserId, owner))
        .orderBy(asc(repaymentDestinations.sortOrder), asc(repaymentDestinations.id));
      return destinations.map(typedDestination);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function listSharedRepaymentDestinations() {
    try {
      const destinations = await database
        .select()
        .from(repaymentDestinations)
        .where(and(eq(repaymentDestinations.ownerUserId, owner), eq(repaymentDestinations.shareOnBalanceLinks, true)))
        .orderBy(asc(repaymentDestinations.sortOrder), asc(repaymentDestinations.id));
      return destinations.map(typedDestination);
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function createRepaymentDestination(input: RepaymentDestinationInput) {
    assertInput(input);
    try {
      return await database.transaction(async (transaction) => {
        const [last] = await transaction
          .select({ sortOrder: repaymentDestinations.sortOrder })
          .from(repaymentDestinations)
          .where(eq(repaymentDestinations.ownerUserId, owner))
          .orderBy(desc(repaymentDestinations.sortOrder), desc(repaymentDestinations.id))
          .limit(1)
          .for("update");
        const [created] = await transaction
          .insert(repaymentDestinations)
          .values({ ...input, ownerUserId: owner, sortOrder: (last?.sortOrder ?? -1) + 1 })
          .returning();
        if (!created) throw new Error("repayment destination insert returned no row");
        return created;
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function updateRepaymentDestination(id: string, input: RepaymentDestinationInput) {
    const destinationId = assertDestinationId(id);
    assertInput(input);
    try {
      const [updated] = await database
        .update(repaymentDestinations)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(repaymentDestinations.ownerUserId, owner), eq(repaymentDestinations.id, destinationId)))
        .returning();
      if (!updated) throw new LedgerNotFoundError();
      return updated;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function deleteRepaymentDestination(id: string) {
    const destinationId = assertDestinationId(id);
    try {
      const [deleted] = await database
        .delete(repaymentDestinations)
        .where(and(eq(repaymentDestinations.ownerUserId, owner), eq(repaymentDestinations.id, destinationId)))
        .returning({ id: repaymentDestinations.id });
      if (!deleted) throw new LedgerNotFoundError();
      return deleted;
    } catch (error) {
      return persistenceError(error);
    }
  }

  async function reorderRepaymentDestinations(ids: string[]) {
    const requestedIds = orderedIds(ids);
    try {
      await database.transaction(async (transaction) => {
        const existing = await transaction
          .select({ id: repaymentDestinations.id })
          .from(repaymentDestinations)
          .where(eq(repaymentDestinations.ownerUserId, owner))
          .for("update");
        const existingIds = existing.map(({ id }) => id.toLowerCase());
        if (requestedIds.length !== existingIds.length || requestedIds.some((id) => !existingIds.includes(id))) {
          throw new LedgerRepositoryError("INVALID_INPUT", "Repayment destination order does not match the owner destinations");
        }
        for (const [sortOrder, id] of requestedIds.entries()) {
          await transaction
            .update(repaymentDestinations)
            .set({ sortOrder, updatedAt: new Date() })
            .where(and(eq(repaymentDestinations.ownerUserId, owner), eq(repaymentDestinations.id, id)));
        }
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    listRepaymentDestinations,
    listSharedRepaymentDestinations,
    createRepaymentDestination,
    updateRepaymentDestination,
    deleteRepaymentDestination,
    reorderRepaymentDestinations,
  };
}
