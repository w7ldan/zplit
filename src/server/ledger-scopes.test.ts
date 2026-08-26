import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/db/client";
import { ledgerScopes } from "@/db/schema";
import { LedgerScopeError, createOrganizationLedgerScope, ensurePersonalLedgerScope, getPersonalLedgerScopeId } from "./ledger-scopes";

function database(selectResult: unknown[], insertResult: unknown[]) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    values: vi.fn(() => builder),
    onConflictDoNothing: vi.fn(() => builder),
    returning: vi.fn(async () => insertResult),
    then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) => Promise.resolve(selectResult).then(resolve, reject),
  };
  return {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
  } as unknown as Database & { select: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };
}

describe("ledger scopes", () => {
  it("creates a Personal scope and resolves an existing one after a duplicate", async () => {
    const created = database([], [{ id: "scope-a" }]);
    await expect(ensurePersonalLedgerScope(created, "user-a")).resolves.toBe("scope-a");
    expect(created.insert).toHaveBeenCalledWith(ledgerScopes);

    const existing = database([{ id: "scope-a" }], []);
    await expect(ensurePersonalLedgerScope(existing, "user-a")).resolves.toBe("scope-a");
  });

  it("creates Organization scopes in the caller's transaction and fails closed when Personal is missing", async () => {
    const created = database([], [{ id: "scope-org" }]);
    await expect(createOrganizationLedgerScope(created, "11111111-1111-4111-8111-111111111111")).resolves.toBe("scope-org");

    const missing = database([], []);
    await expect(getPersonalLedgerScopeId(missing, "user-a")).rejects.toBeInstanceOf(LedgerScopeError);
  });
});
