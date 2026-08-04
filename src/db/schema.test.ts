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

function indexColumns(table: unknown, name: string) {
  const index = getTableConfig(table as never).indexes.find((candidate) => candidate.config.name === name);
  return index ? columnNames(index.config.columns) : undefined;
}

function foreignKeyShape(table: unknown) {
  return getTableConfig(table as never).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      from: columnNames(reference.columns),
      to: getTableConfig(reference.foreignTable).name,
      target: columnNames(reference.foreignColumns),
      onDelete: foreignKey.onDelete,
    };
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

  it("defines one-time account invitations with bounded, linked fields", () => {
    const table = getTableConfig(schema.accountInvitations);
    expect(table.name).toBe("account_invitations");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "token_hash",
      "email",
      "suggested_name",
      "created_by_user_id",
      "created_at",
      "expires_at",
      "claimed_at",
      "accepted_at",
      "accepted_user_id",
      "revoked_at",
    ]);
    expect((table.columns.find((column) => column.name === "token_hash") as unknown as { config: { length: number } }).config.length).toBe(64);
    expect((table.columns.find((column) => column.name === "email") as unknown as { config: { length: number } }).config.length).toBe(254);
    expect((table.columns.find((column) => column.name === "suggested_name") as unknown as { config: { length: number } }).config.length).toBe(120);
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "account_invitations_token_hash_uidx",
        "account_invitations_created_by_user_id_idx",
        "account_invitations_expires_at_idx",
        "account_invitations_accepted_user_id_idx",
        "account_invitations_active_email_expires_idx",
      ]),
    );
    expect(foreignKeyShape(schema.accountInvitations)).toEqual(
      expect.arrayContaining([
        { from: ["created_by_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
        { from: ["accepted_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      ]),
    );
    expect(table.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "account_invitations_token_hash_hex",
        "account_invitations_email_lowercase",
        "account_invitations_expires_after_created",
        "account_invitations_accepted_pair",
        "account_invitations_accepted_not_revoked",
      ]),
    );
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

  it("adds required owner columns, restrictions, and composite targets", () => {
    const domainTables = [
      schema.friends,
      schema.outings,
      schema.expenses,
      schema.expenseShares,
      schema.repayments,
      schema.repaymentAllocations,
    ];
    for (const table of domainTables) {
      const ownerColumn = getTableConfig(table).columns.find((column) => column.name === "owner_user_id");
      expect(ownerColumn).toBeDefined();
      expect(ownerColumn?.notNull).toBe(true);
      expect(ownerColumn?.columnType).toBe(schema.users.id.columnType);
      expect(
        foreignKeyShape(table).some(
          ({ from, to, target, onDelete }) =>
            from.join(",") === "owner_user_id" && to === "users" && target.join(",") === "id" && onDelete === "restrict",
        ),
      ).toBe(true);
    }

    for (const [table, name] of [
      [schema.friends, "friends_owner_user_id_id_uidx"],
      [schema.outings, "outings_owner_user_id_id_uidx"],
      [schema.expenses, "expenses_owner_user_id_id_uidx"],
      [schema.expenseShares, "expense_shares_owner_user_id_id_uidx"],
      [schema.repayments, "repayments_owner_user_id_id_uidx"],
    ] as const) {
      expect(indexColumns(table, name)).toEqual(["owner_user_id", "id"]);
    }
  });

  it("uses owner-aware composite foreign keys for domain relationships", () => {
    const references = [
      [schema.expenseShares, ["owner_user_id", "expense_id"], "expenses", ["owner_user_id", "id"], "cascade"],
      [schema.expenseShares, ["owner_user_id", "friend_id"], "friends", ["owner_user_id", "id"], "restrict"],
      [schema.repayments, ["owner_user_id", "friend_id"], "friends", ["owner_user_id", "id"], "restrict"],
      [schema.repaymentAllocations, ["owner_user_id", "repayment_id"], "repayments", ["owner_user_id", "id"], "cascade"],
      [schema.repaymentAllocations, ["owner_user_id", "expense_share_id"], "expense_shares", ["owner_user_id", "id"], "restrict"],
    ] as const;
    for (const [table, from, to, target, onDelete] of references) {
      expect(foreignKeyShape(table)).toEqual(expect.arrayContaining([{ from, to, target, onDelete }]));
    }
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
    const actions = [
      ...foreignKeyShape(schema.expenses),
      ...foreignKeyShape(schema.expenseShares),
      ...foreignKeyShape(schema.repayments),
      ...foreignKeyShape(schema.repaymentAllocations),
    ];
    expect(actions).toEqual(
      expect.arrayContaining([
        { from: ["owner_user_id", "outing_id"], to: "outings", target: ["owner_user_id", "id"], onDelete: "restrict" },
        { from: ["owner_user_id", "expense_id"], to: "expenses", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "friend_id"], to: "friends", target: ["owner_user_id", "id"], onDelete: "restrict" },
        { from: ["owner_user_id", "repayment_id"], to: "repayments", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "expense_share_id"], to: "expense_shares", target: ["owner_user_id", "id"], onDelete: "restrict" },
      ]),
    );
    expect(actions.filter(({ from, to }) => from.join(",") === "owner_user_id,friend_id" && to === "friends")).toHaveLength(2);
  });

  it("defines the expected lookup indexes", () => {
    const indexes = [
      [schema.friends, "friends_name_idx", ["owner_user_id", "name"]],
      [schema.friends, "friends_archived_at_idx", ["owner_user_id", "archived_at"]],
      [schema.outings, "outings_occurred_at_idx", ["owner_user_id", "occurred_at"]],
      [schema.expenses, "expenses_outing_id_idx", ["owner_user_id", "outing_id"]],
      [schema.expenseShares, "expense_shares_friend_id_idx", ["owner_user_id", "friend_id"]],
      [schema.repayments, "repayments_friend_id_idx", ["owner_user_id", "friend_id"]],
      [schema.repayments, "repayments_paid_at_idx", ["owner_user_id", "paid_at"]],
      [schema.repaymentAllocations, "repayment_allocations_expense_share_id_idx", ["owner_user_id", "expense_share_id"]],
    ] as const;
    for (const [table, name, columns] of indexes) expect(indexColumns(table, name)).toEqual(columns);
  });

  it("binds every expense to a required outing without an independent occurrence time", () => {
    const expenseColumns = getTableConfig(schema.expenses).columns;
    expect(expenseColumns.find((column) => column.name === "outing_id")?.notNull).toBe(true);
    expect(expenseColumns.some((column) => column.name === "occurred_at")).toBe(false);
    expect(getTableConfig(schema.expenses).indexes.some((index) => index.config.name === "expenses_occurred_at_idx")).toBe(false);
    expect(foreignKeyShape(schema.expenses)).toEqual(
      expect.arrayContaining([
        { from: ["owner_user_id", "outing_id"], to: "outings", target: ["owner_user_id", "id"], onDelete: "restrict" },
      ]),
    );
  });
});
