import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import { createLedgerRepository } from "../src/domain/ledger-repository";
import { validateReceiptFile } from "../src/domain/receipt-file";
import { createExpenseReceipt, getExpenseReceipt } from "../src/server/expense-receipts";

if (process.env.DB_NAME !== "zplit_test") throw new Error("shared receipts smoke requires DB_NAME=zplit_test");

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const {
  createDebtorShareLink,
  DebtorShareReceiptSelectionError,
  getSharedDebtorReceipt,
  hashDebtorShareToken,
  resolveDebtorShareLink,
  revokeDebtorShareLink,
  updateDebtorShareReceiptSelection,
} = await import("../src/server/debtor-share-links");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function receipt(seed: number, filename: string) {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
  return validateReceiptFile({ bytes, filename, mediaType: "image/png" });
}

async function cleanup(client: PoolClient, owners: string[]) {
  await client.query("DELETE FROM debtor_share_receipts WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM debtor_share_links WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM expense_receipts WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM expense_shares WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM expenses WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM outings WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM friends WHERE owner_user_id = ANY($1::text[])", [owners]);
  await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [owners]);
}

async function run() {
  const pool = createDatabasePool(readRuntimeDatabaseConfig());
  const db = drizzle(pool, { schema });
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const now = new Date("2026-08-05T00:00:00.000Z");
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true), ($4, $5, $6, true)", [ownerA, "Shared A", `shared-a-${ownerA}@example.com`, ownerB, "Shared B", `shared-b-${ownerB}@example.com`]);
    const repositoryA = createLedgerRepository(db, ownerA);
    const repositoryB = createLedgerRepository(db, ownerB);
    const friendA = await repositoryA.createFriend({ name: "Friend A", phoneNumber: null, notes: null });
    const friendB = await repositoryB.createFriend({ name: "Friend B", phoneNumber: null, notes: null });
    const outingA = await repositoryA.createOuting({ title: "Owner A outing", occurredAt: now, notes: null });
    const outingB = await repositoryB.createOuting({ title: "Owner B outing", occurredAt: now, notes: null });
    const expenseA1 = await repositoryA.createExpense({ outingId: outingA.id, description: "Owner A dinner", amount: 10_000 });
    const expenseA2 = await repositoryA.createExpense({ outingId: outingA.id, description: "Owner A taxi", amount: 8_000 });
    const expenseA3 = await repositoryA.createExpense({ outingId: outingA.id, description: "Owner A private", amount: 4_000 });
    const expenseB = await repositoryB.createExpense({ outingId: outingB.id, description: "Owner B lunch", amount: 7_000 });
    const [shareA1] = await repositoryA.replaceExpenseShares(expenseA1.id, [{ friendId: friendA.id, amountOwed: 10_000 }]);
    await repositoryA.replaceExpenseShares(expenseA2.id, [{ friendId: friendA.id, amountOwed: 8_000 }]);
    await repositoryB.replaceExpenseShares(expenseB.id, [{ friendId: friendB.id, amountOwed: 7_000 }]);
    assert(shareA1, "owner A share was not created");
    const fileA1 = receipt(1, "private-dinner.png");
    const fileA2 = receipt(2, "private-taxi.png");
    const receiptA1 = await createExpenseReceipt(db, ownerA, expenseA1.id, fileA1);
    const receiptA2 = await createExpenseReceipt(db, ownerA, expenseA2.id, fileA2);
    const receiptAUnselected = await createExpenseReceipt(db, ownerA, expenseA3.id, receipt(3, "not-selected.png"));
    const receiptB = await createExpenseReceipt(db, ownerB, expenseB.id, receipt(4, "owner-b.png"));
    const eligible = await repositoryA.listEligibleDebtorShareReceipts(friendA.id);
    assert(eligible.flatMap((group) => group.receipts).length === 2, "eligible lookup omitted owner A receipts");
    assert(eligible.some((group) => group.expenseId === expenseA1.id), "eligible lookup omitted friend share expense");

    let rejected = false;
    try { await createDebtorShareLink(db, ownerA, friendA.id, [receiptAUnselected.id], now); } catch (error) { rejected = error instanceof DebtorShareReceiptSelectionError; }
    assert(rejected, "same-owner receipt without a friend share was accepted");
    rejected = false;
    try { await createDebtorShareLink(db, ownerA, friendA.id, [receiptB.id], now); } catch (error) { rejected = error instanceof DebtorShareReceiptSelectionError; }
    assert(rejected, "another owner's receipt was accepted");

    const first = await createDebtorShareLink(db, ownerA, friendA.id, [receiptA1.id], now);
    const firstMapping = (await client.query<{ id: string; expense_receipt_id: string }>("SELECT id, expense_receipt_id FROM debtor_share_receipts WHERE debtor_share_link_id = $1", [await linkId(client, first.token)])).rows[0];
    assert(firstMapping?.expense_receipt_id === receiptA1.id, "selected mapping was not persisted");
    const firstPublicReceipt = await getSharedDebtorReceipt(db, first.token, firstMapping.id, now);
    assert(firstPublicReceipt && Buffer.compare(firstPublicReceipt.content, Buffer.from(fileA1.content)) === 0, "selected receipt bytes changed");
    assert(!(await getSharedDebtorReceipt(db, first.token, randomUUID(), now)), "unselected receipt was accessible");
    assert(!(await getSharedDebtorReceipt(db, first.token, firstMapping.id, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000 + 1))), "expired token retrieved a receipt");
    const before = await resolveDebtorShareLink(db, first.token, now);
    assert(before?.statement.outstandingAmount === 18_000, "initial statement total changed");
    assert(await getExpenseReceipt(db, ownerA, expenseA1.id, receiptA1.id), "authenticated owner receipt route lost private access");
    assert(!(await getExpenseReceipt(db, ownerB, expenseA1.id, receiptA1.id)), "authenticated receipt access crossed owners");

    const selected = await updateDebtorShareReceiptSelection(db, ownerA, friendA.id, [receiptA2.id], now);
    assert(selected.length === 1 && selected[0] === receiptA2.id, "selection update returned the wrong IDs");
    assert(!(await getSharedDebtorReceipt(db, first.token, firstMapping.id, now)), "old mapping survived selection update");
    const updatedMapping = (await client.query<{ id: string }>("SELECT id FROM debtor_share_receipts WHERE debtor_share_link_id = $1", [await linkId(client, first.token)])).rows[0];
    const updatedPublicReceipt = updatedMapping ? await getSharedDebtorReceipt(db, first.token, updatedMapping.id, now) : null;
    assert(updatedPublicReceipt && Buffer.compare(updatedPublicReceipt.content, Buffer.from(fileA2.content)) === 0, "new mapping was not granted");
    const afterUpdate = await resolveDebtorShareLink(db, first.token, now);
    assert(afterUpdate?.statement.outstandingAmount === before?.statement.outstandingAmount, "selection update changed statement totals");

    const replacement = await createDebtorShareLink(db, ownerA, friendA.id, [receiptA1.id], new Date(now.getTime() + 1_000));
    assert(!(await resolveDebtorShareLink(db, first.token, now)), "replacement left the old token active");
    assert(!(await getSharedDebtorReceipt(db, first.token, updatedMapping.id, now)), "replacement left the old receipt route active");
    const replacementResolved = await resolveDebtorShareLink(db, replacement.token, now);
    assert(replacementResolved?.statement.outstandingAmount === before?.statement.outstandingAmount, "replacement changed statement totals");
    await revokeDebtorShareLink(db, ownerA, friendA.id, new Date(now.getTime() + 2_000));
    assert(!(await resolveDebtorShareLink(db, replacement.token, now)), "revocation left the token active");
    const replacementMapping = (await client.query<{ id: string }>("SELECT id FROM debtor_share_receipts WHERE debtor_share_link_id = $1", [await linkId(client, replacement.token)])).rows[0];
    assert(!replacementMapping, "revocation left receipt mappings behind");

    const ownerBLink = await createDebtorShareLink(db, ownerB, friendB.id, [receiptB.id], now);
    const ownerBMapping = (await client.query<{ id: string }>("SELECT id FROM debtor_share_receipts WHERE debtor_share_link_id = $1", [await linkId(client, ownerBLink.token)])).rows[0];
    assert(ownerBMapping && await getSharedDebtorReceipt(db, ownerBLink.token, ownerBMapping.id, now), "owner B link did not resolve its own receipt");
    assert(!(await getSharedDebtorReceipt(db, ownerBLink.token, firstMapping.id, now)), "owner B retrieved owner A receipt");
    assert(!(await getSharedDebtorReceipt(db, randomUUID(), ownerBMapping.id, now)), "foreign token retrieved a receipt");
    console.log("shared receipts smoke passed: owner isolation, eligibility, selection, update, replacement, revocation, private access, and totals verified");
  } finally {
    if (client) await cleanup(client, [ownerA, ownerB]);
    client?.release();
    await pool.end();
  }
}

async function linkId(client: PoolClient, token: string) {
  const result = await client.query<{ id: string }>("SELECT id FROM debtor_share_links WHERE token_hash = $1", [hashDebtorShareToken(token)]);
  assert(result.rows[0], "link was not persisted");
  return result.rows[0].id;
}

await run();
