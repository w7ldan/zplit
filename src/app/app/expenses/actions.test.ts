import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExpenseAction, deleteExpenseAction, replaceExpenseSharesAction, searchExpenseFriendOptions, updateExpenseAction, type ExpenseActionState, type ExpenseShareActionState } from "./actions";
import { deletionImpactRevision, ExpenseShareInvariantError, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

const revision = "a".repeat(64);

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
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

function shareForm(rows: Array<{ friendId: string; amountRupiah: string }>, charges: unknown[] = []) {
  const formData = new FormData();
  for (const row of rows) {
    formData.append("friendId", row.friendId);
    formData.append("amountRupiah", row.amountRupiah);
  }
  formData.set("charges", JSON.stringify(charges));
  return formData;
}

const initialState: ExpenseActionState = {
  fieldErrors: {},
  formError: "",
  values: { description: "", amountRupiah: "", outingId: "" },
};

const initialShareState: ExpenseShareActionState = { fieldErrors: {}, formError: "", values: [] };

const values = {
  description: "  Dinner  ",
  amountRupiah: "84.000",
  outingId: "11111111-1111-4111-8111-111111111111",
};

describe("expense actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only bounded active friend options for the session owner", async () => {
    const searchFriends = vi.fn().mockResolvedValue([
      { id: "11111111-1111-4111-8111-111111111111", name: "Active", archived: false },
      { id: "22222222-2222-4222-8222-222222222222", name: "Archived", archived: true },
      ...Array.from({ length: 21 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, name: `Friend ${index}`, archived: false })),
    ]);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ searchFriends });

    const options = await searchExpenseFriendOptions("active", "22222222-2222-4222-8222-222222222222");
    expect(options).toHaveLength(20);
    expect(options.every((option) => option.id !== "22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(searchFriends).toHaveBeenCalledWith({ q: "active", selectedId: "22222222-2222-4222-8222-222222222222", activeOnly: true });
    mocks.createLedgerRepository.mockClear();
  });

  it("returns validation errors without touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createExpenseAction(initialState, form({ ...values, description: "", outingId: "", intent: "continue" }));

    expect(state).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { description: "Description is required.", outingId: "Outing is required." }, intent: "continue", values: { description: "", amountRupiah: values.amountRupiah, outingId: "" } });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("uses normal add behavior when intent is missing", async () => {
    const createExpense = vi.fn().mockResolvedValue({ id: "expense-a", amount: 84000 });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createExpense });

    await expect(createExpenseAction(initialState, form(values))).rejects.toThrow("redirect:/app/expenses/expense-a?created=1#friend-shares");
    expect(createExpense).toHaveBeenCalledOnce();
  });

  it("saves one expense and returns a continuation result without redirecting", async () => {
    const createExpense = vi.fn().mockResolvedValue({ id: "expense-a", amount: 84000 });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createExpense });

    const result = await createExpenseAction(initialState, form({ ...values, intent: "continue" }));

    expect(createExpense).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      values: { description: "", amountRupiah: "", outingId: values.outingId },
      success: { expenseId: "expense-a", amount: 84000 },
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/expenses");
  });

  it("rejects malformed and repeated intents without creating an expense", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const repository = { createExpense: vi.fn() };
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue(repository);

    const malformed = await createExpenseAction(initialState, form({ ...values, intent: "delete" }));
    const repeated = form({ ...values, intent: "continue" });
    repeated.append("intent", "continue");
    const repeatedResult = await createExpenseAction(initialState, repeated);

    expect(malformed).toMatchObject({ formError: "Invalid expense submission.", values: { description: "Dinner", amountRupiah: values.amountRupiah, outingId: values.outingId } });
    expect(repeatedResult).toMatchObject({ formError: "Invalid expense submission.", values: { description: "Dinner", amountRupiah: values.amountRupiah, outingId: values.outingId } });
    expect(repository.createExpense).not.toHaveBeenCalled();
  });

  it("binds mutations to the authenticated owner and passes only expense fields", async () => {
    const createExpense = vi.fn().mockResolvedValue({ id: "expense-a" });
    const updateExpense = vi.fn().mockResolvedValue({ id: "expense-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createExpense, updateExpense });

    await expect(createExpenseAction(initialState, form({ ...values, ownerUserId: "owner-b" }))).rejects.toThrow("redirect:/app/expenses/expense-a?created=1#friend-shares");
    await expect(updateExpenseAction("expense-a", initialState, form(values))).rejects.toThrow("redirect:/app/expenses/expense-a?updated=1#expense-details");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createExpense).toHaveBeenCalledWith({ description: "Dinner", amount: 84000, outingId: values.outingId });
    expect(updateExpense).toHaveBeenCalledWith("expense-a", { description: "Dinner", amount: 84000, outingId: values.outingId });
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

  it("binds split replacement to the session owner and canonical detail route", async () => {
    const replaceExpenseShares = vi.fn().mockResolvedValue([]);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ replaceExpenseShares });

    await expect(replaceExpenseSharesAction("expense-a", initialShareState, shareForm([
      { friendId: "11111111-1111-4111-8111-111111111111", amountRupiah: "84.000" },
      { friendId: "22222222-2222-4222-8222-222222222222", amountRupiah: "" },
    ]))).rejects.toThrow("redirect:/app/expenses/expense-a?splitSaved=1#friend-shares");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(replaceExpenseShares).toHaveBeenCalledWith("expense-a", [{ friendId: "11111111-1111-4111-8111-111111111111", amountOwed: 84000 }], []);
  });

  it("returns stable invariant and unavailable split messages", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const replaceExpenseShares = vi.fn().mockRejectedValue(new ExpenseShareInvariantError());
    mocks.createLedgerRepository.mockReturnValue({ replaceExpenseShares });
    expect((await replaceExpenseSharesAction("expense-a", initialShareState, shareForm([
      { friendId: "11111111-1111-4111-8111-111111111111", amountRupiah: "84000" },
    ]))).formError).toBe("Assigned shares cannot exceed the expense amount.");

    replaceExpenseShares.mockRejectedValue(new LedgerNotFoundError());
    const state = await replaceExpenseSharesAction("foreign-expense", initialShareState, shareForm([]));
    expect(state.formError).toBe("This expense or friend is no longer available.");
    expect(state.formError).not.toContain("foreign-expense");
  });

  it("validates and passes persistent charge definitions with exact basis points", async () => {
    const replaceExpenseShares = vi.fn().mockResolvedValue([]);
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ replaceExpenseShares });

    await expect(replaceExpenseSharesAction("expense-a", initialShareState, shareForm([
      { friendId: "11111111-1111-4111-8111-111111111111", amountRupiah: "84000" },
    ], [{ name: "Service charge", percentage: "7.5", scope: "all", friendIds: [] }]))).rejects.toThrow("redirect:/app/expenses/expense-a?splitSaved=1#friend-shares");
    expect(replaceExpenseShares).toHaveBeenCalledWith("expense-a", [{ friendId: "11111111-1111-4111-8111-111111111111", amountOwed: 84000 }], [{ name: "Service charge", percentageBasisPoints: 750, scope: "all", friendIds: [] }]);
  });

  it("rejects invalid selected charge targets before persistence", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const replaceExpenseShares = vi.fn();
    mocks.createLedgerRepository.mockReturnValue({ replaceExpenseShares });
    const state = await replaceExpenseSharesAction("expense-a", initialShareState, shareForm([
      { friendId: "11111111-1111-4111-8111-111111111111", amountRupiah: "84000" },
    ], [{ name: "PB1", percentage: "10", scope: "selected", friendIds: ["22222222-2222-4222-8222-222222222222"] }]));
    expect(state).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { "charge-0": "Choose valid selected friends." } });
    expect(replaceExpenseShares).not.toHaveBeenCalled();
  });

  it("maps a reduced expense below assigned shares to the edit message", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ updateExpense: vi.fn().mockRejectedValue(new ExpenseShareInvariantError()) });
    const state = await updateExpenseAction("expense-a", initialState, form(values));
    expect(state.formError).toBe("Expense amount cannot be lower than its assigned shares.");
  });

  it("requires exact deletion confirmation, revalidates affected friends, and redirects canonically", async () => {
    const deleteExpense = vi.fn().mockResolvedValue({ friendIds: ["friend-a"], repaymentIds: ["repayment-a"] });
    const getExpenseDeletionImpact = vi.fn().mockResolvedValue({ recordType: "expense", receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ deleteExpense, getExpenseDeletionImpact });
    expect((await deleteExpenseAction("expense-a", { formError: "" }, form({ confirm: "DELETE" }))).formError).toBe("Type delete to confirm.");
    expect((await deleteExpenseAction("expense-a", { formError: "" }, form({ confirm: "delete", impactRevision: "bad" }))).formError).toBe("Impact revision is invalid.");
    const duplicateRevision = form({ confirm: "delete", impactRevision: revision });
    duplicateRevision.append("impactRevision", revision);
    expect((await deleteExpenseAction("expense-a", { formError: "" }, duplicateRevision)).formError).toBe("Impact revision is invalid.");
    await expect(deleteExpenseAction("expense-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }))).rejects.toThrow("redirect:/app/expenses?deleted=1");
    expect(deleteExpense).toHaveBeenCalledWith("expense-a", { cascadeDependents: false, expectedImpactRevision: revision });
    expect(getExpenseDeletionImpact).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/friends/friend-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments/repayment-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/share/[token]", "page");
  });

  it("requires current expense cascade confirmation", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const impact = { recordType: "expense" as const, receiptCount: 1, shareCount: 1, allocationCount: 1, affectedRepaymentCount: 1, affectedRepaymentIds: ["repayment-a"], affectedFriendIds: ["friend-a"] };
    const getExpenseDeletionImpact = vi.fn().mockResolvedValue(impact);
    const deleteExpense = vi.fn().mockRejectedValue(new LedgerDeletionConfirmationRequiredError(impact));
    mocks.createLedgerRepository.mockReturnValue({ deleteExpense, getExpenseDeletionImpact });
    const blocked = await deleteExpenseAction("expense-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }));
    expect(blocked).toMatchObject({ formError: "Review the dependent records and confirm their deletion.", impact, impactRevision: deletionImpactRevision(impact) });
    expect(getExpenseDeletionImpact).not.toHaveBeenCalled();
    deleteExpense.mockRejectedValue(new LedgerDeletionConfirmationRequiredError(impact, "impact_changed"));
    expect(await deleteExpenseAction("expense-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }))).toMatchObject({ formError: "The dependent records changed. Review the updated deletion impact and confirm again.", impact, impactRevision: deletionImpactRevision(impact) });
    deleteExpense.mockResolvedValue({ friendIds: ["friend-a"], repaymentIds: ["repayment-a"] });
    const confirmed = form({ confirm: "delete", impactRevision: revision });
    confirmed.set("confirmCascade", "delete-dependents");
    await expect(deleteExpenseAction("expense-a", { formError: "" }, confirmed)).rejects.toThrow("redirect:/app/expenses?deleted=1");
    expect(deleteExpense).toHaveBeenCalledWith("expense-a", { cascadeDependents: true, expectedImpactRevision: revision });
  });

  it.each([
    ["full", 70_000, 0, "redirect:/app/expenses?deleted=1&reallocated=70000&unallocated=0"],
    ["partial", 70_000, 30_000, "redirect:/app/expenses?deleted=1&reallocated=70000&unallocated=30000"],
    ["unallocated", 0, 100_000, "redirect:/app/expenses?deleted=1&reallocated=0&unallocated=100000"],
  ] as const)("passes %s reconciliation totals to the delete feedback", async (_name, reallocatedAmount, unallocatedAmount, redirectPath) => {
    const deleteExpense = vi.fn().mockResolvedValue({ friendIds: ["friend-a"], repaymentIds: ["repayment-a"], reallocatedAmount, unallocatedAmount, affectedRepaymentCount: 1 });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ deleteExpense });
    await expect(deleteExpenseAction("expense-a", { formError: "" }, form({ confirm: "delete", confirmCascade: "delete-dependents", impactRevision: revision }))).rejects.toThrow(redirectPath);
    expect(deleteExpense).toHaveBeenCalledWith("expense-a", { cascadeDependents: true, expectedImpactRevision: revision });
  });
});
