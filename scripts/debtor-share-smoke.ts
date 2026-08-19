import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";

if (process.env.DB_NAME !== "zplit_test") throw new Error("debtor share smoke requires DB_NAME=zplit_test");

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const {
  DEBTOR_SHARE_LINK_TTL_MS,
  createDebtorShareLink,
  resolveDebtorShareLink,
  revokeDebtorShareLink,
} = await import("../src/server/debtor-share-links");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runDebtorShareSmoke() {
  const databaseConfig = readRuntimeDatabaseConfig();
  const pool = createDatabasePool(databaseConfig);
  const db = drizzle(pool, { schema });
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const friendA = randomUUID();
  const friendB = randomUUID();
  const outingA = randomUUID();
  const outingB = randomUUID();
  const expenseA = randomUUID();
  const expenseB = randomUUID();
  const shareOpen = randomUUID();
  const shareSettled = randomUUID();
  const repaymentPartial = randomUUID();
  const repaymentSettled = randomUUID();
  const now = new Date("2026-08-04T00:00:00.000Z");

  try {
    await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)", [
      ownerA, "Owner A Private", `debtor-a-${ownerA}@example.com`, ownerB, "Owner B Private", `debtor-b-${ownerB}@example.com`,
    ]);
    await pool.query(
      "INSERT INTO friends (id, owner_user_id, name, phone_number, notes) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
      [friendA, ownerA, "Friend A", "+62000000001", "private friend A note", friendB, ownerB, "Friend B", "+62000000002", "private friend B note"],
    );
    await pool.query(
      "INSERT INTO outings (id, owner_user_id, title, occurred_at) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
      [outingA, ownerA, "Owner A dinner", "2026-08-03T00:00:00Z", outingB, ownerB, "Owner B outing", "2026-08-03T00:00:00Z"],
    );
    await pool.query(
      "INSERT INTO expenses (id, owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
      [expenseA, ownerA, outingA, "Open dinner share", 100_000, expenseB, ownerA, outingA, "Settled coffee share", 30_000],
    );
    await pool.query(
      "INSERT INTO expense_shares (id, owner_user_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)",
      [shareOpen, ownerA, expenseA, friendA, 100_000, 100_000, shareSettled, ownerA, expenseB, friendA, 30_000, 30_000],
    );
    await pool.query(
      "INSERT INTO repayments (id, owner_user_id, friend_id, amount, paid_at, payment_method, notes) VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $9, $10, $11, $12, $13, $14)",
      [repaymentPartial, ownerA, friendA, 60_000, "2026-08-04T00:00:00Z", "private-method", "private repayment note", repaymentSettled, ownerA, friendA, 30_000, "2026-08-04T00:00:00Z", "cash", "another private note"],
    );
    await pool.query(
      "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
      [ownerA, repaymentPartial, shareOpen, 40_000, ownerA, repaymentSettled, shareSettled, 30_000],
    );
    const first = await createDebtorShareLink(db, ownerA, friendA, now);
    const firstPublic = await resolveDebtorShareLink(db, first.token, now);
    assert(firstPublic, "owner A link did not resolve");
    assert(firstPublic.statement.assignedAmount === 130_000, "assigned total is wrong");
    assert(firstPublic.statement.repaidAmount === 70_000, "allocated repayment total is wrong");
    assert(firstPublic.statement.outstandingAmount === 60_000, "outstanding total is wrong");
    assert(firstPublic.statement.items[0]?.state === "open", "open share was not first");
    assert(firstPublic.statement.items[0]?.remainingAmount === 60_000, "partial share is wrong");
    assert(firstPublic.statement.items[1]?.state === "settled", "settled share was not rendered");
    const publicJson = JSON.stringify(firstPublic.statement);
    assert(!publicJson.includes(ownerA) && !publicJson.includes("Owner A Private"), "owner metadata leaked");
    assert(!publicJson.includes("private friend") && !publicJson.includes("private repayment") && !publicJson.includes("private-method"), "private metadata leaked");
    assert(Object.keys(firstPublic.statement.items[0] ?? {}).sort().join(",") === "assignedAmount,expenseDescription,outingOccurredAt,outingTitle,remainingAmount,repaidAmount,state", "public item allowlist changed");

    await expectMissing(() => createDebtorShareLink(db, ownerB, friendA, now), "foreign owner managed owner A friend");
    assert(await revokeDebtorShareLink(db, ownerB, friendA, now) === false, "foreign owner revoked owner A friend");
    assert((await resolveDebtorShareLink(db, first.token, now)) !== null, "owner A link stopped resolving");

    const replacement = await createDebtorShareLink(db, ownerA, friendA, new Date(now.getTime() + 1_000));
    assert(await resolveDebtorShareLink(db, first.token, now) === null, "replacement did not invalidate old link");
    assert(await resolveDebtorShareLink(db, replacement.token, now) !== null, "replacement did not resolve");
    await revokeDebtorShareLink(db, ownerA, friendA, new Date(now.getTime() + 2_000));
    assert(await resolveDebtorShareLink(db, replacement.token, now) === null, "revocation did not invalidate current link");
    await revokeDebtorShareLink(db, ownerA, friendA, new Date(now.getTime() + 3_000));

    const expired = await createDebtorShareLink(db, ownerA, friendA, new Date(now.getTime() - DEBTOR_SHARE_LINK_TTL_MS - 1));
    const unavailable = [
      await resolveDebtorShareLink(db, "not-a-uuid", now),
      await resolveDebtorShareLink(db, randomUUID(), now),
      await resolveDebtorShareLink(db, expired.token, now),
      await resolveDebtorShareLink(db, replacement.token, now),
    ];
    assert(unavailable.every((result) => result === null), "malformed, missing, expired, and revoked results differ");

    const ownerBLink = await createDebtorShareLink(db, ownerB, friendB, now);
    const ownerBPublic = await resolveDebtorShareLink(db, ownerBLink.token, now);
    assert(ownerBPublic?.statement.friendName === "Friend B", "owner B ledger did not resolve independently");
    assert(ownerBPublic.statement.items.length === 0, "owner B saw owner A shares");
    console.log("debtor share smoke passed: two owners isolated; create, replacement, revocation, expiry, arithmetic, and allowlist verified");
  } finally {
    await pool.query("DELETE FROM debtor_share_links WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM repayment_allocations WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM repayments WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM expense_shares WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM expenses WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM outings WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM friends WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
    await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ownerA, ownerB]);
    await pool.end();
  }
}

async function expectMissing(action: () => Promise<unknown>, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && "code" in error && error.code === "NOT_FOUND", message);
    return;
  }
  throw new Error(message);
}

await runDebtorShareSmoke();
