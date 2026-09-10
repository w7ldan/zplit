import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { SCALE_FIXTURE_DATABASE, SCALE_FIXTURE_CONFIRMATION } from "./scale-fixture-data";
import {
  credentialAccountId,
  ensureScaleCredential,
  parseScaleCommand,
  readOwnerPassword,
  redactScaleError,
  runScaleCommand,
  validateScaleCommandEnvironment,
  verifyScaleCredential,
  type ScaleFixtureDependencies,
} from "./scale-fixture";

type AccountRow = { id: string; account_id: string; provider_id: string; user_id: string; password: string | null };

function mockClient(initial: AccountRow[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const client = {
    async query(text: string, params: unknown[]) {
      if (text.startsWith("SELECT id FROM accounts WHERE user_id")) {
        const [userId] = params as [string];
        return { rows: [...rows.values()].filter((row) => row.user_id === userId && row.provider_id === "credential").map((row) => ({ id: row.id })) };
      }
      if (text.startsWith("DELETE FROM accounts WHERE user_id")) {
        const [userId, deterministicId] = params as [string, string];
        for (const [id, row] of [...rows]) {
          if (row.user_id === userId && row.provider_id === "credential" && id !== deterministicId) rows.delete(id);
        }
        return { rows: [] };
      }
      if (text.startsWith("INSERT INTO accounts")) {
        const [id, accountId, password] = params as [string, string, string];
        const existing = rows.get(id);
        if (existing) existing.password = password;
        else rows.set(id, { id, account_id: accountId, provider_id: "credential", user_id: accountId, password });
        return { rows: [] };
      }
      if (text.startsWith("SELECT id, user_id, provider_id, password FROM accounts WHERE id")) {
        const [id, userId] = params as [string, string];
        const row = rows.get(id);
        if (row && row.user_id === userId && row.provider_id === "credential") return { rows: [{ ...row }] };
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as PoolClient;
  return { client, rows };
}

const disposablePassword = "scale-test-password-0123456789abcdef";

const noConnection: ScaleFixtureDependencies = {
  readDatabaseConfig: (() => { throw new Error("connected unexpectedly"); }) as ScaleFixtureDependencies["readDatabaseConfig"],
  createPool: (() => { throw new Error("connected unexpectedly"); }) as ScaleFixtureDependencies["createPool"],
};

describe("scale fixture command safety", () => {
  it("parses only the three supported commands", () => {
    expect(parseScaleCommand("seed")).toBe("seed");
    expect(parseScaleCommand("verify")).toBe("verify");
    expect(parseScaleCommand("clear")).toBe("clear");
    expect(() => parseScaleCommand("drop")).toThrow(/usage/);
  });

  it("rejects mutation commands before connecting to the wrong database", async () => {
    const environment = { DB_NAME: "zplit", ZPLIT_SCALE_TEST_CONFIRM: SCALE_FIXTURE_CONFIRMATION, SCALE_TEST_OWNER_EMAIL: "owner@example.com" };
    await expect(runScaleCommand("seed", environment, noConnection)).rejects.toThrow(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
    await expect(runScaleCommand("clear", environment, noConnection)).rejects.toThrow(`DB_NAME must be ${SCALE_FIXTURE_DATABASE}`);
  });

  it("rejects mutation commands before connecting without confirmation", async () => {
    const environment = { DB_NAME: SCALE_FIXTURE_DATABASE, SCALE_TEST_OWNER_EMAIL: "owner@example.com" };
    await expect(runScaleCommand("seed", environment, noConnection)).rejects.toThrow(/ZPLIT_SCALE_TEST_CONFIRM/);
    await expect(runScaleCommand("clear", environment, noConnection)).rejects.toThrow(/ZPLIT_SCALE_TEST_CONFIRM/);
  });

  it("allows read-only verify without mutation confirmation and requires an owner email", () => {
    expect(validateScaleCommandEnvironment("verify", { DB_NAME: SCALE_FIXTURE_DATABASE, SCALE_TEST_OWNER_EMAIL: "Owner@Example.com" })).toEqual({ ownerEmail: "owner@example.com" });
    expect(() => validateScaleCommandEnvironment("verify", { DB_NAME: SCALE_FIXTURE_DATABASE })).toThrow(/SCALE_TEST_OWNER_EMAIL/);
  });

  it("redacts database secrets from failure text", () => {
    expect(redactScaleError(new Error("password=s3cret connection failed"), ["s3cret"])).toBe("password=[redacted] connection failed");
  });

  it("reads the optional owner password file without requiring it", () => {
    expect(readOwnerPassword({})).toBeUndefined();
    expect(() => readOwnerPassword({ SCALE_OWNER_PASSWORD_FILE: " /nonexistent " })).toThrow(/SCALE_OWNER_PASSWORD_FILE/);
  });

  it("derives a deterministic fixture-owned credential account id", () => {
    expect(credentialAccountId("scale-owner")).toBe("scale-credential-scale-owner");
    expect(credentialAccountId("scale-owner")).not.toBe(credentialAccountId("someone-else"));
  });
});

describe("scale owner credential contract", () => {
  it("preserves existing credentials and skips verification without a password file", async () => {
    const { client } = mockClient([{ id: "legacy-id", account_id: "owner", provider_id: "credential", user_id: "owner", password: "hashed-legacy" }]);
    await expect(ensureScaleCredential(client, "owner", undefined)).resolves.toBe("present");
    await expect(verifyScaleCredential(client, "owner", undefined, false)).resolves.toBeUndefined();
  });

  it("creates the deterministic credential when no prior credential exists", async () => {
    const { client, rows } = mockClient([]);
    await expect(ensureScaleCredential(client, "owner", disposablePassword)).resolves.toBe("created");
    const deterministicId = credentialAccountId("owner");
    expect(rows.has(deterministicId)).toBe(true);
    const stored = rows.get(deterministicId)!;
    expect(stored.provider_id).toBe("credential");
    expect(stored.password).not.toBe(disposablePassword);
    await expect(verifyScaleCredential(client, "owner", disposablePassword, true)).resolves.toBeUndefined();
  });

  it("does not silently ignore the supplied password when an unrelated credential exists", async () => {
    const { client, rows } = mockClient([{ id: "legacy-id", account_id: "owner", provider_id: "credential", user_id: "owner", password: "hashed-legacy" }]);
    await expect(ensureScaleCredential(client, "owner", disposablePassword)).resolves.toBe("created");
    expect(rows.has("legacy-id")).toBe(false);
    expect(rows.has(credentialAccountId("owner"))).toBe(true);
    await expect(verifyScaleCredential(client, "owner", disposablePassword, true)).resolves.toBeUndefined();
  });

  it("is idempotent across repeated seeds with the same password", async () => {
    const { client, rows } = mockClient([]);
    await ensureScaleCredential(client, "owner", disposablePassword);
    await ensureScaleCredential(client, "owner", disposablePassword);
    expect([...rows.keys()].filter((id) => rows.get(id)!.user_id === "owner")).toHaveLength(1);
    await expect(verifyScaleCredential(client, "owner", disposablePassword, true)).resolves.toBeUndefined();
  });

  it("never exposes the explicit password in error text", async () => {
    const { client } = mockClient([]);
    await ensureScaleCredential(client, "owner", disposablePassword);
    const failure = await verifyScaleCredential(client, "owner", "wrong-password-0123456789abcdef", true).then(
      () => new Error("verified unexpectedly"),
      (error: unknown) => error,
    );
    expect(redactScaleError(failure, [disposablePassword, "wrong-password-0123456789abcdef"])).not.toContain(disposablePassword);
    expect(String((failure as Error).message)).not.toContain(disposablePassword);
  });
});
