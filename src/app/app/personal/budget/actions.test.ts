import { beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetError } from "@/domain/budgeting/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  updateBudgetPlan: vi.fn(),
  voidBudgetTransaction: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/budgeting/profiles", () => ({ createBudgetSetup: vi.fn() }));
vi.mock("@/server/budgeting/categories", () => ({ createBudgetCategory: vi.fn(), updateBudgetPlan: mocks.updateBudgetPlan }));
vi.mock("@/server/budgeting/transactions", () => ({ createManualBudgetTransaction: vi.fn(), voidBudgetTransaction: mocks.voidBudgetTransaction }));

import { updateBudgetPlanAction, voidBudgetTransactionAction } from "./actions";

function planForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    periodName: "September",
    startsOn: "2026-09-01",
    endsOn: "2026-09-30",
    periodUpdatedAt: "2026-09-09T00:00:00.000Z",
    totalBudget: "100.000",
    categoryId: "00000000-0000-4000-8000-000000000001",
    categoryName: "Uncategorized",
    categoryAllocation: "0",
    categorySystemKey0: "uncategorized",
    ...overrides,
  })) form.append(name, value);
  form.append("categoryId", "00000000-0000-4000-8000-000000000002");
  form.append("categoryName", overrides.categoryName1 ?? "Food");
  form.append("categoryAllocation", "50.000");
  form.append("categorySystemKey1", "");
  return form;
}

describe("budget actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.voidBudgetTransaction.mockResolvedValue({ status: "voided" });
    mocks.updateBudgetPlan.mockResolvedValue({});
  });

  it("accepts an unchanged plan containing the real Uncategorized row", async () => {
    await expect(updateBudgetPlanAction({ fieldErrors: {}, formError: "", values: {} as never }, planForm())).rejects.toThrow("redirect:/app/personal/budget");
    expect(mocks.updateBudgetPlan).toHaveBeenCalledWith("database", "owner-a", expect.objectContaining({
      categories: [
        { id: "00000000-0000-4000-8000-000000000001", name: "Uncategorized", allocatedAmount: 0 },
        { id: "00000000-0000-4000-8000-000000000002", name: "Food", allocatedAmount: 50_000 },
      ],
    }));
  });

  it("rejects a custom category renamed to Uncategorized before the mutation", async () => {
    const result = await updateBudgetPlanAction({ fieldErrors: {}, formError: "", values: {} as never }, planForm({ categoryName1: "  UNCATEGORIZED  " }));
    expect(result.fieldErrors.categories).toContain("Uncategorized");
    expect(mocks.updateBudgetPlan).not.toHaveBeenCalled();
  });

  it("does not swallow unexpected void failures", async () => {
    const failure = new Error("database unavailable");
    mocks.voidBudgetTransaction.mockRejectedValue(failure);
    await expect(voidBudgetTransactionAction("transaction-a")).rejects.toBe(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps unavailable voids safe and non-distinguishing", async () => {
    mocks.voidBudgetTransaction.mockRejectedValue(new BudgetError("NOT_FOUND", "unavailable"));
    await expect(voidBudgetTransactionAction("foreign-or-missing")).rejects.toThrow("redirect:/app/personal/budget/transactions");
  });
});
