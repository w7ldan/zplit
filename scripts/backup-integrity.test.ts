import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import {
  assertMigrationHistory,
  assertNoViolations,
  deriveExpectedMigrations,
  EXPECTED_TABLES,
  INTEGRITY_CHECKS,
  loadExpectedMigrations,
  parseBackupManifest,
} from "./backup-integrity";

const validManifest = JSON.stringify({
  formatVersion: 1,
  createdAt: "2026-08-05T00:00:00Z",
  gitCommit: "a".repeat(40),
  postgresqlServerVersion: "18.4",
  dumpSha256: "b".repeat(64),
  dumpByteLength: 42,
  dumpFilename: "zplit-20260805T000000Z.dump",
});
const createBackupSource = readFileSync(path.resolve(process.cwd(), "scripts/create-backup.sh"), "utf8");
const verifyBackupSource = readFileSync(path.resolve(process.cwd(), "scripts/verify-backup.sh"), "utf8");
const backupIntegritySource = readFileSync(path.resolve(process.cwd(), "scripts/backup-integrity.ts"), "utf8");

function groupAccountingIntegritySql() {
  const check = INTEGRITY_CHECKS.find(({ name }) => name === "Group accounting integrity");
  if (!check) throw new Error("Group accounting integrity check is missing");
  return check.sql;
}

async function insertBackupIntegrityFixture(client: PoolClient, settlementState: "pending" | "confirmed", applicationAmount: number | null) {
  const groupId = randomUUID();
  const senderUserId = randomUUID();
  const recipientUserId = randomUUID();
  const senderParticipantId = randomUUID();
  const recipientParticipantId = randomUUID();
  const expenseId = randomUUID();
  const shareId = randomUUID();
  const obligationId = randomUUID();
  const settlementId = randomUUID();
  const timestamp = "2026-08-29T00:00:00Z";

  await client.query(
    `INSERT INTO users (id, name, email, email_verified) VALUES
      ($1, 'Backup Integrity Sender', $3, true),
      ($2, 'Backup Integrity Recipient', $4, true)`,
    [senderUserId, recipientUserId, `${senderUserId}@backup-integrity.test`, `${recipientUserId}@backup-integrity.test`],
  );
  await client.query(
    "INSERT INTO groups (id, name, created_by_user_id) VALUES ($1, 'Backup integrity', $2)",
    [groupId, recipientUserId],
  );
  await client.query(
    `INSERT INTO group_participants (id, group_id, user_id) VALUES
      ($1, $3, $4), ($2, $3, $5)`,
    [senderParticipantId, recipientParticipantId, groupId, senderUserId, recipientUserId],
  );
  await client.query(
    `INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES
      ($1, $2, $3, 'member'), ($1, $4, $5, 'owner')`,
    [groupId, senderUserId, senderParticipantId, recipientUserId, recipientParticipantId],
  );
  await client.query(
    `INSERT INTO group_expenses (id, group_id, creator_participant_id, payer_participant_id, description, occurred_at, total_amount, state, confirmed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'Backup integrity debt', $5, 100, 'pending', NULL, $5, $5)`,
    [expenseId, groupId, recipientParticipantId, recipientParticipantId, timestamp],
  );
  await client.query(
    `INSERT INTO group_expense_shares (id, group_id, expense_id, participant_id, amount, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 100, $5, $5)`,
    [shareId, groupId, expenseId, senderParticipantId, timestamp],
  );
  await client.query(
    "UPDATE group_expenses SET state = 'confirmed', confirmed_at = $2, updated_at = $2 WHERE id = $1",
    [expenseId, timestamp],
  );
  await client.query(
    `INSERT INTO group_obligations (id, group_id, source_expense_id, source_share_id, debtor_participant_id, creditor_participant_id, original_amount, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 100, $7)`,
    [obligationId, groupId, expenseId, shareId, senderParticipantId, recipientParticipantId, timestamp],
  );
  await client.query(
    `INSERT INTO group_settlements (id, group_id, sender_participant_id, recipient_participant_id, amount, payment_method, state, created_at)
     VALUES ($1, $2, $3, $4, 100, 'Bank transfer', 'pending', $5)`,
    [settlementId, groupId, senderParticipantId, recipientParticipantId, timestamp],
  );
  if (settlementState === "confirmed") {
    await client.query(
      "UPDATE group_settlements SET state = 'confirmed', confirmed_at = $2 WHERE id = $1",
      [settlementId, timestamp],
    );
  }
  if (applicationAmount !== null) {
    await client.query(
      `INSERT INTO group_settlement_applications (group_id, settlement_id, obligation_id, applied_amount)
       VALUES ($1, $2, $3, $4)`,
      [groupId, settlementId, obligationId, applicationAmount],
    );
  }
}

async function readGroupAccountingViolations(client: PoolClient) {
  const result = await client.query<{ violations: number | string }>(groupAccountingIntegritySql());
  return Number(result.rows[0]?.violations);
}

function migrationFixture() {
  return {
    journal: {
      version: "7",
      dialect: "postgresql",
      entries: [
        { idx: 0, version: "7", when: 100, tag: "0000_initial_schema", breakpoints: true },
        { idx: 1, version: "7", when: 200, tag: "0001_second_schema", breakpoints: true },
      ],
    },
    sqlFiles: new Map([
      ["0000_initial_schema", "CREATE TABLE first;"],
      ["0001_second_schema", "ALTER TABLE first ADD COLUMN second integer;"],
    ]),
  };
}

function databaseRows(migrations: ReturnType<typeof deriveExpectedMigrations>) {
  return migrations.map((migration) => ({ id: String(migration.idx + 1), hash: migration.hash, created_at: String(migration.when) }));
}

describe("backup integrity", () => {
  it("parses the metadata-only manifest and rejects a filename mismatch", () => {
    expect(parseBackupManifest(validManifest, "zplit-20260805T000000Z.dump").formatVersion).toBe(1);
    expect(() => parseBackupManifest(validManifest, "other.dump")).toThrow();
  });

  it("keeps all expected tables and integrity SQL checks explicit", () => {
    expect(EXPECTED_TABLES).toEqual(expect.arrayContaining([
      "users", "account_invitations", "ledger_scopes", "debtor_share_links", "friends", "expenses", "expense_receipts", "repayments", "repayment_destinations", "repayment_proofs", "repayment_allocations", "groups", "group_participants", "group_memberships", "group_expenses", "group_expense_shares", "group_obligations", "group_settlements", "group_settlement_applications", "group_settlement_proofs", "group_expense_lifecycle_events", "group_expense_receipts",
    ]));
    for (const name of ["scope-aware foreign keys", "Group accounting integrity", "shares within expenses", "allocations within repayments", "allocations within shares", "cross-friend allocations", "accepted and revoked invitations", "duplicate active debtor links", "whole-rupiah values", "receipt byte lengths"]) {
      expect(INTEGRITY_CHECKS.map((check) => check.name)).toContain(name);
    }
    expect(INTEGRITY_CHECKS.map((check) => check.name)).not.toContain("migration journal");
    expect(backupIntegritySource).not.toMatch(/drizzle\.__drizzle_migrations[^\n]*count\(\*\)[^\n]*=/);
  });

  it("checks application totals from every confirmed settlement", () => {
    const sql = groupAccountingIntegritySql();
    expect(sql).toContain("FROM group_settlements s LEFT JOIN group_settlement_applications a");
    expect(sql).toContain("WHERE s.state = 'confirmed'");
    expect(sql).toContain("COALESCE(sum(a.applied_amount), 0) <> s.amount");
  });

  it("accepts only integer zero violation counts", () => {
    expect(() => assertNoViolations(0)).not.toThrow();
    expect(() => assertNoViolations("0")).not.toThrow();
    expect(() => assertNoViolations(1)).toThrow();
    expect(() => assertNoViolations("record@example.com")).toThrow();
  });

  it("rejects malformed backup paths and checks archive hash and size", () => {
    expect(verifyBackupSource).toContain("$1 != /*");
    expect(verifyBackupSource).toContain("-L \"$dump_path\"");
    expect(verifyBackupSource).toContain("sha256sum");
    expect(verifyBackupSource).toContain("stat -c '%s'");
    expect(verifyBackupSource).toContain("backup SHA-256 mismatch");
    expect(verifyBackupSource).toContain("backup byte length mismatch");
    expect(() => parseBackupManifest(validManifest.replace("zplit-20260805T000000Z.dump", "bad.dump"))).toThrow();
    expect(verifyBackupSource).toContain('ZPLIT_BACKUP_GIT_COMMIT="$manifest_git_commit"');
  });

  it("keeps sensitive values out of the manifest and normal output", () => {
    const manifest = JSON.parse(validManifest) as Record<string, unknown>;
    expect(Object.keys(manifest)).not.toEqual(expect.arrayContaining(["email", "token", "receiptHash", "password", "content"]));
    expect(createBackupSource).toContain("backup created:");
    expect(createBackupSource).toContain("manifest created:");
    expect(createBackupSource).toContain("ZPLIT_BACKUP_GIT_COMMIT");
    expect(createBackupSource).not.toContain("git_commit=$(git rev-parse HEAD)");
    expect(createBackupSource).not.toMatch(/echo .*password|echo .*email|echo .*token/i);
  });

  it("discovers all current migrations from the explicit commit", () => {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const migrations = loadExpectedMigrations(commit);
    const journal = JSON.parse(execFileSync("git", ["show", commit + ":drizzle/meta/_journal.json"], { encoding: "utf8" })) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(migrations.map(({ idx, tag }) => ({ idx, tag }))).toEqual(journal.entries.map(({ idx, tag }) => ({ idx, tag })));
    expect(migrations.map((migration) => migration.tag)).toEqual(expect.arrayContaining([
      "0000_initial_schema",
      "0009_cascade_confirmed_ledger_deletions",
    ]));
  });

  it("changes expectations when a valid migration is added", () => {
    const fixture = migrationFixture();
    const initial = deriveExpectedMigrations(fixture.journal, fixture.sqlFiles);
    fixture.journal.entries.push({ idx: 2, version: "7", when: 300, tag: "0010_future_schema", breakpoints: true });
    fixture.sqlFiles.set("0010_future_schema", "CREATE TABLE future;");
    const expanded = deriveExpectedMigrations(fixture.journal, fixture.sqlFiles);
    expect(initial).toHaveLength(2);
    expect(expanded).toHaveLength(3);
    expect(expanded[2]?.tag).toBe("0010_future_schema");
  });

  it.each([
    ["missing SQL file", (fixture: ReturnType<typeof migrationFixture>) => fixture.sqlFiles.delete("0001_second_schema")],
    ["extra numbered SQL file", (fixture: ReturnType<typeof migrationFixture>) => fixture.sqlFiles.set("0010_future_schema", "CREATE TABLE future;")],
    ["non-contiguous index", (fixture: ReturnType<typeof migrationFixture>) => { fixture.journal.entries[1].idx = 2; }],
    ["duplicate tag", (fixture: ReturnType<typeof migrationFixture>) => { fixture.journal.entries[1].tag = "0000_initial_schema"; }],
    ["malformed timestamp", (fixture: ReturnType<typeof migrationFixture>) => { (fixture.journal.entries[1] as Record<string, unknown>).when = "later"; }],
  ])("rejects %s", (_reason, mutate) => {
    const fixture = migrationFixture();
    mutate(fixture);
    expect(() => deriveExpectedMigrations(fixture.journal, fixture.sqlFiles)).toThrow();
  });

  it("rejects malformed or nonexistent migration commits before loading files", () => {
    expect(() => loadExpectedMigrations("not-a-commit")).toThrow();
    expect(() => loadExpectedMigrations("0".repeat(40))).toThrow();
  });

  it("matches the complete restored row sequence", () => {
    const expected = deriveExpectedMigrations(migrationFixture().journal, migrationFixture().sqlFiles);
    const rows = databaseRows(expected);
    expect(() => assertMigrationHistory(rows, expected)).not.toThrow();
    expect(() => assertMigrationHistory(rows.slice(0, -1), expected)).toThrow();
    expect(() => assertMigrationHistory([...rows, { id: "3", hash: "a".repeat(64), created_at: "300" }], expected)).toThrow();
    expect(() => assertMigrationHistory([rows[1], rows[0]], expected)).toThrow();
    expect(() => assertMigrationHistory([{ ...rows[0], id: "1" }, { ...rows[1], id: "1" }], expected)).toThrow();
    expect(() => assertMigrationHistory([{ ...rows[0], hash: "malformed" }, rows[1]], expected)).toThrow();
    expect(() => assertMigrationHistory([{ ...rows[0], hash: "a".repeat(64) }, rows[1]], expected)).toThrow();
    expect(() => assertMigrationHistory([{ ...rows[0], created_at: "999" }, rows[1]], expected)).toThrow();
  });

  it.skipIf(!process.env.BACKUP_INTEGRITY_DATABASE_URL)("matches rows written by the installed Drizzle migrator", async () => {
    const databaseUrl = process.env.BACKUP_INTEGRITY_DATABASE_URL;
    if (!databaseUrl) throw new Error("BACKUP_INTEGRITY_DATABASE_URL is required");
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (databaseName !== "zplit_backup_integrity_test") throw new Error("test database must be disposable");
    const commit = process.env.BACKUP_INTEGRITY_GIT_COMMIT;
    if (!commit) throw new Error("BACKUP_INTEGRITY_GIT_COMMIT is required");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
      const result = await client.query("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
      assertMigrationHistory(result.rows, loadExpectedMigrations(commit));
    } finally {
      client.release();
      await pool.end();
    }
  });

  it.skipIf(!process.env.BACKUP_INTEGRITY_DATABASE_URL)("detects incomplete confirmed settlement applications without rejecting pending settlements", async () => {
    const databaseUrl = process.env.BACKUP_INTEGRITY_DATABASE_URL;
    if (!databaseUrl) throw new Error("BACKUP_INTEGRITY_DATABASE_URL is required");
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
    if (databaseName !== "zplit_backup_integrity_test") throw new Error("test database must be disposable");
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const client = await pool.connect();
    try {
      await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
      const scenarios = [
        { name: "confirmed + exact applications", state: "confirmed", applicationAmount: 100, violations: 0 },
        { name: "confirmed + partial applications", state: "confirmed", applicationAmount: 40, violations: 1 },
        { name: "confirmed + zero applications", state: "confirmed", applicationAmount: null, violations: 1 },
        { name: "pending + zero applications", state: "pending", applicationAmount: null, violations: 0 },
      ] as const;
      for (const scenario of scenarios) {
        await client.query("BEGIN");
        try {
          await insertBackupIntegrityFixture(client, scenario.state, scenario.applicationAmount);
          expect(await readGroupAccountingViolations(client), scenario.name).toBe(scenario.violations);
        } finally {
          await client.query("ROLLBACK");
        }
      }
    } finally {
      client.release();
      await pool.end();
    }
  });
});
