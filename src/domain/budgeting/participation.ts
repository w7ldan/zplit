import { normalizeUuid } from "../record-retrieval";

/**
 * The creation-time Budget decision for one eligible expense source.
 *
 * Participation is decided when the expense is created and is never edited
 * afterwards. Absence of an explicit exclusion means the source stays
 * eligible for the existing import/reconciliation behavior.
 */
export type ExpenseBudgetParticipation =
  | { includeInBudget: false }
  | { includeInBudget: true; categoryId: string | null };

export const EXPENSE_BUDGET_PARTICIPATION_FIELD = "budgetParticipation";
export const EXPENSE_BUDGET_INCLUDED_FIELD = "includeInBudget";
export const EXPENSE_BUDGET_CATEGORY_FIELD = "budgetCategoryId";
export const EXPENSE_BUDGET_MARKER = "1";

export type ExpenseBudgetParticipationSubmission =
  | { ok: true; participation: ExpenseBudgetParticipation | undefined }
  | { ok: false; categoryError: string };

/**
 * Parses the optional Budget section of an eligible expense create form.
 * A missing marker means the form offered no Budget control for this source,
 * which is different from an explicit exclusion.
 */
export function parseExpenseBudgetParticipation(formData: FormData): ExpenseBudgetParticipationSubmission {
  if (formData.get(EXPENSE_BUDGET_PARTICIPATION_FIELD) !== EXPENSE_BUDGET_MARKER) {
    return { ok: true, participation: undefined };
  }
  if (formData.get(EXPENSE_BUDGET_INCLUDED_FIELD) !== EXPENSE_BUDGET_MARKER) {
    return { ok: true, participation: { includeInBudget: false } };
  }
  const rawCategoryId = formData.get(EXPENSE_BUDGET_CATEGORY_FIELD);
  const categoryId = typeof rawCategoryId === "string" ? rawCategoryId.trim() : "";
  if (!categoryId) return { ok: true, participation: { includeInBudget: true, categoryId: null } };
  const normalized = normalizeUuid(categoryId);
  if (!normalized) return { ok: false, categoryError: "Choose a valid Budget category." };
  return { ok: true, participation: { includeInBudget: true, categoryId: normalized } };
}
