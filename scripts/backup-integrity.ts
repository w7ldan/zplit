import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export const EXPECTED_TABLES = [
  "users",
  "sessions",
  "accounts",
  "verifications",
  "account_invitations",
  "debtor_share_links",
  "friends",
  "outings",
  "expenses",
  "expense_receipts",
  "expense_shares",
  "repayments",
  "repayment_allocations",
] as const;

export type BackupManifest = {
  formatVersion: 1;
  createdAt: string;
  gitCommit: string;
  postgresqlServerVersion: string;
  dumpSha256: string;
  dumpByteLength: number;
  dumpFilename: string;
};

export function parseBackupManifest(source: string, expectedFilename?: string): BackupManifest {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid backup manifest");
  const record = value as Record<string, unknown>;
  const expectedKeys = ["createdAt", "dumpByteLength", "dumpFilename", "dumpSha256", "formatVersion", "gitCommit", "postgresqlServerVersion"];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) throw new Error("invalid backup manifest fields");
  if (record.formatVersion !== 1 || typeof record.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.createdAt)) throw new Error("invalid backup manifest timestamp");
  if (typeof record.gitCommit !== "string" || !/^[0-9a-f]{40}$/.test(record.gitCommit)) throw new Error("invalid backup manifest commit");
  if (typeof record.postgresqlServerVersion !== "string" || !/^[0-9]+(?:\.[0-9]+)*$/.test(record.postgresqlServerVersion)) throw new Error("invalid backup manifest server version");
  if (typeof record.dumpSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.dumpSha256)) throw new Error("invalid backup manifest hash");
  const dumpByteLength = record.dumpByteLength;
  if (typeof dumpByteLength !== "number" || !Number.isSafeInteger(dumpByteLength) || dumpByteLength < 1) throw new Error("invalid backup manifest byte length");
  if (typeof record.dumpFilename !== "string" || !/^zplit-[0-9]{8}T[0-9]{6}Z\.dump$/.test(record.dumpFilename)) throw new Error("invalid backup filename");
  if (expectedFilename && record.dumpFilename !== expectedFilename) throw new Error("backup filename mismatch");
  return { ...record, dumpByteLength } as BackupManifest;
}

type IntegrityCheck = { name: string; sql: string };

export const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [
  {
    name: "migration journal",
    sql: "SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AND (SELECT count(*) FROM drizzle.__drizzle_migrations) = 8 THEN 0 ELSE 1 END AS violations",
  },
  {
    name: "expected tables",
    sql: `SELECT count(*)::int AS violations
      FROM (VALUES ${EXPECTED_TABLES.map((table) => `('${table}')`).join(",")}) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NULL`,
  },
  {
    name: "owner-aware foreign keys",
    sql: `SELECT (
      (SELECT count(*) FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)) +
      (SELECT count(*) FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)) +
      (SELECT count(*) FROM friends f WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = f.owner_user_id)) +
      (SELECT count(*) FROM outings o WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.owner_user_id)) +
      (SELECT count(*) FROM expenses e WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.owner_user_id) OR NOT EXISTS (SELECT 1 FROM outings o WHERE o.owner_user_id = e.owner_user_id AND o.id = e.outing_id)) +
      (SELECT count(*) FROM expense_receipts r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.owner_user_id) OR NOT EXISTS (SELECT 1 FROM expenses e WHERE e.owner_user_id = r.owner_user_id AND e.id = r.expense_id)) +
      (SELECT count(*) FROM expense_shares s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.owner_user_id) OR NOT EXISTS (SELECT 1 FROM expenses e WHERE e.owner_user_id = s.owner_user_id AND e.id = s.expense_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.owner_user_id = s.owner_user_id AND f.id = s.friend_id)) +
      (SELECT count(*) FROM repayments r WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.owner_user_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.owner_user_id = r.owner_user_id AND f.id = r.friend_id)) +
      (SELECT count(*) FROM repayment_allocations a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.owner_user_id) OR NOT EXISTS (SELECT 1 FROM repayments r WHERE r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id) OR NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id)) +
      (SELECT count(*) FROM account_invitations i WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = i.created_by_user_id) OR (i.accepted_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = i.accepted_user_id))) +
      (SELECT count(*) FROM debtor_share_links l WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = l.owner_user_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.owner_user_id = l.owner_user_id AND f.id = l.friend_id))
    )::int AS violations`,
  },
  {
    name: "shares within expenses",
    sql: "SELECT count(*)::int AS violations FROM (SELECT s.owner_user_id, s.expense_id FROM expense_shares s JOIN expenses e ON e.owner_user_id = s.owner_user_id AND e.id = s.expense_id GROUP BY s.owner_user_id, s.expense_id, e.amount HAVING sum(s.amount_owed) > e.amount) invalid",
  },
  {
    name: "allocations within repayments",
    sql: "SELECT count(*)::int AS violations FROM (SELECT a.owner_user_id, a.repayment_id FROM repayment_allocations a JOIN repayments r ON r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id GROUP BY a.owner_user_id, a.repayment_id, r.amount HAVING sum(a.amount) > r.amount) invalid",
  },
  {
    name: "allocations within shares",
    sql: "SELECT count(*)::int AS violations FROM (SELECT a.owner_user_id, a.expense_share_id FROM repayment_allocations a JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id GROUP BY a.owner_user_id, a.expense_share_id, s.amount_owed HAVING sum(a.amount) > s.amount_owed) invalid",
  },
  {
    name: "cross-friend allocations",
    sql: "SELECT count(*)::int AS violations FROM repayment_allocations a JOIN repayments r ON r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id WHERE r.friend_id <> s.friend_id",
  },
  {
    name: "accepted and revoked invitations",
    sql: "SELECT count(*)::int AS violations FROM account_invitations WHERE accepted_at IS NOT NULL AND revoked_at IS NOT NULL",
  },
  {
    name: "duplicate active debtor links",
    sql: "SELECT count(*)::int AS violations FROM (SELECT owner_user_id, friend_id FROM debtor_share_links WHERE revoked_at IS NULL GROUP BY owner_user_id, friend_id HAVING count(*) > 1) invalid",
  },
  {
    name: "whole-rupiah values",
    sql: "SELECT ((SELECT count(*) FROM expenses WHERE amount IS NULL OR amount <= 0) + (SELECT count(*) FROM expense_shares WHERE amount_owed IS NULL OR amount_owed <= 0) + (SELECT count(*) FROM repayments WHERE amount IS NULL OR amount <= 0) + (SELECT count(*) FROM repayment_allocations WHERE amount IS NULL OR amount <= 0))::int AS violations",
  },
  {
    name: "receipt byte lengths",
    sql: "SELECT count(*)::int AS violations FROM expense_receipts WHERE byte_size <> octet_length(content)",
  },
];

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readPassword() {
  const passwordFile = requiredEnv("DB_PASSWORD_FILE");
  const password = readFileSync(passwordFile, "utf8").trim();
  if (!password) throw new Error("DB_PASSWORD_FILE must contain a password");
  return password;
}

export function assertNoViolations(value: unknown) {
  const violations = Number(value);
  if (!Number.isInteger(violations) || violations !== 0) throw new Error("backup integrity check failed");
}

export async function runBackupIntegrity() {
  if (process.env.DB_NAME?.trim() !== "zplit_restore_test") throw new Error("DB_NAME must be zplit_restore_test");
  const pool = new Pool({
    host: requiredEnv("DB_HOST"),
    port: Number(process.env.DB_PORT?.trim() || "5432"),
    database: "zplit_restore_test",
    user: requiredEnv("DB_USER"),
    password: readPassword(),
    max: 1,
  });
  const client = await pool.connect();
  try {
    for (const check of INTEGRITY_CHECKS) {
      const result = await client.query<{ violations: number | string }>(check.sql);
      assertNoViolations(result.rows[0]?.violations);
    }
    const receipts = await client.query<{ byte_size: number | string; sha256: string; content: Buffer }>("SELECT byte_size, sha256, content FROM expense_receipts");
    for (const receipt of receipts.rows) {
      const content = Buffer.from(receipt.content);
      if (content.byteLength !== Number(receipt.byte_size) || createHash("sha256").update(content).digest("hex") !== receipt.sha256) throw new Error("backup integrity check failed");
    }
    const counts = [];
    for (const table of EXPECTED_TABLES) {
      const result = await client.query<{ count: number | string }>(`SELECT count(*)::int AS count FROM "${table}"`);
      const count = Number(result.rows[0]?.count);
      if (!Number.isInteger(count) || count < 0) throw new Error("backup integrity check failed");
      counts.push(count);
    }
    console.log(`backup integrity passed: ${counts.join(" ")}`);
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runBackupIntegrity().catch(() => {
    console.error("backup integrity failed");
    process.exitCode = 1;
  });
}
