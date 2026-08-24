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
  repaymentDestinations,
  repayments,
} from "../../db/schema";
import { LedgerIntegrityError } from "../ledger-summary";
import {
  buildDebtorStatement,
  buildPagedDebtorStatement,
  DEBTOR_STATEMENT_PAGE_SIZE,
  DebtorStatementIntegrityError,
} from "../debtor-statement";
import { validateLedgerExportSnapshot, type LedgerExportSnapshot } from "../ledger-export";
import { notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import { assertFriendId } from "./validation";
import { clampPage, normalizePage } from "../record-retrieval";
import type { DebtorStatementPageOptions, EligibleDebtorShareReceiptGroup } from "./types";
import { toPublicRepaymentDestination, type RepaymentDestinationType } from "../repayment-destination";

export function createLedgerStatementRepository(database: Database, owner: string) {
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

      const destinationRows = await database
        .select({
          type: repaymentDestinations.type,
          name: repaymentDestinations.name,
          identifier: repaymentDestinations.identifier,
          accountName: repaymentDestinations.accountName,
          note: repaymentDestinations.note,
        })
        .from(repaymentDestinations)
        .where(and(eq(repaymentDestinations.ownerUserId, owner), eq(repaymentDestinations.shareOnBalanceLinks, true)))
        .orderBy(asc(repaymentDestinations.sortOrder), asc(repaymentDestinations.id));
      const publicRepaymentDestinations = destinationRows.map((destination) => toPublicRepaymentDestination({
        ...destination,
        type: destination.type as RepaymentDestinationType,
      }));

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
        repaymentDestinations: publicRepaymentDestinations,
        asOf,
      });
    } catch (error) {
      return persistenceError(error);
    }
  }

  return {
    getLedgerExportSnapshot,
    listEligibleDebtorShareReceipts,
    getFriendDebtorStatement,
    getPublicFriendDebtorStatement,
  };
}
