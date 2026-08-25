import "server-only";

import { and, asc, isNotNull, like, sql } from "drizzle-orm";
import { requireSession } from "@/auth/require-session";
import { getDatabase } from "@/db/client";
import { escapeLikePattern } from "@/domain/record-retrieval";
import { normalizeUsername } from "@/domain/username";
import { users } from "@/db/schema";

export const USERNAME_DIRECTORY_LIMIT = 20;

export type UsernameDirectoryUser = {
  id: string;
  username: string;
  displayName: string;
};

export async function searchUsernameDirectory(query: unknown): Promise<UsernameDirectoryUser[]> {
  await requireSession();
  const username = normalizeUsername(query);
  if (!username || !/^[a-z0-9._]*$/.test(username)) return [];
  const rows = await getDatabase()
    .select({ id: users.id, username: users.username, displayName: users.name })
    .from(users)
    .where(and(isNotNull(users.username), like(users.username, `${escapeLikePattern(username)}%`)))
    .orderBy(sql`case when ${users.username} = ${username} then 0 else 1 end`, asc(users.username), asc(users.id))
    .limit(USERNAME_DIRECTORY_LIMIT);
  return rows.filter((user): user is UsernameDirectoryUser => typeof user.username === "string");
}
