import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { debtorShareLinks, debtorShareReceipts, expenseReceipts, expenseShares, expenses, friends } from "../db/schema";
import { createLedgerRepository, LedgerNotFoundError, type DebtorStatementPageOptions } from "../domain/ledger-repository";
import { getPersonalLedgerScopeId } from "./ledger-scopes";

export const DEBTOR_SHARE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEBTOR_SHARE_UNAVAILABLE = "This balance link is unavailable.";
export const SHARED_RECEIPT_UNAVAILABLE = "One or more selected receipts are unavailable for this friend.";
export const PUBLIC_RECEIPT_UNAVAILABLE = "This receipt is unavailable.";

export type DebtorShareLinkStatus = {
  status: "none" | "active" | "expired" | "revoked";
  expiresAt: Date | null;
};

export type CreatedDebtorShareLink = {
  token: string;
  expiresAt: Date;
  selectedReceiptIds: string[];
};

export class DebtorShareReceiptSelectionError extends Error {
  constructor() {
    super(SHARED_RECEIPT_UNAVAILABLE);
    this.name = "DebtorShareReceiptSelectionError";
  }
}

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

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function normalizeReceiptIds(value: unknown) {
  if (!Array.isArray(value)) throw new DebtorShareReceiptSelectionError();
  const ids = value.map((id) => typeof id === "string" ? id : "").map((id) => id.toLowerCase());
  if (ids.some((id) => !isCanonicalUuid(id)) || new Set(ids).size !== ids.length) throw new DebtorShareReceiptSelectionError();
  return ids;
}

function selectionAndTime(value: string[] | Date | undefined, time: Date) {
  if (value instanceof Date) return { selectedReceiptIds: [] as string[], now: value };
  return { selectedReceiptIds: normalizeReceiptIds(value ?? []), now: time };
}

async function lockEligibleReceipts(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ledgerScopeId: string,
  friendId: string,
  selectedReceiptIds: string[],
) {
  if (selectedReceiptIds.length === 0) return [] as Array<{ id: string; expenseId: string }>;
  const locked = await transaction
    .select({ id: expenseReceipts.id, expenseId: expenseReceipts.expenseId })
    .from(expenseReceipts)
    .where(and(eq(expenseReceipts.ledgerScopeId, ledgerScopeId), inArray(expenseReceipts.id, selectedReceiptIds)))
    .orderBy(asc(expenseReceipts.id))
    .for("update");
  if (locked.length !== selectedReceiptIds.length) throw new DebtorShareReceiptSelectionError();

  const eligible = await transaction
    .select({ id: expenseReceipts.id })
    .from(expenseReceipts)
    .innerJoin(expenses, and(eq(expenses.ledgerScopeId, ledgerScopeId), eq(expenses.id, expenseReceipts.expenseId)))
    .innerJoin(expenseShares, and(
      eq(expenseShares.ledgerScopeId, ledgerScopeId),
      eq(expenseShares.expenseId, expenses.id),
      eq(expenseShares.friendId, friendId),
    ))
    .where(and(eq(expenseReceipts.ledgerScopeId, ledgerScopeId), inArray(expenseReceipts.id, selectedReceiptIds)))
    .orderBy(asc(expenseReceipts.id));
  if (eligible.length !== selectedReceiptIds.length) throw new DebtorShareReceiptSelectionError();
  return locked;
}

async function replaceReceiptMappings(
  transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ledgerScopeId: string,
  linkId: string,
  receipts: Array<{ id: string; expenseId: string }>,
) {
  await transaction.delete(debtorShareReceipts).where(and(eq(debtorShareReceipts.ledgerScopeId, ledgerScopeId), eq(debtorShareReceipts.debtorShareLinkId, linkId)));
  if (receipts.length > 0) {
    await transaction.insert(debtorShareReceipts).values(receipts.map((receipt) => ({
      ledgerScopeId,
      debtorShareLinkId: linkId,
      expenseId: receipt.expenseId,
      expenseReceiptId: receipt.id,
    })));
  }
}

export async function createDebtorShareLink(
  database: Database,
  ownerUserId: string,
  friendId: string,
  selectedReceiptIdsOrNow: string[] | Date = [],
  now = new Date(),
): Promise<CreatedDebtorShareLink> {
  assertOwnerAndFriend(ownerUserId, friendId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const selection = selectionAndTime(selectedReceiptIdsOrNow, now);
  const token = generateDebtorShareToken();
  const expiresAt = new Date(selection.now.getTime() + DEBTOR_SHARE_LINK_TTL_MS);

  return database.transaction(async (transaction) => {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, ledgerScopeId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) throw new LedgerNotFoundError();

    const selectedReceipts = await lockEligibleReceipts(transaction, ledgerScopeId, friendId, selection.selectedReceiptIds);

    const revoked = await transaction
      .update(debtorShareLinks)
      .set({ revokedAt: selection.now })
      .where(
        and(
          eq(debtorShareLinks.ledgerScopeId, ledgerScopeId),
          eq(debtorShareLinks.friendId, friendId),
          isNull(debtorShareLinks.revokedAt),
        ),
      )
      .returning({ id: debtorShareLinks.id });
    for (const link of revoked) await replaceReceiptMappings(transaction, ledgerScopeId, link.id, []);

    const [created] = await transaction
      .insert(debtorShareLinks)
      .values({
        tokenHash: hashDebtorShareToken(token),
        ledgerScopeId,
        friendId,
        createdAt: selection.now,
        expiresAt,
      })
      .returning({ id: debtorShareLinks.id, expiresAt: debtorShareLinks.expiresAt });
    if (!created) throw new Error("Debtor share link was not created");
    await replaceReceiptMappings(transaction, ledgerScopeId, created.id, selectedReceipts);
    return { token, expiresAt: created.expiresAt, selectedReceiptIds: selectedReceipts.map((receipt) => receipt.id) };
  });
}

export async function updateDebtorShareReceiptSelection(
  database: Database,
  ownerUserId: string,
  friendId: string,
  selectedReceiptIds: string[],
  now = new Date(),
) {
  assertOwnerAndFriend(ownerUserId, friendId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const normalizedIds = normalizeReceiptIds(selectedReceiptIds);
  return database.transaction(async (transaction) => {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, ledgerScopeId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) throw new LedgerNotFoundError();
    const [link] = await transaction
      .select({ id: debtorShareLinks.id })
      .from(debtorShareLinks)
      .where(and(
        eq(debtorShareLinks.ledgerScopeId, ledgerScopeId),
        eq(debtorShareLinks.friendId, friendId),
        isNull(debtorShareLinks.revokedAt),
        gt(debtorShareLinks.expiresAt, now),
      ))
      .orderBy(desc(debtorShareLinks.createdAt), desc(debtorShareLinks.id))
      .limit(1)
      .for("update");
    if (!link) throw new LedgerNotFoundError();
    const receipts = await lockEligibleReceipts(transaction, ledgerScopeId, friendId, normalizedIds);
    await replaceReceiptMappings(transaction, ledgerScopeId, link.id, receipts);
    return receipts.map((receipt) => receipt.id);
  });
}

export async function revokeDebtorShareLink(
  database: Database,
  ownerUserId: string,
  friendId: string,
  now = new Date(),
) {
  assertOwnerAndFriend(ownerUserId, friendId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  return database.transaction(async (transaction) => {
    const [friend] = await transaction
      .select({ id: friends.id })
      .from(friends)
      .where(and(eq(friends.ledgerScopeId, ledgerScopeId), eq(friends.id, friendId)))
      .limit(1)
      .for("update");
    if (!friend) return false;

    const revoked = await transaction
      .update(debtorShareLinks)
      .set({ revokedAt: now })
      .where(
        and(
          eq(debtorShareLinks.ledgerScopeId, ledgerScopeId),
          eq(debtorShareLinks.friendId, friendId),
          isNull(debtorShareLinks.revokedAt),
          gt(debtorShareLinks.expiresAt, now),
        ),
      )
      .returning({ id: debtorShareLinks.id });
    for (const link of revoked) await replaceReceiptMappings(transaction, ledgerScopeId, link.id, []);
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
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const [link] = await database
    .select({ expiresAt: debtorShareLinks.expiresAt, revokedAt: debtorShareLinks.revokedAt })
    .from(debtorShareLinks)
    .where(and(eq(debtorShareLinks.ledgerScopeId, ledgerScopeId), eq(debtorShareLinks.friendId, friendId)))
    .orderBy(desc(debtorShareLinks.createdAt), desc(debtorShareLinks.id))
    .limit(1);
  if (!link) return { status: "none", expiresAt: null };
  if (link.revokedAt) return { status: "revoked", expiresAt: link.expiresAt };
  if (link.expiresAt <= now) return { status: "expired", expiresAt: link.expiresAt };
  return { status: "active", expiresAt: link.expiresAt };
}

export async function getDebtorShareReceiptSelection(database: Database, ownerUserId: string, friendId: string, now = new Date()) {
  assertOwnerAndFriend(ownerUserId, friendId);
  const ledgerScopeId = await getPersonalLedgerScopeId(database, ownerUserId);
  const [link] = await database
    .select({ id: debtorShareLinks.id })
    .from(debtorShareLinks)
    .where(and(eq(debtorShareLinks.ledgerScopeId, ledgerScopeId), eq(debtorShareLinks.friendId, friendId), isNull(debtorShareLinks.revokedAt), gt(debtorShareLinks.expiresAt, now)))
    .orderBy(desc(debtorShareLinks.createdAt), desc(debtorShareLinks.id))
    .limit(1);
  if (!link) return [];
  const rows = await database
    .select({ id: debtorShareReceipts.expenseReceiptId })
    .from(debtorShareReceipts)
    .where(and(eq(debtorShareReceipts.ledgerScopeId, ledgerScopeId), eq(debtorShareReceipts.debtorShareLinkId, link.id)))
    .orderBy(asc(debtorShareReceipts.expenseReceiptId));
  return rows.map((row) => row.id);
}

export async function resolveDebtorShareLink(database: Database, token: string, now = new Date(), options: DebtorStatementPageOptions = {}) {
  if (!isCanonicalDebtorShareToken(token)) return null;
  const [link] = await database
    .select({ id: debtorShareLinks.id, ledgerScopeId: debtorShareLinks.ledgerScopeId, friendId: debtorShareLinks.friendId, expiresAt: debtorShareLinks.expiresAt })
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
      statement: await createLedgerRepository(database, link.ledgerScopeId).getPublicFriendDebtorStatement(link.friendId, now, link.id, options),
      expiresAt: link.expiresAt,
    };
  } catch (error) {
    if (error instanceof LedgerNotFoundError) return null;
    throw error;
  }
}

export type SharedDebtorReceipt = {
  id: string;
  mediaType: string;
  byteSize: number;
  content: Buffer;
};

export async function getSharedDebtorReceipt(database: Database, token: string, publicReceiptId: string, now = new Date()): Promise<SharedDebtorReceipt | null> {
  if (!isCanonicalDebtorShareToken(token) || !isCanonicalUuid(publicReceiptId)) return null;
  const [receipt] = await database
    .select({ id: debtorShareReceipts.id, mediaType: expenseReceipts.mediaType, byteSize: expenseReceipts.byteSize, content: expenseReceipts.content })
    .from(debtorShareReceipts)
    .innerJoin(debtorShareLinks, and(
      eq(debtorShareLinks.id, debtorShareReceipts.debtorShareLinkId),
      eq(debtorShareLinks.ledgerScopeId, debtorShareReceipts.ledgerScopeId),
      isNull(debtorShareLinks.revokedAt),
      gt(debtorShareLinks.expiresAt, now),
    ))
    .innerJoin(expenseReceipts, and(
      eq(expenseReceipts.ledgerScopeId, debtorShareReceipts.ledgerScopeId),
      eq(expenseReceipts.expenseId, debtorShareReceipts.expenseId),
      eq(expenseReceipts.id, debtorShareReceipts.expenseReceiptId),
    ))
    .innerJoin(expenseShares, and(
      eq(expenseShares.ledgerScopeId, debtorShareReceipts.ledgerScopeId),
      eq(expenseShares.expenseId, debtorShareReceipts.expenseId),
      eq(expenseShares.friendId, debtorShareLinks.friendId),
    ))
    .where(and(eq(debtorShareReceipts.id, publicReceiptId), eq(debtorShareLinks.tokenHash, hashDebtorShareToken(token))))
    .limit(1);
  return receipt ?? null;
}
