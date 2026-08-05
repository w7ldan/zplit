import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import {
  createLedgerRepository,
  deletionImpactRevision,
  LedgerDeletionConfirmationRequiredError,
  LedgerNotFoundError,
} from "../src/domain/ledger-repository";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("history-delete smoke requires DATABASE_URL");
let databaseName: string;
try {
  databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
} catch {
  throw new Error("history-delete smoke requires a valid DATABASE_URL");
}
if (databaseName !== "zplit_test") throw new Error("history-delete smoke requires the disposable zplit_test database");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function count(pool: Pool, table: string, owner: string) {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE owner_user_id = $1`, [owner]);
  return Number(result.rows[0]?.count ?? 0);
}

async function expectError(action: () => Promise<unknown>, errorType: new (...args: never[]) => Error) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof errorType, `expected ${errorType.name}`);
    return;
  }
  throw new Error(`expected ${errorType.name}`);
}

const pool = new Pool({ connectionString: databaseUrl, max: 5 });
const database = drizzle(pool, { schema });
const ownerA = randomUUID();
const ownerB = randomUUID();
const friendA = randomUUID();
const friendB = randomUUID();
const outingEmpty = randomUUID();
const outingCascade = randomUUID();
const outingExpense = randomUUID();
const outingRepayment = randomUUID();
const outingB = randomUUID();
const expenseRace = randomUUID();
const expenseOne = randomUUID();
const expenseTwo = randomUUID();
const expenseCascade = randomUUID();
const expenseRepayment = randomUUID();
const expenseB = randomUUID();
const shareOne = randomUUID();
const shareTwo = randomUUID();
const shareCascade = randomUUID();
const shareRepayment = randomUUID();
const shareB = randomUUID();
const shareRace = randomUUID();
const receiptOne = randomUUID();
const receiptTwo = randomUUID();
const receiptCascade = randomUUID();
const receiptRepayment = randomUUID();
const debtorLink = randomUUID();
const publicReceiptOne = randomUUID();
const publicReceiptCascade = randomUUID();
const repaymentOne = randomUUID();
const repaymentTwo = randomUUID();
const repaymentExpense = randomUUID();
const repaymentToDelete = randomUUID();
const repaymentB = randomUUID();
const now = new Date("2026-08-04T00:00:00.000Z");

const repositoryA = createLedgerRepository(database, ownerA);
const repositoryB = createLedgerRepository(database, ownerB);

try {
  await pool.query(
    "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)",
    [ownerA, "Owner A Private", `history-a-${ownerA}@example.com`, ownerB, "Owner B Private", `history-b-${ownerB}@example.com`],
  );
  await pool.query(
    "INSERT INTO friends (id, owner_user_id, name) VALUES ($1, $2, $3), ($4, $5, $6)",
    [friendA, ownerA, "Friend A", friendB, ownerB, "Friend B"],
  );
  await pool.query(
    "INSERT INTO outings (id, owner_user_id, title, occurred_at) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12), ($13, $14, $15, $16), ($17, $18, $19, $20)",
    [
      outingEmpty, ownerA, "Empty outing", "2026-08-01T00:00:00Z",
      outingCascade, ownerA, "Cascading outing", "2026-08-02T00:00:00Z",
      outingExpense, ownerA, "Expense cascade outing", "2026-08-03T00:00:00Z",
      outingRepayment, ownerA, "Repayment cascade outing", "2026-08-04T00:00:00Z",
      outingB, ownerB, "Owner B outing", "2026-08-04T00:00:00Z",
    ],
  );
  await pool.query(
    "INSERT INTO expenses (id, owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20), ($21, $22, $23, $24, $25)",
    [
      expenseOne, ownerA, outingCascade, "First expense", 10000,
      expenseTwo, ownerA, outingCascade, "Second expense", 20000,
      expenseCascade, ownerA, outingExpense, "Expense subtree", 30000,
      expenseRepayment, ownerA, outingRepayment, "Repayment subtree", 40000,
      expenseB, ownerB, outingB, "Owner B expense", 5000,
    ],
  );
  await pool.query(
    "INSERT INTO expense_shares (id, owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20), ($21, $22, $23, $24, $25)",
    [
      shareOne, ownerA, expenseOne, friendA, 6000,
      shareTwo, ownerA, expenseTwo, friendA, 7000,
      shareCascade, ownerA, expenseCascade, friendA, 10000,
      shareRepayment, ownerA, expenseRepayment, friendA, 12000,
      shareB, ownerB, expenseB, friendB, 5000,
    ],
  );
  await pool.query(
    "INSERT INTO expense_receipts (id, owner_user_id, expense_id, original_filename, media_type, byte_size, sha256, content) VALUES ($1, $2, $3, 'one.png', 'image/png', 4, repeat('a', 64), decode('01020304', 'hex')), ($4, $5, $6, 'two.png', 'image/png', 4, repeat('b', 64), decode('05060708', 'hex')), ($7, $8, $9, 'cascade.png', 'image/png', 4, repeat('c', 64), decode('090a0b0c', 'hex')), ($10, $11, $12, 'repayment.png', 'image/png', 4, repeat('d', 64), decode('0d0e0f10', 'hex'))",
    [receiptOne, ownerA, expenseOne, receiptTwo, ownerA, expenseTwo, receiptCascade, ownerA, expenseCascade, receiptRepayment, ownerA, expenseRepayment],
  );
  await pool.query(
    "INSERT INTO debtor_share_links (id, token_hash, owner_user_id, friend_id, expires_at) VALUES ($1, repeat('e', 64), $2, $3, $4)",
    [debtorLink, ownerA, friendA, new Date("2027-01-01T00:00:00Z")],
  );
  await pool.query(
    "INSERT INTO debtor_share_receipts (id, owner_user_id, debtor_share_link_id, expense_id, expense_receipt_id) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
    [publicReceiptOne, ownerA, debtorLink, expenseOne, receiptOne, publicReceiptCascade, ownerA, debtorLink, expenseCascade, receiptCascade],
  );
  await pool.query(
    "INSERT INTO repayments (id, owner_user_id, friend_id, amount, paid_at, payment_method, notes) VALUES ($1, $2, $3, 4000, $4, 'cash', null), ($5, $6, $7, 5000, $8, 'cash', null), ($9, $10, $11, 3000, $12, 'cash', null), ($13, $14, $15, 2000, $16, 'cash', null), ($17, $18, $19, 1000, $20, 'cash', null)",
    [repaymentOne, ownerA, friendA, now, repaymentTwo, ownerA, friendA, now, repaymentExpense, ownerA, friendA, now, repaymentToDelete, ownerA, friendA, now, repaymentB, ownerB, friendB, now],
  );
  await pool.query(
    "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, 4000), ($4, $5, $6, 5000), ($7, $8, $9, 3000), ($10, $11, $12, 2000)",
    [ownerA, repaymentOne, shareOne, ownerA, repaymentTwo, shareTwo, ownerA, repaymentExpense, shareCascade, ownerA, repaymentToDelete, shareRepayment],
  );

  const outingImpact = await repositoryA.getOutingDeletionImpact(outingCascade);
  assert(outingImpact.expenseCount === 2 && outingImpact.expenseTotal === 30000, "outing impact expenses are wrong");
  assert(outingImpact.receiptCount === 2 && outingImpact.shareCount === 2 && outingImpact.allocationCount === 2, "outing impact subtree counts are wrong");
  assert(outingImpact.affectedRepaymentCount === 2 && outingImpact.affectedFriendIds.length === 1, "outing impact dependencies are wrong");
  const outingRevision = deletionImpactRevision(outingImpact);
  await pool.query(
    "INSERT INTO expenses (id, owner_user_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5)",
    [expenseRace, ownerA, outingCascade, "Race expense", 11000],
  );
  await pool.query(
    "INSERT INTO expense_shares (id, owner_user_id, expense_id, friend_id, amount_owed) VALUES ($1, $2, $3, $4, $5)",
    [shareRace, ownerA, expenseRace, friendA, 11000],
  );
  await pool.query(
    "INSERT INTO repayment_allocations (owner_user_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
    [ownerA, repaymentTwo, shareRace, 11000],
  );
  await expectError(() => repositoryA.deleteOuting(outingCascade, { cascadeDependents: true, expectedImpactRevision: outingRevision }), LedgerDeletionConfirmationRequiredError);
  assert((await repositoryA.getOuting(outingCascade)).id === outingCascade, "stale outing deletion removed the parent");
  assert((await repositoryA.getExpense(expenseRace)).id === expenseRace, "stale outing deletion removed the new dependent");
  assert(await count(pool, "expenses", ownerA) === 5, "stale outing deletion changed dependent expenses");
  assert(await count(pool, "expense_shares", ownerA) === 5, "stale outing deletion changed dependent shares");
  assert(await count(pool, "repayment_allocations", ownerA) === 5, "stale outing deletion changed dependent allocations");
  const updatedOutingImpact = await repositoryA.getOutingDeletionImpact(outingCascade);
  const updatedOutingRevision = deletionImpactRevision(updatedOutingImpact);
  assert(updatedOutingRevision !== outingRevision, "stale outing revision did not change");
  assert(updatedOutingImpact.expenseCount === 3 && updatedOutingImpact.expenseTotal === 41000, "updated outing impact is wrong");
  await repositoryA.deleteOuting(outingCascade, { cascadeDependents: true, expectedImpactRevision: updatedOutingRevision });
  const repaymentAfterRace = await repositoryA.getRepayment(repaymentTwo);
  assert(repaymentAfterRace.unallocatedAmount === repaymentAfterRace.amount, "affected repayment did not remain and become unallocated");
  assert((await repositoryB.getExpense(expenseB)).id === expenseB, "unrelated owner record did not survive the race deletion");
  await repositoryA.deleteOuting(outingEmpty);
  assert(await count(pool, "expenses", ownerA) === 2, "outing cascade did not remove its expenses");
  assert(await count(pool, "expense_receipts", ownerA) === 2, "outing cascade did not remove receipts");
  assert(await count(pool, "expense_shares", ownerA) === 2, "outing cascade did not remove shares");
  assert(await count(pool, "debtor_share_receipts", ownerA) === 1, "outing cascade removed unrelated public receipts");
  assert(await count(pool, "repayment_allocations", ownerA) === 2, "outing cascade removed unrelated allocations");
  const repaymentAfterOuting = await repositoryA.getRepayment(repaymentOne);
  assert(repaymentAfterOuting.unallocatedAmount === repaymentAfterOuting.amount, "affected repayment did not become unallocated");
  assert((await repositoryB.getExpense(expenseB)).id === expenseB, "unrelated owner record did not survive");

  const expenseImpact = await repositoryA.getExpenseDeletionImpact(expenseCascade);
  assert(expenseImpact.receiptCount === 1 && expenseImpact.shareCount === 1 && expenseImpact.allocationCount === 1, "expense impact is wrong");
  await expectError(() => repositoryA.deleteExpense(expenseCascade), LedgerDeletionConfirmationRequiredError);
  await repositoryA.deleteExpense(expenseCascade, { cascadeDependents: true });
  assert(await count(pool, "expense_receipts", ownerA) === 1, "expense cascade did not remove its receipt");
  assert(await count(pool, "expense_shares", ownerA) === 1, "expense cascade did not remove its share");
  assert(await count(pool, "repayment_allocations", ownerA) === 1, "expense cascade did not remove its allocation");
  assert((await repositoryA.getRepayment(repaymentExpense)).unallocatedAmount === 3000, "expense cascade did not unallocate repayment");

  const repaymentImpact = await repositoryA.getRepaymentDeletionImpact(repaymentToDelete);
  assert(repaymentImpact.allocationCount === 1 && repaymentImpact.friendId === friendA, "repayment impact is wrong");
  await expectError(() => repositoryA.deleteRepayment(repaymentToDelete), LedgerDeletionConfirmationRequiredError);
  await repositoryA.deleteRepayment(repaymentToDelete, { cascadeDependents: true });
  assert(await count(pool, "repayment_allocations", ownerA) === 0, "repayment cascade did not remove its allocations");
  assert((await repositoryA.getExpense(expenseRepayment)).id === expenseRepayment, "repayment cascade deleted the expense");
  assert((await repositoryA.listExpenseShares(expenseRepayment)).some((share) => share.id === shareRepayment), "repayment cascade deleted the share");

  await expectError(() => repositoryB.deleteExpense(expenseCascade, { cascadeDependents: true }), LedgerNotFoundError);
  await expectError(() => repositoryB.deleteRepayment(repaymentToDelete, { cascadeDependents: true }), LedgerNotFoundError);
  await expectError(() => repositoryA.getOutingDeletionImpact(randomUUID()), LedgerNotFoundError);
  console.log("history-delete smoke passed: owner-isolated impacts, transactional confirmation, outing/expense/repayment cascades, public receipts, and unallocated repayments verified");
} finally {
  await pool.query("DELETE FROM debtor_share_receipts WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM debtor_share_links WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM repayment_allocations WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM repayments WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM expense_receipts WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM expense_shares WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM expenses WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM outings WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM friends WHERE owner_user_id IN ($1, $2)", [ownerA, ownerB]);
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ownerA, ownerB]);
  await pool.end();
}
