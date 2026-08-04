import "server-only";

import { randomBytes, createHash } from "node:crypto";
import { desc, and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { runWithTransaction } from "@better-auth/core/context";
import { getAuth } from "./runtime";
import type { Database } from "../db/client";
import { accountInvitations } from "../db/schema";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AccountInvitation = typeof accountInvitations.$inferSelect;

export function generateInvitationToken() {
  return randomBytes(32).toString("hex");
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isInvitationToken(token: string) {
  return /^[0-9a-f]{64}$/.test(token);
}

export function normalizeInvitationEmail(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function normalizeSuggestedName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
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

export async function createInvitation(
  db: Database,
  input: { email: string; suggestedName: string | null; createdByUserId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const token = generateInvitationToken();
  const [invitation] = await db
    .insert(accountInvitations)
    .values({
      tokenHash: hashInvitationToken(token),
      email: input.email,
      suggestedName: input.suggestedName,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    })
    .returning();
  if (!invitation) throw new Error("Invitation was not created");
  return { invitation, token };
}

export async function findUsableInvitation(db: Database, token: string, now = new Date()) {
  if (!isInvitationToken(token)) return null;
  const [invitation] = await db
    .select()
    .from(accountInvitations)
    .where(
      and(
        eq(accountInvitations.tokenHash, hashInvitationToken(token)),
        gt(accountInvitations.expiresAt, now),
        isNull(accountInvitations.claimedAt),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.revokedAt),
      ),
    )
    .limit(1);
  return invitation ?? null;
}

export async function claimInvitation(db: Database, token: string, now = new Date()) {
  if (!isInvitationToken(token)) return null;
  const [invitation] = await db
    .update(accountInvitations)
    .set({ claimedAt: now })
    .where(
      and(
        eq(accountInvitations.tokenHash, hashInvitationToken(token)),
        gt(accountInvitations.expiresAt, now),
        isNull(accountInvitations.claimedAt),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.revokedAt),
      ),
    )
    .returning();
  return invitation ?? null;
}

export async function acceptInvitation(db: Database, id: string, userId: string, now = new Date()) {
  const [invitation] = await db
    .update(accountInvitations)
    .set({ acceptedAt: now, acceptedUserId: userId })
    .where(
      and(
        eq(accountInvitations.id, id),
        isNotNull(accountInvitations.claimedAt),
        isNull(accountInvitations.acceptedAt),
        isNull(accountInvitations.acceptedUserId),
        isNull(accountInvitations.revokedAt),
      ),
    )
    .returning();
  return invitation ?? null;
}

export async function listInvitations(db: Database, createdByUserId: string) {
  return db
    .select()
    .from(accountInvitations)
    .where(eq(accountInvitations.createdByUserId, createdByUserId))
    .orderBy(desc(accountInvitations.createdAt));
}

export async function revokeInvitation(db: Database, id: string, createdByUserId: string, now = new Date()) {
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
}

export async function createInvitedCredentialAccount(input: { name: string; email: string; password: string }) {
  const context = await getAuth().$context;
  const passwordHash = await context.password.hash(input.password);
  const id = context.generateId({ model: "user" });
  if (!id) throw new Error("Unable to generate account id");

  return runWithTransaction(context.adapter, async () => {
    const user = await context.internalAdapter.createUser({
      id,
      name: input.name,
      email: input.email,
      emailVerified: false,
      image: null,
    } as never);
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: passwordHash,
    });
    return user;
  });
}
