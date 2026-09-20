import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { BudgetError } from "../src/domain/budgeting/errors";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;
const { createGroup, removeGroupMember, requireGroupAccess } = await import("../src/server/groups");
const { createGroupExpense, confirmGroupExpenseAsPayer, rejectGroupExpenseAsPayer, voidGroupExpenseAsPayer } = await import("../src/server/group-accounting");
const { createGroupSettlement, confirmGroupSettlement } = await import("../src/server/group-settlements");
const { createGroupOffset, confirmGroupOffset } = await import("../src/server/group-offsets");
const { createBudgetSetup } = await import("../src/server/budgeting/profiles");
const { importBudgetActivity } = await import("../src/server/budgeting/sources-personal");
const { changeGroupExpenseBudgetCategory, changeGroupObligationBudgetCategory, readGroupBudgetSharedMoney } = await import("../src/server/budgeting/sources-group");
const { listBudgetTransactions } = await import("../src/server/budgeting/transactions");

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
    dave: randomUUID(),
  };
  let groupId = "";
  const groupIds: string[] = [];
  try {
    for (const [label, id] of Object.entries(users)) {
      await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)", [id, label, `b3-${id}@example.com`]);
    }
    const group = await createGroup(database, users.alice, { name: "B3 budget smoke" });
    groupId = group.id;
    groupIds.push(group.id);
    const aliceParticipant = (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [groupId, users.alice])).rows[0]!.participant_id;
    const bobParticipant = await addMember(pool, groupId, users.bob);
    const carolParticipant = await addMember(pool, groupId, users.carol);

    const secondGroup = await createGroup(database, users.alice, { name: "B3 second budget smoke" });
    groupIds.push(secondGroup.id);
    const daveParticipant = await addMember(pool, secondGroup.id, users.dave);

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
    await changeGroupExpenseBudgetCategory(database, users.alice, expense.id, aliceCategories.get("Food")!);
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
    await changeGroupExpenseBudgetCategory(database, users.alice, expense.id, aliceCategories.get("Dining")!);
    assert.equal((await pool.query<{ name: string }>("SELECT c.name FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2", [users.alice, recipientTransaction])).rows[0]?.name, "Dining");
    await changeGroupObligationBudgetCategory(database, users.bob, obligationId, bobCategories.get("Accommodation")!);
    assert.equal((await pool.query<{ name: string }>("SELECT c.name FROM budget_impacts i JOIN budget_categories c ON c.owner_user_id = i.owner_user_id AND c.id = i.budget_category_id WHERE i.owner_user_id = $1 AND i.budget_transaction_id = $2", [users.bob, senderTransaction])).rows[0]?.name, "Accommodation");

    await assert.rejects(() => changeGroupExpenseBudgetCategory(database, users.bob, expense.id, bobCategories.get("Travel")!), (error: unknown) => isBudgetError(error, "NOT_FOUND"));
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

    await createGroupExpense(database, secondGroup.id, users.alice, {
      description: "Second Group dinner",
      occurredAt: new Date("2026-09-11T10:00:00Z"),
      occurredOn: "2026-09-11",
      totalAmount: 400,
      payerParticipantId: (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [secondGroup.id, users.alice])).rows[0]!.participant_id,
      shares: [{ participantId: daveParticipant, amount: 400 }],
    });

    await removeGroupMember(database, groupId, users.alice, users.bob);
    await removeGroupMember(database, groupId, users.alice, users.carol);
    await assert.rejects(() => requireGroupAccess(database, groupId, users.bob));
    await assert.rejects(() => requireGroupAccess(database, groupId, users.carol));
    const formerDebtorMoney = await readGroupBudgetSharedMoney(database, users.bob);
    assert.equal(formerDebtorMoney.stillOwe, 100, "former debtor lost the remaining Group obligation");
    assert.equal(formerDebtorMoney.expectedBack, 0);
    assert.equal(formerDebtorMoney.obligations.filter(({ id }) => id === obligationId).length, 1, "Group obligation was counted more than once");
    const formerCreditorMoney = await readGroupBudgetSharedMoney(database, users.carol);
    assert.equal(formerCreditorMoney.expectedBack, 40, "former creditor lost the remaining Group obligation");
    const aliceSharedMoney = await readGroupBudgetSharedMoney(database, users.alice);
    assert.equal(aliceSharedMoney.expectedBack, 500, "active owner did not aggregate multiple Groups/counterparties");
    assert.equal(aliceSharedMoney.stillOwe, 40);

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
    const historyTriggers = [
      "DROP TRIGGER IF EXISTS group_offset_applications_totals ON group_offset_applications",
      "DROP TRIGGER IF EXISTS group_offset_settlements_applications_complete ON group_offset_settlements",
      "DROP TRIGGER IF EXISTS group_offset_applications_integrity ON group_offset_applications",
      "DROP TRIGGER IF EXISTS group_offset_settlements_historical_facts ON group_offset_settlements",
      "DROP TRIGGER IF EXISTS group_settlement_applications_totals ON group_settlement_applications",
      "DROP TRIGGER IF EXISTS group_settlements_applications_complete ON group_settlements",
      "DROP TRIGGER IF EXISTS group_settlement_applications_integrity ON group_settlement_applications",
      "DROP TRIGGER IF EXISTS group_settlements_historical_facts ON group_settlements",
    ];
    for (const statement of historyTriggers) await pool.query(statement);
    try {
      await pool.query("DELETE FROM budget_group_obligation_classifications WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]);
      await pool.query("DELETE FROM budget_group_expense_sources WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]);
      await pool.query("DELETE FROM budget_group_settlement_sources WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]);
      for (const currentGroupId of groupIds) {
        await pool.query("DELETE FROM group_offset_applications WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_offset_settlements WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_settlement_applications WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_settlements WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_obligations WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_expense_shares WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_expenses WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_memberships WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM group_participants WHERE group_id = $1", [currentGroupId]);
        await pool.query("DELETE FROM groups WHERE id = $1", [currentGroupId]);
      }
    } finally {
      await pool.query("CREATE TRIGGER group_offset_applications_integrity BEFORE INSERT OR UPDATE OR DELETE ON group_offset_applications FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_application()");
      await pool.query("CREATE CONSTRAINT TRIGGER group_offset_settlements_applications_complete AFTER INSERT OR UPDATE ON group_offset_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_application_totals()");
      await pool.query("CREATE CONSTRAINT TRIGGER group_offset_applications_totals AFTER INSERT ON group_offset_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_application_totals()");
      await pool.query("CREATE TRIGGER group_offset_settlements_historical_facts BEFORE INSERT OR UPDATE OR DELETE ON group_offset_settlements FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_offset_settlement()");
      await pool.query("CREATE TRIGGER group_settlement_applications_integrity BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_applications FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application()");
      await pool.query("CREATE CONSTRAINT TRIGGER group_settlements_applications_complete AFTER INSERT OR UPDATE ON group_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application_totals()");
      await pool.query("CREATE CONSTRAINT TRIGGER group_settlement_applications_totals AFTER INSERT ON group_settlement_applications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement_application_totals()");
      await pool.query("CREATE TRIGGER group_settlements_historical_facts BEFORE INSERT OR UPDATE OR DELETE ON group_settlements FOR EACH ROW EXECUTE FUNCTION zplit_validate_group_settlement()");
    }
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [Object.values(users)]);
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("budgeting-group-smoke.ts")) await runBudgetingGroupSmoke();
