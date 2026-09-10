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
    expect(tableNames(schema.budgetRecurringTemplates)).toEqual([
      "id", "owner_user_id", "name", "amount", "category_id", "frequency", "starts_on", "spread_count", "archived_at", "created_at", "updated_at",
    ]);
    expect(tableNames(schema.budgetRecurringOccurrences)).toEqual([
      "id", "owner_user_id", "recurring_template_id", "scheduled_period_id", "scheduled_on", "amount", "category_id", "spread_count", "status", "budget_transaction_id", "created_at", "updated_at",
    ]);
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
    expect(getTableConfig(schema.budgetImpacts).indexes.map((index) => index.config.name)).toContain("budget_impacts_owner_target_status_idx");
  });

  it("keeps recurring templates and occurrences owner-safe and lifecycle-consistent", () => {
    const templates = getTableConfig(schema.budgetRecurringTemplates);
    expect(templates.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "budget_recurring_templates_amount_positive",
      "budget_recurring_templates_frequency_allowed",
      "budget_recurring_templates_spread_count_range",
      "budget_recurring_templates_spread_count_fits_amount",
    ]));
    expect(templates.foreignKeys.map((key) => key.getName())).toEqual(expect.arrayContaining(["budget_recurring_templates_owner_category_fk"]));
    expect(templates.indexes.map((index) => index.config.name)).toContain("budget_recurring_templates_owner_archived_idx");

    const occurrences = getTableConfig(schema.budgetRecurringOccurrences);
    expect(occurrences.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "budget_recurring_occurrences_lifecycle",
      "budget_recurring_occurrences_status_allowed",
      "budget_recurring_occurrences_spread_count_fits_amount",
    ]));
    expect(occurrences.uniqueConstraints.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      "budget_recurring_occurrences_identity_unique",
      "budget_recurring_occurrences_owner_id_unique",
    ]));
    expect(occurrences.foreignKeys.map((key) => key.getName())).toEqual(expect.arrayContaining([
      "budget_recurring_occurrences_owner_template_fk",
      "budget_recurring_occurrences_owner_period_fk",
      "budget_recurring_occurrences_owner_category_fk",
      "budget_recurring_occurrences_owner_transaction_fk",
    ]));
    expect(occurrences.indexes.map((index) => index.config.name)).toEqual(expect.arrayContaining([
      "budget_recurring_occurrences_owner_status_scheduled_idx",
      "budget_recurring_occurrences_owner_transaction_uidx",
    ]));
  });

  it("defines typed Personal source links without polymorphic source columns", () => {
    expect(tableNames(schema.budgetPersonalExpenseSources)).toEqual(["owner_user_id", "budget_transaction_id", "expense_id", "created_at"]);
    expect(tableNames(schema.budgetPersonalRepaymentSources)).toEqual(["owner_user_id", "budget_transaction_id", "repayment_id", "created_at"]);
    for (const table of [schema.budgetPersonalExpenseSources, schema.budgetPersonalRepaymentSources]) {
      const config = getTableConfig(table);
      expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
        table === schema.budgetPersonalExpenseSources ? "budget_personal_expense_sources_owner_expense_unique" : "budget_personal_repayment_sources_owner_repayment_unique",
        table === schema.budgetPersonalExpenseSources ? "budget_personal_expense_sources_owner_transaction_unique" : "budget_personal_repayment_sources_owner_transaction_unique",
      ]));
      expect(config.foreignKeys.length).toBe(3);
    }
  });

  it("defines typed Group source links and owner-private obligation classifications", () => {
    expect(tableNames(schema.budgetGroupExpenseSources)).toEqual(["owner_user_id", "budget_transaction_id", "group_expense_id", "created_at"]);
    expect(tableNames(schema.budgetGroupSettlementSources)).toEqual(["owner_user_id", "budget_transaction_id", "group_settlement_id", "created_at"]);
    expect(tableNames(schema.budgetGroupObligationClassifications)).toEqual(["owner_user_id", "group_obligation_id", "budget_category_id", "created_at", "updated_at"]);
    expect(getTableConfig(schema.budgetGroupExpenseSources).uniqueConstraints.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      "budget_group_expense_sources_owner_expense_unique",
      "budget_group_expense_sources_owner_transaction_unique",
    ]));
    expect(getTableConfig(schema.budgetGroupSettlementSources).uniqueConstraints.map((constraint) => constraint.name)).toEqual(expect.arrayContaining([
      "budget_group_settlement_sources_owner_settlement_unique",
      "budget_group_settlement_sources_owner_transaction_unique",
    ]));
    expect(getTableConfig(schema.budgetGroupObligationClassifications).uniqueConstraints.map((constraint) => constraint.name)).toContain("budget_group_obligation_classifications_owner_obligation_unique");
    expect(getTableConfig(schema.budgetGroupExpenseSources).foreignKeys.length).toBe(3);
    expect(getTableConfig(schema.budgetGroupSettlementSources).foreignKeys.length).toBe(3);
    expect(getTableConfig(schema.budgetGroupObligationClassifications).foreignKeys.length).toBe(3);
  });
});
