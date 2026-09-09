export type BudgetErrorCode =
  | "INVALID_INPUT"
  | "NOT_CONFIGURED"
  | "ALREADY_CONFIGURED"
  | "NOT_FOUND"
  | "ALLOCATION_EXCEEDS_BUDGET"
  | "TRANSACTION_OUTSIDE_PERIOD"
  | "SYSTEM_CATEGORY_IMMUTABLE"
  | "CONFLICT";

export class BudgetError extends Error {
  constructor(public readonly code: BudgetErrorCode, message: string) {
    super(message);
    this.name = "BudgetError";
  }
}
