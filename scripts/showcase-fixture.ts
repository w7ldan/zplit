import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { readSecretFile } from "../src/server/secret-file";
import {
  SHOWCASE_FIXED_TIMESTAMP,
  SHOWCASE_FIXTURE_CONFIRMATION,
  SHOWCASE_FIXTURE_DATABASE,
  SHOWCASE_LINK_TTL_MS,
  SHOWCASE_OWNER_EMAIL,
  SHOWCASE_OWNER_NAME,
  SHOWCASE_RECEIPT_PATH,
  SHOWCASE_IDS,
  generateShowcaseFixture,
  parseShowcaseState,
  showcaseTotals,
  type ShowcaseFixtureData,
  type ShowcaseState,
} from "./showcase-fixture-data";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { generateDebtorShareToken, hashDebtorShareToken } = await import("../src/server/debtor-share-links");

const showcaseFixtureLockKey = 20603021;

export type ShowcaseCommand = "setup" | "state" | "verify" | "clear";

export type ShowcaseEnvironment = {
  DB_NAME?: string;
  DB_HOST?: string;
  DB_PORT?: string;
  DB_USER?: string;
  DB_PASSWORD_FILE?: string;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET_FILE?: string;
  OWNER_NAME_FILE?: string;
  OWNER_EMAIL_FILE?: string;
  OWNER_PASSWORD_FILE?: string;
  ZPLIT_SHOWCASE_CONFIRM?: string;
  [name: string]: string | undefined;
};

export type ShowcaseRuntime = {
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  authSecret: string;
  authBaseURL: string;
  secrets: string[];
};

export type ShowcaseFixtureDependencies = {
  readDatabaseConfig?: typeof readRuntimeDatabaseConfig;
  createPool?: typeof createDatabasePool;
  generateToken?: typeof generateDebtorShareToken;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnvironment(environment: ShowcaseEnvironment, name: keyof ShowcaseEnvironment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readOwnerFile(environment: ShowcaseEnvironment, name: "OWNER_NAME_FILE" | "OWNER_EMAIL_FILE" | "OWNER_PASSWORD_FILE") {
  return readSecretFile(requiredEnvironment(environment, name), name);
}

export function parseShowcaseCommand(value = process.argv[2]): ShowcaseCommand {
  if (value === "setup" || value === "state" || value === "verify" || value === "clear") return value;
  throw new Error("usage: tsx scripts/showcase-fixture.ts <setup|state|verify|clear> [1-6]");
}

export function validateShowcaseCommandEnvironment(
  command: ShowcaseCommand,
  stateValue: string | number | undefined,
  environment: ShowcaseEnvironment = process.env,
): ShowcaseRuntime & { state?: ShowcaseState } {
  if (environment.DB_NAME?.trim() !== SHOWCASE_FIXTURE_DATABASE) throw new Error(`DB_NAME must be ${SHOWCASE_FIXTURE_DATABASE}`);
  if (command !== "verify" && environment.ZPLIT_SHOWCASE_CONFIRM?.trim() !== SHOWCASE_FIXTURE_CONFIRMATION) {
    throw new Error(`ZPLIT_SHOWCASE_CONFIRM must be ${SHOWCASE_FIXTURE_CONFIRMATION}`);
  }
  requiredEnvironment(environment, "DB_HOST");
  requiredEnvironment(environment, "DB_USER");
  const databasePassword = readSecretFile(requiredEnvironment(environment, "DB_PASSWORD_FILE"), "DB_PASSWORD_FILE");
  const authBaseURL = requiredEnvironment(environment, "BETTER_AUTH_URL");
  const authSecret = readSecretFile(requiredEnvironment(environment, "BETTER_AUTH_SECRET_FILE"), "BETTER_AUTH_SECRET_FILE");
  const ownerName = readOwnerFile(environment, "OWNER_NAME_FILE");
  const ownerEmail = readOwnerFile(environment, "OWNER_EMAIL_FILE").toLowerCase();
  const ownerPassword = readOwnerFile(environment, "OWNER_PASSWORD_FILE");
  if (ownerName !== SHOWCASE_OWNER_NAME) throw new Error(`OWNER_NAME_FILE must contain ${SHOWCASE_OWNER_NAME}`);
  if (ownerEmail !== SHOWCASE_OWNER_EMAIL) throw new Error(`OWNER_EMAIL_FILE must contain ${SHOWCASE_OWNER_EMAIL}`);
  const state = command === "state" || command === "verify" ? parseShowcaseState(stateValue ?? "") : undefined;
  return { ownerName, ownerEmail, ownerPassword, authSecret, authBaseURL, secrets: [databasePassword, authSecret, ownerPassword], state };
}

type ShowcaseAccount = { id: string; name: string; email: string };

async function resolveShowcaseAccount(client: PoolClient, email: string): Promise<ShowcaseAccount> {
  const users = await client.query<ShowcaseAccount>("SELECT id, name, email FROM users ORDER BY id");
  assert(users.rows.length === 1, "showcase account must be the only user in zplit_showcase");
  const user = users.rows[0]!;
  assert(user.email === email && user.name === SHOWCASE_OWNER_NAME, "showcase account identity is inconsistent");
  const accounts = await client.query<{ provider_id: string; has_password: boolean }>(
    "SELECT provider_id, password IS NOT NULL AND btrim(password) <> '' AS has_password FROM accounts WHERE user_id = $1 ORDER BY id",
    [user.id],
  );
  assert(accounts.rows.length === 1 && accounts.rows[0]!.provider_id === "credential" && accounts.rows[0]!.has_password, "showcase credential account is inconsistent");
  return user;
}

async function ensureShowcaseAccount(pool: ReturnType<typeof createDatabasePool>, runtime: ShowcaseRuntime) {
  const db = drizzle(pool, { schema });
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [showcaseFixtureLockKey]);
    locked = true;
    const users = await client.query<{ id: string }>("SELECT id FROM users ORDER BY id");
    if (users.rows.length === 0) {
      const auth = createAuth({ db, secret: runtime.authSecret, baseURL: runtime.authBaseURL, enableBootstrapSignUp: true });
      await auth.api.signUpEmail({ body: { name: runtime.ownerName, email: runtime.ownerEmail, password: runtime.ownerPassword } });
    }
    return await resolveShowcaseAccount(client, runtime.ownerEmail);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1::bigint)", [showcaseFixtureLockKey]).catch(() => undefined);
    client.release();
  }
}

function ids(fixture: ShowcaseFixtureData) {
  return {
    friends: fixture.friends.map((row) => row.id),
    outings: fixture.outings.map((row) => row.id),
    expenses: fixture.expenses.map((row) => row.id),
    shares: fixture.expenseShares.map((row) => row.id),
    repayments: fixture.repayments.map((row) => row.id),
    receipts: fixture.receipts.map((row) => row.id),
  };
}

async function insertRows(client: PoolClient, table: string, columns: string[], rows: readonly (readonly unknown[])[]) {
  for (const row of rows) {
    await client.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_column, index) => `$${index + 1}`).join(", ")})`, [...row]);
  }
}

async function deleteShowcaseLedger(client: PoolClient, ownerUserId: string) {
  await client.query("DELETE FROM debtor_share_receipts WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM debtor_share_links WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM repayment_allocations WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM expense_receipts WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM expense_shares WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM repayments WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM expenses WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM outings WHERE owner_user_id = $1", [ownerUserId]);
  await client.query("DELETE FROM friends WHERE owner_user_id = $1", [ownerUserId]);
}

async function insertShowcaseState(client: PoolClient, fixture: ShowcaseFixtureData, generateToken: typeof generateDebtorShareToken) {
  await insertRows(client, "friends", ["id", "owner_user_id", "name", "phone_number", "notes", "archived_at", "created_at", "updated_at"], fixture.friends.map((row) => [row.id, row.ownerUserId, row.name, row.phoneNumber, row.notes, row.archivedAt, row.createdAt, row.updatedAt]));
  await insertRows(client, "outings", ["id", "owner_user_id", "title", "occurred_at", "notes", "created_at", "updated_at"], fixture.outings.map((row) => [row.id, row.ownerUserId, row.title, row.occurredAt, row.notes, row.createdAt, row.updatedAt]));
  await insertRows(client, "expenses", ["id", "owner_user_id", "outing_id", "description", "amount", "created_at", "updated_at"], fixture.expenses.map((row) => [row.id, row.ownerUserId, row.outingId, row.description, row.amount, row.createdAt, row.updatedAt]));
  await insertRows(client, "expense_shares", ["id", "owner_user_id", "expense_id", "friend_id", "base_amount", "amount_owed", "created_at"], fixture.expenseShares.map((row) => [row.id, row.ownerUserId, row.expenseId, row.friendId, row.amountOwed, row.amountOwed, row.createdAt]));
  await insertRows(client, "repayments", ["id", "owner_user_id", "friend_id", "amount", "paid_at", "payment_method", "notes", "created_at"], fixture.repayments.map((row) => [row.id, row.ownerUserId, row.friendId, row.amount, row.paidAt, row.paymentMethod, row.notes, row.createdAt]));
  await insertRows(client, "repayment_allocations", ["owner_user_id", "repayment_id", "expense_share_id", "amount", "created_at"], fixture.repaymentAllocations.map((row) => [row.ownerUserId, row.repaymentId, row.expenseShareId, row.amount, row.createdAt]));
  await insertRows(client, "expense_receipts", ["id", "owner_user_id", "expense_id", "original_filename", "media_type", "byte_size", "sha256", "content", "created_at"], fixture.receipts.map((row) => [row.id, row.ownerUserId, row.expenseId, row.originalFilename, row.mediaType, row.byteSize, row.sha256, row.content, row.createdAt]));
  if (fixture.state === 6) {
    const token = generateToken();
    const createdAt = new Date(SHOWCASE_FIXED_TIMESTAMP);
    await client.query(
      "INSERT INTO debtor_share_links (id, token_hash, owner_user_id, friend_id, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [SHOWCASE_IDS.shareLink, hashDebtorShareToken(token), fixture.ownerUserId, SHOWCASE_IDS.friends.dimas, createdAt, new Date(createdAt.getTime() + SHOWCASE_LINK_TTL_MS)],
    );
    await client.query(
      "INSERT INTO debtor_share_receipts (owner_user_id, debtor_share_link_id, expense_id, expense_receipt_id, created_at) VALUES ($1, $2, $3, $4, $5)",
      [fixture.ownerUserId, SHOWCASE_IDS.shareLink, SHOWCASE_IDS.expenses.dinner, SHOWCASE_IDS.receipt, createdAt],
    );
    return token;
  }
  return undefined;
}

async function replaceShowcaseState(
  pool: ReturnType<typeof createDatabasePool>,
  email: string,
  state: ShowcaseState | undefined,
  generateToken: typeof generateDebtorShareToken,
) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [showcaseFixtureLockKey]);
    const owner = await resolveShowcaseAccount(client, email);
    await deleteShowcaseLedger(client, owner.id);
    const token = state === undefined ? undefined : await insertShowcaseState(client, generateShowcaseFixture(owner.id, state), generateToken);
    await client.query("COMMIT");
    transactionStarted = false;
    return { owner, token };
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function dateValue(value: unknown) {
  return new Date(value as string | number | Date).toISOString();
}

async function countOwned(client: PoolClient, table: string, ownerUserId: string) {
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE owner_user_id = $1`, [ownerUserId]);
  return Number(result.rows[0]!.count);
}

async function verifyExactRows(client: PoolClient, fixture: ShowcaseFixtureData) {
  const friendRows = await client.query("SELECT id, owner_user_id, name, phone_number, notes, archived_at, created_at, updated_at FROM friends WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  assert(friendRows.rows.length === fixture.friends.length, "showcase friends are not exact");
  for (const expected of fixture.friends) {
    const row = friendRows.rows.find((candidate) => candidate.id === expected.id);
    assert(row?.owner_user_id === fixture.ownerUserId && row.name === expected.name && row.phone_number === null && row.notes === null && row.archived_at === null && dateValue(row.created_at) === expected.createdAt.toISOString() && dateValue(row.updated_at) === expected.updatedAt.toISOString(), "showcase friend record is not exact");
  }
  const outingRows = await client.query("SELECT id, owner_user_id, title, occurred_at, notes, created_at, updated_at FROM outings WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  assert(outingRows.rows.length === fixture.outings.length, "showcase outings are not exact");
  for (const expected of fixture.outings) {
    const row = outingRows.rows.find((candidate) => candidate.id === expected.id);
    assert(row?.owner_user_id === fixture.ownerUserId && row.title === expected.title && dateValue(row.occurred_at) === expected.occurredAt.toISOString() && row.notes === null && dateValue(row.created_at) === expected.createdAt.toISOString() && dateValue(row.updated_at) === expected.updatedAt.toISOString(), "showcase outing record is not exact");
  }
  const expenseRows = await client.query("SELECT id, owner_user_id, outing_id, description, amount, created_at, updated_at FROM expenses WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  assert(expenseRows.rows.length === fixture.expenses.length, "showcase expenses are not exact");
  for (const expected of fixture.expenses) {
    const row = expenseRows.rows.find((candidate) => candidate.id === expected.id);
    assert(row?.owner_user_id === fixture.ownerUserId && row.outing_id === expected.outingId && row.description === expected.description && Number(row.amount) === expected.amount && dateValue(row.created_at) === expected.createdAt.toISOString() && dateValue(row.updated_at) === expected.updatedAt.toISOString(), "showcase expense record is not exact");
  }
  const shareRows = await client.query("SELECT id, owner_user_id, expense_id, friend_id, amount_owed, created_at FROM expense_shares WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  assert(shareRows.rows.length === fixture.expenseShares.length, "showcase shares are not exact");
  for (const expected of fixture.expenseShares) {
    const row = shareRows.rows.find((candidate) => candidate.id === expected.id);
    assert(row?.owner_user_id === fixture.ownerUserId && row.expense_id === expected.expenseId && row.friend_id === expected.friendId && Number(row.amount_owed) === expected.amountOwed && dateValue(row.created_at) === expected.createdAt.toISOString(), "showcase share record is not exact");
  }
  const repaymentRows = await client.query("SELECT id, owner_user_id, friend_id, amount, paid_at, payment_method, notes, created_at FROM repayments WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  assert(repaymentRows.rows.length === fixture.repayments.length, "showcase repayments are not exact");
  for (const expected of fixture.repayments) {
    const row = repaymentRows.rows.find((candidate) => candidate.id === expected.id);
    assert(row?.owner_user_id === fixture.ownerUserId && row.friend_id === expected.friendId && Number(row.amount) === expected.amount && dateValue(row.paid_at) === expected.paidAt.toISOString() && row.payment_method === expected.paymentMethod && row.notes === null && dateValue(row.created_at) === expected.createdAt.toISOString(), "showcase repayment record is not exact");
  }
  const allocationRows = await client.query("SELECT owner_user_id, repayment_id, expense_share_id, amount, created_at FROM repayment_allocations WHERE owner_user_id = $1 ORDER BY repayment_id, expense_share_id", [fixture.ownerUserId]);
  assert(allocationRows.rows.length === fixture.repaymentAllocations.length, "showcase repayment allocations are not exact");
  for (const expected of fixture.repaymentAllocations) {
    const row = allocationRows.rows.find((candidate) => candidate.repayment_id === expected.repaymentId && candidate.expense_share_id === expected.expenseShareId);
    assert(row?.owner_user_id === fixture.ownerUserId && Number(row.amount) === expected.amount && dateValue(row.created_at) === expected.createdAt.toISOString(), "showcase allocation record is not exact");
  }
  const receiptRows = await client.query("SELECT id, owner_user_id, expense_id, original_filename, media_type, byte_size, sha256, content, created_at FROM expense_receipts WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  assert(receiptRows.rows.length === fixture.receipts.length, "showcase receipts are not exact");
  for (const expected of fixture.receipts) {
    const row = receiptRows.rows.find((candidate) => candidate.id === expected.id);
    assert(row?.owner_user_id === fixture.ownerUserId && row.expense_id === expected.expenseId && row.original_filename === expected.originalFilename && row.media_type === expected.mediaType && Number(row.byte_size) === expected.byteSize && row.sha256 === expected.sha256 && Buffer.from(row.content).equals(expected.content) && dateValue(row.created_at) === expected.createdAt.toISOString(), "showcase receipt record is not exact");
  }
}

async function verifyRelationships(client: PoolClient, ownerUserId: string) {
  const checks = [
    ["expense outing", "SELECT count(*)::text AS count FROM expenses e WHERE e.owner_user_id = $1 AND NOT EXISTS (SELECT 1 FROM outings o WHERE o.owner_user_id = e.owner_user_id AND o.id = e.outing_id)"],
    ["share parents", "SELECT count(*)::text AS count FROM expense_shares s WHERE s.owner_user_id = $1 AND (NOT EXISTS (SELECT 1 FROM expenses e WHERE e.owner_user_id = s.owner_user_id AND e.id = s.expense_id) OR NOT EXISTS (SELECT 1 FROM friends f WHERE f.owner_user_id = s.owner_user_id AND f.id = s.friend_id))"],
    ["repayment friends", "SELECT count(*)::text AS count FROM repayments r WHERE r.owner_user_id = $1 AND NOT EXISTS (SELECT 1 FROM friends f WHERE f.owner_user_id = r.owner_user_id AND f.id = r.friend_id)"],
    ["receipt expenses", "SELECT count(*)::text AS count FROM expense_receipts r WHERE r.owner_user_id = $1 AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.owner_user_id = r.owner_user_id AND e.id = r.expense_id)"],
    ["allocation parents", "SELECT count(*)::text AS count FROM repayment_allocations a WHERE a.owner_user_id = $1 AND (NOT EXISTS (SELECT 1 FROM repayments r WHERE r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id) OR NOT EXISTS (SELECT 1 FROM expense_shares s WHERE s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id))"],
    ["cross-friend allocations", "SELECT count(*)::text AS count FROM repayment_allocations a JOIN repayments r ON r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id WHERE a.owner_user_id = $1 AND r.friend_id <> s.friend_id"],
  ] as const;
  for (const [name, query] of checks) {
    const result = await client.query<{ count: string }>(query, [ownerUserId]);
    assert(Number(result.rows[0]!.count) === 0, `${name} relationship invariant failed`);
  }
}

async function verifyFinancialInvariants(client: PoolClient, ownerUserId: string) {
  const checks = [
    ["shares over expense", "SELECT count(*)::text AS count FROM (SELECT s.expense_id FROM expense_shares s JOIN expenses e ON e.owner_user_id = s.owner_user_id AND e.id = s.expense_id WHERE s.owner_user_id = $1 GROUP BY s.expense_id, e.amount HAVING sum(s.amount_owed) > e.amount) invalid"],
    ["allocations over repayment", "SELECT count(*)::text AS count FROM (SELECT a.repayment_id FROM repayment_allocations a JOIN repayments r ON r.owner_user_id = a.owner_user_id AND r.id = a.repayment_id WHERE a.owner_user_id = $1 GROUP BY a.repayment_id, r.amount HAVING sum(a.amount) > r.amount) invalid"],
    ["allocations over share", "SELECT count(*)::text AS count FROM (SELECT a.expense_share_id FROM repayment_allocations a JOIN expense_shares s ON s.owner_user_id = a.owner_user_id AND s.id = a.expense_share_id WHERE a.owner_user_id = $1 GROUP BY a.expense_share_id, s.amount_owed HAVING sum(a.amount) > s.amount_owed) invalid"],
  ] as const;
  for (const [name, query] of checks) {
    const result = await client.query<{ count: string }>(query, [ownerUserId]);
    assert(Number(result.rows[0]!.count) === 0, `${name} financial invariant failed`);
  }
}

async function verifyOwnerIsolation(client: PoolClient, fixture: ShowcaseFixtureData) {
  const tableIds = ids(fixture);
  for (const [table, values] of Object.entries({
    friends: tableIds.friends,
    outings: tableIds.outings,
    expenses: tableIds.expenses,
    expense_shares: tableIds.shares,
    repayments: tableIds.repayments,
    expense_receipts: tableIds.receipts,
  })) {
    if (values.length === 0) continue;
    const result = await client.query<{ other: string }>(`SELECT count(*) FILTER (WHERE owner_user_id <> $1)::text AS other FROM ${table} WHERE id = ANY($2::uuid[])`, [fixture.ownerUserId, values]);
    assert(Number(result.rows[0]!.other) === 0, `${table} owner isolation failed`);
  }
}

async function verifyScenario(client: PoolClient, fixture: ShowcaseFixtureData) {
  const totals = showcaseTotals(fixture.state);
  const result = await client.query<{ spending: string; assigned: string }>(
    "SELECT coalesce((SELECT sum(amount) FROM expenses WHERE owner_user_id = $1), 0)::text AS spending, coalesce((SELECT sum(amount_owed) FROM expense_shares WHERE owner_user_id = $1), 0)::text AS assigned",
    [fixture.ownerUserId],
  );
  assert(Number(result.rows[0]!.spending) === totals.totalSpending && Number(result.rows[0]!.assigned) === totals.assigned, "showcase totals are incorrect");
  assert(totals.totalSpending - totals.assigned === totals.ownerPortion, "showcase owner portion is incorrect");
  const balances = await client.query<{ friend_id: string; outstanding: string }>(
    "SELECT f.id AS friend_id, coalesce(sum(s.amount_owed), 0) - coalesce((SELECT sum(a.amount) FROM repayment_allocations a JOIN expense_shares paid ON paid.id = a.expense_share_id AND paid.owner_user_id = a.owner_user_id WHERE a.owner_user_id = f.owner_user_id AND paid.friend_id = f.id), 0) AS outstanding FROM friends f LEFT JOIN expense_shares s ON s.owner_user_id = f.owner_user_id AND s.friend_id = f.id WHERE f.owner_user_id = $1 GROUP BY f.id ORDER BY f.id",
    [fixture.ownerUserId],
  );
  for (const balance of balances.rows) {
    const expected = balance.friend_id === SHOWCASE_IDS.friends.rani ? totals.raniOutstanding : balance.friend_id === SHOWCASE_IDS.friends.dimas ? totals.dimasOutstanding : null;
    assert(expected === null ? Number(balance.outstanding) === 0 : Number(balance.outstanding) === expected, "showcase friend balance is incorrect");
  }
  if (fixture.state >= 5) assert(balances.rows.find((row) => row.friend_id === SHOWCASE_IDS.friends.rani)?.outstanding === "0", "Rani is not settled");
  if (fixture.state >= 5) assert(balances.rows.find((row) => row.friend_id === SHOWCASE_IDS.friends.dimas)?.outstanding === "42500", "Dimas is not open at Rp 42.500");
}

async function verifyLinks(client: PoolClient, fixture: ShowcaseFixtureData) {
  const links = await client.query<{ id: string; friend_id: string; revoked_at: Date | null; expires_at: Date; token_hash: string }>("SELECT id, friend_id, revoked_at, expires_at, token_hash FROM debtor_share_links WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  const mappings = await client.query<{ debtor_share_link_id: string; expense_id: string; expense_receipt_id: string }>("SELECT debtor_share_link_id, expense_id, expense_receipt_id FROM debtor_share_receipts WHERE owner_user_id = $1 ORDER BY id", [fixture.ownerUserId]);
  if (fixture.state < 6) {
    assert(links.rows.length === 0 && mappings.rows.length === 0, "showcase share link exists before state 6");
    return;
  }
  const link = links.rows[0];
  assert(links.rows.length === 1 && link?.id === SHOWCASE_IDS.shareLink && link.friend_id === SHOWCASE_IDS.friends.dimas && link.revoked_at === null && link.token_hash.length === 64 && dateValue(link.expires_at) > new Date().toISOString(), "state 6 share link is not active and read-only");
  assert(mappings.rows.length === 1 && mappings.rows[0]!.debtor_share_link_id === SHOWCASE_IDS.shareLink && mappings.rows[0]!.expense_id === SHOWCASE_IDS.expenses.dinner && mappings.rows[0]!.expense_receipt_id === SHOWCASE_IDS.receipt, "state 6 exposes a receipt other than Dinner");
}

async function verifyShowcaseState(client: PoolClient, owner: ShowcaseAccount, state: ShowcaseState) {
  const fixture = generateShowcaseFixture(owner.id, state);
  assert(await countOwned(client, "friends", owner.id) === fixture.friends.length, "showcase friend count is incorrect");
  assert(await countOwned(client, "outings", owner.id) === fixture.outings.length, "showcase outing count is incorrect");
  assert(await countOwned(client, "expenses", owner.id) === fixture.expenses.length, "showcase expense count is incorrect");
  assert(await countOwned(client, "expense_shares", owner.id) === fixture.expenseShares.length, "showcase share count is incorrect");
  assert(await countOwned(client, "repayments", owner.id) === fixture.repayments.length, "showcase repayment count is incorrect");
  assert(await countOwned(client, "repayment_allocations", owner.id) === fixture.repaymentAllocations.length, "showcase allocation count is incorrect");
  assert(await countOwned(client, "expense_receipts", owner.id) === fixture.receipts.length, "showcase receipt count is incorrect");
  assert(state < 4 ? fixture.expenseShares.length === 0 : true, "shares exist before state 4");
  assert(state < 5 ? fixture.repayments.length === 0 : true, "repayment exists before state 5");
  await verifyExactRows(client, fixture);
  await verifyOwnerIsolation(client, fixture);
  await verifyRelationships(client, owner.id);
  await verifyFinancialInvariants(client, owner.id);
  await verifyScenario(client, fixture);
  await verifyLinks(client, fixture);
}

async function verifyState(pool: ReturnType<typeof createDatabasePool>, email: string, state: ShowcaseState) {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [showcaseFixtureLockKey]);
    const owner = await resolveShowcaseAccount(client, email);
    await verifyShowcaseState(client, owner, state);
    await client.query("COMMIT");
    transactionStarted = false;
    return owner;
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export type ShowcaseRunResult = {
  command: ShowcaseCommand;
  activeState: ShowcaseState | null;
  ownerEmail: string;
  baseURL: string;
  token?: string;
};

export async function runShowcaseCommand(
  command: ShowcaseCommand,
  stateValue: string | number | undefined,
  environment: ShowcaseEnvironment = process.env,
  dependencies: ShowcaseFixtureDependencies = {},
): Promise<ShowcaseRunResult> {
  const runtime = validateShowcaseCommandEnvironment(command, stateValue, environment);
  const config = (dependencies.readDatabaseConfig ?? readRuntimeDatabaseConfig)();
  const pool = (dependencies.createPool ?? createDatabasePool)(config);
  try {
    if (command === "setup") {
      await ensureShowcaseAccount(pool, runtime);
      const result = await replaceShowcaseState(pool, runtime.ownerEmail, 1, dependencies.generateToken ?? generateDebtorShareToken);
      return { command, activeState: 1, ownerEmail: result.owner.email, baseURL: runtime.authBaseURL };
    }
    if (command === "state") {
      const state = runtime.state!;
      const result = await replaceShowcaseState(pool, runtime.ownerEmail, state, dependencies.generateToken ?? generateDebtorShareToken);
      return { command, activeState: state, ownerEmail: result.owner.email, baseURL: runtime.authBaseURL, ...(result.token ? { token: result.token } : {}) };
    }
    if (command === "clear") {
      const result = await replaceShowcaseState(pool, runtime.ownerEmail, undefined, dependencies.generateToken ?? generateDebtorShareToken);
      return { command, activeState: null, ownerEmail: result.owner.email, baseURL: runtime.authBaseURL };
    }
    const owner = await verifyState(pool, runtime.ownerEmail, runtime.state!);
    return { command, activeState: runtime.state!, ownerEmail: owner.email, baseURL: runtime.authBaseURL };
  } finally {
    await pool.end();
  }
}

export function redactShowcaseError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : "unknown error";
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/\s+/g, " ").slice(0, 240);
}

function url(baseURL: string, path: string) {
  return new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString();
}

function printCapture(result: ShowcaseRunResult) {
  console.log(`Active state: ${result.activeState === null ? "cleared" : result.activeState}`);
  console.log(`Login email: ${result.ownerEmail}`);
  console.log(`Overview URL: ${url(result.baseURL, "/app")}`);
  console.log(`Rani friend URL: ${url(result.baseURL, `/app/friends/${SHOWCASE_IDS.friends.rani}`)}`);
  console.log(`Dimas friend URL: ${url(result.baseURL, `/app/friends/${SHOWCASE_IDS.friends.dimas}`)}`);
  console.log(`Outing URL: ${url(result.baseURL, `/app/outings/${SHOWCASE_IDS.outing}`)}`);
  console.log(`Dinner URL: ${url(result.baseURL, `/app/expenses/${SHOWCASE_IDS.expenses.dinner}`)}`);
  console.log(`Taxi URL: ${url(result.baseURL, `/app/expenses/${SHOWCASE_IDS.expenses.taxi}`)}`);
  console.log(`Repayment URL: ${url(result.baseURL, `/app/repayments/${SHOWCASE_IDS.repayment}`)}`);
  if (result.activeState === 6 && result.token) console.log(`Public share URL: ${url(result.baseURL, `/share/${result.token}`)}`);
  console.log(`Receipt fixture path: ${SHOWCASE_RECEIPT_PATH}`);
}

function optionalSecret(filePath: string | undefined) {
  if (!filePath) return [];
  try {
    return [readSecretFile(filePath)];
  } catch {
    return [];
  }
}

async function main() {
  const command = parseShowcaseCommand();
  const result = await runShowcaseCommand(command, command === "state" || command === "verify" ? process.argv[3] : undefined);
  printCapture(result);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    const secrets = [
      ...optionalSecret(process.env.DB_PASSWORD_FILE),
      ...optionalSecret(process.env.BETTER_AUTH_SECRET_FILE),
      ...optionalSecret(process.env.OWNER_PASSWORD_FILE),
    ];
    console.error(`showcase fixture failed: ${redactShowcaseError(error, secrets)}`);
    process.exitCode = 1;
  });
}
