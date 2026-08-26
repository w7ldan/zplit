import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { ledgerScopes } from "@/db/schema";

export class LedgerScopeError extends Error {
  constructor(readonly code: "personal_scope_missing" | "organization_scope_missing" | "scope_creation_failed") {
    super(code);
    this.name = "LedgerScopeError";
  }
}

function assertId(value: string, message: string) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(message);
}

export async function getPersonalLedgerScopeId(database: Database, userId: string) {
  assertId(userId, "A user id is required");
  const [scope] = await database
    .select({ id: ledgerScopes.id })
    .from(ledgerScopes)
    .where(and(eq(ledgerScopes.kind, "personal"), eq(ledgerScopes.userId, userId)))
    .limit(1);
  if (!scope) throw new LedgerScopeError("personal_scope_missing");
  return scope.id;
}

export async function getOrganizationLedgerScopeId(database: Database, organizationId: string) {
  assertId(organizationId, "An organization id is required");
  const [scope] = await database
    .select({ id: ledgerScopes.id })
    .from(ledgerScopes)
    .where(and(eq(ledgerScopes.kind, "organization"), eq(ledgerScopes.organizationId, organizationId)))
    .limit(1);
  if (!scope) throw new LedgerScopeError("organization_scope_missing");
  return scope.id;
}

export async function ensurePersonalLedgerScope(database: Database, userId: string) {
  assertId(userId, "A user id is required");
  const [created] = await database
    .insert(ledgerScopes)
    .values({ kind: "personal", userId })
    .onConflictDoNothing()
    .returning({ id: ledgerScopes.id });
  return created?.id ?? getPersonalLedgerScopeId(database, userId);
}

export async function createOrganizationLedgerScope(database: Database, organizationId: string) {
  assertId(organizationId, "An organization id is required");
  const [created] = await database
    .insert(ledgerScopes)
    .values({ kind: "organization", organizationId })
    .returning({ id: ledgerScopes.id });
  if (!created) throw new LedgerScopeError("scope_creation_failed");
  return created.id;
}
