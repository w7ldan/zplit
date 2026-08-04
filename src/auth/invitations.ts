import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDatabasePool } from "../db/client";
import type { Database } from "../db/client";
import {
  accountInvitations,
  accounts,
  expenseShares,
  expenses,
  friends,
  outings,
  repaymentAllocations,
  repayments,
  sessions,
  users,
} from "../db/schema";
import { getTrustedAuth } from "./runtime";

export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
export const INVITATION_LOCK_KEY = 20603020;
export const INVITATION_UNAVAILABLE_ERROR = "This invitation is unavailable.";
export const EXISTING_ACCOUNT_ERROR = "An account with that email already exists.";
export const ACTIVE_INVITATION_ERROR = "An active invitation already exists for that email.";

export type AccountInvitation = typeof accountInvitations.$inferSelect;

export function generateInvitationToken() {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isInvitationToken(token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const bytes = Buffer.from(token, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === token;
}

export function normalizeInvitationEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function normalizeSuggestedName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function validateInvitationEmail(email: string) {
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateSuggestedName(name: string) {
  return name.length > 0 && name.length <= 120;
}

export function validateInvitePassword(password: string, minLength = 16, maxLength = 128) {
  if (password.length < minLength) return `Password must be at least ${minLength} characters.`;
  if (password.length > maxLength) return `Password must be no more than ${maxLength} characters.`;
  return "";
}

export class InvitationAuthorizationError extends Error {
  constructor() {
    super("Invitation management is restricted to the installation owner.");
    this.name = "InvitationAuthorizationError";
  }
}

export class InvitationUnavailableError extends Error {
  constructor() {
    super(INVITATION_UNAVAILABLE_ERROR);
    this.name = "InvitationUnavailableError";
  }
}

export async function resolveInstallationOwner(db: Database) {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return owner ?? null;
}

export async function isInstallationOwner(db: Database, userId: string) {
  const owner = await resolveInstallationOwner(db);
  return owner?.id === userId;
}

async function assertInstallationOwner(db: Database, userId: string) {
  if (!(await isInstallationOwner(db, userId))) throw new InvitationAuthorizationError();
}

export async function withInvitationLock<T>(callback: () => Promise<T>) {
  const client = await getDatabasePool().connect();
  let result!: T;
  let failure: unknown;
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [INVITATION_LOCK_KEY]);
    locked = true;
    result = await callback();
  } catch (error) {
    failure = error;
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [INVITATION_LOCK_KEY]);
      } catch (error) {
        failure ??= error;
      }
    }
    client.release();
  }
  if (failure) throw failure;
  return result;
}

function invitationByHash(db: Database, tokenHash: string, now: Date) {
  return db
    .select()
    .from(accountInvitations)
    .where(
      and(
        eq(accountInvitations.tokenHash, tokenHash),
        gt(accountInvitations.expiresAt, now),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.acceptedUserId),
        isNull(accountInvitations.revokedAt),
      ),
    )
    .limit(1);
}

export async function createInvitation(
  db: Database,
  input: { email: string; suggestedName: string | null; createdByUserId: string; now?: Date },
) {
  return withInvitationLock(async () => {
    const now = input.now ?? new Date();
    const email = normalizeInvitationEmail(input.email);
    const suggestedName = input.suggestedName ? normalizeSuggestedName(input.suggestedName) : null;
    if (!validateInvitationEmail(email) || (suggestedName !== null && !validateSuggestedName(suggestedName))) {
      throw new Error("Invitation fields are invalid.");
    }
    await assertInstallationOwner(db, input.createdByUserId);
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existingUser) throw new Error(EXISTING_ACCOUNT_ERROR);
    const [activeInvitation] = await db
      .select({ id: accountInvitations.id })
      .from(accountInvitations)
      .where(
        and(
          eq(accountInvitations.email, email),
          gt(accountInvitations.expiresAt, now),
          isNull(accountInvitations.acceptedAt),
          isNull(accountInvitations.revokedAt),
        ),
      )
      .limit(1);
    if (activeInvitation) throw new Error(ACTIVE_INVITATION_ERROR);

    const token = generateInvitationToken();
    const [invitation] = await db
      .insert(accountInvitations)
      .values({
        tokenHash: hashInvitationToken(token),
        email,
        suggestedName,
        createdByUserId: input.createdByUserId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      })
      .returning();
    if (!invitation) throw new Error("Invitation was not created");
    return { invitation, token };
  });
}

export async function findUsableInvitation(db: Database, token: string, now = new Date()) {
  if (!isInvitationToken(token)) return null;
  const [invitation] = await invitationByHash(db, hashInvitationToken(token), now);
  return invitation ?? null;
}

export async function listInvitations(db: Database, createdByUserId: string) {
  await assertInstallationOwner(db, createdByUserId);
  return db
    .select()
    .from(accountInvitations)
    .where(eq(accountInvitations.createdByUserId, createdByUserId))
    .orderBy(desc(accountInvitations.createdAt));
}

export async function revokeInvitation(db: Database, id: string, createdByUserId: string, now = new Date()) {
  return withInvitationLock(async () => {
    await assertInstallationOwner(db, createdByUserId);
    const [invitation] = await db
      .update(accountInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(accountInvitations.id, id),
          eq(accountInvitations.createdByUserId, createdByUserId),
          isNull(accountInvitations.claimedAt),
          isNull(accountInvitations.acceptedAt),
          isNull(accountInvitations.revokedAt),
        ),
      )
      .returning();
    return invitation ?? null;
  });
}

type MatchingAccount = {
  user: typeof users.$inferSelect;
  account: typeof accounts.$inferSelect;
};

async function findMatchingCredentialAccount(db: Database, email: string): Promise<MatchingAccount | null> {
  const matchingUsers = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  if (matchingUsers.length !== 1) return null;
  const matchingAccounts = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, matchingUsers[0].id), eq(accounts.providerId, "credential")));
  if (matchingAccounts.length !== 1) return null;
  return { user: matchingUsers[0], account: matchingAccounts[0] };
}

async function hasDomainRows(db: Database, userId: string) {
  const result = await db.execute(sql`
    SELECT EXISTS (SELECT 1 FROM ${friends} WHERE ${friends.ownerUserId} = ${userId})
      OR EXISTS (SELECT 1 FROM ${outings} WHERE ${outings.ownerUserId} = ${userId})
      OR EXISTS (SELECT 1 FROM ${expenses} WHERE ${expenses.ownerUserId} = ${userId})
      OR EXISTS (SELECT 1 FROM ${expenseShares} WHERE ${expenseShares.ownerUserId} = ${userId})
      OR EXISTS (SELECT 1 FROM ${repayments} WHERE ${repayments.ownerUserId} = ${userId})
      OR EXISTS (SELECT 1 FROM ${repaymentAllocations} WHERE ${repaymentAllocations.ownerUserId} = ${userId})
      AS has_rows
  `);
  return Boolean((result.rows[0] as { has_rows?: boolean } | undefined)?.has_rows);
}

async function claimInvitationForAcceptance(db: Database, tokenHash: string, now: Date) {
  return db.transaction(async (transaction) => {
    const [invitation] = await transaction
      .select()
      .from(accountInvitations)
      .where(eq(accountInvitations.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    if (
      !invitation ||
      invitation.expiresAt <= now ||
      invitation.acceptedAt ||
      invitation.acceptedUserId ||
      invitation.revokedAt
    ) return null;

    if (invitation.claimedAt) {
      const existing = await findMatchingCredentialAccount(transaction, invitation.email);
      if (
        existing &&
        existing.user.createdAt >= invitation.claimedAt &&
        existing.account.createdAt >= invitation.claimedAt
      ) return { invitation, existing };
    }

    const [claimed] = await transaction
      .update(accountInvitations)
      .set({ claimedAt: now })
      .where(eq(accountInvitations.id, invitation.id))
      .returning();
    return claimed ? { invitation: claimed, existing: null } : null;
  });
}

async function clearClaim(db: Database, id: string, claimedAt: Date) {
  await db
    .update(accountInvitations)
    .set({ claimedAt: null })
    .where(
      and(
        eq(accountInvitations.id, id),
        eq(accountInvitations.claimedAt, claimedAt),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.acceptedUserId),
      ),
    );
}

export async function acceptInvitation(
  db: Database,
  token: string,
  input: { name: string; password: string; now?: Date },
) {
  if (!isInvitationToken(token)) throw new InvitationUnavailableError();
  return withInvitationLock(async () => {
    const now = input.now ?? new Date();
    const claimed = await claimInvitationForAcceptance(db, hashInvitationToken(token), now);
    if (!claimed) throw new InvitationUnavailableError();

    let matching = claimed.existing;
    if (!matching) {
      try {
        const signup = await getTrustedAuth().api.signUpEmail({
          body: { name: input.name, email: claimed.invitation.email, password: input.password },
        });
        if (signup.token !== null) throw new Error("Invitation signup created a session");
      } catch (error) {
        if (!(await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${claimed.invitation.email}`)).length) {
          await clearClaim(db, claimed.invitation.id, claimed.invitation.claimedAt!);
        }
        throw error;
      }
      matching = await findMatchingCredentialAccount(db, claimed.invitation.email);
    }

    if (
      !matching ||
      matching.user.createdAt < claimed.invitation.claimedAt! ||
      matching.account.createdAt < claimed.invitation.claimedAt!
    ) throw new InvitationUnavailableError();

    await db.transaction(async (transaction) => {
      const [lockedInvitation] = await transaction
        .select()
        .from(accountInvitations)
        .where(eq(accountInvitations.id, claimed.invitation.id))
        .limit(1)
        .for("update");
      if (
        !lockedInvitation ||
        lockedInvitation.acceptedAt ||
        lockedInvitation.acceptedUserId ||
        lockedInvitation.revokedAt ||
        lockedInvitation.expiresAt <= now ||
        lockedInvitation.claimedAt?.getTime() !== claimed.invitation.claimedAt?.getTime()
      ) throw new InvitationUnavailableError();

      const current = await findMatchingCredentialAccount(transaction, lockedInvitation.email);
      if (
        !current ||
        current.user.id !== matching!.user.id ||
        current.user.createdAt < lockedInvitation.claimedAt! ||
        current.account.createdAt < lockedInvitation.claimedAt!
      ) throw new InvitationUnavailableError();
      const sessionRows = await transaction
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.userId, current.user.id));
      if (sessionRows.length !== 0 || await hasDomainRows(transaction, current.user.id)) {
        throw new InvitationUnavailableError();
      }

      const [accepted] = await transaction
        .update(accountInvitations)
        .set({ acceptedAt: now, acceptedUserId: current.user.id })
        .where(
          and(
            eq(accountInvitations.id, lockedInvitation.id),
            isNull(accountInvitations.acceptedAt),
            isNull(accountInvitations.acceptedUserId),
            isNull(accountInvitations.revokedAt),
          ),
        )
        .returning();
      if (!accepted) throw new InvitationUnavailableError();
    });

    return matching.user;
  });
}
