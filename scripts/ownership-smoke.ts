import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import {
  createLedgerRepository,
  ExpenseShareInvariantError,
  LedgerNotFoundError,
  RepaymentAllocationAmountInvariantError,
  RepaymentAllocationShareInvariantError,
  RepaymentAmountInvariantError,
  RepaymentFriendInvariantError,
} from "../src/domain/ledger-repository";
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

async function expectShareInvariant(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ExpenseShareInvariantError, "share total invariant error type is wrong");
    return;
  }
  throw new Error("share total invariant was bypassed");
}

async function expectRepaymentAllocationInvariant(action: () => Promise<unknown>, expected: "amount" | "share") {
  try {
    await action();
  } catch (error) {
    const expectedError = expected === "amount" ? RepaymentAllocationAmountInvariantError : RepaymentAllocationShareInvariantError;
    assert(error instanceof expectedError, "repayment allocation invariant error type is wrong");
    return;
  }
  throw new Error("repayment allocation invariant was bypassed");
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
    let sharesA = await repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 7500 }]);
    let shareA = sharesA[0];
    assert(shareA?.friendId === friendA.id, "owner A share was not assigned");
    const originalShareAId = shareA!.id;
    const ownerASummaryBeforeOwnerB = await repositoryA.getLedgerSummary();
    assert(ownerASummaryBeforeOwnerB.totalExpenseAmount === 12500, "owner A initial paid-out total is wrong");
    assert(ownerASummaryBeforeOwnerB.totalAssignedAmount === 7500, "owner A initial assigned total is wrong");
    assert(ownerASummaryBeforeOwnerB.totalRepaidAmount === 0, "owner A initial repaid total is wrong");
    assert(ownerASummaryBeforeOwnerB.totalReceivedAmount === 0, "owner A initial received total is wrong");
    assert(ownerASummaryBeforeOwnerB.totalUnallocatedRepaymentAmount === 0, "owner A initial unallocated total is wrong");
    assert(ownerASummaryBeforeOwnerB.totalOutstandingAmount === 7500, "owner A partial outstanding total is wrong");
    assert(ownerASummaryBeforeOwnerB.ownerPortionAmount === 5000, "owner A initial owner portion is wrong");
    assert(ownerASummaryBeforeOwnerB.friendBalances[0]?.outstandingAmount === 7500, "owner A partial friend balance is wrong");
    const friendB = await repositoryB.createFriend({ name: "Friend B", phoneNumber: null, notes: null });
    const outingB = await repositoryB.createOuting({ title: "Outing B", occurredAt: now, notes: null });
    const outingB2 = await repositoryB.createOuting({ title: "Outing B 2", occurredAt: new Date("2026-01-05T10:30:00.000Z"), notes: null });
    const expenseB = await repositoryB.createExpense({
      outingId: outingB.id,
      description: "Expense B",
      amount: 10000,
    });
    const sharesB = await repositoryB.replaceExpenseShares(expenseB.id, [{ friendId: friendB.id, amountOwed: 5000 }]);
    const shareB = sharesB[0];
    assert(shareB?.friendId === friendB.id, "owner B share was not assigned");
    const ownerASummaryAfterOwnerB = await repositoryA.getLedgerSummary();
    assert(JSON.stringify(ownerASummaryAfterOwnerB) === JSON.stringify(ownerASummaryBeforeOwnerB), "owner B data changed owner A summary");

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

    sharesA = await repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 13000 }]);
    assert(sharesA[0]?.id === originalShareAId, "updating a share did not preserve its ID");
    assert((await repositoryA.listExpenseShares(expenseA.id)).reduce((sum, share) => sum + share.amountOwed, 0) === 13000, "owner A assigned total is wrong");
    assert(13000 - 13000 === 0, "owner portion at a fully assigned total is wrong");
    await expectShareInvariant(() => repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 13001 }]));
    await expectShareInvariant(() => repositoryA.updateExpense(expenseA.id, { description: "Too Small", amount: 12999, outingId: outingA2.id }));
    sharesA = await repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 7500 }]);
    shareA = sharesA[0];
    assert(sharesA[0]?.id === originalShareAId, "existing share was not retained after amount update");
    assert(13000 - sharesA.reduce((sum, share) => sum + share.amountOwed, 0) === 5500, "owner portion is wrong");

    await repositoryA.setFriendArchived(friendA.id, true);
    const archivedShares = await repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 7500 }]);
    assert(archivedShares[0]?.friendArchivedAt !== null, "archived existing friend was not preserved");
    await repositoryA.setFriendArchived(friendA.id, false);
    await expectNotFound(() => repositoryA.listExpenseShares(expenseB.id));
    await expectNotFound(() => repositoryA.replaceExpenseShares(expenseB.id, [{ friendId: friendB.id, amountOwed: 1 }]));
    await expectNotFound(() => repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendB.id, amountOwed: 1 }]));
    const removedShares = await repositoryA.replaceExpenseShares(expenseA.id, []);
    assert(removedShares.length === 0, "removing a share failed");
    assert(13000 - removedShares.reduce((sum, share) => sum + share.amountOwed, 0) === 13000, "owner portion after removal is wrong");
    await repositoryA.setFriendArchived(friendA.id, true);
    let archivedRejected = false;
    try {
      await repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 1 }]);
    } catch (error) {
      assert(error instanceof Error && error.message === "Archived friends cannot be newly assigned.", "archived-new friend message is wrong");
      archivedRejected = true;
    }
    assert(archivedRejected, "archived-new friend was accepted");
    await repositoryA.setFriendArchived(friendA.id, false);
    sharesA = await repositoryA.replaceExpenseShares(expenseA.id, [{ friendId: friendA.id, amountOwed: 7500 }]);
    shareA = sharesA[0];
    assert(shareA, "owner A share could not be restored");

    await repositoryA.setFriendArchived(friendA.id, true);
    const repaymentA = await repositoryA.createRepayment({ friendId: friendA.id, amount: 7500, paidAt: now, paymentMethod: "bank transfer", notes: "Allocated repayment" });
    assert((await repositoryA.getRepayment(repaymentA.id)).friendArchivedAt !== null, "archived friend could not receive a repayment");
    await repositoryA.setFriendArchived(friendA.id, false);
    const partialPlan = await repositoryA.replaceRepaymentAllocations(repaymentA.id, [{ expenseShareId: shareA.id, amount: 3500 }]);
    assert(partialPlan.allocatedAmount === 3500 && partialPlan.unallocatedAmount === 4000, "partial repayment allocation failed");
    await expectRepaymentAllocationInvariant(
      () => repositoryA.replaceRepaymentAllocations(repaymentA.id, [{ expenseShareId: shareA.id, amount: 7501 }]),
      "amount",
    );
    const concurrentRepaymentA = await repositoryA.createRepayment({ friendId: friendA.id, amount: 3000, paidAt: now, paymentMethod: "cash", notes: "Concurrent A" });
    const concurrentRepaymentB = await repositoryA.createRepayment({ friendId: friendA.id, amount: 3000, paidAt: now, paymentMethod: "cash", notes: "Concurrent B" });
    const concurrentResults = await Promise.allSettled([
      repositoryA.replaceRepaymentAllocations(concurrentRepaymentA.id, [{ expenseShareId: shareA.id, amount: 3000 }]),
      repositoryA.replaceRepaymentAllocations(concurrentRepaymentB.id, [{ expenseShareId: shareA.id, amount: 3000 }]),
    ]);
    assert(concurrentResults.filter((result) => result.status === "fulfilled").length === 1, "both concurrent allocations succeeded");
    assert(concurrentResults.filter((result) => result.status === "rejected").length === 1, "concurrent allocation did not reject one attempt");
    const rejectedConcurrent = concurrentResults.find((result) => result.status === "rejected");
    assert(rejectedConcurrent?.status === "rejected" && rejectedConcurrent.reason instanceof RepaymentAllocationShareInvariantError, "concurrent allocation error type is wrong");
    await repositoryA.replaceRepaymentAllocations(
      concurrentResults[0]?.status === "fulfilled" ? concurrentRepaymentA.id : concurrentRepaymentB.id,
      [],
    );
    const summaryAfterAllocationRemoval = await repositoryA.getLedgerSummary();
    assert(summaryAfterAllocationRemoval.totalOutstandingAmount === 4000, "removing an allocation did not restore outstanding debt");
    const allocationA = await repositoryA.replaceRepaymentAllocations(repaymentA.id, [{ expenseShareId: shareA.id, amount: 7500 }]);
    assert(allocationA.allocatedAmount === 7500 && allocationA.shares[0]?.currentAllocation === 7500, "full repayment allocation failed");
    const repaymentAUnallocated = await repositoryA.createRepayment({ friendId: friendA.id, amount: 2500, paidAt: now, paymentMethod: "cash", notes: "Unallocated repayment" });
    const updatedRepaymentAUnallocated = await repositoryA.updateRepayment(repaymentAUnallocated.id, {
      friendId: friendA.id,
      amount: 3000,
      paidAt: new Date("2026-01-03T10:30:00.000Z"),
      paymentMethod: "mobile transfer",
      notes: "Updated unallocated repayment",
    });
    assert(updatedRepaymentAUnallocated.amount === 3000, "owner A unallocated repayment amount update failed");
    assert(updatedRepaymentAUnallocated.paymentMethod === "mobile transfer", "owner A repayment method update failed");
    assert(updatedRepaymentAUnallocated.notes === "Updated unallocated repayment", "owner A repayment notes update failed");
    assert(updatedRepaymentAUnallocated.unallocatedAmount === 3000, "owner A unallocated repayment total is wrong");
    assert((await repositoryA.getRepayment(repaymentAUnallocated.id)).paidAt.getTime() === new Date("2026-01-03T10:30:00.000Z").getTime(), "owner A repayment date update failed");
    await expectNotFound(() => repositoryB.getRepayment(repaymentAUnallocated.id));
    const repaymentB = await repositoryB.createRepayment({ friendId: friendB.id, amount: 5000, paidAt: now, paymentMethod: null, notes: null });
    await repositoryB.replaceRepaymentAllocations(repaymentB.id, [{ expenseShareId: shareB!.id, amount: 5000 }]);
    let repaymentAmountRejected = false;
    try {
      await repositoryA.updateRepayment(repaymentA.id, { friendId: friendA.id, amount: 7499, paidAt: now, paymentMethod: "bank transfer", notes: "Allocated repayment" });
    } catch (error) {
      assert(error instanceof RepaymentAmountInvariantError && error.message === "Repayment amount cannot be lower than its allocated amount.", "repayment amount invariant message is wrong");
      repaymentAmountRejected = true;
    }
    assert(repaymentAmountRejected, "repayment amount below allocation was accepted");
    let repaymentFriendRejected = false;
    try {
      await repositoryA.updateRepayment(repaymentA.id, { friendId: friendB.id, amount: 7500, paidAt: now, paymentMethod: "bank transfer", notes: "Allocated repayment" });
    } catch (error) {
      assert(error instanceof RepaymentFriendInvariantError && error.message === "The friend cannot be changed after this repayment has allocations.", "repayment friend invariant message is wrong");
      repaymentFriendRejected = true;
    }
    assert(repaymentFriendRejected, "repayment friend change after allocation was accepted");
    const repaymentsA = await repositoryA.listRepayments();
    assert(repaymentsA.length === 4 && repaymentsA.some((repayment) => repayment.unallocatedAmount === 3000), "owner A repayment list is wrong");
    assert(repaymentsA.some((repayment) => repayment.friendName === "Friend A" && repayment.allocatedAmount === 7500), "owner A repayment friend or allocation is wrong");
    assert((await repositoryB.listRepayments()).length === 1, "owner B repayment list is wrong");
    const ownerASummary = await repositoryA.getLedgerSummary();
    const ownerBSummary = await repositoryB.getLedgerSummary();
    assert(ownerASummary.totalExpenseAmount === 13000, "owner A paid-out total is wrong");
    assert(ownerASummary.totalAssignedAmount === 7500, "owner A assigned total is wrong");
    assert(ownerASummary.totalRepaidAmount === 7500, "owner A repaid total is wrong");
    assert(ownerASummary.totalReceivedAmount === 16500, "owner A received total is wrong");
    assert(ownerASummary.totalUnallocatedRepaymentAmount === 9000, "owner A unallocated total is wrong");
    assert(ownerASummary.totalOutstandingAmount === 0, "owner A fully repaid outstanding total is wrong");
    assert(ownerASummary.ownerPortionAmount === 5500, "owner A owner portion total is wrong");
    assert(ownerASummary.friendBalances[0]?.outstandingAmount === 0, "owner A fully repaid friend balance is wrong");
    assert(ownerBSummary.totalExpenseAmount === 11000, "owner B paid-out total is wrong");
    assert(ownerBSummary.totalAssignedAmount === 5000, "owner B assigned total is wrong");
    assert(ownerBSummary.totalRepaidAmount === 5000, "owner B repaid total is wrong");
    assert(ownerBSummary.totalReceivedAmount === 5000, "owner B received total is wrong");
    assert(ownerBSummary.totalUnallocatedRepaymentAmount === 0, "owner B unallocated total is wrong");
    assert(ownerBSummary.totalOutstandingAmount === 0, "owner B fully repaid outstanding total is wrong");
    assert(ownerBSummary.ownerPortionAmount === 6000, "owner B owner portion total is wrong");

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
      const expectedA = table === "outings" ? 2 : table === "repayments" ? 4 : 1;
      const expectedB = table === "outings" ? 2 : 1;
      assert(await count(client, table, userA) === expectedA, `${table} owner A row missing`);
      assert(await count(client, table, userB) === expectedB, `${table} owner B row missing`);
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
    await expectNotFound(() => repositoryA.createRepayment({ friendId: friendB.id, amount: 1, paidAt: now, paymentMethod: null, notes: null }));
    await expectNotFound(() => repositoryA.replaceRepaymentAllocations(repaymentA.id, [{ expenseShareId: shareB.id, amount: 1 }]));
    await expectNotFound(() => repositoryA.replaceRepaymentAllocations(repaymentB.id, [{ expenseShareId: shareA.id, amount: 1 }]));
    await expectNotFound(() => repositoryA.replaceRepaymentAllocations("00000000-0000-0000-0000-000000000000", []));
    await expectNotFound(() => repositoryA.getFriend(friendB.id));
    await expectNotFound(() => repositoryA.updateFriend(friendB.id, { name: "Foreign", phoneNumber: null, notes: null }));
    await expectNotFound(() => repositoryA.setFriendArchived(friendB.id, true));

    await client.query("BEGIN");
    transactionStarted = true;
    await expectConstraint(
      client,
      "23503",
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5)",
      [userA, expenseA.id, friendB.id, 1, 1],
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
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5)",
      [userA, expenseA.id, friendA.id, 0, 0],
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
      "INSERT INTO expense_shares (owner_user_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5)",
      [userA, expenseA.id, friendA.id, 1, 1],
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

  console.log("ownership smoke passed: owner A expense=13000 assigned=7500 received=16500 allocated=7500 unallocated=9000 outstanding=0; owner B expense=11000 assigned=5000 received=5000 allocated=5000 unallocated=0 outstanding=0");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runOwnershipSmoke().catch((error) => {
    console.error(`ownership smoke failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
