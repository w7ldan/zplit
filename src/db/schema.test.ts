import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const domainTables = [
  "expense_shares",
  "expenses",
  "friends",
  "outings",
  "repayment_allocations",
  "repayments",
];

const authTables = [schema.users, schema.sessions, schema.accounts, schema.verifications];

function columnNames(columns: readonly unknown[]) {
  return columns.flatMap((column) => {
    if (typeof column === "object" && column !== null && "name" in column && typeof column.name === "string") {
      return [column.name];
    }
    return [];
  });
}

describe("database schema", () => {
  it("exports the six domain tables and four auth tables", () => {
    expect(
      [schema.friends, schema.outings, schema.expenses, schema.expenseShares, schema.repayments, schema.repaymentAllocations]
        .map((table) => getTableConfig(table).name)
        .sort(),
    ).toEqual(domainTables);
    expect(authTables.map((table) => getTableConfig(table).name).sort()).toEqual([
      "accounts",
      "sessions",
      "users",
      "verifications",
    ]);
  });

  it("keeps canonical Better Auth fields and lookup indexes", () => {
    expect(schema.users.email.isUnique).toBe(true);
    expect(schema.sessions.token.isUnique).toBe(true);
    expect(
      authTables.flatMap((table) => getTableConfig(table).indexes.map((index) => index.config.name)),
    ).toEqual(
      expect.arrayContaining([
        "sessions_userId_idx",
        "accounts_userId_idx",
        "accounts_provider_account_uidx",
        "verifications_identifier_idx",
      ]),
    );
    expect(getTableConfig(schema.sessions).foreignKeys[0].onDelete).toBe("cascade");
    expect(getTableConfig(schema.accounts).foreignKeys[0].onDelete).toBe("cascade");
  });

  it("uses integer money columns and positive amount checks", () => {
    for (const column of [
      schema.expenses.amount,
      schema.expenseShares.amountOwed,
      schema.repayments.amount,
      schema.repaymentAllocations.amount,
    ]) {
      expect(column.columnType).toBe("PgInteger");
    }

    const checks = [
      ...getTableConfig(schema.expenses).checks,
      ...getTableConfig(schema.expenseShares).checks,
      ...getTableConfig(schema.repayments).checks,
      ...getTableConfig(schema.repaymentAllocations).checks,
    ].map((check) => check.name);
    expect(checks).toEqual(
      expect.arrayContaining([
        "expenses_amount_positive",
        "expense_shares_amount_owed_positive",
        "repayments_amount_positive",
        "repayment_allocations_amount_positive",
      ]),
    );
  });

  it("defines share uniqueness and allocation composite identity", () => {
    const shareIndexes = getTableConfig(schema.expenseShares).indexes;
    expect(
      shareIndexes.some(
        (index) =>
          index.config.unique &&
          columnNames(index.config.columns).join(",") === "expense_id,friend_id",
      ),
    ).toBe(true);

    const allocationPrimaryKey = getTableConfig(schema.repaymentAllocations).primaryKeys[0];
    expect(columnNames(allocationPrimaryKey.columns)).toEqual(["repayment_id", "expense_share_id"]);
  });

  it("defines the required foreign-key delete actions", () => {
    const foreignKeys = [
      ...getTableConfig(schema.expenses).foreignKeys,
      ...getTableConfig(schema.expenseShares).foreignKeys,
      ...getTableConfig(schema.repayments).foreignKeys,
      ...getTableConfig(schema.repaymentAllocations).foreignKeys,
    ];
    const actions = foreignKeys.map((foreignKey) => ({
      from: foreignKey.reference().columns[0].name,
      to: getTableConfig(foreignKey.reference().foreignTable).name,
      onDelete: foreignKey.onDelete,
    }));
    expect(actions).toEqual(
      expect.arrayContaining([
        { from: "outing_id", to: "outings", onDelete: "set null" },
        { from: "expense_id", to: "expenses", onDelete: "cascade" },
        { from: "friend_id", to: "friends", onDelete: "restrict" },
        { from: "repayment_id", to: "repayments", onDelete: "cascade" },
        { from: "expense_share_id", to: "expense_shares", onDelete: "restrict" },
      ]),
    );
    expect(actions.filter(({ from, to }) => from === "friend_id" && to === "friends")).toHaveLength(2);
  });

  it("defines the expected lookup indexes", () => {
    const indexes = [
      ...getTableConfig(schema.friends).indexes,
      ...getTableConfig(schema.outings).indexes,
      ...getTableConfig(schema.expenses).indexes,
      ...getTableConfig(schema.expenseShares).indexes,
      ...getTableConfig(schema.repayments).indexes,
      ...getTableConfig(schema.repaymentAllocations).indexes,
    ].map((index) => index.config.name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "friends_name_idx",
        "friends_archived_at_idx",
        "outings_occurred_at_idx",
        "expenses_outing_id_idx",
        "expenses_occurred_at_idx",
        "expense_shares_friend_id_idx",
        "repayments_friend_id_idx",
        "repayments_paid_at_idx",
        "repayment_allocations_expense_share_id_idx",
      ]),
    );
  });
});
