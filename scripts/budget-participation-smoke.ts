import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResultRow } from "pg";
import * as schema from "../src/db/schema";
import type { Database } from "../src/db/client";
import { BudgetError } from "../src/domain/budgeting/errors";
import { formatSafeError, readDatabaseConfig } from "./migrate.js";

const require = createRequire(import.meta.url);
const serverOnlyPath = require.resolve("server-only");
if (!require.cache[serverOnlyPath]) require.cache[serverOnlyPath] = { exports: {} } as never;

const { createLedgerRepository } = await import("../src/domain/ledger-repository");
const { createPersonalBudgetIntegration, changePersonalExpenseBudgetCategory, getPersonalExpenseBudgetState, importPersonalActivity } = await import("../src/server/budgeting/sources-personal");
const { changeGroupExpenseBudgetCategory, getGroupExpenseBudgetState } = await import("../src/server/budgeting/sources-group");
const { createBudgetSetup, getBudgetProfile, setBudgetIncludeNewExpensesByDefault } = await import("../src/server/budgeting/profiles");
const { createGroupExpense, confirmGroupExpenseAsPayer } = await import("../src/server/group-accounting");
const { createGroup } = await import("../src/server/groups");
const { ensurePersonalLedgerScope } = await import("../src/server/ledger-scopes");

async function row<T extends QueryResultRow>(pool: Pool, statement: string, values: unknown[]) {
  const result = await pool.query<T>(statement, values);
  assert.equal(result.rowCount, 1, `expected one row for ${statement}`);
  return result.rows[0]!;
}

async function count(pool: Pool, statement: string, values: unknown[]) {
  const result = await pool.query<{ count: string }>(statement, values);
  return Number(result.rows[0]?.count ?? 0);
}

function isBudgetError(error: unknown, code: string) {
  return error instanceof BudgetError && error.code === code;
}

async function run() {
  if (process.env.DB_NAME !== "zplit_test") throw new Error("budget participation smoke requires DB_NAME=zplit_test");
  const config = readDatabaseConfig("zplit_test");
  const pool = new Pool({ ...config, max: 8, connectionTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema }) as Database;
  const users = { owner: randomUUID(), member: randomUUID() };
  let scope = "";
  const groupIds: string[] = [];
  try {
    for (const [label, id] of Object.entries(users)) {
      await pool.query("INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, true)", [id, label, `bp-${id}@example.com`]);
    }
    scope = await ensurePersonalLedgerScope(database, users.owner);
    await createBudgetSetup(database, users.owner, {
      periodName: "Participation September",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      totalBudget: 10_000,
      categories: [{ name: "Food", allocatedAmount: 0 }, { name: "Transport", allocatedAmount: 0 }],
    });
    await createBudgetSetup(database, users.member, {
      periodName: "Member September",
      startsOn: "2026-09-01",
      endsOn: "2026-09-30",
      totalBudget: 10_000,
      categories: [],
    });
    const ownerProfile = await getBudgetProfile(database, users.owner);
    assert.equal(ownerProfile?.includeNewExpensesByDefault, true, "a configured Budget must default to including new expenses");

    const categories = await pool.query<{ id: string; name: string }>("SELECT id, name FROM budget_categories WHERE owner_user_id = $1", [users.owner]);
    const foodId = categories.rows.find((category) => category.name === "Food")!.id;
    const transportId = categories.rows.find((category) => category.name === "Transport")!.id;
    const uncategorizedId = categories.rows.find((category) => category.name === "Uncategorized")!.id;

    // Private preference storage: persisted, owner-scoped, and defaulted ON.
    await setBudgetIncludeNewExpensesByDefault(database, users.owner, false);
    assert.equal((await getBudgetProfile(database, users.owner))?.includeNewExpensesByDefault, false, "the Budget default preference must persist OFF");
    await setBudgetIncludeNewExpensesByDefault(database, users.owner, true);
    assert.equal((await getBudgetProfile(database, users.owner))?.includeNewExpensesByDefault, true, "the Budget default preference must persist ON");

    const ids = {
      outingIncluded: randomUUID(),
      outingExcluded: randomUUID(),
      outingLegacy: randomUUID(),
      legacyExpense: randomUUID(),
    };
    await pool.query(
      "INSERT INTO outings (id, ledger_scope_id, title, occurred_at, occurred_on) VALUES ($1, $2, 'Included outing', '2026-09-05T10:00:00Z', '2026-09-05'), ($3, $2, 'Excluded outing', '2026-09-06T10:00:00Z', '2026-09-06'), ($4, $2, 'Legacy outing', '2026-09-08T10:00:00Z', '2026-09-08')",
      [ids.outingIncluded, scope, ids.outingExcluded, ids.outingLegacy],
    );
    await pool.query("INSERT INTO expenses (id, ledger_scope_id, outing_id, description, amount) VALUES ($1, $2, $3, 'Legacy unlinked expense', 250)", [ids.legacyExpense, scope, ids.outingLegacy]);

    const repository = createLedgerRepository(database, scope, { personalBudget: createPersonalBudgetIntegration(users.owner, scope) });

    // Included Personal creation: linked transaction with the chosen canonical category.
    const included = await repository.createExpense({ outingId: ids.outingIncluded, description: "Included dinner", amount: 600 }, { includeInBudget: true, categoryId: foodId });
    const includedLink = await row<{ budget_transaction_id: string }>(pool, "SELECT budget_transaction_id FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, included.id]);
    const includedTransaction = await row<{ amount: number; direction: string; status: string; origin: string; occurred_on: string }>(pool, "SELECT amount, direction, status, origin, occurred_on::text AS occurred_on FROM budget_transactions WHERE owner_user_id = $1 AND id = $2", [users.owner, includedLink.budget_transaction_id]);
    assert.deepEqual(includedTransaction, { amount: 600, direction: "outflow", status: "posted", origin: "linked", occurred_on: "2026-09-05" });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_category_id = $3 AND status = 'applied'", [users.owner, includedLink.budget_transaction_id, foodId]), 1, "an included Personal expense must absorb into the chosen category");
    assert.deepEqual(await getPersonalExpenseBudgetState(database, users.owner, scope, included.id), { status: "included", transactionId: includedLink.budget_transaction_id, categoryId: foodId, categoryName: "Food" });

    // Excluded Personal creation: durable private exclusion, no Budget cash.
    const excluded = await repository.createExpense({ outingId: ids.outingExcluded, description: "Excluded dinner", amount: 700 }, { includeInBudget: false });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, excluded.id]), 0, "an excluded Personal expense must not link Budget cash");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_exclusions WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, excluded.id]), 1, "an explicit Personal exclusion must be durable");
    assert.deepEqual(await getPersonalExpenseBudgetState(database, users.owner, scope, excluded.id), { status: "not_included" });

    // Later reconciliation (a source edit) must keep respecting the decision.
    await repository.updateExpense(excluded.id, { outingId: ids.outingExcluded, description: "Excluded dinner edited", amount: 750 });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, excluded.id]), 0, "reconciliation must not auto-link an explicitly excluded Personal expense");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_exclusions WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, excluded.id]), 1);
    // A deleted source removes its exclusion through the typed foreign key.
    const disposable = await repository.createExpense({ outingId: ids.outingExcluded, description: "Disposable excluded", amount: 100 }, { includeInBudget: false });
    await repository.deleteExpense(disposable.id, { cascadeDependents: true });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_exclusions WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, disposable.id]), 0, "deleting an expense must not leave orphaned exclusion state");

    // Import: excluded sources stay out while legacy unlinked sources remain eligible.
    const firstImport = await importPersonalActivity(database, users.owner, scope);
    assert.equal(firstImport.expenseCount, 1, "import must only pick up the legacy unlinked Personal expense");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, ids.legacyExpense]), 1, "import must keep seeing legacy unlinked Personal expenses");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND expense_id = $2", [users.owner, excluded.id]), 0, "import must never resurrect an explicit exclusion");
    assert.equal((await importPersonalActivity(database, users.owner, scope)).expenseCount, 0, "a repeated import must be idempotent");

    // Category mutation keeps the canonical amount, status, and source identity.
    await changePersonalExpenseBudgetCategory(database, users.owner, scope, includedLink.budget_transaction_id, transportId);
    const recategorized = await row<{ amount: number; status: string; category_id: string }>(
      pool,
      "SELECT t.amount, t.status, i.budget_category_id AS category_id FROM budget_transactions t JOIN budget_impacts i ON i.owner_user_id = t.owner_user_id AND i.budget_transaction_id = t.id WHERE t.owner_user_id = $1 AND t.id = $2",
      [users.owner, includedLink.budget_transaction_id],
    );
    assert.deepEqual(recategorized, { amount: 600, status: "posted", category_id: transportId });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_personal_expense_sources WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND expense_id = $3", [users.owner, includedLink.budget_transaction_id, included.id]), 1, "recategorization must preserve source identity");
    await assert.rejects(
      () => changePersonalExpenseBudgetCategory(database, users.owner, scope, includedLink.budget_transaction_id, randomUUID()),
      (error: unknown) => isBudgetError(error, "NOT_FOUND"),
      "an unowned Budget category must be rejected",
    );
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_category_id = $3", [users.owner, includedLink.budget_transaction_id, uncategorizedId])).rows[0].count, 0, "a rejected category must not create classification state");

    // Group creation: only the registered payer's own creation-time choice applies.
    const group = await createGroup(database, users.owner, { name: "Participation smoke" });
    groupIds.push(group.id);
    const ownerParticipant = (await pool.query<{ participant_id: string }>("SELECT participant_id FROM group_memberships WHERE group_id = $1 AND user_id = $2", [group.id, users.owner])).rows[0]!.participant_id;
    const memberParticipant = randomUUID();
    await pool.query("INSERT INTO group_participants (id, group_id, user_id) VALUES ($1, $2, $3)", [memberParticipant, group.id, users.member]);
    await pool.query("INSERT INTO group_memberships (group_id, user_id, participant_id, role) VALUES ($1, $2, $3, 'member')", [group.id, users.member, memberParticipant]);

    const groupIncluded = await createGroupExpense(database, group.id, users.owner, {
      description: "Group dinner",
      occurredAt: new Date("2026-09-10T10:00:00Z"),
      occurredOn: "2026-09-10",
      totalAmount: 900,
      payerParticipantId: ownerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 400 }, { participantId: memberParticipant, amount: 500 }],
    }, { includeInBudget: true, categoryId: foodId });
    assert.equal(groupIncluded.state, "confirmed");
    const groupIncludedLink = await row<{ budget_transaction_id: string }>(pool, "SELECT budget_transaction_id FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.owner, groupIncluded.id]);
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_category_id = $3", [users.owner, groupIncludedLink.budget_transaction_id, foodId]), 1, "an included Group expense must absorb into the payer's chosen category");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.member, groupIncluded.id]), 0, "another member must never receive the payer's Budget cash");

    const groupExcluded = await createGroupExpense(database, group.id, users.owner, {
      description: "Group groceries",
      occurredAt: new Date("2026-09-11T10:00:00Z"),
      occurredOn: "2026-09-11",
      totalAmount: 300,
      payerParticipantId: ownerParticipant,
      shares: [{ participantId: ownerParticipant, amount: 300 }],
    }, { includeInBudget: false });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.owner, groupExcluded.id]), 0, "an excluded Group expense must not link the payer's Budget cash");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_exclusions WHERE owner_user_id = $1 AND group_expense_id = $2", [users.owner, groupExcluded.id]), 1, "an explicit Group exclusion must be durable");
    assert.deepEqual(await getGroupExpenseBudgetState(database, users.owner, groupExcluded.id), { status: "not_included" });
    assert.deepEqual(await getGroupExpenseBudgetState(database, users.member, groupExcluded.id), { status: "unprocessed" }, "a non-payer must not read another member's private Budget state");

    // Reconciling Group activity must keep both the exclusion and Group authority intact.
    const linksBeforePendingClaim = await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = ANY($1::text[])", [[users.owner, users.member]]);
    const memberExpense = await createGroupExpense(database, group.id, users.owner, {
      description: "Claimed by member",
      occurredAt: new Date("2026-09-12T10:00:00Z"),
      occurredOn: "2026-09-12",
      totalAmount: 500,
      payerParticipantId: memberParticipant,
      shares: [{ participantId: memberParticipant, amount: 500 }],
    }, { includeInBudget: true, categoryId: transportId });
    assert.equal(memberExpense.state, "pending", "a third-party claim stays financially non-authoritative");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = ANY($1::text[])", [[users.owner, users.member]]), linksBeforePendingClaim, "a pending payer claim must create no Budget cash for anyone");
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_exclusions WHERE owner_user_id = ANY($1::text[])", [[users.owner, users.member]]), 1, "a creator must not record another member's private exclusion");
    await confirmGroupExpenseAsPayer(database, group.id, memberExpense.id, users.member);
    const memberLink = await row<{ budget_transaction_id: string }>(pool, "SELECT budget_transaction_id FROM budget_group_expense_sources WHERE owner_user_id = $1 AND group_expense_id = $2", [users.member, memberExpense.id]);
    const memberUncategorizedId = (await pool.query<{ id: string }>("SELECT id FROM budget_categories WHERE owner_user_id = $1 AND system_key = 'uncategorized'", [users.member])).rows[0]!.id;
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_impacts WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND budget_category_id = $3", [users.member, memberLink.budget_transaction_id, memberUncategorizedId]), 1, "a confirmed third-party payer keeps the existing reconciliation behavior");

    // Group category mutation preserves amount/source and stays owner-private.
    await changeGroupExpenseBudgetCategory(database, users.owner, groupIncludedLink.budget_transaction_id, transportId);
    const groupRecategorized = await row<{ amount: number; status: string; category_id: string }>(
      pool,
      "SELECT t.amount, t.status, i.budget_category_id AS category_id FROM budget_transactions t JOIN budget_impacts i ON i.owner_user_id = t.owner_user_id AND i.budget_transaction_id = t.id WHERE t.owner_user_id = $1 AND t.id = $2",
      [users.owner, groupIncludedLink.budget_transaction_id],
    );
    assert.deepEqual(groupRecategorized, { amount: 900, status: "posted", category_id: transportId });
    assert.equal(await count(pool, "SELECT count(*)::text AS count FROM budget_group_expense_sources WHERE owner_user_id = $1 AND budget_transaction_id = $2 AND group_expense_id = $3", [users.owner, groupIncludedLink.budget_transaction_id, groupIncluded.id]), 1, "Group recategorization must preserve source identity");
    await assert.rejects(
      () => changeGroupExpenseBudgetCategory(database, users.member, groupIncludedLink.budget_transaction_id, transportId),
      (error: unknown) => isBudgetError(error, "NOT_FOUND"),
      "another user must not mutate this payer's Group classification",
    );
    console.log("budget participation smoke passed: durable private exclusions, default preference, creation-time category, import/reconciliation semantics, category mutation, and Group payer ownership verified");
  } catch (error) {
    console.error(`budget participation smoke failed: ${formatSafeError(error, config.password)}`);
    process.exitCode = 1;
  } finally {
    if (scope) {
      await pool.query("DELETE FROM budget_group_expense_exclusions WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_personal_expense_exclusions WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_group_expense_sources WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_personal_expense_sources WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_impacts WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_transactions WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_period_categories WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_periods WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_categories WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      await pool.query("DELETE FROM budget_profiles WHERE owner_user_id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
      for (const groupId of groupIds) {
        await pool.query("DELETE FROM group_expense_lifecycle_events WHERE group_id = $1", [groupId]).catch(() => undefined);
        await pool.query("DELETE FROM group_obligations WHERE group_id = $1", [groupId]).catch(() => undefined);
        await pool.query("DELETE FROM group_expense_shares WHERE group_id = $1", [groupId]).catch(() => undefined);
        await pool.query("DELETE FROM group_expenses WHERE group_id = $1", [groupId]).catch(() => undefined);
        await pool.query("DELETE FROM group_memberships WHERE group_id = $1", [groupId]).catch(() => undefined);
        await pool.query("DELETE FROM group_participants WHERE group_id = $1", [groupId]).catch(() => undefined);
        await pool.query("DELETE FROM groups WHERE id = $1", [groupId]).catch(() => undefined);
      }
      await pool.query("DELETE FROM expenses WHERE ledger_scope_id = $1", [scope]).catch(() => undefined);
      await pool.query("DELETE FROM outings WHERE ledger_scope_id = $1", [scope]).catch(() => undefined);
      await pool.query("DELETE FROM ledger_scopes WHERE id = $1", [scope]).catch(() => undefined);
      await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [Object.values(users)]).catch(() => undefined);
    }
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) void run();
