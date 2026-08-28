import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export const EXPECTED_TABLES = [
  "users",
  "sessions",
  "accounts",
  "verifications",
  "account_invitations",
  "organizations",
  "ledger_scopes",
  "organization_memberships",
  "organization_avatars",
  "organization_invitations",
  "debtor_share_links",
  "friends",
  "groups",
  "group_participants",
  "group_memberships",
  "group_avatars",
  "group_join_requests",
  "group_expenses",
  "group_expense_shares",
  "group_obligations",
  "group_expense_receipts",
  "group_expense_lifecycle_events",
  "outings",
  "expenses",
  "expense_receipts",
  "expense_shares",
  "repayments",
  "repayment_destinations",
  "repayment_proofs",
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

export type ExpectedMigration = {
  idx: number;
  tag: string;
  when: number;
  hash: string;
};

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MIGRATION_TAG_PATTERN = /^\d+_[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function gitText(args: readonly string[]) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitBytes(args: readonly string[]) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] });
}

export function validateGitCommit(commit: string) {
  if (!COMMIT_PATTERN.test(commit)) throw new Error("invalid migration history commit");
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
  } catch {
    throw new Error("migration history commit does not exist locally");
  }
  return commit;
}

function safeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

export function deriveExpectedMigrations(journal: unknown, sqlFiles: ReadonlyMap<string, string>): ExpectedMigration[] {
  if (!isRecord(journal) || journal.dialect !== "postgresql" || !Array.isArray(journal.entries)) {
    throw new Error("invalid PostgreSQL migration journal");
  }

  const tags = new Set<string>();
  const rawEntries = journal.entries as unknown[];
  const entries = rawEntries.map((entry, index) => {
    if (!isRecord(entry) || entry.idx !== index || typeof entry.tag !== "string" || !MIGRATION_TAG_PATTERN.test(entry.tag) || tags.has(entry.tag)) {
      throw new Error("invalid migration journal entry");
    }
    const when = safeTimestamp(entry.when);
    const previousEntry = rawEntries[index - 1];
    const previousWhen = index > 0 && isRecord(previousEntry) ? safeTimestamp(previousEntry.when) : undefined;
    if (when === undefined || (index > 0 && (previousWhen === undefined || when <= previousWhen))) {
      throw new Error("migration journal timestamps must be safe and strictly increasing");
    }
    tags.add(entry.tag);
    return { idx: index, tag: entry.tag, when };
  });

  for (const tag of sqlFiles.keys()) {
    if (MIGRATION_TAG_PATTERN.test(tag) && !tags.has(tag)) throw new Error("numbered SQL migration is missing from the journal");
  }

  return entries.map((entry) => {
    const sql = sqlFiles.get(entry.tag);
    if (sql === undefined) throw new Error(`migration SQL file is missing: ${entry.tag}`);
    return { ...entry, hash: createHash("sha256").update(sql).digest("hex") };
  });
}

export function loadExpectedMigrations(commit: string): ExpectedMigration[] {
  validateGitCommit(commit);
  let journal: unknown;
  try {
    journal = JSON.parse(gitText(["show", `${commit}:drizzle/meta/_journal.json`]));
  } catch {
    throw new Error("migration journal is missing or malformed");
  }

  const sqlFiles = new Map<string, string>();
  const paths = gitText(["ls-tree", "-r", "--name-only", commit, "drizzle"]).split("\n").filter(Boolean);
  for (const filePath of paths) {
    const match = /^drizzle\/([^/]+)\.sql$/.exec(filePath);
    if (!match || !MIGRATION_TAG_PATTERN.test(match[1])) continue;
    if (sqlFiles.has(match[1])) throw new Error(`duplicate migration SQL file: ${match[1]}`);
    sqlFiles.set(match[1], gitBytes(["show", `${commit}:${filePath}`]).toString());
  }
  return deriveExpectedMigrations(journal, sqlFiles);
}

function safeDatabaseInteger(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

export function assertMigrationHistory(rows: readonly unknown[], expected: readonly ExpectedMigration[]) {
  if (rows.length !== expected.length) throw new Error("migration history row count mismatch");
  rows.forEach((row, index) => {
    if (!isRecord(row) || row.id === null || row.hash === null || row.created_at === null || typeof row.hash !== "string" || !/^[0-9a-f]{64}$/.test(row.hash)) {
      throw new Error("malformed migration history row");
    }
    const id = safeDatabaseInteger(row.id);
    const createdAt = safeDatabaseInteger(row.created_at);
    const migration = expected[index];
    if (id === undefined || createdAt === undefined || id !== index + 1 || !migration || migration.hash !== row.hash || migration.when !== createdAt) {
      throw new Error("migration history mismatch");
    }
  });
}

function validateBackupManifestIdentity(record: Record<string, unknown>) {
  if (record.formatVersion !== 1 || typeof record.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.createdAt)) throw new Error("invalid backup manifest timestamp");
  if (typeof record.gitCommit !== "string" || !/^[0-9a-f]{40}$/.test(record.gitCommit)) throw new Error("invalid backup manifest commit");
  if (typeof record.postgresqlServerVersion !== "string" || !/^[0-9]+(?:\.[0-9]+)*$/.test(record.postgresqlServerVersion)) throw new Error("invalid backup manifest server version");
  if (typeof record.dumpSha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.dumpSha256)) throw new Error("invalid backup manifest hash");
}

function validateBackupManifestDump(record: Record<string, unknown>, expectedFilename: string | undefined) {
  const dumpByteLength = record.dumpByteLength;
  if (typeof dumpByteLength !== "number" || !Number.isSafeInteger(dumpByteLength) || dumpByteLength < 1) throw new Error("invalid backup manifest byte length");
  if (typeof record.dumpFilename !== "string" || !/^zplit-[0-9]{8}T[0-9]{6}Z\.dump$/.test(record.dumpFilename)) throw new Error("invalid backup filename");
  if (expectedFilename && record.dumpFilename !== expectedFilename) throw new Error("backup filename mismatch");
  return dumpByteLength;
}

export function parseBackupManifest(source: string, expectedFilename?: string): BackupManifest {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid backup manifest");
  const record = value as Record<string, unknown>;
  const expectedKeys = ["createdAt", "dumpByteLength", "dumpFilename", "dumpSha256", "formatVersion", "gitCommit", "postgresqlServerVersion"];
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)) throw new Error("invalid backup manifest fields");
  validateBackupManifestIdentity(record);
  const dumpByteLength = validateBackupManifestDump(record, expectedFilename);
  return { ...record, dumpByteLength } as BackupManifest;
}

type IntegrityCheck = { name: string; sql: string };

export const INTEGRITY_CHECKS: readonly IntegrityCheck[] = [
  {
    name: "expected tables",
    sql: `SELECT count(*)::int AS violations
      FROM (VALUES ${EXPECTED_TABLES.map((table) => `('${table}')`).join(",")}) AS expected(name)
      WHERE to_regclass('public.' || expected.name) IS NULL`,
  },
  {
    name: "scope-aware foreign keys",
    sql: `SELECT (
      (SELECT count(*) FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id)) +
      (SELECT count(*) FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.user_id)) +
      (SELECT count(*) FROM ledger_scopes s WHERE (s.kind = 'personal' AND (s.user_id IS NULL OR s.organization_id IS NOT NULL)) OR (s.kind = 'organization' AND (s.organization_id IS NULL OR s.user_id IS NOT NULL))) +
      (SELECT count(*) FROM friends f WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = f.ledger_scope_id)) +
      (SELECT count(*) FROM outings o WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = o.ledger_scope_id)) +
      (SELECT count(*) FROM expenses e WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = e.ledger_scope_id) OR NOT EXISTS (SELECT 1 FROM outings o WHERE o.ledger_scope_id = e.ledger_scope_id AND o.id = e.outing_id)) +
      (SELECT count(*) FROM expense_receipts r WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = r.ledger_scope_id) OR NOT EXISTS (SELECT 1 FROM expenses e WHERE e.ledger_scope_id = r.ledger_scope_id AND e.id = r.expense_id)) +
      (SELECT count(*) FROM expense_shares s WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes ls WHERE ls.id = s.ledger_scope_id) OR NOT EXISTS (SELECT 1 FROM expenses e WHERE e.ledger_scope_id = s.ledger_scope_id AND e.id = s.expense_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = s.ledger_scope_id AND f.id = s.friend_id)) +
      (SELECT count(*) FROM repayments r WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes ls WHERE ls.id = r.ledger_scope_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = r.ledger_scope_id AND f.id = r.friend_id)) +
      (SELECT count(*) FROM repayment_destinations d WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = d.ledger_scope_id)) +
      (SELECT count(*) FROM repayment_allocations a WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes ls WHERE ls.id = a.ledger_scope_id) OR NOT EXISTS (SELECT 1 FROM repayments r WHERE r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id) OR NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id)) +
      (SELECT count(*) FROM account_invitations i WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = i.created_by_user_id) OR (i.accepted_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = i.accepted_user_id))) +
      (SELECT count(*) FROM debtor_share_links l WHERE NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = l.ledger_scope_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = l.ledger_scope_id AND f.id = l.friend_id)) +
      (SELECT count(*) FROM debtor_share_receipts r WHERE NOT EXISTS (SELECT 1 FROM debtor_share_links l WHERE l.ledger_scope_id = r.ledger_scope_id AND l.id = r.debtor_share_link_id) OR NOT EXISTS (SELECT 1 FROM expense_receipts e WHERE e.ledger_scope_id = r.ledger_scope_id AND e.expense_id = r.expense_id AND e.id = r.expense_receipt_id)) +
      (SELECT count(*) FROM friend_link_requests r WHERE NOT EXISTS (SELECT 1 FROM friends f WHERE f.ledger_scope_id = r.friend_ledger_scope_id AND f.id = r.friend_id) OR NOT EXISTS (SELECT 1 FROM ledger_scopes s WHERE s.id = r.friend_ledger_scope_id AND s.user_id = r.owner_user_id AND s.kind = 'personal'))
    )::int AS violations`,
  },
  {
    name: "Group accounting integrity",
    sql: `SELECT (
      (SELECT count(*) FROM group_expenses e WHERE NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = e.group_id) OR NOT EXISTS (SELECT 1 FROM group_participants p WHERE p.group_id = e.group_id AND p.id = e.creator_participant_id) OR NOT EXISTS (SELECT 1 FROM group_participants p WHERE p.group_id = e.group_id AND p.id = e.payer_participant_id)) +
      (SELECT count(*) FROM group_expense_shares s WHERE NOT EXISTS (SELECT 1 FROM group_expenses e WHERE e.group_id = s.group_id AND e.id = s.expense_id) OR NOT EXISTS (SELECT 1 FROM group_participants p WHERE p.group_id = s.group_id AND p.id = s.participant_id)) +
      (SELECT count(*) FROM group_obligations o WHERE NOT EXISTS (SELECT 1 FROM group_expenses e WHERE e.group_id = o.group_id AND e.id = o.source_expense_id AND e.state IN ('confirmed', 'voided') AND e.payer_participant_id = o.creditor_participant_id) OR NOT EXISTS (SELECT 1 FROM group_expense_shares s WHERE s.group_id = o.group_id AND s.expense_id = o.source_expense_id AND s.id = o.source_share_id AND s.participant_id = o.debtor_participant_id AND s.amount = o.original_amount) OR NOT EXISTS (SELECT 1 FROM group_participants p WHERE p.group_id = o.group_id AND p.id = o.creditor_participant_id AND p.user_id IS NOT NULL) OR (EXISTS (SELECT 1 FROM group_expenses e WHERE e.group_id = o.group_id AND e.id = o.source_expense_id AND e.state = 'confirmed') AND o.voided_at IS NOT NULL) OR (EXISTS (SELECT 1 FROM group_expenses e WHERE e.group_id = o.group_id AND e.id = o.source_expense_id AND e.state = 'voided') AND o.voided_at IS NULL)) +
      (SELECT count(*) FROM group_expense_receipts r WHERE NOT EXISTS (SELECT 1 FROM group_expenses e WHERE e.group_id = r.group_id AND e.id = r.expense_id)) +
      (SELECT count(*) FROM group_expenses e WHERE e.state IN ('confirmed', 'voided') AND (SELECT COALESCE(sum(s.amount), 0) FROM group_expense_shares s WHERE s.group_id = e.group_id AND s.expense_id = e.id) <> e.total_amount)
    )::int AS violations`,
  },
  {
    name: "shares within expenses",
    sql: "SELECT count(*)::int AS violations FROM (SELECT s.ledger_scope_id, s.expense_id FROM expense_shares s JOIN expenses e ON e.ledger_scope_id = s.ledger_scope_id AND e.id = s.expense_id GROUP BY s.ledger_scope_id, s.expense_id, e.amount HAVING sum(s.amount_owed) > e.amount) invalid",
  },
  {
    name: "allocations within repayments",
    sql: "SELECT count(*)::int AS violations FROM (SELECT a.ledger_scope_id, a.repayment_id FROM repayment_allocations a JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id GROUP BY a.ledger_scope_id, a.repayment_id, r.amount HAVING sum(a.amount) > r.amount) invalid",
  },
  {
    name: "allocations within shares",
    sql: "SELECT count(*)::int AS violations FROM (SELECT a.ledger_scope_id, a.expense_share_id FROM repayment_allocations a JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id GROUP BY a.ledger_scope_id, a.expense_share_id, s.amount_owed HAVING sum(a.amount) > s.amount_owed) invalid",
  },
  {
    name: "cross-friend allocations",
    sql: "SELECT count(*)::int AS violations FROM repayment_allocations a JOIN repayments r ON r.ledger_scope_id = a.ledger_scope_id AND r.id = a.repayment_id JOIN expense_shares s ON s.ledger_scope_id = a.ledger_scope_id AND s.id = a.expense_share_id WHERE r.friend_id <> s.friend_id",
  },
  {
    name: "accepted and revoked invitations",
    sql: "SELECT count(*)::int AS violations FROM account_invitations WHERE accepted_at IS NOT NULL AND revoked_at IS NOT NULL",
  },
  {
    name: "duplicate active debtor links",
    sql: "SELECT count(*)::int AS violations FROM (SELECT ledger_scope_id, friend_id FROM debtor_share_links WHERE revoked_at IS NULL GROUP BY ledger_scope_id, friend_id HAVING count(*) > 1) invalid",
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
  const expectedMigrations = loadExpectedMigrations(requiredEnv("ZPLIT_BACKUP_GIT_COMMIT"));
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
    const migrationTable = await client.query<{ migration_table: string | null }>("SELECT to_regclass('drizzle.__drizzle_migrations') AS migration_table");
    if (!migrationTable.rows[0]?.migration_table) throw new Error("migration journal table is missing");
    const migrationRows = await client.query("SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id");
    assertMigrationHistory(migrationRows.rows, expectedMigrations);
    for (const check of INTEGRITY_CHECKS) {
      const result = await client.query<{ violations: number | string }>(check.sql);
      assertNoViolations(result.rows[0]?.violations);
    }
    const receipts = await client.query<{ byte_size: number | string; sha256: string; content: Buffer }>("SELECT byte_size, sha256, content FROM expense_receipts UNION ALL SELECT byte_size, sha256, content FROM group_expense_receipts");
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

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function runJournalStdinCheck() {
  const source = (await readStdin()).trim();
  const rows = source ? source.split("\n").map((line) => {
    const [id, hash, created_at] = line.split("\t");
    if (created_at === undefined) throw new Error("malformed migration journal input");
    return { id, hash, created_at };
  }) : [];
  assertMigrationHistory(rows, loadExpectedMigrations(requiredEnv("ZPLIT_BACKUP_GIT_COMMIT")));
  console.log("migration history passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] === "--check-journal-stdin" ? runJournalStdinCheck : runBackupIntegrity;
  void action().catch(() => {
    console.error("backup integrity failed");
    process.exitCode = 1;
  });
}
