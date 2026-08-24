import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const domainTables = [
  "expense_charge_targets",
  "expense_charges",
  "expense_receipts",
  "expense_shares",
  "expenses",
  "friends",
  "outings",
  "repayment_allocations",
  "repayment_destinations",
  "repayment_proofs",
  "repayments",
  "trips",
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
  it("exports the twelve domain tables and four auth tables", () => {
    expect(
      [schema.friends, schema.outings, schema.trips, schema.expenses, schema.expenseShares, schema.expenseCharges, schema.expenseChargeTargets, schema.expenseReceipts, schema.repayments, schema.repaymentProofs, schema.repaymentAllocations, schema.repaymentDestinations]
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

  it("defines owner-editable repayment destinations with safe bounds", () => {
    const table = getTableConfig(schema.repaymentDestinations);
    expect(table.name).toBe("repayment_destinations");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_user_id",
      "type",
      "name",
      "identifier",
      "account_name",
      "note",
      "share_on_balance_links",
      "sort_order",
      "created_at",
      "updated_at",
    ]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "repayment_destinations_type_allowed",
      "repayment_destinations_name_not_blank",
      "repayment_destinations_identifier_not_blank",
      "repayment_destinations_sort_order_nonnegative",
    ]));
    expect(foreignKeyShape(schema.repaymentDestinations)).toEqual(expect.arrayContaining([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.repaymentDestinations, "repayment_destinations_owner_order_idx")).toEqual(["owner_user_id", "sort_order", "id"]);
  });

  it("defines one owner-private payment proof per repayment", () => {
    const table = getTableConfig(schema.repaymentProofs);
    expect(table.name).toBe("repayment_proofs");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_user_id",
      "repayment_id",
      "original_filename",
      "media_type",
      "byte_size",
      "sha256",
      "content",
      "created_at",
    ]);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "repayment_proofs_media_type_allowed",
      "repayment_proofs_byte_size_valid",
      "repayment_proofs_content_size_matches",
      "repayment_proofs_filename_not_blank",
      "repayment_proofs_sha256_hex",
    ]));
    expect(foreignKeyShape(schema.repaymentProofs)).toEqual(expect.arrayContaining([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["owner_user_id", "repayment_id"], to: "repayments", target: ["owner_user_id", "id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.repaymentProofs, "repayment_proofs_owner_repayment_uidx")).toEqual(["owner_user_id", "repayment_id"]);
  });

  it("defines private receipt storage constraints and indexes", () => {
    const table = getTableConfig(schema.expenseReceipts);
    expect(table.name).toBe("expense_receipts");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_user_id",
      "expense_id",
      "original_filename",
      "media_type",
      "byte_size",
      "sha256",
      "content",
      "created_at",
    ]);
    expect((table.columns.find((column) => column.name === "original_filename") as unknown as { config: { length: number } }).config.length).toBe(160);
    expect((table.columns.find((column) => column.name === "media_type") as unknown as { config: { length: number } }).config.length).toBe(32);
    expect((table.columns.find((column) => column.name === "sha256") as unknown as { config: { length: number } }).config.length).toBe(64);
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "expense_receipts_media_type_allowed",
      "expense_receipts_byte_size_valid",
      "expense_receipts_content_size_matches",
      "expense_receipts_filename_not_blank",
      "expense_receipts_sha256_hex",
    ]));
    expect(foreignKeyShape(schema.expenseReceipts)).toEqual(expect.arrayContaining([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["owner_user_id", "expense_id"], to: "expenses", target: ["owner_user_id", "id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.expenseReceipts, "expense_receipts_owner_expense_sha256_uidx")).toEqual(["owner_user_id", "expense_id", "sha256"]);
    expect(indexColumns(schema.expenseReceipts, "expense_receipts_owner_expense_created_id_idx")).toEqual(["owner_user_id", "expense_id", "created_at", "id"]);
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

  it("defines owner-bound temporary debtor share links", () => {
    const table = getTableConfig(schema.debtorShareLinks);
    expect(table.name).toBe("debtor_share_links");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "token_hash",
      "owner_user_id",
      "friend_id",
      "created_at",
      "expires_at",
      "revoked_at",
    ]);
    expect((table.columns.find((column) => column.name === "token_hash") as unknown as { config: { length: number } }).config.length).toBe(64);
    expect(table.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "debtor_share_links_token_hash_uidx",
        "debtor_share_links_active_owner_friend_uidx",
        "debtor_share_links_owner_friend_idx",
        "debtor_share_links_expires_at_idx",
      ]),
    );
    expect(foreignKeyShape(schema.debtorShareLinks)).toEqual(
      expect.arrayContaining([
        { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
        { from: ["owner_user_id", "friend_id"], to: "friends", target: ["owner_user_id", "id"], onDelete: "restrict" },
      ]),
    );
    expect(table.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "debtor_share_links_token_hash_hex",
        "debtor_share_links_expires_after_created",
        "debtor_share_links_revoked_after_created",
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
      schema.trips,
      schema.expenses,
      schema.expenseShares,
      schema.expenseCharges,
      schema.expenseChargeTargets,
      schema.expenseReceipts,
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
      [schema.expenseCharges, "expense_charges_owner_user_id_id_uidx"],
      [schema.repayments, "repayments_owner_user_id_id_uidx"],
      [schema.trips, "trips_owner_user_id_id_uidx"],
    ] as const) {
      expect(indexColumns(table, name)).toEqual(["owner_user_id", "id"]);
    }
  });

  it("uses owner-aware composite foreign keys for domain relationships", () => {
    const references = [
      [schema.expenseShares, ["owner_user_id", "expense_id"], "expenses", ["owner_user_id", "id"], "cascade"],
      [schema.expenseChargeTargets, ["owner_user_id", "expense_id", "expense_charge_id"], "expense_charges", ["owner_user_id", "expense_id", "id"], "cascade"],
      [schema.expenseChargeTargets, ["owner_user_id", "expense_id", "expense_share_id"], "expense_shares", ["owner_user_id", "expense_id", "id"], "cascade"],
      [schema.outings, ["owner_user_id", "trip_id"], "trips", ["owner_user_id", "id"], "restrict"],
      [schema.expenseShares, ["owner_user_id", "friend_id"], "friends", ["owner_user_id", "id"], "restrict"],
      [schema.repayments, ["owner_user_id", "friend_id"], "friends", ["owner_user_id", "id"], "restrict"],
      [schema.repaymentAllocations, ["owner_user_id", "repayment_id"], "repayments", ["owner_user_id", "id"], "cascade"],
      [schema.repaymentAllocations, ["owner_user_id", "expense_share_id"], "expense_shares", ["owner_user_id", "id"], "cascade"],
    ] as const;
    for (const [table, from, to, target, onDelete] of references) {
      expect(foreignKeyShape(table)).toEqual(expect.arrayContaining([{ from, to, target, onDelete }]));
    }
  });

  it("uses integer money columns and positive amount checks", () => {
    for (const column of [
      schema.expenses.amount,
      schema.expenseShares.amountOwed,
      schema.expenseShares.baseAmount,
      schema.repayments.amount,
      schema.repaymentAllocations.amount,
    ]) {
      expect(column.columnType).toBe("PgInteger");
    }

    const checks = [
      ...getTableConfig(schema.expenses).checks,
      ...getTableConfig(schema.expenseShares).checks,
      ...getTableConfig(schema.expenseCharges).checks,
      ...getTableConfig(schema.repayments).checks,
      ...getTableConfig(schema.repaymentAllocations).checks,
    ].map((check) => check.name);
    expect(checks).toEqual(
      expect.arrayContaining([
        "expenses_amount_positive",
        "expense_shares_amount_owed_positive",
        "expense_shares_base_amount_positive",
        "expense_charges_percentage_basis_points_valid",
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

  it("defines owner-bound receipt visibility mappings with cascading cleanup", () => {
    const table = getTableConfig(schema.debtorShareReceipts);
    expect(table.name).toBe("debtor_share_receipts");
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_user_id",
      "debtor_share_link_id",
      "expense_id",
      "expense_receipt_id",
      "created_at",
    ]);
    expect(foreignKeyShape(schema.debtorShareReceipts)).toEqual(expect.arrayContaining([
      { from: ["owner_user_id", "debtor_share_link_id"], to: "debtor_share_links", target: ["owner_user_id", "id"], onDelete: "cascade" },
      { from: ["owner_user_id", "expense_id", "expense_receipt_id"], to: "expense_receipts", target: ["owner_user_id", "expense_id", "id"], onDelete: "cascade" },
    ]));
    expect(indexColumns(schema.debtorShareReceipts, "debtor_share_receipts_link_idx")).toEqual(["owner_user_id", "debtor_share_link_id"]);
    expect(indexColumns(schema.debtorShareReceipts, "debtor_share_receipts_public_id_idx")).toEqual(["id"]);
    expect(indexColumns(schema.debtorShareLinks, "debtor_share_links_owner_user_id_id_uidx")).toEqual(["owner_user_id", "id"]);
    expect(indexColumns(schema.expenseReceipts, "expense_receipts_owner_expense_id_uidx")).toEqual(["owner_user_id", "expense_id", "id"]);
  });

  it("defines the required foreign-key delete actions", () => {
    const actions = [
      ...foreignKeyShape(schema.expenses),
      ...foreignKeyShape(schema.expenseShares),
      ...foreignKeyShape(schema.expenseCharges),
      ...foreignKeyShape(schema.expenseChargeTargets),
      ...foreignKeyShape(schema.repayments),
      ...foreignKeyShape(schema.repaymentAllocations),
    ];
    expect(actions).toEqual(
      expect.arrayContaining([
        { from: ["owner_user_id", "outing_id"], to: "outings", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "expense_id"], to: "expenses", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "friend_id"], to: "friends", target: ["owner_user_id", "id"], onDelete: "restrict" },
        { from: ["owner_user_id", "repayment_id"], to: "repayments", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "expense_share_id"], to: "expense_shares", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "expense_id"], to: "expenses", target: ["owner_user_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "expense_id", "expense_charge_id"], to: "expense_charges", target: ["owner_user_id", "expense_id", "id"], onDelete: "cascade" },
        { from: ["owner_user_id", "expense_id", "expense_share_id"], to: "expense_shares", target: ["owner_user_id", "expense_id", "id"], onDelete: "cascade" },
      ]),
    );
    expect(actions.filter(({ from, to }) => from.join(",") === "owner_user_id,friend_id" && to === "friends")).toHaveLength(2);
  });

  it("keeps the ownership cascade graph exact", () => {
    expect(foreignKeyShape(schema.expenses)).toEqual([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["owner_user_id", "outing_id"], to: "outings", target: ["owner_user_id", "id"], onDelete: "cascade" },
    ]);
    expect(foreignKeyShape(schema.expenseShares)).toEqual([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["owner_user_id", "expense_id"], to: "expenses", target: ["owner_user_id", "id"], onDelete: "cascade" },
      { from: ["owner_user_id", "friend_id"], to: "friends", target: ["owner_user_id", "id"], onDelete: "restrict" },
    ]);
    expect(foreignKeyShape(schema.repaymentAllocations)).toEqual([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
      { from: ["owner_user_id", "repayment_id"], to: "repayments", target: ["owner_user_id", "id"], onDelete: "cascade" },
      { from: ["owner_user_id", "expense_share_id"], to: "expense_shares", target: ["owner_user_id", "id"], onDelete: "cascade" },
    ]);
  });

  it("defines the expected lookup indexes", () => {
    const indexes = [
      [schema.friends, "friends_name_idx", ["owner_user_id", "name"]],
      [schema.friends, "friends_archived_at_idx", ["owner_user_id", "archived_at"]],
      [schema.outings, "outings_occurred_at_idx", ["owner_user_id", "occurred_at"]],
      [schema.outings, "outings_owner_user_id_trip_id_idx", ["owner_user_id", "trip_id"]],
      [schema.trips, "trips_owner_user_id_name_idx", ["owner_user_id", "name"]],
      [schema.trips, "trips_owner_user_id_dates_idx", ["owner_user_id", "starts_on", "ends_on"]],
      [schema.expenses, "expenses_outing_id_idx", ["owner_user_id", "outing_id"]],
      [schema.expenseShares, "expense_shares_friend_id_idx", ["owner_user_id", "friend_id"]],
      [schema.expenseCharges, "expense_charges_owner_expense_id_idx", ["owner_user_id", "expense_id"]],
      [schema.expenseChargeTargets, "expense_charge_targets_owner_share_idx", ["owner_user_id", "expense_share_id"]],
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
        { from: ["owner_user_id", "outing_id"], to: "outings", target: ["owner_user_id", "id"], onDelete: "cascade" },
      ]),
    );
  });

  it("defines Trip fields and constraints as calendar-date organizational data", () => {
    const table = getTableConfig(schema.trips);
    expect(table.columns.map((column) => column.name)).toEqual([
      "id",
      "owner_user_id",
      "name",
      "starts_on",
      "ends_on",
      "notes",
      "created_at",
      "updated_at",
    ]);
    expect(table.columns.find((column) => column.name === "name")?.columnType).toBe("PgVarchar");
    expect((table.columns.find((column) => column.name === "name") as unknown as { config: { length: number } }).config.length).toBe(160);
    expect(table.columns.find((column) => column.name === "starts_on")?.columnType).toBe("PgDateString");
    expect(table.columns.find((column) => column.name === "ends_on")?.columnType).toBe("PgDateString");
    expect(table.checks.map((check) => check.name)).toEqual(expect.arrayContaining(["trips_name_not_blank", "trips_date_range_valid"]));
    expect(foreignKeyShape(schema.trips)).toEqual(expect.arrayContaining([
      { from: ["owner_user_id"], to: "users", target: ["id"], onDelete: "restrict" },
    ]));
    expect(foreignKeyShape(schema.outings)).toEqual(expect.arrayContaining([
      { from: ["owner_user_id", "trip_id"], to: "trips", target: ["owner_user_id", "id"], onDelete: "restrict" },
    ]));
    expect(getTableConfig(schema.outings).columns.find((column) => column.name === "trip_id")?.notNull).toBe(false);
  });
});
