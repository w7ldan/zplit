import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseShares, friends, repayments } from "../../db/schema";
import { literalContains, notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import {
  clampPage,
  normalizeFriendFilters,
  normalizeText,
  normalizeUuid,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "../record-retrieval";
import { assertFriendId } from "./validation";
import type { FriendSelectorOption } from "./types";

export function createFriendsReadRepository(database: Database, owner: string) {
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

async function searchFriends(options: { q?: unknown; selectedId?: unknown; activeOnly?: boolean } = {}): Promise<FriendSelectorOption[]> {
    const query = normalizeText(options.q);
    const selectedId = normalizeUuid(options.selectedId);
    const recentFriendUsage = sql`greatest(
      (select max(${expenseShares.createdAt}) from ${expenseShares} where ${expenseShares.ownerUserId} = ${owner} and ${expenseShares.friendId} = ${friends.id}),
      (select max(${repayments.createdAt}) from ${repayments} where ${repayments.ownerUserId} = ${owner} and ${repayments.friendId} = ${friends.id})
    )`;
    const conditions = [
      eq(friends.ownerUserId, owner),
      ...(options.activeOnly ? [isNull(friends.archivedAt)] : []),
      ...(query ? [selectedId ? or(literalContains(friends.name, query), literalContains(friends.phoneNumber, query), eq(friends.id, selectedId)) : or(literalContains(friends.name, query), literalContains(friends.phoneNumber, query))] : []),
    ];
    try {
      const rows = await database
        .select({ id: friends.id, name: friends.name, archived: sql<boolean>`${friends.archivedAt} is not null` })
        .from(friends)
        .where(and(...conditions))
        .orderBy(
          ...(selectedId ? [sql`case when ${friends.id} = ${selectedId} then 0 else 1 end`] : []),
          ...(!query ? [sql`${recentFriendUsage} desc nulls last`] : []),
          sql`case when ${friends.archivedAt} is null then 0 else 1 end`,
          asc(friends.name),
          asc(friends.id),
        )
        .limit(20);
      return rows;
    } catch (error) {
      return persistenceError(error);
    }
  }

async function listFriendRecords(options: { archived?: unknown; q?: unknown; page?: unknown } = {}): Promise<RecordPage<typeof friends.$inferSelect>> {
    const filters = normalizeFriendFilters(options);
    const conditions = [
      eq(friends.ownerUserId, owner),
      filters.archived ? isNotNull(friends.archivedAt) : isNull(friends.archivedAt),
      ...(filters.q ? [sql`(${literalContains(friends.name, filters.q)} OR ${literalContains(friends.phoneNumber, filters.q)})`] : []),
    ];
    try {
      const [{ count = 0 } = {}] = await database
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(friends)
        .where(and(...conditions));
      const totalItems = safeRetrievalInteger(count, "Friend count");
      const page = clampPage(filters.page, totalItems);
      const items = await database
        .select()
        .from(friends)
        .where(and(...conditions))
        .orderBy(asc(friends.name), asc(friends.id))
        .limit(RECORD_PAGE_SIZE)
        .offset((page - 1) * RECORD_PAGE_SIZE);
      return pageResult(items, totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { getFriend, listFriends, searchFriends, listFriendRecords };
}
