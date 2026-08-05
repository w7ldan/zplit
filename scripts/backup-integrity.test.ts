import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
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
      "users", "account_invitations", "debtor_share_links", "friends", "expenses", "expense_receipts", "repayments", "repayment_allocations",
    ]));
    for (const name of ["owner-aware foreign keys", "shares within expenses", "allocations within repayments", "allocations within shares", "cross-friend allocations", "accepted and revoked invitations", "duplicate active debtor links", "whole-rupiah values", "receipt byte lengths"]) {
      expect(INTEGRITY_CHECKS.map((check) => check.name)).toContain(name);
    }
    expect(INTEGRITY_CHECKS.map((check) => check.name)).not.toContain("migration journal");
    expect(backupIntegritySource).not.toMatch(/drizzle\.__drizzle_migrations[^\n]*count\(\*\)[^\n]*=/);
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
    expect(migrations).toHaveLength(10);
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
});
