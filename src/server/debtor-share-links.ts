import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { debtorShareLinks, friends } from "../db/schema";
import { createLedgerRepository, LedgerNotFoundError } from "../domain/ledger-repository";

export const DEBTOR_SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEBTOR_SHARE_UNAVAILABLE = "This balance link is unavailable.";

export type DebtorShareLinkStatus = {
  status: "none" | "active" | "expired" | "revoked";
  expiresAt: Date | null;
};

export type CreatedDebtorShareLink = {
  token: string;
  expiresAt: Date;
};

export function isCanonicalDebtorShareToken(token: unknown): token is string {
  return typeof token === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token);
}

export function generateDebtorShareToken() {
  const token = randomUUID();
  if (!isCanonicalDebtorShareToken(token)) throw new Error("Generated debtor share token was invalid");
  return token;
}

export function hashDebtorShareToken(token: string) {
  if (!isCanonicalDebtorShareToken(token)) throw new Error("Debtor share token is invalid");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function assertOwnerAndFriend(ownerUserId: string, friendId: string) {
  if (!ownerUserId.trim()) throw new Error("A ledger owner is required");
  if (!friendId.trim()) throw new Error("A friend ID is required");
}

export async function createDebtorShareLink(
  database: Database,
  ownerUserId: string,
  friendId: string,
  now = new Date(),
): Promise<CreatedDebtorShareLink> {
  assertOwnerAndFriend(ownerUserId, friendId);
  const token = generateDebtorShareToken();
  const expiresAt = new Date(now.getTime() + DEBTOR_SHARE_LINK_TTL_MS);

  return database.transaction(async (transaction) => {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, ownerUserId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) throw new LedgerNotFoundError();

    await transaction
      .update(debtorShareLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(debtorShareLinks.ownerUserId, ownerUserId),
          eq(debtorShareLinks.friendId, friendId),
          isNull(debtorShareLinks.revokedAt),
        ),
      );

    const [created] = await transaction
      .insert(debtorShareLinks)
      .values({
        tokenHash: hashDebtorShareToken(token),
        ownerUserId,
        friendId,
        createdAt: now,
        expiresAt,
      })
      .returning({ expiresAt: debtorShareLinks.expiresAt });
    if (!created) throw new Error("Debtor share link was not created");
    return { token, expiresAt: created.expiresAt };
  });
}

export async function revokeDebtorShareLink(
  database: Database,
  ownerUserId: string,
  friendId: string,
  now = new Date(),
) {
  assertOwnerAndFriend(ownerUserId, friendId);
  return database.transaction(async (transaction) => {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ownerUserId, ownerUserId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) return false;

    const revoked = await transaction
      .update(debtorShareLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(debtorShareLinks.ownerUserId, ownerUserId),
          eq(debtorShareLinks.friendId, friendId),
          isNull(debtorShareLinks.revokedAt),
          gt(debtorShareLinks.expiresAt, now),
        ),
      )
      .returning({ id: debtorShareLinks.id });
    return revoked.length > 0;
  });
}

export async function getDebtorShareLinkStatus(
  database: Database,
  ownerUserId: string,
  friendId: string,
  now = new Date(),
): Promise<DebtorShareLinkStatus> {
  assertOwnerAndFriend(ownerUserId, friendId);
  const [link] = await database
    .select({ expiresAt: debtorShareLinks.expiresAt, revokedAt: debtorShareLinks.revokedAt })
    .from(debtorShareLinks)
    .where(and(eq(debtorShareLinks.ownerUserId, ownerUserId), eq(debtorShareLinks.friendId, friendId)))
    .orderBy(desc(debtorShareLinks.createdAt), desc(debtorShareLinks.id))
    .limit(1);
  if (!link) return { status: "none", expiresAt: null };
  if (link.revokedAt) return { status: "revoked", expiresAt: link.expiresAt };
  if (link.expiresAt <= now) return { status: "expired", expiresAt: link.expiresAt };
  return { status: "active", expiresAt: link.expiresAt };
}

export async function resolveDebtorShareLink(database: Database, token: string, now = new Date()) {
  if (!isCanonicalDebtorShareToken(token)) return null;
  const [link] = await database
    .select({ ownerUserId: debtorShareLinks.ownerUserId, friendId: debtorShareLinks.friendId, expiresAt: debtorShareLinks.expiresAt })
    .from(debtorShareLinks)
    .where(
      and(
        eq(debtorShareLinks.tokenHash, hashDebtorShareToken(token)),
        isNull(debtorShareLinks.revokedAt),
        gt(debtorShareLinks.expiresAt, now),
      ),
    )
    .limit(1);
  if (!link) return null;

  try {
    return {
      statement: await createLedgerRepository(database, link.ownerUserId).getFriendDebtorStatement(link.friendId, now),
      expiresAt: link.expiresAt,
    };
  } catch (error) {
    if (error instanceof LedgerNotFoundError) return null;
    throw error;
  }
}
