import { beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetError } from "@/domain/budgeting/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(() => "database"),
  updateBudgetPlan: vi.fn(),
  voidBudgetTransaction: vi.fn(),
  archiveActiveBudgetPeriod: vi.fn(),
  startBudgetPeriodFromPaused: vi.fn(),
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
vi.mock("@/server/budgeting/periods", () => ({
  archiveActiveBudgetPeriod: mocks.archiveActiveBudgetPeriod,
  startBudgetPeriodFromPaused: mocks.startBudgetPeriodFromPaused,
  startNextBudgetPeriod: vi.fn(),
}));

import { archiveActiveBudgetPeriodAction, startBudgetPeriodFromPausedAction, updateBudgetPlanAction, voidBudgetTransactionAction } from "./actions";

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
    mocks.archiveActiveBudgetPeriod.mockResolvedValue({});
    mocks.startBudgetPeriodFromPaused.mockResolvedValue({});
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

  it("returns a useful early-archive conflict instead of an unmarked-field message", async () => {
    mocks.archiveActiveBudgetPeriod.mockRejectedValue(new BudgetError("CONFLICT", "Cannot close through 2026-09-23 because posted budget activity on 2026-09-27 is already applied."));
    const form = new FormData();
    form.set("expectedActivePeriodId", "period-a");
    form.set("closeThrough", "2026-09-23");

    const result = await archiveActiveBudgetPeriodAction({ fieldErrors: {}, formError: "", values: { expectedActivePeriodId: "", closeThrough: "" } }, form);

    expect(result.formError).toContain("posted budget activity on 2026-09-27");
    expect(result.formError).not.toBe("Please correct the marked fields.");
    expect(mocks.archiveActiveBudgetPeriod).toHaveBeenCalledWith("database", "owner-a", "period-a", "2026-09-23");
  });

  it("passes paused-reset confirmation to the authoritative transition", async () => {
    const form = new FormData();
    form.set("expectedLatestPeriodId", "period-a");
    form.set("periodName", "Fresh period");
    form.set("startsOn", "2026-09-24");
    form.set("endsOn", "2026-09-30");
    form.set("totalBudget", "100.000");
    form.append("categoryId", "00000000-0000-4000-8000-000000000001");
    form.append("categoryName", "Food");
    form.append("categoryAllocation", "50.000");
    form.set("confirmPreviousPeriodShortening", "on");

    await expect(startBudgetPeriodFromPausedAction({ fieldErrors: {}, formError: "", values: {} as never }, form)).rejects.toThrow("redirect:/app/personal/budget");

    expect(mocks.startBudgetPeriodFromPaused).toHaveBeenCalledWith("database", "owner-a", expect.objectContaining({
      expectedLatestPeriodId: "period-a",
      startsOn: "2026-09-24",
      confirmPreviousPeriodShortening: true,
    }));
  });
});
