import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";

if (process.env.DB_NAME !== "zplit_test") throw new Error("repayment entry smoke requires DB_NAME=zplit_test");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectLedgerError(action: () => Promise<unknown>, code: string, message: string) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof Error && "code" in error && error.code === code, message);
    return;
  }
  throw new Error(message);
}

async function run() {
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  const db = drizzle(pool, { schema });
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const friendA = randomUUID();
  const friendC = randomUUID();
  const friendB = randomUUID();
  const outingA = randomUUID();
  const outingB = randomUUID();
  const expenseA1 = randomUUID();
  const expenseA2 = randomUUID();
  const expenseC = randomUUID();
  const expenseB = randomUUID();
  const shareA1 = randomUUID();
  const shareA2 = randomUUID();
  const shareC = randomUUID();
  const shareB = randomUUID();
  const repository = createLedgerRepository(db, ownerA);
  const foreignRepository = createLedgerRepository(db, ownerB);
  const paidAt = new Date("2026-08-05T00:00:00.000Z");
  const repaymentInput = (friendId: string, amount: number) => ({ friendId, amount, paidAt, paymentMethod: "Cash", notes: null });

  try {
    await pool.query(
      "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)",
      [ownerA, "Smoke Owner A", `repayment-a-${ownerA}@example.com`, ownerB, "Smoke Owner B", `repayment-b-${ownerB}@example.com`],
    );
    await pool.query(
      "INSERT INTO friends (id, owner_user_id, name) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)",
      [friendA, ownerA, "Friend A", friendC, ownerA, "Friend C", friendB, ownerB, "Friend B"],
    );
    await pool.query(
      "INSERT INTO outings (id, owner_user_id, title, occurred_at) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
      [outingA, ownerA, "Owner A outing", "2026-08-04T00:00:00Z", outingB, ownerB, "Owner B outing", "2026-08-04T00:00:00Z"],
    );
    await pool.query(
      "INSERT INTO expenses (id, owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20)",
      [
        expenseA1, ownerA, outingA, "Dinner", 100_000,
        expenseA2, ownerA, outingA, "Taxi", 60_000,
        expenseC, ownerA, outingA, "Coffee", 20_000,
        expenseB, ownerB, outingB, "Foreign dinner", 50_000,
      ],
    );
    await pool.query(
      "INSERT INTO expense_shares (id, owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20)",
      [
        shareA1, ownerA, expenseA1, friendA, 100_000,
        shareA2, ownerA, expenseA2, friendA, 60_000,
        shareC, ownerA, expenseC, friendC, 20_000,
        shareB, ownerB, expenseB, friendB, 50_000,
      ],
    );

    const open = await repository.listOpenExpenseSharesByFriend();
    assert(open[friendA]?.length === 2 && open[friendC]?.length === 1, "owner A open shares were not grouped by friend");
    assert((await foreignRepository.listOpenExpenseSharesByFriend())[friendB]?.length === 1, "owner B cannot see its own open share");
    assert(!(await foreignRepository.listOpenExpenseSharesByFriend())[friendA], "owner B saw owner A shares");

    const initialSummary = await repository.getLedgerSummary();
    const unallocated = await repository.createRepayment(repaymentInput(friendA, 10_000));
    await repository.createRepaymentWithAllocations(repaymentInput(friendA, 5_000), []);
    const afterUnallocated = await repository.getLedgerSummary();
    assert(afterUnallocated.totalReceivedAmount === initialSummary.totalReceivedAmount + 15_000, "unallocated repayments were not recorded");
    assert(afterUnallocated.totalRepaidAmount === initialSummary.totalRepaidAmount, "unallocated repayment changed settled totals");
    assert(afterUnallocated.totalOutstandingAmount === initialSummary.totalOutstandingAmount, "unallocated repayment changed outstanding totals");
    const unallocatedRows = await pool.query("SELECT 1 FROM repayment_allocations WHERE repayment_id = $1", [unallocated.id]);
    assert(unallocatedRows.rowCount === 0, "unallocated repayment unexpectedly has allocations");

    await repository.createRepaymentWithAllocations(repaymentInput(friendA, 50_000), [{ expenseShareId: shareA1, amount: 50_000 }]);
    await repository.createRepaymentWithAllocations(repaymentInput(friendA, 70_000), [
      { expenseShareId: shareA1, amount: 20_000 },
      { expenseShareId: shareA2, amount: 50_000 },
    ]);
    const afterAllocation = await repository.getLedgerSummary();
    assert(afterAllocation.totalRepaidAmount === initialSummary.totalRepaidAmount + 120_000, "allocated repayment totals are wrong");
    assert(afterAllocation.totalOutstandingAmount === initialSummary.totalOutstandingAmount - 120_000, "allocated repayment outstanding total is wrong");

    const beforeRejected = await pool.query("SELECT count(*)::int AS count FROM repayments WHERE owner_user_id = $1", [ownerA]);
    await expectLedgerError(
      () => repository.createRepaymentWithAllocations(repaymentInput(friendA, 10_000), [{ expenseShareId: shareA1, amount: 11_000 }]),
      "REPAYMENT_ALLOCATION_AMOUNT_EXCEEDED",
      "allocation total above repayment amount was accepted",
    );
    await expectLedgerError(
      () => repository.createRepaymentWithAllocations(repaymentInput(friendA, 20_000), [{ expenseShareId: shareA2, amount: 11_000 }]),
      "REPAYMENT_ALLOCATION_SHARE_EXCEEDED",
      "share capacity overflow was accepted",
    );
    await expectLedgerError(
      () => repository.createRepaymentWithAllocations(repaymentInput(friendA, 1_000), [{ expenseShareId: shareC, amount: 1_000 }]),
      "NOT_FOUND",
      "wrong-friend share was accepted",
    );
    await expectLedgerError(
      () => repository.createRepaymentWithAllocations(repaymentInput(friendA, 1_000), [{ expenseShareId: shareB, amount: 1_000 }]),
      "NOT_FOUND",
      "cross-owner share was accepted",
    );
    await expectLedgerError(
      () => repository.createRepaymentWithAllocations(repaymentInput(friendA, 1_000), [
        { expenseShareId: shareA1, amount: 1_000 },
        { expenseShareId: shareC, amount: 1_000 },
      ]),
      "NOT_FOUND",
      "invalid mixed allocation was accepted",
    );
    const afterRejected = await pool.query("SELECT count(*)::int AS count FROM repayments WHERE owner_user_id = $1", [ownerA]);
    assert(afterRejected.rows[0]?.count === beforeRejected.rows[0]?.count, "failed allocation transaction left a repayment behind");
    const allocationCount = await pool.query("SELECT count(*)::int AS count FROM repayment_allocations WHERE owner_user_id = $1", [ownerA]);
    assert(allocationCount.rows[0]?.count === 3, "failed allocation transaction changed existing allocations");

    const remaining = await repository.listOpenExpenseSharesByFriend();
    assert(remaining[friendA]?.find((share) => share.id === shareA1)?.remainingAmount === 30_000, "share A1 remaining capacity is wrong");
    assert(remaining[friendA]?.find((share) => share.id === shareA2)?.remainingAmount === 10_000, "share A2 remaining capacity is wrong");
    console.log("repayment entry smoke passed: owner scope, optional allocation, invariants, rollback, and totals verified");
  } finally {
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

await run();
