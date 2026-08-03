import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import { createLedgerRepository, LedgerNotFoundError } from "../src/domain/ledger-repository";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { readSecretFile } from "../src/server/secret-file";

const domainTables = [
  "friends",
  "outings",
  "expenses",
  "expense_shares",
  "repayments",
  "repayment_allocations",
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function postgresCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function safeError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : "unknown error";
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return message.replace(/\s+/g, " ").slice(0, 240);
}

async function count(client: PoolClient, table: string, ownerUserId?: string) {
  const query = ownerUserId
    ? `SELECT count(*)::int AS count FROM "${table}" WHERE owner_user_id = $1`
    : `SELECT count(*)::int AS count FROM "${table}"`;
  const result = await client.query<{ count: number }>(query, ownerUserId ? [ownerUserId] : []);
  return Number(result.rows[0]?.count);
}

async function expectConstraint(client: PoolClient, code: string, statement: string, values: unknown[], name: string) {
  await client.query(`SAVEPOINT ${name}`);
  try {
    await client.query(statement, values);
    throw new Error(`expected PostgreSQL error ${code}`);
  } catch (error) {
    if (postgresCode(error) !== code) throw error;
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  }
}

async function expectNotFound(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof LedgerNotFoundError, "cross-owner reference did not map to not-found");
    return;
  }
  throw new Error("cross-owner reference was accepted");
}

export async function runOwnershipSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("ownership smoke requires DB_NAME=zplit_test");

  const config = readRuntimeDatabaseConfig();
  const secret = readSecretFile(process.env.BETTER_AUTH_SECRET_FILE ?? "", "BETTER_AUTH_SECRET_FILE");
  const baseURL = process.env.BETTER_AUTH_URL?.trim();
  if (!baseURL) throw new Error("BETTER_AUTH_URL is required");
  const passwordA = randomBytes(24).toString("base64url");
  const passwordB = randomBytes(24).toString("base64url");
  const suffix = randomBytes(6).toString("hex");
  const emailA = `ownership-a-${suffix}@example.com`;
  const emailB = `ownership-b-${suffix}@example.com`;
  const pool = createDatabasePool(config);
  const db = drizzle(pool, { schema });
  let client: PoolClient | undefined;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    for (const table of domainTables) assert(await count(client, table) === 0, `${table} is not empty before smoke`);

    const auth = createAuth({ db, secret, baseURL, enableBootstrapSignUp: true });
    await auth.api.signUpEmail({ body: { name: "Owner A", email: emailA, password: passwordA } });
    await auth.api.signUpEmail({ body: { name: "Owner B", email: emailB, password: passwordB } });
    const users = await client.query<{ id: string; email: string }>(
      "SELECT id, email FROM users WHERE email = ANY($1::text[]) ORDER BY email",
      [[emailA, emailB]],
    );
    assert(users.rowCount === 2, "two users were not created");
    const userA = users.rows.find((user) => user.email === emailA)?.id;
    const userB = users.rows.find((user) => user.email === emailB)?.id;
    assert(userA && userB, "smoke users are missing");

    const repositoryA = createLedgerRepository(db, userA);
    const repositoryB = createLedgerRepository(db, userB);
    const now = new Date("2026-01-02T10:30:00.000Z");
    const friendA = await repositoryA.createFriend({ name: "Friend A", phoneNumber: null, notes: null });
    const outingA = await repositoryA.createOuting({ title: "Outing A", occurredAt: now, notes: null });
    const outingA2 = await repositoryA.createOuting({ title: "Outing A 2", occurredAt: new Date("2026-01-04T10:30:00.000Z"), notes: null });
    const expenseA = await repositoryA.createExpense({
      outingId: outingA.id,
      description: "Expense A",
      amount: 12500,
    });
    const shareA = await repositoryA.createExpenseShare({ expenseId: expenseA.id, friendId: friendA.id, amountOwed: 7500 });
    const repaymentA = await repositoryA.createRepayment({ friendId: friendA.id, amount: 7500, paidAt: now });
    const allocationA = await repositoryA.createRepaymentAllocation({
      repaymentId: repaymentA.id,
      expenseShareId: shareA.id,
      amount: 7500,
    });
    assert(allocationA.ownerUserId === userA, "owner A allocation is not owner scoped");
    const friendB = await repositoryB.createFriend({ name: "Friend B", phoneNumber: null, notes: null });
    const outingB = await repositoryB.createOuting({ title: "Outing B", occurredAt: now, notes: null });
    const outingB2 = await repositoryB.createOuting({ title: "Outing B 2", occurredAt: new Date("2026-01-05T10:30:00.000Z"), notes: null });
    const expenseB = await repositoryB.createExpense({
      outingId: outingB.id,
      description: "Expense B",
      amount: 10000,
    });
    const shareB = await repositoryB.createExpenseShare({ expenseId: expenseB.id, friendId: friendB.id, amountOwed: 5000 });
    const repaymentB = await repositoryB.createRepayment({ friendId: friendB.id, amount: 5000, paidAt: now });
    await repositoryB.createRepaymentAllocation({ repaymentId: repaymentB.id, expenseShareId: shareB.id, amount: 5000 });

    await repositoryA.updateOuting(outingA.id, { title: "Outing A Updated", occurredAt: now, notes: "Owner A" });
    assert((await repositoryA.getOuting(outingA.id)).title === "Outing A Updated", "owner A outing update failed");
    assert((await repositoryA.listOutings()).map((outing) => outing.id).sort().join() === [outingA.id, outingA2.id].sort().join(), "owner A outing list is wrong");
    await repositoryB.updateOuting(outingB.id, { title: "Outing B Updated", occurredAt: now, notes: "Owner B" });
    assert((await repositoryB.getOuting(outingB.id)).title === "Outing B Updated", "owner B outing update failed");
    assert((await repositoryB.listOutings()).map((outing) => outing.id).sort().join() === [outingB.id, outingB2.id].sort().join(), "owner B outing list is wrong");

    assert((await repositoryA.listExpenses()).map((expense) => expense.id).join() === expenseA.id, "owner A expense list is wrong");
    assert((await repositoryB.listExpenses()).map((expense) => expense.id).join() === expenseB.id, "owner B expense list is wrong");
    assert((await repositoryA.getExpense(expenseA.id)).outingTitle === "Outing A Updated", "owner A expense outing lookup failed");
    assert((await repositoryB.getExpense(expenseB.id)).outingTitle === "Outing B Updated", "owner B expense outing lookup failed");
    const updatedExpenseA = await repositoryA.updateExpense(expenseA.id, { description: "Expense A Updated", amount: 13000, outingId: outingA2.id });
    assert(updatedExpenseA.outingId === outingA2.id, "owner A expense outing reassignment failed");
    assert(updatedExpenseA.outingOccurredAt.getTime() === outingA2.occurredAt.getTime(), "owner A expense date did not come from outing");
    const updatedExpenseB = await repositoryB.updateExpense(expenseB.id, { description: "Expense B Updated", amount: 11000, outingId: outingB2.id });
    assert(updatedExpenseB.outingOccurredAt.getTime() === outingB2.occurredAt.getTime(), "owner B expense date did not come from outing");
    assert((await repositoryB.getExpense(expenseB.id)).description === "Expense B Updated", "owner B expense update failed");

    await repositoryA.updateFriend(friendA.id, { name: "Friend A Updated", phoneNumber: "+62 811", notes: "Owner A" });
    assert((await repositoryA.getFriend(friendA.id)).name === "Friend A Updated", "owner A friend update failed");
    await repositoryA.setFriendArchived(friendA.id, true);
    assert((await repositoryA.listFriends({ archived: false })).length === 0, "archived owner A friend remains active");
    assert((await repositoryA.listFriends({ archived: true })).map((friend) => friend.id).join() === friendA.id, "owner A archive list is wrong");
    await repositoryA.setFriendArchived(friendA.id, false);

    await repositoryB.updateFriend(friendB.id, { name: "Friend B Updated", phoneNumber: null, notes: "Owner B" });
    assert((await repositoryB.getFriend(friendB.id)).name === "Friend B Updated", "owner B friend update failed");
    await repositoryB.setFriendArchived(friendB.id, true);
    assert((await repositoryB.listFriends({ archived: false })).length === 0, "archived owner B friend remains active");
    assert((await repositoryB.listFriends({ archived: true })).map((friend) => friend.id).join() === friendB.id, "owner B archive list is wrong");
    await repositoryB.setFriendArchived(friendB.id, false);

    assert((await repositoryA.listFriends({ archived: false })).map((friend) => friend.id).join() === friendA.id, "owner A can see another friend");
    assert((await repositoryB.listFriends({ archived: false })).map((friend) => friend.id).join() === friendB.id, "owner B can see another friend");
    for (const table of domainTables) {
      const expected = table === "outings" ? 2 : 1;
      assert(await count(client, table, userA) === expected, `${table} owner A row missing`);
      assert(await count(client, table, userB) === expected, `${table} owner B row missing`);
    }

    await expectNotFound(() => repositoryA.createExpense({ outingId: outingB.id, description: "Cross", amount: 1 }));
    const absentExpense = await repositoryA.getExpense("00000000-0000-0000-0000-000000000000").catch((error) => error);
    const foreignExpense = await repositoryA.getExpense(expenseB.id).catch((error) => error);
    assert(absentExpense instanceof LedgerNotFoundError, "absent expense did not map to not-found");
    assert(foreignExpense instanceof LedgerNotFoundError, "foreign expense did not map to not-found");
    assert(absentExpense.message === foreignExpense.message, "expense not-found errors differ");
    await expectNotFound(() => repositoryA.updateExpense(expenseB.id, { description: "Foreign", amount: 1, outingId: outingA.id }));
    const absentOuting = await repositoryA.getOuting("00000000-0000-0000-0000-000000000000").catch((error) => error);
    const foreignOuting = await repositoryA.getOuting(outingB.id).catch((error) => error);
    assert(absentOuting instanceof LedgerNotFoundError, "absent outing did not map to not-found");
    assert(foreignOuting instanceof LedgerNotFoundError, "foreign outing did not map to not-found");
    assert(absentOuting.message === foreignOuting.message, "outing not-found errors differ");
    await expectNotFound(() => repositoryA.updateOuting(outingB.id, { title: "Foreign", occurredAt: now, notes: null }));
    await expectNotFound(() => repositoryA.createExpenseShare({ expenseId: expenseA.id, friendId: friendB.id, amountOwed: 1 }));
    await expectNotFound(() => repositoryA.createRepayment({ friendId: friendB.id, amount: 1, paidAt: now }));
    await expectNotFound(() => repositoryA.createRepaymentAllocation({ repaymentId: repaymentA.id, expenseShareId: shareB.id, amount: 1 }));
    await expectNotFound(() => repositoryA.createRepaymentAllocation({ repaymentId: repaymentB.id, expenseShareId: shareA.id, amount: 1 }));
    await expectNotFound(() => repositoryA.getFriend(friendB.id));
    await expectNotFound(() => repositoryA.updateFriend(friendB.id, { name: "Foreign", phoneNumber: null, notes: null }));
    await expectNotFound(() => repositoryA.setFriendArchived(friendB.id, true));

    await client.query("BEGIN");
    transactionStarted = true;
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4)",
      [userA, expenseA.id, friendB.id, 1],
      "cross_owner_share",
    );
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO repayments (owner_user_id, friend_id, amount, paid_at) VALUES ($1, $2, $3, $4)",
      [userA, friendB.id, 1, now],
      "cross_owner_repayment",
    );
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
      [userA, repaymentA.id, shareB.id, 1],
      "cross_owner_allocation",
    );
    await expectConstraint(
      client,
      "23514",
      "INSERT INTO expenses (owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4)",
      [userA, outingA.id, "Invalid amount", 0],
      "amount_expense",
    );
    await expectConstraint(
      client,
      "23502",
      "INSERT INTO expenses (owner_user_id, description, amount) VALUES ($1, $2, $3)",
      [userA, "Missing outing", 1],
      "required_expense_outing",
    );
    await expectConstraint(
      client,
      "23514",
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4)",
      [userA, expenseA.id, friendA.id, 0],
      "amount_share",
    );
    await expectConstraint(
      client,
      "23514",
      "INSERT INTO repayments (owner_user_id, friend_id, amount, paid_at) VALUES ($1, $2, $3, $4)",
      [userA, friendA.id, 0, now],
      "amount_repayment",
    );
    await expectConstraint(
      client,
      "23514",
      "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
      [userA, repaymentA.id, shareA.id, 0],
      "amount_allocation",
    );
    await expectConstraint(
      client,
      "23505",
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4)",
      [userA, expenseA.id, friendA.id, 1],
      "duplicate_share",
    );
    await expectConstraint(
      client,
      "23505",
      "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
      [userA, repaymentA.id, shareA.id, 1],
      "duplicate_allocation",
    );
    await client.query("ROLLBACK");
    transactionStarted = false;
  } catch (error) {
    throw new Error(safeError(error, [config.password, secret, passwordA, passwordB]));
  } finally {
    if (client) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
        } catch {}
      }
      client.release();
    }
    await pool.end();
  }

  console.log("ownership smoke passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runOwnershipSmoke().catch((error) => {
    console.error(`ownership smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
