import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { createBudgetSetup } from "../src/server/budgeting/profiles";
import { importBudgetActivity } from "../src/server/budgeting/sources-personal";
import { changeGroupExpenseBudgetCategory, changeGroupObligationBudgetCategory } from "../src/server/budgeting/sources-group";
import { listBudgetTransactions } from "../src/server/budgeting/transactions";
import { BudgetError } from "../src/domain/budgeting/errors";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { createGroup } = await import("../src/server/groups");
const { createGroupExpense, confirmGroupExpenseAsPayer, rejectGroupExpenseAsPayer, voidGroupExpenseAsPayer } = await import("../src/server/group-accounting");
const { createGroupSettlement, confirmGroupSettlement } = await import("../src/server/group-settlements");
const { createGroupOffset, confirmGroupOffset } = await import("../src/server/group-offsets");

async function addMember(pool: Pool, groupId: string, userId: string) {
  const participantId = randomUUID();
  await pool.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $2, $3)", [participantId, groupId, userId]);
  await pool.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'member')", [groupId, userId, participantId]);
  return participantId;
}

async function categoryIds(pool: Pool, ownerUserId: string) {
  const result = await pool.query<{ id: string; name: string }>("SELECT id, name FROM budget_categories WHERE owner_user_id = $1", [ownerUserId]);
  return new Map(result.rows.map((row) => [row.name, row.id]));
}

async function count(pool: Pool, statement: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(statement, values);
  return Number(result.rows[0]?.count ?? 0);
}

function isBudgetError(error: unknown, code: string) {
  return error instanceof BudgetError && error.code === code;
}

export async function runBudgetingGroupSmoke() {
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema }) as Database;
  const users = {
    alice: randomUUID(),
    bob: randomUUID(),
    carol: randomUUID(),
  };
  let groupId = "";
  try {
    for (const [label, id] of Object.entries(users)) {
      await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)", [id, label, `b3-${id}@example.com`]);
    }
    const group = await createGroup(database, users.alice, { name: "B3 budget smoke" });
    groupId = group.id;
    const aliceParticipant = (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, users.alice])).rows[0]!.participant_id;
    const bobParticipant = await addMember(pool, groupId, users.bob);
    const carolParticipant = await addMember(pool, groupId, users.carol);

    await createBudgetSetup(database, users.alice, { periodName: "Alice September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 10_000, categories: [{ name: "Food", allocatedAmount: 0 }, { name: "Dining", allocatedAmount: 0 }] });
    await createBudgetSetup(database, users.bob, { periodName: "Bob September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 10_000, categories: [{ name: "Travel", allocatedAmount: 0 }, { name: "Accommodation", allocatedAmount: 0 }] });
    const aliceCategories = await categoryIds(pool, users.alice);
    const bobCategories = await categoryIds(pool, users.bob);

    const expense = await createGroupExpense(database, groupId, users.alice, {
      description: "Group dinner",
      occurredAt: new Date("2026-09-05T10:00:00Z"),
      occurredOn: "2026-09-05",
      totalAmount: 1_000,
      payerParticipantId: aliceParticipant,
      shares: [{ participantId: aliceParticipant, amount: 400 }, { participantId: bobParticipant, amount: 600 }],
    });
    assert.equal(expense.state, "confirmed");
    const aliceExpenseTransaction = (await pool.query<{ id: string }>("SELECT budget_transaction_id AS id FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.alice, expense.id])).rows[0]?.id;
    assert(aliceExpenseTransaction, "authoritative payer Expense did not create a Budget link");
    assert.equal((await pool.query("SELECT amount, direction, occurred_on FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [users.alice, aliceExpenseTransaction])).rows[0].amount, 1_000);
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.bob, expense.id]), 0, "non-payer received Expense-time cash");
    await changeGroupExpenseBudgetCategory(database, users.alice, aliceExpenseTransaction, aliceCategories.get("Food")!);
    const obligationId = (await pool.query<{ id: string }>("SELECT id FROM group_obligations WHERE source_expense_id = $1 AND debtor_participant_id = $2", [expense.id, bobParticipant])).rows[0]!.id;
    await changeGroupObligationBudgetCategory(database, users.bob, obligationId, bobCategories.get("Travel")!);

    const pendingExpense = await createGroupExpense(database, groupId, users.alice, {
      description: "Pending payer claim",
      occurredAt: new Date("2026-09-06T10:00:00Z"),
      occurredOn: "2026-09-06",
      totalAmount: 50,
      payerParticipantId: bobParticipant,
      shares: [{ participantId: aliceParticipant, amount: 50 }],
    });
    assert.equal(pendingExpense.state, "pending");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE group_expense_id = $1", [pendingExpense.id]), 0);
    await rejectGroupExpenseAsPayer(database, groupId, pendingExpense.id, users.bob);
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE group_expense_id = $1", [pendingExpense.id]), 0);

    const pendingSettlement = await createGroupSettlement(database, groupId, users.bob, {
      senderParticipantId: bobParticipant,
      recipientParticipantId: aliceParticipant,
      amount: 300,
      paymentMethod: "Cash",
      paidOn: "2026-09-07",
    });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_settlement_sources WHERE group_settlement_id = $1", [pendingSettlement.id]), 0);
    const confirmedSettlement = await confirmGroupSettlement(database, groupId, pendingSettlement.id, users.alice);
    assert.equal(confirmedSettlement.state, "confirmed");
    const senderTransaction = (await pool.query<{ id: string }>("SELECT budget_transaction_id AS id FROM budget_group_settlement_sources WHERE owner_user_id = $1 AND group_settlement_id = $2", [users.bob, confirmedSettlement.id])).rows[0]?.id;
    const recipientTransaction = (await pool.query<{ id: string }>("SELECT budget_transaction_id AS id FROM budget_group_settlement_sources WHERE owner_user_id = $1 AND group_settlement_id = $2", [users.alice, confirmedSettlement.id])).rows[0]?.id;
    assert(senderTransaction && recipientTransaction, "confirmed settlement did not create both owner links");
    assert.equal((await pool.query<{ name: string }>("SELECT c.name FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2", [users.bob, senderTransaction])).rows[0]?.name, "Travel");
    assert.equal((await pool.query<{ name: string }>("SELECT c.name FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2", [users.alice, recipientTransaction])).rows[0]?.name, "Food");
    assert.equal((await pool.query<{ total: string }>("SELECT coalesce(sum(amount), 0)::text AS total FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [users.bob, senderTransaction])).rows[0]?.total, "300");
    assert.equal((await pool.query<{ total: string }>("SELECT coalesce(sum(amount), 0)::text AS total FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [users.alice, recipientTransaction])).rows[0]?.total, "300");
    await changeGroupExpenseBudgetCategory(database, users.alice, aliceExpenseTransaction, aliceCategories.get("Dining")!);
    assert.equal((await pool.query<{ name: string }>("SELECT c.name FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2", [users.alice, recipientTransaction])).rows[0]?.name, "Dining");
    await changeGroupObligationBudgetCategory(database, users.bob, obligationId, bobCategories.get("Accommodation")!);
    assert.equal((await pool.query<{ name: string }>("SELECT c.name FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2", [users.bob, senderTransaction])).rows[0]?.name, "Accommodation");

    await assert.rejects(() => changeGroupExpenseBudgetCategory(database, users.bob, aliceExpenseTransaction, bobCategories.get("Travel")!), (error: unknown) => isBudgetError(error, "NOT_FOUND"));
    await assert.rejects(() => changeGroupObligationBudgetCategory(database, users.alice, obligationId, aliceCategories.get("Dining")!), (error: unknown) => isBudgetError(error, "NOT_FOUND"));
    const bobHistory = await listBudgetTransactions(database, users.bob);
    assert(bobHistory.every((row) => row.sourceId !== expense.id), "Budget history leaked Alice's Group Expense");

    const reverseExpense = await createGroupExpense(database, groupId, users.bob, {
      description: "Reverse Group expense",
      occurredAt: new Date("2026-09-08T10:00:00Z"),
      occurredOn: "2026-09-08",
      totalAmount: 200,
      payerParticipantId: bobParticipant,
      shares: [{ participantId: aliceParticipant, amount: 200 }],
    });
    const budgetCountBeforeOffset = await count(pool, "SELECT count(*)::text AS count FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [[users.alice, users.bob]]);
    const impactCountBeforeOffset = await count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [[users.alice, users.bob]]);
    const offset = await createGroupOffset(database, groupId, users.alice, { counterpartyParticipantId: bobParticipant });
    await confirmGroupOffset(database, groupId, offset.id, users.bob);
    const budgetCountAfterOffset = await count(pool, "SELECT count(*)::text AS count FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [[users.alice, users.bob]]);
    assert.equal(budgetCountAfterOffset, budgetCountBeforeOffset, "confirmed Group offset created Budget cash");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [[users.alice, users.bob]]), impactCountBeforeOffset, "confirmed Group offset created Budget impacts");
    assert(reverseExpense.id, "reverse expense should exist");

    const importExpense = await createGroupExpense(database, groupId, users.alice, {
      description: "Carol import expense",
      occurredAt: new Date("2026-09-09T10:00:00Z"),
      occurredOn: "2026-09-09",
      totalAmount: 40,
      payerParticipantId: carolParticipant,
      shares: [{ participantId: aliceParticipant, amount: 40 }],
    });
    assert.equal(importExpense.state, "pending");
    await confirmGroupExpenseAsPayer(database, groupId, importExpense.id, users.carol);
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE group_expense_id = $1", [importExpense.id]), 0);
    await createBudgetSetup(database, users.carol, { periodName: "Carol September", startsOn: "2026-09-01", endsOn: "2026-09-30", totalBudget: 10_000, categories: [] });
    await Promise.all([importBudgetActivity(database, users.carol, null), importBudgetActivity(database, users.carol, null)]);
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.carol, importExpense.id]), 1, "concurrent Group imports did not converge");

    const outside = await createGroupExpense(database, groupId, users.alice, {
      description: "Outside active period",
      occurredAt: new Date("2026-08-31T10:00:00Z"),
      occurredOn: "2026-08-31",
      totalAmount: 25,
      payerParticipantId: aliceParticipant,
      shares: [{ participantId: aliceParticipant, amount: 25 }],
    });
    const outsideTransaction = (await pool.query<{ id: string }>("SELECT budget_transaction_id AS id FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.alice, outside.id])).rows[0]!.id;
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2", [users.alice, outsideTransaction]), 0);
    const voidExpense = await createGroupExpense(database, groupId, users.alice, {
      description: "Voided Group expense",
      occurredAt: new Date("2026-09-10T10:00:00Z"),
      occurredOn: "2026-09-10",
      totalAmount: 15,
      payerParticipantId: aliceParticipant,
      shares: [{ participantId: aliceParticipant, amount: 15 }],
    });
    const voidTransaction = (await pool.query<{ id: string }>("SELECT budget_transaction_id AS id FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.alice, voidExpense.id])).rows[0]!.id;
    await voidGroupExpenseAsPayer(database, groupId, voidExpense.id, users.alice);
    assert.equal((await pool.query<{ status: string }>("SELECT status FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [users.alice, voidTransaction])).rows[0]?.status, "voided");
    console.log("Group budgeting smoke passed");
  } catch (error) {
    console.error(`Group budgeting smoke failed: ${formatSafeError(error)}`);
    process.exitCode = 1;
  } finally {
    if (groupId) {
      await pool.query("DELETE FROM budget_group_obligation_classifications WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]);
      await pool.query("DELETE FROM budget_group_expense_sources WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]);
      await pool.query("DELETE FROM budget_group_settlement_sources WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]);
      await pool.query("DELETE FROM group_offset_applications WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_offset_settlements WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_settlement_applications WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_settlements WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_obligations WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_expense_shares WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_expenses WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_memberships WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM group_participants WHERE group_id = $1", [groupId]);
      await pool.query("DELETE FROM groups WHERE id = $1", [groupId]);
    }
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [Object.values(users)]);
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("budgeting-group-smoke.ts")) await runBudgetingGroupSmoke();
