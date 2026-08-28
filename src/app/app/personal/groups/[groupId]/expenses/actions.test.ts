import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestGroupAccountingError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return { requireSession: vi.fn(), getDatabase: vi.fn(), createGroupExpense: vi.fn(), confirmGroupExpenseAsPayer: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }), GroupAccountingError: TestGroupAccountingError };
});

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/group-accounting", () => ({ createGroupExpense: mocks.createGroupExpense, confirmGroupExpenseAsPayer: mocks.confirmGroupExpenseAsPayer, GroupAccountingError: mocks.GroupAccountingError }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { confirmGroupExpenseAction, createGroupExpenseAction, emptyGroupExpenseActionState } from "./actions";

const payerId = "11111111-1111-4111-8111-111111111111";

function form(values: { payer: string; total?: string; shares?: Array<[string, string]> }) {
  const data = new FormData();
  data.set("description", "Dinner");
  data.set("totalAmount", values.total ?? "100000");
  data.set("occurredAtLocal", "2026-08-27T12:00");
  data.set("timezoneOffsetMinutes", "0");
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
  });

  it("uses the authenticated creator and redirects a self-payer expense", async () => {
    await expect(createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: payerId }))).rejects.toThrow("redirect:/app/personal/groups/group-a/expenses/expense-a?created=1");
    expect(mocks.createGroupExpense).toHaveBeenCalledWith("database", "group-a", "user-a", expect.objectContaining({ payerParticipantId: payerId, totalAmount: 100000 }));
    expect(mocks.createGroupExpense.mock.calls[0]?.[2]).toBe("user-a");
  });

  it("requires exact allocation before touching accounting", async () => {
    const result = await createGroupExpenseAction("group-a", emptyGroupExpenseActionState, form({ payer: payerId, shares: [[payerId, "99999"]] }));
    expect(result).toMatchObject({ fieldErrors: { shares: "Shares must equal the expense total." } });
    expect(mocks.createGroupExpense).not.toHaveBeenCalled();
  });

  it("keeps payer confirmation authoritative and maps non-payer denial", async () => {
    const confirmed = await confirmGroupExpenseAction("group-a", "expense-a", { error: "" }, new FormData());
    expect(confirmed.success).toContain("authoritative");
    expect(mocks.confirmGroupExpenseAsPayer).toHaveBeenCalledWith("database", "group-a", "expense-a", "user-a");

    mocks.confirmGroupExpenseAsPayer.mockRejectedValue(new mocks.GroupAccountingError("forbidden"));
    await expect(confirmGroupExpenseAction("group-a", "expense-a", { error: "" }, new FormData())).resolves.toEqual({ error: "Only the claimed payer can confirm this expense." });
  });
});
