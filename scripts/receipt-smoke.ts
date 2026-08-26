import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import { createAuth } from "../src/auth/factory";
import { createDatabasePool, readRuntimeDatabaseConfig } from "../src/db/client";
import * as schema from "../src/db/schema";
import {
  MAX_RECEIPT_BYTES_PER_EXPENSE,
  MAX_RECEIPT_BYTES,
  ReceiptFileValidationError,
  validateReceiptFile,
} from "../src/domain/receipt-file";
import { buildLedgerExportCsv } from "../src/domain/ledger-export";
import {
  createExpenseReceipt,
  deleteExpenseReceipt,
  ExpenseReceiptCountError,
  ExpenseReceiptDuplicateError,
  ExpenseReceiptTotalSizeError,
  getExpenseReceipt,
  listExpenseReceipts,
  RECEIPT_READ_HEADERS,
} from "../src/server/expense-receipts";
import { createLedgerRepository, ExpenseDeletionInvariantError } from "../src/domain/ledger-repository";
import { readSecretFile } from "../src/server/secret-file";
import { getPersonalLedgerScopeId } from "../src/server/ledger-scopes";

const suffix = randomBytes(6).toString("hex");
const emailA = `receipt-smoke-a-${suffix}@example.com`;
const emailB = `receipt-smoke-b-${suffix}@example.com`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function image(kind: "jpeg" | "png" | "webp", size: number, seed: number) {
  const bytes = Buffer.alloc(size, seed);
  if (kind === "jpeg") bytes.set([0xff, 0xd8, 0xff], 0);
  if (kind === "png") bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  if (kind === "webp") bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);
  return bytes;
}

function file(kind: "jpeg" | "png" | "webp", size = 32, seed = 1) {
  const bytes = image(kind, size, seed);
  return validateReceiptFile({ bytes, filename: `${kind}.image`, mediaType: `image/${kind}` === "image/jpeg" ? "image/jpeg" : `image/${kind}` });
}

async function expectRejected(action: Promise<unknown>, errorType: new (...args: never[]) => Error) {
  try {
    await action;
  } catch (error) {
    assert(error instanceof errorType, "unexpected receipt invariant");
    return;
  }
  throw new Error("expected rejection");
}

async function cleanup(client: PoolClient) {
  const users = await client.query<{ id: string }>("SELECT id FROM users WHERE email = ANY($1::text[])", [[emailA, emailB]]);
  const ids = users.rows.map((user) => user.id);
  if (ids.length === 0) return;
  const scopes = await client.query<{ id: string }>("SELECT id FROM ledger_scopes WHERE kind = 'personal' AND user_id = ANY($1::text[])", [ids]);
  const scopeIds = scopes.rows.map((scope) => scope.id);
  await client.query("DELETE FROM repayment_allocations WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM debtor_share_links WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM expense_receipts WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM expense_shares WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM repayments WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM expenses WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM outings WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM friends WHERE ledger_scope_id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM ledger_scopes WHERE id = ANY($1::uuid[])", [scopeIds]);
  await client.query("DELETE FROM users WHERE id = ANY($1::text[])", [ids]);
}

export async function runReceiptSmoke() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("receipt smoke requires DB_NAME=zplit_test");
  const config = readRuntimeDatabaseConfig();
  const secret = readSecretFile(process.env.BETTER_AUTH_SECRET_FILE ?? "", "BETTER_AUTH_SECRET_FILE");
  const baseURL = process.env.BETTER_AUTH_URL?.trim();
  if (!baseURL) throw new Error("BETTER_AUTH_URL is required");
  const password = randomBytes(24).toString("base64url");
  const pool = createDatabasePool(config);
  const db = drizzle(pool, { schema });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const existing = await client.query<{ count: string }>("SELECT count(*) AS count FROM expense_receipts");
    assert(Number(existing.rows[0]?.count) === 0, "receipt table is not empty before smoke");

    const auth = createAuth({ db, secret, baseURL, enableBootstrapSignUp: true });
    await auth.api.signUpEmail({ body: { name: "Receipt A", email: emailA, password } });
    await auth.api.signUpEmail({ body: { name: "Receipt B", email: emailB, password } });
    const users = await client.query<{ id: string; email: string }>("SELECT id, email FROM users WHERE email = ANY($1::text[])", [[emailA, emailB]]);
    const userA = users.rows.find((user) => user.email === emailA)?.id;
    const userB = users.rows.find((user) => user.email === emailB)?.id;
    assert(userA && userB, "smoke owners are missing");
    const scopeA = await getPersonalLedgerScopeId(db, userA);
    const scopeB = await getPersonalLedgerScopeId(db, userB);
    const repositoryA = createLedgerRepository(db, scopeA);
    const repositoryB = createLedgerRepository(db, scopeB);
    const now = new Date("2026-08-05T00:00:00.000Z");
    const outingA = await repositoryA.createOuting({ title: "Dinner", occurredAt: now, notes: null });
    const outingB = await repositoryB.createOuting({ title: "Lunch", occurredAt: now, notes: null });
    const expenseA = await repositoryA.createExpense({ outingId: outingA.id, description: "Dinner", amount: 10000 });
    const expenseB = await repositoryB.createExpense({ outingId: outingB.id, description: "Lunch", amount: 10000 });

    const jpeg = file("jpeg");
    const png = file("png", 33, 2);
    const webp = file("webp", 34, 3);
    const unsupported = Uint8Array.from([1, 2, 3]);
    for (const accepted of [jpeg, png, webp]) assert(accepted.mediaType.startsWith("image/"), "supported signature was rejected");
    for (const invalid of [
      () => validateReceiptFile({ bytes: unsupported, filename: "bad", mediaType: "image/png" }),
      () => validateReceiptFile({ bytes: png.content, filename: "bad", mediaType: "image/jpeg" }),
    ]) await expectRejected(Promise.resolve().then(invalid), ReceiptFileValidationError);
    await expectRejected(Promise.resolve().then(() => validateReceiptFile({ bytes: new Uint8Array(MAX_RECEIPT_BYTES + 1), filename: "large", mediaType: "image/png" })), ReceiptFileValidationError);

    const receiptA = await createExpenseReceipt(db, userA, expenseA.id, jpeg);
    const receiptB = await createExpenseReceipt(db, userB, expenseB.id, jpeg);
    const listedA = await listExpenseReceipts(db, userA, expenseA.id);
    assert(listedA.length === 1 && !Object.hasOwn(listedA[0]!, "content") && !Object.hasOwn(listedA[0]!, "sha256"), "receipt metadata leaked bytes or hash");
    assert(await getExpenseReceipt(db, userB, expenseA.id, receiptA.id) === null, "owner B accessed owner A receipt");
    assert(!(await deleteExpenseReceipt(db, userB, expenseA.id, receiptA.id)), "owner B deleted owner A receipt");
    assert(await getExpenseReceipt(db, userA, expenseB.id, receiptB.id) === null, "owner A accessed owner B receipt");
    assert(!(await deleteExpenseReceipt(db, userA, expenseB.id, receiptB.id)), "owner A deleted owner B receipt");
    assert(await getExpenseReceipt(db, userB, expenseB.id, receiptB.id) !== null, "owner B receipt disappeared");
    const stored = await getExpenseReceipt(db, userA, expenseA.id, receiptA.id);
    assert(stored && Buffer.compare(stored.content, Buffer.from(jpeg.content)) === 0, "retrieval bytes changed");
    const directResponse = new Response(stored.content as unknown as BodyInit, {
      headers: { ...RECEIPT_READ_HEADERS, "Content-Type": stored.mediaType, "Content-Length": String(stored.byteSize) },
    });
    for (const [name, value] of Object.entries(RECEIPT_READ_HEADERS)) assert(directResponse.headers.get(name) === value, "receipt security header changed");
    assert(directResponse.headers.get("content-length") === String(jpeg.content.byteLength), "receipt content length changed");
    const secondReceiptA = await createExpenseReceipt(db, userA, expenseA.id, png);
    assert(await deleteExpenseReceipt(db, userA, expenseA.id, receiptA.id), "selected receipt was not deleted");
    assert(await getExpenseReceipt(db, userA, expenseA.id, secondReceiptA.id) !== null, "deleting one receipt removed another");

    const countExpense = await repositoryA.createExpense({ outingId: outingA.id, description: "Count", amount: 10000 });
    for (let index = 0; index < 5; index += 1) await createExpenseReceipt(db, userA, countExpense.id, file("jpeg", 32, index + 10));
    await expectRejected(createExpenseReceipt(db, userA, countExpense.id, file("jpeg", 32, 20)), ExpenseReceiptCountError);
    const duplicateExpense = await repositoryA.createExpense({ outingId: outingA.id, description: "Duplicate", amount: 10000 });
    await createExpenseReceipt(db, userA, duplicateExpense.id, jpeg);
    await expectRejected(createExpenseReceipt(db, userA, duplicateExpense.id, jpeg), ExpenseReceiptDuplicateError);

    const totalExpense = await repositoryA.createExpense({ outingId: outingA.id, description: "Total", amount: 10000 });
    for (let index = 0; index < 3; index += 1) await createExpenseReceipt(db, userA, totalExpense.id, file("png", MAX_RECEIPT_BYTES, index + 30));
    await expectRejected(createExpenseReceipt(db, userA, totalExpense.id, file("png", 8, 40)), ExpenseReceiptTotalSizeError);
    assert(MAX_RECEIPT_BYTES_PER_EXPENSE === 15 * 1024 * 1024, "total limit changed");

    const friend = await repositoryA.createFriend({ name: "Friend", phoneNumber: null, notes: null });
    const allocatedExpense = await repositoryA.createExpense({ outingId: outingA.id, description: "Allocated", amount: 5000 });
    const [share] = await repositoryA.replaceExpenseShares(allocatedExpense.id, [{ friendId: friend.id, amountOwed: 3000 }]);
    const repayment = await repositoryA.createRepayment({ friendId: friend.id, amount: 3000, paidAt: now, paymentMethod: null, notes: null });
    await repositoryA.replaceRepaymentAllocations(repayment.id, [{ expenseShareId: share!.id, amount: 3000 }]);
    const allocatedReceipt = await createExpenseReceipt(db, userA, allocatedExpense.id, webp);
    let deletionFailed = false;
    try { await repositoryA.deleteExpense(allocatedExpense.id); } catch (error) { deletionFailed = error instanceof ExpenseDeletionInvariantError; }
    assert(deletionFailed, "allocated expense deletion succeeded");
    assert(await getExpenseReceipt(db, userA, allocatedExpense.id, allocatedReceipt.id) !== null, "allocated deletion removed receipt");
    assert(!(await repositoryA.getFriendDebtorStatement(friend.id)).items.some((item) => Object.hasOwn(item, "receipt")), "debtor statement contains receipt data");
    const exportCsv = buildLedgerExportCsv("expense-shares.csv", await repositoryA.getLedgerExportSnapshot());
    assert(!/receipt|sha256|content/i.test(exportCsv), "export contains receipt data");
    await repositoryA.replaceRepaymentAllocations(repayment.id, []);
    await repositoryA.deleteExpense(allocatedExpense.id, { cascadeDependents: true });
    assert(await getExpenseReceipt(db, userA, allocatedExpense.id, allocatedReceipt.id) === null, "expense deletion did not cascade receipt");

    await repositoryA.deleteExpense(expenseA.id, { cascadeDependents: true });
    assert((await listExpenseReceipts(db, userA, expenseA.id)).length === 0, "simple expense deletion did not cascade receipt");
  } finally {
    if (client) await cleanup(client);
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runReceiptSmoke().then(() => console.log("receipt smoke succeeded"), () => {
    console.error("receipt smoke failed");
    process.exitCode = 1;
  });
}
