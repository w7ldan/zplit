import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseShares, friendConnections, friendLinkRequests, friends, repayments, users } from "../../db/schema";
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
import { assertFriendArchiveReversalReceipt, assertFriendId, assertFriendInput } from "./validation";
import type { CreateFriendInput, FriendArchiveReversalReceipt, FriendConnectionListRecord, FriendListEntry, FriendListRecord, FriendSelectorOption, UpdateFriendInput } from "./types";

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

  async function listFriendRecords(options: { archived?: unknown; q?: unknown; page?: unknown } = {}): Promise<RecordPage<FriendListRecord>> {
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

  async function listFriendsExperience(options: { archived?: unknown; q?: unknown; page?: unknown } = {}): Promise<RecordPage<FriendListEntry>> {
    const filters = normalizeFriendFilters(options);
    const localConditions = [
      eq(friends.ownerUserId, owner),
      filters.archived ? isNotNull(friends.archivedAt) : isNull(friends.archivedAt),
      ...(filters.q ? [sql`(${literalContains(friends.name, filters.q)} OR ${literalContains(friends.phoneNumber, filters.q)})`] : []),
    ];
    try {
      const [localRows, representedRows, connectionRows] = await Promise.all([
        database
          .select({
            id: friends.id,
            name: friends.name,
            phoneNumber: friends.phoneNumber,
            archivedAt: friends.archivedAt,
            createdAt: friends.createdAt,
            linkedUserId: friends.linkedUserId,
            linkedDisplayName: users.name,
            linkedUsername: users.username,
          })
          .from(friends)
          .leftJoin(users, eq(users.id, friends.linkedUserId))
          .where(and(...localConditions))
          .orderBy(asc(friends.name), asc(friends.id)),
        filters.archived
          ? Promise.resolve([])
          : database
              .select({ linkedUserId: friends.linkedUserId })
              .from(friends)
              .where(and(eq(friends.ownerUserId, owner), isNotNull(friends.linkedUserId))),
        filters.archived
          ? Promise.resolve([])
          : database
              .select({
                id: friendConnections.id,
                userAId: friendConnections.userAId,
                userBId: friendConnections.userBId,
                name: users.name,
                username: users.username,
                requestId: friendLinkRequests.id,
                requestAcceptedAt: friendLinkRequests.acceptedAt,
              })
              .from(friendConnections)
              .innerJoin(users, or(
                and(eq(friendConnections.userAId, owner), eq(users.id, friendConnections.userBId)),
                and(eq(friendConnections.userBId, owner), eq(users.id, friendConnections.userAId)),
              ))
              .leftJoin(friendLinkRequests, and(
                eq(friendLinkRequests.status, "accepted"),
                or(
                  and(eq(friendLinkRequests.ownerUserId, friendConnections.userAId), eq(friendLinkRequests.targetUserId, friendConnections.userBId)),
                  and(eq(friendLinkRequests.ownerUserId, friendConnections.userBId), eq(friendLinkRequests.targetUserId, friendConnections.userAId)),
                ),
              ))
              .where(and(
                or(eq(friendConnections.userAId, owner), eq(friendConnections.userBId, owner)),
                eq(friendConnections.status, "connected"),
                ...(filters.q ? [or(literalContains(users.name, filters.q), literalContains(users.username, filters.q))] : []),
              ))
              .orderBy(asc(users.name), asc(users.id)),
      ]);

      const representedUserIds = new Set([...localRows, ...representedRows].map(({ linkedUserId }) => linkedUserId).filter((id): id is string => Boolean(id)));
      const localEntries: FriendListEntry[] = localRows.map(({ linkedUserId, linkedDisplayName, linkedUsername, ...friend }) => ({
        type: "local",
        friend: {
          ...friend,
          ...(linkedUserId && linkedDisplayName && linkedUsername ? { linkedUser: { displayName: linkedDisplayName, username: linkedUsername } } : {}),
        },
      }));
      const connectionById = new Map<string, { entry: FriendConnectionListRecord; acceptedAt: number }>();
      for (const row of connectionRows) {
        const userId = row.userAId === owner ? row.userBId : row.userAId;
        if (representedUserIds.has(userId) || typeof row.username !== "string" || typeof row.requestId !== "string") continue;
        const acceptedAt = row.requestAcceptedAt?.getTime() ?? -1;
        const current = connectionById.get(row.id);
        if (!current || acceptedAt > current.acceptedAt) {
          connectionById.set(row.id, { acceptedAt, entry: { type: "connection", id: row.id, userId, name: row.name, username: row.username, requestId: row.requestId } });
        }
      }
      const entries = [...localEntries, ...[...connectionById.values()].map(({ entry }) => ({ type: "connection" as const, connection: entry }))];
      entries.sort((left, right) => {
        const leftName = left.type === "local" ? left.friend.name : left.connection.name;
        const rightName = right.type === "local" ? right.friend.name : right.connection.name;
        return leftName.localeCompare(rightName) || (left.type === "local" ? left.friend.id : left.connection.id).localeCompare(right.type === "local" ? right.friend.id : right.connection.id);
      });
      const totalItems = entries.length;
      const page = clampPage(filters.page, totalItems);
      const offset = (page - 1) * RECORD_PAGE_SIZE;
      return pageResult(entries.slice(offset, offset + RECORD_PAGE_SIZE), totalItems, page);
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { getFriend, listFriends, searchFriends, listFriendRecords, listFriendsExperience };
}

export function createFriendsMutationRepository(database: Database, owner: string) {
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

async function archiveFriend(friendId: string) {
    assertFriendId(friendId);
    const archivedAt = new Date();
    const updatedAt = new Date();
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt, updatedAt })
        .where(and(eq(friends.ownerUserId, owner), eq(friends.id, friendId), isNull(friends.archivedAt)))
        .returning();
      if (!friend) return notFound();
      return {
        friend,
        reversalReceipt: {
          version: 1 as const,
          friendId: friend.id,
          archivedAt: friend.archivedAt?.toISOString() ?? archivedAt.toISOString(),
          updatedAt: friend.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      return persistenceError(error);
    }
  }

async function undoFriendArchive(receipt: FriendArchiveReversalReceipt) {
    assertFriendArchiveReversalReceipt(receipt);
    try {
      const [friend] = await database
        .update(friends)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(and(
          eq(friends.ownerUserId, owner),
          eq(friends.id, receipt.friendId),
          eq(friends.archivedAt, new Date(receipt.archivedAt)),
          eq(friends.updatedAt, new Date(receipt.updatedAt)),
        ))
        .returning();
      if (!friend) return notFound();
      return friend;
    } catch (error) {
      return persistenceError(error);
    }
  }

  return { createFriend, updateFriend, setFriendArchived, archiveFriend, undoFriendArchive };
}
