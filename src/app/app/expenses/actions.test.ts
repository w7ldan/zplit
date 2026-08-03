import { describe, expect, it, vi } from "vitest";
import { createExpenseAction, updateExpenseAction, type ExpenseActionState } from "./actions";
import { LedgerNotFoundError } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

const initialState: ExpenseActionState = {
  fieldErrors: {},
  formError: "",
  values: { description: "", amountRupiah: "", occurredAtLocal: "", timezoneOffsetMinutes: "", outingId: "" },
};

const values = {
  description: "  Dinner  ",
  amountRupiah: "84.000",
  occurredAtLocal: "2026-01-02T10:30",
  timezoneOffsetMinutes: "-480",
  outingId: "",
};

describe("expense actions", () => {
  it("returns validation errors without touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createExpenseAction(initialState, form({ ...values, description: "", amountRupiah: "84.00" }));

    expect(state).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { description: "Description is required." } });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("binds create and update to the authenticated owner and never trusts owner fields", async () => {
    const createExpense = vi.fn().mockResolvedValue({ id: "expense-a" });
    const updateExpense = vi.fn().mockResolvedValue({ id: "expense-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createExpense, updateExpense });

    await expect(createExpenseAction(initialState, form({ ...values, ownerUserId: "owner-b" }))).rejects.toThrow("redirect:/app/expenses");
    await expect(updateExpenseAction("expense-a", initialState, form(values))).rejects.toThrow("redirect:/app/expenses/expense-a");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createExpense).toHaveBeenCalledWith({ description: "Dinner", amount: 84000, occurredAt: new Date("2026-01-02T02:30:00.000Z"), outingId: null });
    expect(updateExpense).toHaveBeenCalledWith("expense-a", { description: "Dinner", amount: 84000, occurredAt: new Date("2026-01-02T02:30:00.000Z"), outingId: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/expenses/expense-a");
  });

  it("maps cross-owner failures to a generic form error", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ updateExpense: vi.fn().mockRejectedValue(new LedgerNotFoundError()) });

    const state = await updateExpenseAction("expense-b", initialState, form(values));
    expect(state.formError).toBe("This outing or expense is no longer available.");
    expect(state.formError).not.toContain("expense-b");
  });
});
