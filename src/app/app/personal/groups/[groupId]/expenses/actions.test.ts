import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestGroupAccountingError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return { requireSession: vi.fn(), getDatabase: vi.fn(), createGroupExpense: vi.fn(), confirmGroupExpenseAsPayer: vi.fn(), rejectGroupExpenseAsPayer: vi.fn(), voidGroupExpenseAsPayer: vi.fn(), changeGroupExpenseBudgetCategory: vi.fn(), listBudgetCategoryOptions: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }), GroupAccountingError: TestGroupAccountingError };
});

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-accounting", () => ({ createGroupExpense: mocks.createGroupExpense, confirmGroupExpenseAsPayer: mocks.confirmGroupExpenseAsPayer, rejectGroupExpenseAsPayer: mocks.rejectGroupExpenseAsPayer, voidGroupExpenseAsPayer: mocks.voidGroupExpenseAsPayer, GroupAccountingError: mocks.GroupAccountingError }));
vi.mock("@/server/budgeting/sources-group", () => ({ changeGroupExpenseBudgetCategory: mocks.changeGroupExpenseBudgetCategory }));
vi.mock("@/server/budgeting/categories", () => ({ listBudgetCategoryOptions: mocks.listBudgetCategoryOptions }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { changeGroupExpenseBudgetCategoryAction, confirmGroupExpenseAction, createGroupExpenseAction, rejectGroupExpenseAction, voidGroupExpenseAction, type GroupExpenseActionState } from "./actions";

const payerId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const expenseId = "33333333-3333-4333-8333-333333333333";
const budgetCategoryId = "44444444-4444-4444-8444-444444444444";
const emptyGroupExpenseActionState: GroupExpenseActionState = { fieldErrors: {}, formError: "", values: { description: "", totalAmount: "", occurredAtLocal: "", timezoneOffsetMinutes: "", payerParticipantId: "", shares: [] } };

function form(values: { payer: string; total?: string; shares?: Array<[string, string]>; occurredAtLocal?: string; timezoneOffsetMinutes?: string }) {
  const data = new FormData();
  data.set("description", "Dinner");
  data.set("totalAmount", values.total ?? "100000");
  data.set("occurredAtLocal", values.occurredAtLocal ?? "2026-08-27T12:00");
  data.set("timezoneOffsetMinutes", values.timezoneOffsetMinutes ?? "0");
  data.set("payerParticipantId", values.payer);
  for (const [participantId, amount] of values.shares ?? [[values.payer, "100000"]]) {
    data.append("participantId", participantId);
    data.append("shareAmount", amount);
  }
  return data;
}

describe("Group expense actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "user-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createGroupExpense.mockResolvedValue({ id: "expense-a", state: "confirmed" });
    mocks.confirmGroupExpenseAsPayer.mockResolvedValue({});
    mocks.rejectGroupExpenseAsPayer.mockResolvedValue({});
    mocks.voidGroupExpenseAsPayer.mockResolvedValue({});
    mocks.changeGroupExpenseBudgetCategory.mockResolvedValue(undefined);
    mocks.listBudgetCategoryOptions.mockResolvedValue([{ id: budgetCategoryId, name: "Food" }]);
  });

  it("uses the authenticated creator and redirects a self-payer expense", async () => {
    await expect(createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: payerId }))).rejects.toThrow("redirect:/app/personal/groups/group-a/expenses/expense-a?created=1");
    expect(mocks.createGroupExpense).toHaveBeenCalledWith("database", "group-a", "user-a", expect.objectContaining({ payerParticipantId: payerId, totalAmount: 100000, occurredOn: "2026-08-27" }), undefined);
    expect(mocks.createGroupExpense.mock.calls[0]?.[2]).toBe("user-a");
  });

  it("requires exact allocation before touching accounting", async () => {
    const result = await createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: payerId, shares: [[payerId, "99999"]] }));
    expect(result).toMatchObject({ fieldErrors: { shares: "Shares must equal the expense total." } });
    expect(mocks.createGroupExpense).not.toHaveBeenCalled();
  });

  it("takes the financial date from the submitted local date, not the converted instant", async () => {
    await expect(createGroupExpenseAction(
      "group-a",
      emptyGroupExpenseActionState,
      form({ payer: payerId, occurredAtLocal: "2026-09-10T00:30", timezoneOffsetMinutes: "-420" }),
    )).rejects.toThrow("redirect:");
    expect(mocks.createGroupExpense).toHaveBeenCalledWith(
      "database",
      "group-a",
      "user-a",
      expect.objectContaining({
        occurredOn: "2026-09-10",
        occurredAt: new Date("2026-09-09T17:30:00.000Z"),
      }),
      undefined,
    );
  });

  it("passes the private Budget participation of the current-user payer", async () => {
    const included = form({ payer: payerId });
    included.set("budgetParticipation", "1");
    included.set("includeInBudget", "1");
    included.set("budgetCategoryId", budgetCategoryId);
    await expect(createGroupExpenseAction("group-a", emptyGroupExpenseActionState, included)).rejects.toThrow("redirect:");
    expect(mocks.createGroupExpense).toHaveBeenCalledWith("database", "group-a", "user-a", expect.anything(), { includeInBudget: true, categoryId: budgetCategoryId });

    mocks.createGroupExpense.mockClear();
    const excluded = form({ payer: payerId });
    excluded.set("budgetParticipation", "1");
    await expect(createGroupExpenseAction("group-a", emptyGroupExpenseActionState, excluded)).rejects.toThrow("redirect:");
    expect(mocks.createGroupExpense).toHaveBeenCalledWith("database", "group-a", "user-a", expect.anything(), { includeInBudget: false });
  });

  it("never submits another payer's private Budget decision", async () => {
    await expect(createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: "55555555-5555-4555-8555-555555555555" }))).rejects.toThrow("redirect:");
    expect(mocks.createGroupExpense).toHaveBeenCalledWith("database", "group-a", "user-a", expect.anything(), undefined);
    expect(mocks.listBudgetCategoryOptions).not.toHaveBeenCalled();
  });

  it("rejects a Budget category the owner cannot use", async () => {
    const submitted = form({ payer: payerId });
    submitted.set("budgetParticipation", "1");
    submitted.set("includeInBudget", "1");
    submitted.set("budgetCategoryId", "66666666-6666-4666-8666-666666666666");
    const state = await createGroupExpenseAction("group-a", emptyGroupExpenseActionState, submitted);
    expect(state).toMatchObject({ fieldErrors: { budgetCategoryId: "Choose a valid Budget category." }, formError: "Please correct the marked fields." });
    expect(mocks.createGroupExpense).not.toHaveBeenCalled();
  });

  it("routes a payer category change through the canonical Budget action", async () => {
    const data = new FormData();
    data.set("transactionId", "77777777-7777-4777-8777-777777777777");
    data.set("categoryId", budgetCategoryId);
    await expect(changeGroupExpenseBudgetCategoryAction(groupId, expenseId, data)).rejects.toThrow(`redirect:/app/personal/groups/${groupId}/expenses/${expenseId}?budgetSaved=1#budget`);
    expect(mocks.changeGroupExpenseBudgetCategory).toHaveBeenCalledWith("database", "user-a", "77777777-7777-4777-8777-777777777777", budgetCategoryId);
  });

  it("maps invalid total and share amounts to their own fields", async () => {
    const invalidTotal = await createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: payerId, total: "0" }));
    expect(invalidTotal.fieldErrors).toHaveProperty("totalAmount", "Use a positive whole-rupiah amount.");

    const invalidShare = await createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: payerId, shares: [[payerId, "0"]] }));
    expect(invalidShare.fieldErrors).toHaveProperty("shares", "Use a positive whole-rupiah amount.");
    expect(mocks.createGroupExpense).not.toHaveBeenCalled();
  });

  it("keeps payer confirmation authoritative and maps non-payer denial", async () => {
    const confirmed = await confirmGroupExpenseAction(groupId, expenseId, { error: "" }, new FormData());
    expect(confirmed.success).toContain("authoritative");
    expect(mocks.confirmGroupExpenseAsPayer).toHaveBeenCalledWith("database", groupId, expenseId, "user-a");

    mocks.confirmGroupExpenseAsPayer.mockRejectedValue(new mocks.GroupAccountingError("forbidden"));
    await expect(confirmGroupExpenseAction(groupId, expenseId, { error: "" }, new FormData())).resolves.toEqual({ error: "Only the claimed payer can confirm this expense." });
  });

  it("routes reject and void through authoritative lifecycle operations", async () => {
    await expect(rejectGroupExpenseAction(groupId, expenseId, { error: "" }, new FormData())).resolves.toMatchObject({ success: expect.stringContaining("Claim rejected.") });
    expect(mocks.rejectGroupExpenseAsPayer).toHaveBeenCalledWith("database", groupId, expenseId, "user-a");

    await expect(voidGroupExpenseAction(groupId, expenseId, { error: "" }, new FormData())).resolves.toMatchObject({ success: expect.stringContaining("Expense voided.") });
    expect(mocks.voidGroupExpenseAsPayer).toHaveBeenCalledWith("database", groupId, expenseId, "user-a");
  });

  it("rejects invalid lifecycle identities without calling accounting", async () => {
    await expect(confirmGroupExpenseAction("bad-group", expenseId, { error: "" }, new FormData())).resolves.toEqual({ error: "This expense is no longer available." });
    expect(mocks.confirmGroupExpenseAsPayer).not.toHaveBeenCalled();
  });

  it("maps a stale lifecycle transition to a safe error", async () => {
    mocks.confirmGroupExpenseAsPayer.mockRejectedValue(new mocks.GroupAccountingError("invalid_state"));
    await expect(confirmGroupExpenseAction(groupId, expenseId, { error: "" }, new FormData())).resolves.toEqual({ error: "This expense is no longer pending." });
  });
});
