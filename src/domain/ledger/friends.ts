import { and, asc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { expenseShares, friends, repayments } from "../../db/schema";
import { literalContains, notFound, persistenceError, safeRetrievalInteger } from "./query-utils";
import {
  clampPage,
  normalizeFriendFilters,
  normalizeText,
  normalizeUuid,
  escapeLikePattern,
  pageResult,
  RECORD_PAGE_SIZE,
  type RecordPage,
} from "../record-retrieval";
import { assertFriendArchiveReversalReceipt, assertFriendId, assertFriendInput } from "./validation";
import { normalizeUsername } from "../username";
import type { CreateFriendInput, FriendArchiveReversalReceipt, FriendListEntry, FriendListRecord, FriendSelectorOption, UpdateFriendInput } from "./types";

type FriendExperienceRow = {
  entry_type: "local" | "connection";
  entry_id: string;
  user_id: string | null;
  request_id: string | null;
  name: string;
  phone_number: string | null;
  archived_at: Date | null;
  created_at: Date | string | null;
  linked_display_name: string | null;
  linked_username: string | null;
};

function friendExperienceCte(owner: string, filters: ReturnType<typeof normalizeFriendFilters>) {
  const query = filters.q;
  const pattern = query ? `%${escapeLikePattern(query)}%` : "";
  const usernameQuery = normalizeUsername(query);
  const usernamePattern = usernameQuery ? `%${escapeLikePattern(usernameQuery)}%` : "";
  const usernameSearch = usernameQuery ? sql` ILIKE ${usernamePattern} ESCAPE ${"\\"}` : sql` IS NOT NULL AND FALSE`;
  const localSearch = query ? sql`AND (
    f.name ILIKE ${pattern} ESCAPE ${"\\"}
    OR f.phone_number ILIKE ${pattern} ESCAPE ${"\\"}
    OR linked.name ILIKE ${pattern} ESCAPE ${"\\"}
    OR linked.username${usernameSearch}
  )` : sql``;
  const connectionSearch = query ? sql`AND (
    connected_user.name ILIKE ${pattern} ESCAPE ${"\\"}
    OR connected_user.username${usernameSearch}
  )` : sql``;
  const archiveFilter = filters.archived ? sql`f.archived_at IS NOT NULL` : sql`f.archived_at IS NULL`;

  return sql`
    WITH represented_users AS (
      SELECT DISTINCT f.linked_user_id AS user_id
      FROM friends f
      WHERE f.owner_user_id = ${owner}
        AND f.linked_user_id IS NOT NULL
        AND f.archived_at IS NULL
    ),
    accepted_requests AS (
      SELECT DISTINCT ON (LEAST(r.owner_user_id, r.target_user_id), GREATEST(r.owner_user_id, r.target_user_id))
        LEAST(r.owner_user_id, r.target_user_id) AS user_a_id,
        GREATEST(r.owner_user_id, r.target_user_id) AS user_b_id,
        r.id::text AS request_id
      FROM friend_link_requests r
      WHERE r.status = 'accepted'
      ORDER BY LEAST(r.owner_user_id, r.target_user_id), GREATEST(r.owner_user_id, r.target_user_id), r.accepted_at DESC NULLS LAST, r.id DESC
    ),
    unified_friends AS (
      SELECT
        'local'::text AS entry_type,
        f.id::text AS entry_id,
        f.linked_user_id AS user_id,
        NULL::text AS request_id,
        f.name::text AS name,
        f.phone_number::text AS phone_number,
        f.archived_at AS archived_at,
        f.created_at AS created_at,
        linked.name::text AS linked_display_name,
        linked.username::text AS linked_username
      FROM friends f
      LEFT JOIN users linked ON linked.id = f.linked_user_id
      WHERE f.owner_user_id = ${owner}
        AND ${archiveFilter}
        ${localSearch}

      UNION ALL

      SELECT
        'connection'::text AS entry_type,
        connection.id::text AS entry_id,
        CASE WHEN connection.user_a_id = ${owner} THEN connection.user_b_id ELSE connection.user_a_id END AS user_id,
        request.request_id,
        connected_user.name::text AS name,
        NULL::text AS phone_number,
        NULL::timestamptz AS archived_at,
        NULL::timestamptz AS created_at,
        NULL::text AS linked_display_name,
        connected_user.username::text AS linked_username
      FROM friend_connections connection
      INNER JOIN users connected_user
        ON connected_user.id = CASE WHEN connection.user_a_id = ${owner} THEN connection.user_b_id ELSE connection.user_a_id END
      INNER JOIN accepted_requests request
        ON request.user_a_id = connection.user_a_id
        AND request.user_b_id = connection.user_b_id
      WHERE connection.status = 'connected'
        AND (connection.user_a_id = ${owner} OR connection.user_b_id = ${owner})
        AND connected_user.username IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM represented_users represented
          WHERE represented.user_id = CASE WHEN connection.user_a_id = ${owner} THEN connection.user_b_id ELSE connection.user_a_id END
        )
        ${filters.archived ? sql`AND FALSE` : connectionSearch}
    )
  `;
}

function mapFriendExperienceRow(row: FriendExperienceRow): FriendListEntry {
  if (row.entry_type === "local") {
    return {
      type: "local",
      friend: {
        id: row.entry_id,
        name: row.name,
        phoneNumber: row.phone_number,
        archivedAt: row.archived_at,
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at!),
        ...(row.linked_display_name && row.linked_username ? { linkedUser: { displayName: row.linked_display_name, username: row.linked_username } } : {}),
      },
    };
  }
  return {
    type: "connection",
    connection: {
      type: "connection",
      id: row.entry_id,
      userId: row.user_id!,
      name: row.name,
      username: row.linked_username!,
      requestId: row.request_id!,
    },
  };
}

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
    try {
      const cte = friendExperienceCte(owner, filters);
      const countResult = await database.execute<{ total_items: unknown }>(sql`${cte} SELECT count(*) AS total_items FROM unified_friends`);
      const countRows = (Array.isArray(countResult) ? countResult : countResult.rows) as Array<{ total_items?: unknown }>;
      const totalItems = safeRetrievalInteger(countRows[0]?.total_items ?? 0, "Friend count");
      const page = clampPage(filters.page, totalItems);
      const pageQueryResult = await database.execute<FriendExperienceRow>(sql`${cte}
        SELECT entry_type, entry_id, user_id, request_id, name, phone_number, archived_at, created_at, linked_display_name, linked_username
        FROM unified_friends
        ORDER BY name ASC, entry_type ASC, entry_id ASC
        LIMIT ${RECORD_PAGE_SIZE} OFFSET ${(page - 1) * RECORD_PAGE_SIZE}
      `);
      const rows = (Array.isArray(pageQueryResult) ? pageQueryResult : pageQueryResult.rows) as FriendExperienceRow[];
      return pageResult(rows.map(mapFriendExperienceRow), totalItems, page);
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
