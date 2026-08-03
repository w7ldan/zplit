import { describe, expect, it, vi } from "vitest";
import { createRepaymentAction, updateRepaymentAction, type RepaymentActionState } from "./actions";
import { LedgerNotFoundError, RepaymentAmountInvariantError, RepaymentFriendInvariantError } from "@/domain/ledger-repository";

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

const friendId = "11111111-1111-4111-8111-111111111111";
const initialState: RepaymentActionState = {
  fieldErrors: {},
  formError: "",
  values: { friendId: "", amountRupiah: "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" },
};

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

const values = {
  friendId,
  amountRupiah: "84.000",
  paidAtLocal: "2026-01-02T10:30",
  timezoneOffsetMinutes: "-480",
  paymentMethod: "  Bank transfer  ",
  notes: "  Received  ",
};

describe("repayment actions", () => {
  it("returns validation errors without touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createRepaymentAction(initialState, form({ friendId: "", amountRupiah: "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" }));

    expect(state).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { friendId: "Friend is required.", amountRupiah: "Amount is required." } });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("binds create and update to the authenticated owner and canonical routes", async () => {
    const createRepayment = vi.fn().mockResolvedValue({ id: "repayment-a" });
    const updateRepayment = vi.fn().mockResolvedValue({ id: "repayment-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepayment, updateRepayment });

    await expect(createRepaymentAction(initialState, form({ ...values, ownerUserId: "owner-b" }))).rejects.toThrow("redirect:/app/repayments");
    await expect(updateRepaymentAction("repayment-a", initialState, form(values))).rejects.toThrow("redirect:/app/repayments/repayment-a");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createRepayment).toHaveBeenCalledWith({ friendId, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", notes: "Received" });
    expect(updateRepayment).toHaveBeenCalledWith("repayment-a", { friendId, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", notes: "Received" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments/repayment-a");
  });

  it("maps unavailable and invariant failures to stable form messages", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const updateRepayment = vi.fn().mockRejectedValue(new LedgerNotFoundError());
    mocks.createLedgerRepository.mockReturnValue({ updateRepayment });

    expect((await updateRepaymentAction("foreign", initialState, form(values))).formError).toBe("This friend or repayment is no longer available.");
    updateRepayment.mockRejectedValue(new RepaymentAmountInvariantError());
    expect((await updateRepaymentAction("repayment-a", initialState, form(values))).formError).toBe("Repayment amount cannot be lower than its allocated amount.");
    updateRepayment.mockRejectedValue(new RepaymentFriendInvariantError());
    expect((await updateRepaymentAction("repayment-a", initialState, form(values))).formError).toBe("The friend cannot be changed after this repayment has allocations.");
  });
});
