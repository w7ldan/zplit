import assert from "node:assert/strict";
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
import { ensurePersonalLedgerScope } from "../src/server/ledger-scopes";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("history-delete smoke requires DATABASE_URL");
let databaseName: string;
try {
  databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
} catch {
  throw new Error("history-delete smoke requires a valid DATABASE_URL");
}
if (databaseName !== "zplit_test") throw new Error("history-delete smoke requires the disposable zplit_test database");

async function count(pool: Pool, table: string, ledgerScopeId: string) {
  const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE ledger_scope_id = $1`, [ledgerScopeId]);
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
let scopeA = "";
let scopeB = "";

try {
  await pool.query(
    "INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)",
    [ownerA, "Owner A Private", `history-a-${ownerA}@example.com`, ownerB, "Owner B Private", `history-b-${ownerB}@example.com`],
  );
  scopeA = await ensurePersonalLedgerScope(database, ownerA);
  scopeB = await ensurePersonalLedgerScope(database, ownerB);
  const repositoryA = createLedgerRepository(database, scopeA);
  const repositoryB = createLedgerRepository(database, scopeB);
  await pool.query(
    "INSERT INTO friends (id, ledger_scope_id, name) VALUES ($1, $2, $3), ($4, $5, $6)",
    [friendA, scopeA, "Friend A", friendB, scopeB, "Friend B"],
  );
  await pool.query(
    "INSERT INTO outings (id, ledger_scope_id, title, occurred_at) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12), ($13, $14, $15, $16), ($17, $18, $19, $20)",
    [
      outingEmpty, scopeA, "Empty outing", "2026-08-01T00:00:00Z",
      outingCascade, scopeA, "Cascading outing", "2026-08-02T00:00:00Z",
      outingExpense, scopeA, "Expense cascade outing", "2026-08-03T00:00:00Z",
      outingRepayment, scopeA, "Repayment cascade outing", "2026-08-04T00:00:00Z",
      outingB, scopeB, "Owner B outing", "2026-08-04T00:00:00Z",
    ],
  );
  await pool.query(
    "INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15), ($16, $17, $18, $19, $20), ($21, $22, $23, $24, $25)",
    [
      expenseOne, scopeA, outingCascade, "First expense", 10000,
      expenseTwo, scopeA, outingCascade, "Second expense", 20000,
      expenseCascade, scopeA, outingExpense, "Expense subtree", 30000,
      expenseRepayment, scopeA, outingRepayment, "Repayment subtree", 40000,
      expenseB, scopeB, outingB, "Owner B expense", 5000,
    ],
  );
  await pool.query(
    "INSERT INTO expense_shares (id, ledger_scope_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12), ($13, $14, $15, $16, $17, $18), ($19, $20, $21, $22, $23, $24), ($25, $26, $27, $28, $29, $30)",
    [
      shareOne, scopeA, expenseOne, friendA, 6000, 6000,
      shareTwo, scopeA, expenseTwo, friendA, 7000, 7000,
      shareCascade, scopeA, expenseCascade, friendA, 10000, 10000,
      shareRepayment, scopeA, expenseRepayment, friendA, 12000, 12000,
      shareB, scopeB, expenseB, friendB, 5000, 5000,
    ],
  );
  await pool.query(
    "INSERT INTO expense_receipts (id, ledger_scope_id, expense_id, original_filename, media_type, byte_size, sha256, content) VALUES ($1, $2, $3, 'one.png', 'image/png', 4, repeat('a', 64), decode('01020304', 'hex')), ($4, $5, $6, 'two.png', 'image/png', 4, repeat('b', 64), decode('05060708', 'hex')), ($7, $8, $9, 'cascade.png', 'image/png', 4, repeat('c', 64), decode('090a0b0c', 'hex')), ($10, $11, $12, 'repayment.png', 'image/png', 4, repeat('d', 64), decode('0d0e0f10', 'hex'))",
    [receiptOne, scopeA, expenseOne, receiptTwo, scopeA, expenseTwo, receiptCascade, scopeA, expenseCascade, receiptRepayment, scopeA, expenseRepayment],
  );
  await pool.query(
    "INSERT INTO debtor_share_links (id, token_hash, ledger_scope_id, friend_id, expires_at) VALUES ($1, repeat('e', 64), $2, $3, $4)",
    [debtorLink, scopeA, friendA, new Date("2027-01-01T00:00:00Z")],
  );
  await pool.query(
    "INSERT INTO debtor_share_receipts (id, ledger_scope_id, debtor_share_link_id, expense_id, expense_receipt_id) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)",
    [publicReceiptOne, scopeA, debtorLink, expenseOne, receiptOne, publicReceiptCascade, scopeA, debtorLink, expenseCascade, receiptCascade],
  );
  await pool.query(
    "INSERT INTO repayments (id, ledger_scope_id, friend_id, amount, paid_at, payment_method, notes) VALUES ($1, $2, $3, 4000, $4, 'cash', null), ($5, $6, $7, 5000, $8, 'cash', null), ($9, $10, $11, 3000, $12, 'cash', null), ($13, $14, $15, 2000, $16, 'cash', null), ($17, $18, $19, 1000, $20, 'cash', null)",
    [repaymentOne, scopeA, friendA, now, repaymentTwo, scopeA, friendA, now, repaymentExpense, scopeA, friendA, now, repaymentToDelete, scopeA, friendA, now, repaymentB, scopeB, friendB, now],
  );
  await pool.query(
    "INSERT INTO repayment_allocations (ledger_scope_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, 4000), ($4, $5, $6, 5000), ($7, $8, $9, 3000), ($10, $11, $12, 2000)",
    [scopeA, repaymentOne, shareOne, scopeA, repaymentTwo, shareTwo, scopeA, repaymentExpense, shareCascade, scopeA, repaymentToDelete, shareRepayment],
  );

  const outingImpact = await repositoryA.getOutingDeletionImpact(outingCascade);
  assert(outingImpact.expenseCount === 2 && outingImpact.expenseTotal === 30000, "outing impact expenses are wrong");
  assert(outingImpact.receiptCount === 2 && outingImpact.shareCount === 2 && outingImpact.allocationCount === 2, "outing impact subtree counts are wrong");
  assert(outingImpact.affectedRepaymentCount === 2 && outingImpact.affectedFriendIds.length === 1, "outing impact dependencies are wrong");
  const outingRevision = deletionImpactRevision(outingImpact);
  await pool.query(
    "INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, $4, $5)",
    [expenseRace, scopeA, outingCascade, "Race expense", 11000],
  );
  await pool.query(
    "INSERT INTO expense_shares (id, ledger_scope_id, expense_id, friend_id, base_amount, amount_owed) VALUES ($1, $2, $3, $4, $5, $6)",
    [shareRace, scopeA, expenseRace, friendA, 11000, 11000],
  );
  await pool.query(
    "INSERT INTO repayment_allocations (ledger_scope_id, repayment_id, expense_share_id, amount) VALUES ($1, $2, $3, $4)",
    [scopeA, repaymentTwo, shareRace, 11000],
  );
  await expectError(() => repositoryA.deleteOuting(outingCascade, { cascadeDependents: true, expectedImpactRevision: outingRevision }), LedgerDeletionConfirmationRequiredError);
  assert((await repositoryA.getOuting(outingCascade)).id === outingCascade, "stale outing deletion removed the parent");
  assert((await repositoryA.getExpense(expenseRace)).id === expenseRace, "stale outing deletion removed the new dependent");
  assert(await count(pool, "expenses", scopeA) === 5, "stale outing deletion changed dependent expenses");
  assert(await count(pool, "expense_shares", scopeA) === 5, "stale outing deletion changed dependent shares");
  assert(await count(pool, "repayment_allocations", scopeA) === 5, "stale outing deletion changed dependent allocations");
  const updatedOutingImpact = await repositoryA.getOutingDeletionImpact(outingCascade);
  const updatedOutingRevision = deletionImpactRevision(updatedOutingImpact);
  assert(updatedOutingRevision !== outingRevision, "stale outing revision did not change");
  assert(updatedOutingImpact.expenseCount === 3 && updatedOutingImpact.expenseTotal === 41000, "updated outing impact is wrong");
  await repositoryA.deleteOuting(outingCascade, { cascadeDependents: true, expectedImpactRevision: updatedOutingRevision });
  const repaymentAfterRace = await repositoryA.getRepayment(repaymentTwo);
  assert(repaymentAfterRace.unallocatedAmount === repaymentAfterRace.amount, "affected repayment did not remain and become unallocated");
  assert((await repositoryB.getExpense(expenseB)).id === expenseB, "unrelated owner record did not survive the race deletion");
  await repositoryA.deleteOuting(outingEmpty);
  assert(await count(pool, "expenses", scopeA) === 2, "outing cascade did not remove its expenses");
  assert(await count(pool, "expense_receipts", scopeA) === 2, "outing cascade did not remove receipts");
  assert(await count(pool, "expense_shares", scopeA) === 2, "outing cascade did not remove shares");
  assert(await count(pool, "debtor_share_receipts", scopeA) === 1, "outing cascade removed unrelated public receipts");
  assert(await count(pool, "repayment_allocations", scopeA) === 2, "outing cascade did not remove unrelated allocations");
  const repaymentAfterOuting = await repositoryA.getRepayment(repaymentOne);
  assert(repaymentAfterOuting.unallocatedAmount === repaymentAfterOuting.amount, "affected repayment did not become unallocated");
  assert((await repositoryB.getExpense(expenseB)).id === expenseB, "unrelated owner record did not survive");

  const expenseImpact = await repositoryA.getExpenseDeletionImpact(expenseCascade);
  assert(expenseImpact.receiptCount === 1 && expenseImpact.shareCount === 1 && expenseImpact.allocationCount === 1, "expense impact is wrong");
  await expectError(() => repositoryA.deleteExpense(expenseCascade), LedgerDeletionConfirmationRequiredError);
  await repositoryA.deleteExpense(expenseCascade, { cascadeDependents: true });
  assert(await count(pool, "expense_receipts", scopeA) === 1, "expense cascade did not remove its receipt");
  assert(await count(pool, "expense_shares", scopeA) === 1, "expense cascade did not remove its share");
  assert(await count(pool, "repayment_allocations", scopeA) === 2, "expense cascade did not reconcile its allocation");
  assert((await repositoryA.getRepayment(repaymentExpense)).unallocatedAmount === 0, "expense cascade did not reallocate repayment");

  const repaymentImpact = await repositoryA.getRepaymentDeletionImpact(repaymentToDelete);
  assert(repaymentImpact.allocationCount === 1 && repaymentImpact.friendId === friendA, "repayment impact is wrong");
  await expectError(() => repositoryA.deleteRepayment(repaymentToDelete), LedgerDeletionConfirmationRequiredError);
  await repositoryA.deleteRepayment(repaymentToDelete, { cascadeDependents: true });
  assert(await count(pool, "repayment_allocations", scopeA) === 1, "repayment cascade did not remove its allocations");
  assert((await repositoryA.getRepayment(repaymentExpense)).unallocatedAmount === 0, "repayment cascade changed the reconciled repayment");
  assert((await repositoryA.getExpense(expenseRepayment)).id === expenseRepayment, "repayment cascade deleted the expense");
  assert((await repositoryA.listExpenseShares(expenseRepayment)).some((share) => share.id === shareRepayment), "repayment cascade deleted the share");

  await expectError(() => repositoryB.deleteExpense(expenseCascade, { cascadeDependents: true }), LedgerNotFoundError);
  await expectError(() => repositoryB.deleteRepayment(repaymentToDelete, { cascadeDependents: true }), LedgerNotFoundError);
  await expectError(() => repositoryA.getOutingDeletionImpact(randomUUID()), LedgerNotFoundError);
  console.log("history-delete smoke passed: owner-isolated impacts, transactional confirmation, outing/expense/repayment cascades, public receipts, and unallocated repayments verified");
  } finally {
  await pool.query("DELETE FROM debtor_share_receipts WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM debtor_share_links WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM repayment_allocations WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM repayments WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM expense_receipts WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM expense_shares WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM expenses WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM outings WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM friends WHERE ledger_scope_id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM ledger_scopes WHERE id IN ($1, $2)", [scopeA, scopeB]);
  await pool.query("DELETE FROM users WHERE id IN ($1, $2)", [ownerA, ownerB]);
  await pool.end();
}
