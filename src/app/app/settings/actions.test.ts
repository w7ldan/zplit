import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRepaymentDestinationAction,
  deleteRepaymentDestinationAction,
  reorderRepaymentDestinationsAction,
  setRepaymentDestinationOrderAction,
  updateBudgetDefaultAction,
  updateRepaymentDestinationAction,
} from "./actions";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getAuthenticatedLedger: vi.fn(),
  getDatabase: vi.fn(),
  setBudgetIncludeNewExpensesByDefault: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: mocks.getAuthenticatedLedger }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/budgeting/profiles", () => ({ setBudgetIncludeNewExpensesByDefault: mocks.setBudgetIncludeNewExpensesByDefault }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

function destinationForm() {
  const form = new FormData();
  form.set("type", "e_wallet");
  form.set("name", "  GoPay  ");
  form.set("identifier", " 0812 ");
  form.set("accountName", " Ada ");
  form.set("note", " Use this ");
  form.set("shareOnBalanceLinks", "on");
  return form;
}

const initialState = { fieldErrors: {}, formError: "", values: { type: "bank_account" as const, name: "", identifier: "", accountName: "", note: "", shareOnBalanceLinks: false } };

describe("repayment destination actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
  });

  it("validates before repository writes", async () => {
    const ledger = { createRepaymentDestination: vi.fn() };
    mocks.getAuthenticatedLedger.mockResolvedValue({ ledger });
    const form = new FormData();
    form.set("type", "invalid");
    const state = await createRepaymentDestinationAction(initialState, form);
    expect(state.formError).toBe("Please correct the marked fields.");
    expect(state.fieldErrors.type).toBeTruthy();
    expect(ledger.createRepaymentDestination).not.toHaveBeenCalled();
  });

  it("creates, updates, deletes, and reorders through the authenticated ledger", async () => {
    const ledger = {
      createRepaymentDestination: vi.fn().mockResolvedValue({ id: "destination-a" }),
      updateRepaymentDestination: vi.fn().mockResolvedValue({ id: "destination-a" }),
      deleteRepaymentDestination: vi.fn().mockResolvedValue({ id: "destination-a" }),
      reorderRepaymentDestinations: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getAuthenticatedLedger.mockResolvedValue({ ledger });

    await expect(createRepaymentDestinationAction(initialState, destinationForm())).rejects.toThrow("redirect:/app/settings?saved=1#repays-to");
    expect(ledger.createRepaymentDestination).toHaveBeenCalledWith({ type: "e_wallet", name: "GoPay", identifier: "0812", accountName: "Ada", note: "Use this", shareOnBalanceLinks: true });

    await expect(updateRepaymentDestinationAction("destination-a", initialState, destinationForm())).rejects.toThrow("redirect:/app/settings?saved=1#repays-to");
    expect(ledger.updateRepaymentDestination).toHaveBeenCalledWith("destination-a", expect.objectContaining({ name: "GoPay" }));

    await expect(deleteRepaymentDestinationAction("destination-a", new FormData())).rejects.toThrow("redirect:/app/settings?saved=1#repays-to");
    expect(ledger.deleteRepaymentDestination).toHaveBeenCalledWith("destination-a");

    const order = new FormData();
    order.append("destinationId", "destination-a");
    order.append("destinationId", "destination-b");
    order.set("movingId", "destination-b");
    order.set("direction", "up");
    await expect(reorderRepaymentDestinationsAction(order)).rejects.toThrow("redirect:/app/settings?saved=1#repays-to");
    expect(ledger.reorderRepaymentDestinations).toHaveBeenCalledWith(["destination-b", "destination-a"]);

    await expect(setRepaymentDestinationOrderAction(["destination-a", "destination-b"])).resolves.toEqual({ ok: true });
    expect(ledger.reorderRepaymentDestinations).toHaveBeenLastCalledWith(["destination-a", "destination-b"]);
  });

  it("returns a recoverable error when explicit order persistence fails", async () => {
    const ledger = { reorderRepaymentDestinations: vi.fn().mockRejectedValue(new Error("database unavailable")) };
    mocks.getAuthenticatedLedger.mockResolvedValue({ ledger });
    await expect(setRepaymentDestinationOrderAction(["destination-a", "destination-b"])).resolves.toEqual({ ok: false, message: "Unable to save repayment destination order." });
  });

  it("persists the private Budget default and refreshes the eligible create surface", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.setBudgetIncludeNewExpensesByDefault.mockResolvedValue({});

    const enabled = new FormData();
    enabled.set("includeNewExpensesByDefault", "1");
    await expect(updateBudgetDefaultAction(enabled)).rejects.toThrow("redirect:/app/settings?saved=1#budget");
    expect(mocks.setBudgetIncludeNewExpensesByDefault).toHaveBeenCalledWith("database", "owner-a", true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/expenses");

    await expect(updateBudgetDefaultAction(new FormData())).rejects.toThrow("redirect:/app/settings?saved=1#budget");
    expect(mocks.setBudgetIncludeNewExpensesByDefault).toHaveBeenLastCalledWith("database", "owner-a", false);
  });

  it("keeps an unconfigured Budget recoverable instead of failing the settings page", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.setBudgetIncludeNewExpensesByDefault.mockRejectedValue(new Error("budgeting is not configured"));

    await expect(updateBudgetDefaultAction(new FormData())).rejects.toThrow("redirect:/app/settings?error=1#budget");
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith("/app/expenses");
  });
});
