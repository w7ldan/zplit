import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

function tableNames(table: unknown) {
  return getTableConfig(table as never).columns.map((column) => column.name);
}

describe("budgeting schema", () => {
  it("defines the private user-owned budgeting model", () => {
    expect(tableNames(schema.budgetProfiles)).toEqual(["owner_user_id", "created_at", "updated_at"]);
    expect(tableNames(schema.budgetPeriods)).toEqual([
      "id", "owner_user_id", "ordinal", "name", "starts_on", "ends_on", "total_budget", "status", "created_at", "updated_at",
    ]);
    expect(tableNames(schema.budgetCategories)).toContain("system_key");
    expect(tableNames(schema.budgetPeriodCategories)).toContain("allocated_amount");
    expect(tableNames(schema.budgetTransactions)).toContain("direction");
    expect(tableNames(schema.budgetImpacts)).toContain("target_period_ordinal");
  });

  it("keeps row-local invariants and one active period in PostgreSQL", () => {
    const periods = getTableConfig(schema.budgetPeriods);
    expect(periods.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "budget_periods_ordinal_positive",
      "budget_periods_date_range_valid",
      "budget_periods_total_budget_positive",
    ]));
    expect(periods.indexes.map((index) => index.config.name)).toContain("budget_periods_active_owner_uidx");
    expect(getTableConfig(schema.budgetTransactions).checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "budget_transactions_amount_positive",
      "budget_transactions_void_timestamp_shape",
    ]));
    expect(getTableConfig(schema.budgetImpacts).checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "budget_impacts_period_shape",
      "budget_impacts_status_allowed",
    ]));
  });
});
