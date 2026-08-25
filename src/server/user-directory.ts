import "server-only";

import { and, asc, isNotNull, like, notInArray, sql } from "drizzle-orm";
import { requireSession } from "@/auth/require-session";
import { getDatabase, type Database } from "@/db/client";
import { escapeLikePattern } from "@/domain/record-retrieval";
import { normalizeUsername } from "@/domain/username";
import { users } from "@/db/schema";

export const USERNAME_DIRECTORY_LIMIT = 20;

export type UsernameDirectoryUser = {
  id: string;
  username: string;
  displayName: string;
};

export type UsernameDirectorySearchOptions = {
  excludeUserIds?: readonly string[];
};

export async function searchUsernameDirectoryInDatabase(database: Database, query: unknown, options: UsernameDirectorySearchOptions = {}): Promise<UsernameDirectoryUser[]> {
  const username = normalizeUsername(query);
  if (!username || !/^[a-z0-9._]*$/.test(username)) return [];
  const conditions = [isNotNull(users.username), like(users.username, `${escapeLikePattern(username)}%`)];
  const excludedUserIds = [...new Set(options.excludeUserIds ?? [])].filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
  if (excludedUserIds.length > 0) conditions.push(notInArray(users.id, excludedUserIds));
  const rows = await database
    .select({ id: users.id, username: users.username, displayName: users.name })
    .from(users)
    .where(and(...conditions))
    .orderBy(sql`case when ${users.username} = ${username} then 0 else 1 end`, asc(users.username), asc(users.id))
    .limit(USERNAME_DIRECTORY_LIMIT);
  return rows.filter((user): user is UsernameDirectoryUser => typeof user.username === "string");
}

export async function searchUsernameDirectory(query: unknown): Promise<UsernameDirectoryUser[]> {
  await requireSession();
  return searchUsernameDirectoryInDatabase(getDatabase(), query);
}
