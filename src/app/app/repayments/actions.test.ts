import { describe, expect, it, vi } from "vitest";
import { createRepaymentAction, deleteRepaymentAction, removeRepaymentAllocationAction, replaceRepaymentAllocationsAction, undoRepaymentAllocationAction, updateRepaymentAction, type RepaymentActionState, type RepaymentAllocationActionState } from "./actions";
import { deletionImpactRevision, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError, RepaymentAllocationAmountInvariantError, RepaymentAllocationShareInvariantError, RepaymentAmountInvariantError, RepaymentFriendInvariantError } from "@/domain/ledger-repository";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getDatabase: vi.fn(),
  createLedgerRepository: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/server/authenticated-ledger", () => ({ getAuthenticatedLedger: async (session?: { user: { id: string } }) => { const current = session ?? await mocks.requireSession(); return { user: current.user, ledger: mocks.createLedgerRepository(mocks.getDatabase(), current.user.id) }; } }));
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const friendId = "11111111-1111-4111-8111-111111111111";
const revision = "a".repeat(64);
const initialState: RepaymentActionState = {
  fieldErrors: {},
  formError: "",
  values: { friendId: "", amountRupiah: "", paidAtLocal: "", timezoneOffsetMinutes: "", paymentMethod: "", notes: "" },
};
const initialAllocationState: RepaymentAllocationActionState = { fieldErrors: {}, formError: "", values: [] };

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

function allocationForm(rows: Array<{ expenseShareId: string; amountRupiah: string }>) {
  const formData = new FormData();
  for (const row of rows) {
    formData.append("expenseShareId", row.expenseShareId);
    formData.append("amountRupiah", row.amountRupiah);
  }
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
    const createRepaymentWithAllocations = vi.fn().mockResolvedValue({ id: "repayment-a" });
    const updateRepayment = vi.fn().mockResolvedValue({ id: "repayment-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations, updateRepayment });

    await expect(createRepaymentAction(initialState, form({ ...values, ownerUserId: "owner-b" }))).rejects.toThrow("redirect:/app/repayments/repayment-a?created=1");
    await expect(updateRepaymentAction("repayment-a", initialState, form(values))).rejects.toThrow("redirect:/app/repayments/repayment-a?saved=1");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createRepaymentWithAllocations).toHaveBeenCalledWith({ friendId, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", notes: "Received" }, []);
    expect(updateRepayment).toHaveBeenCalledWith("repayment-a", { friendId, amount: 84_000, paidAt: new Date("2026-01-02T02:30:00.000Z"), paymentMethod: "Bank transfer", notes: "Received" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments/repayment-a");
  });

  it("keeps contextual allocation inside the owner Trip and preserves the entered amount", async () => {
    const createRepaymentWithAllocations = vi.fn().mockResolvedValue({ id: "repayment-a" });
    const getTrip = vi.fn().mockResolvedValue({ id: "trip-a", name: "Bandung" });
    const getRepaymentFriendContext = vi.fn().mockResolvedValue({ option: { id: friendId, name: "Ari", archived: false }, outstandingAmount: 42_000, openExpenseShares: [{ id: "66666666-6666-4666-8666-666666666666", friendId, remainingAmount: 42_000 }] });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations, getTrip, getRepaymentFriendContext });
    const formData = form({ ...values, tripId: "55555555-5555-4555-8555-555555555555" });
    formData.append("expenseShareId", "66666666-6666-4666-8666-666666666666");
    formData.append("amountRupiah", "42000");

    await expect(createRepaymentAction(initialState, formData)).rejects.toThrow("redirect:/app/repayments/repayment-a?created=1&tripId=55555555-5555-4555-8555-555555555555");
    expect(getTrip).toHaveBeenCalledWith("55555555-5555-4555-8555-555555555555");
    expect(getRepaymentFriendContext).toHaveBeenCalledWith(friendId, true, "55555555-5555-4555-8555-555555555555");
    expect(createRepaymentWithAllocations).toHaveBeenCalledWith(expect.objectContaining({ amount: 84_000 }), [{ expenseShareId: "66666666-6666-4666-8666-666666666666", amount: 42_000 }]);
  });

  it("rejects a contextual allocation outside the selected Trip", async () => {
    const createRepaymentWithAllocations = vi.fn();
    const getTrip = vi.fn().mockResolvedValue({ id: "trip-a", name: "Bandung" });
    const getRepaymentFriendContext = vi.fn().mockResolvedValue({ option: { id: friendId, name: "Ari", archived: false }, outstandingAmount: 42_000, openExpenseShares: [{ id: "77777777-7777-4777-8777-777777777777", friendId, remainingAmount: 42_000 }] });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations, getTrip, getRepaymentFriendContext });
    const formData = form({ ...values, tripId: "55555555-5555-4555-8555-555555555555" });
    formData.append("expenseShareId", "88888888-8888-4888-8888-888888888888");
    formData.append("amountRupiah", "42000");

    await expect(createRepaymentAction(initialState, formData)).resolves.toMatchObject({ formError: "Trip context only allows allocations to this Trip's outstanding shares." });
    expect(createRepaymentWithAllocations).not.toHaveBeenCalled();
  });

  it("persists structured canonical and Other payment methods", async () => {
    const createRepaymentWithAllocations = vi.fn().mockResolvedValue({ id: "repayment-a" });
    const updateRepayment = vi.fn().mockResolvedValue({ id: "repayment-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations, updateRepayment });

    await expect(createRepaymentAction(initialState, form({ ...values, paymentMethodChoice: "GoPay", paymentMethodOther: "" }))).rejects.toThrow("redirect:/app/repayments/repayment-a?created=1");
    await expect(updateRepaymentAction("repayment-a", initialState, form({ ...values, paymentMethodChoice: "Other", paymentMethodOther: "Wallet" }))).rejects.toThrow("redirect:/app/repayments/repayment-a?saved=1");

    expect(createRepaymentWithAllocations.mock.calls[0]![0]).toMatchObject({ paymentMethod: "GoPay" });
    expect(updateRepayment).toHaveBeenCalledWith("repayment-a", expect.objectContaining({ paymentMethod: "Wallet" }));
  });

  it("rejects blank Other without touching persistence", async () => {
    const createRepaymentWithAllocations = vi.fn();
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations });

    const result = await createRepaymentAction(initialState, form({ ...values, paymentMethodChoice: "Other", paymentMethodOther: " " }));
    expect(result).toMatchObject({ fieldErrors: { paymentMethod: "Enter a custom payment method." }, paymentMethodForm: { choice: "Other", other: "" } });
    expect(createRepaymentWithAllocations).not.toHaveBeenCalled();
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

  it("binds allocation replacement to the session owner and canonical routes", async () => {
    const replaceRepaymentAllocations = vi.fn().mockResolvedValue({});
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ replaceRepaymentAllocations });
    const expenseShareId = "11111111-1111-4111-8111-111111111111";

    await expect(replaceRepaymentAllocationsAction("repayment-a", initialAllocationState, allocationForm([
      { expenseShareId: expenseShareId.toUpperCase(), amountRupiah: "84.000" },
      { expenseShareId: "22222222-2222-4222-8222-222222222222", amountRupiah: "" },
    ]))).rejects.toThrow("redirect:/app/repayments/repayment-a?saved=1");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(replaceRepaymentAllocations).toHaveBeenCalledWith("repayment-a", [{ expenseShareId, amount: 84000 }]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/repayments/repayment-a");
  });

  it("preserves the allocation page context when saving", async () => {
    const replaceRepaymentAllocations = vi.fn().mockResolvedValue({});
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ replaceRepaymentAllocations });
    const expenseShareId = "11111111-1111-4111-8111-111111111111";
    const formData = allocationForm([{ expenseShareId, amountRupiah: "84000" }]);
    formData.set("allocationQuery", "Dinner");
    formData.set("allocationPage", "2");

    await expect(replaceRepaymentAllocationsAction("repayment-a", initialAllocationState, formData)).rejects.toThrow("redirect:/app/repayments/repayment-a?saved=1&q=Dinner&page=2#repayment-allocations");
    expect(replaceRepaymentAllocations).toHaveBeenCalledWith("repayment-a", [{ expenseShareId, amount: 84000 }], { q: "Dinner", page: "2" });
  });

  it("parses repeated create allocations and preserves their values on invariant errors", async () => {
    const expenseShareId = "11111111-1111-4111-8111-111111111111";
    const createRepaymentWithAllocations = vi.fn().mockResolvedValue({ id: "repayment-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations });
    const formData = form(values);
    formData.append("expenseShareId", expenseShareId);
    formData.append("amountRupiah", "42000");

    await expect(createRepaymentAction(initialState, formData)).rejects.toThrow("redirect:/app/repayments/repayment-a?created=1");
    expect(createRepaymentWithAllocations).toHaveBeenCalledWith(expect.objectContaining({ amount: 84_000 }), [{ expenseShareId, amount: 42_000 }]);

    createRepaymentWithAllocations.mockRejectedValue(new RepaymentAllocationShareInvariantError());
    const failed = await createRepaymentAction(initialState, formData);
    expect(failed).toMatchObject({ formError: "An allocation cannot exceed the share's remaining balance.", allocations: [{ expenseShareId, amountRupiah: "42000" }] });
  });

  it("ignores the empty optional allocation placeholder from the native fallback", async () => {
    const createRepaymentWithAllocations = vi.fn().mockResolvedValue({ id: "repayment-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createRepaymentWithAllocations });
    const formData = form(values);
    formData.append("expenseShareId", "");
    formData.append("amountRupiah", "");

    await expect(createRepaymentAction(initialState, formData)).rejects.toThrow("redirect:/app/repayments/repayment-a?created=1");
    expect(createRepaymentWithAllocations).toHaveBeenCalledWith(expect.objectContaining({ amount: 84_000 }), []);
  });

  it("returns stable allocation field and invariant errors", async () => {
    const expenseShareId = "11111111-1111-4111-8111-111111111111";
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const replaceRepaymentAllocations = vi.fn();
    mocks.createLedgerRepository.mockReturnValue({ replaceRepaymentAllocations });

    const invalid = await replaceRepaymentAllocationsAction("repayment-a", initialAllocationState, allocationForm([{ expenseShareId, amountRupiah: "84.00" }]));
    expect(invalid).toMatchObject({ formError: "Please correct the marked fields.", fieldErrors: { [expenseShareId]: "Enter whole rupiah, such as 84000 or 84.000." } });
    expect(replaceRepaymentAllocations).not.toHaveBeenCalled();

    replaceRepaymentAllocations.mockRejectedValue(new RepaymentAllocationAmountInvariantError());
    expect((await replaceRepaymentAllocationsAction("repayment-a", initialAllocationState, allocationForm([{ expenseShareId, amountRupiah: "84000" }]))).formError).toBe("Allocated amount cannot exceed the repayment amount.");
    replaceRepaymentAllocations.mockRejectedValue(new RepaymentAllocationShareInvariantError());
    expect((await replaceRepaymentAllocationsAction("repayment-a", initialAllocationState, allocationForm([{ expenseShareId, amountRupiah: "84000" }]))).formError).toBe("An allocation cannot exceed the share's remaining balance.");
    replaceRepaymentAllocations.mockRejectedValue(new LedgerNotFoundError());
    expect((await replaceRepaymentAllocationsAction("foreign", initialAllocationState, allocationForm([]))).formError).toBe("This friend, repayment, or expense share is no longer available.");
  });

  it("removes an allocation immediately and revalidates every affected route", async () => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: "repayment-a:share-a", repaymentId: "repayment-a", expenseShareId: "share-a", friendId, amount: 40000 };
    const removeRepaymentAllocation = vi.fn().mockResolvedValue({ reversalReceipt: receipt, repaymentId: "repayment-a", expenseId: "expense-a", friendId });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ removeRepaymentAllocation });

    await expect(removeRepaymentAllocationAction("repayment-a", "share-a", { formError: "" }, new FormData())).resolves.toEqual({ formError: "", removalReceipt: receipt });
    expect(removeRepaymentAllocation).toHaveBeenCalledWith("repayment-a", "share-a");
    for (const path of ["/app", "/app/history", "/app/repayments", "/app/expenses", "/app/repayments/repayment-a", "/app/expenses/expense-a", `/app/friends/${friendId}`]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it("restores only through the authenticated owner and reports stale Undo safely", async () => {
    const receipt = { version: 1 as const, reversalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", allocationId: "repayment-a:share-a", repaymentId: "repayment-a", expenseShareId: "share-a", friendId, amount: 40000 };
    const undoRepaymentAllocation = vi.fn().mockResolvedValue({ repaymentId: "repayment-a", expenseId: "expense-a", friendId });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ undoRepaymentAllocation });

    await expect(undoRepaymentAllocationAction(receipt)).resolves.toEqual({ ok: true });
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(undoRepaymentAllocation).toHaveBeenCalledWith(receipt);
    for (const path of ["/app", "/app/history", "/app/repayments", "/app/expenses", "/app/repayments/repayment-a", "/app/expenses/expense-a", `/app/friends/${friendId}`]) {
      expect(mocks.revalidatePath).toHaveBeenCalledWith(path);
    }

    undoRepaymentAllocation.mockRejectedValue(new LedgerNotFoundError());
    await expect(undoRepaymentAllocationAction(receipt)).resolves.toEqual({ ok: false, message: "Undo unavailable: this allocation or a related record changed." });
  });

  it("requires exact deletion confirmation and revalidates the debtor friend", async () => {
    const deleteRepayment = vi.fn().mockResolvedValue({ friendIds: [friendId], repaymentIds: [] });
    const getRepaymentDeletionImpact = vi.fn().mockResolvedValue({ recordType: "repayment", allocationCount: 0, friendId });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ deleteRepayment, getRepaymentDeletionImpact });
    expect((await deleteRepaymentAction("repayment-a", { formError: "" }, form({ confirm: "delete,delete" }))).formError).toBe("Type delete to confirm.");
    expect((await deleteRepaymentAction("repayment-a", { formError: "" }, form({ confirm: "delete", impactRevision: "bad" }))).formError).toBe("Impact revision is invalid.");
    const duplicateRevision = form({ confirm: "delete", impactRevision: revision });
    duplicateRevision.append("impactRevision", revision);
    expect((await deleteRepaymentAction("repayment-a", { formError: "" }, duplicateRevision)).formError).toBe("Impact revision is invalid.");
    await expect(deleteRepaymentAction("repayment-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }))).rejects.toThrow("redirect:/app/repayments?deleted=1");
    expect(deleteRepayment).toHaveBeenCalledWith("repayment-a", { cascadeDependents: false, expectedImpactRevision: revision });
    expect(getRepaymentDeletionImpact).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/app/friends/${friendId}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/share/[token]", "page");
  });

  it("requires current repayment cascade confirmation", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const impact = { recordType: "repayment" as const, allocationCount: 2, friendId };
    const getRepaymentDeletionImpact = vi.fn().mockResolvedValue(impact);
    const deleteRepayment = vi.fn().mockRejectedValue(new LedgerDeletionConfirmationRequiredError(impact));
    mocks.createLedgerRepository.mockReturnValue({ deleteRepayment, getRepaymentDeletionImpact });
    const blocked = await deleteRepaymentAction("repayment-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }));
    expect(blocked).toMatchObject({ formError: "Review the dependent records and confirm their deletion.", impact, impactRevision: deletionImpactRevision(impact) });
    expect(getRepaymentDeletionImpact).not.toHaveBeenCalled();
    deleteRepayment.mockRejectedValue(new LedgerDeletionConfirmationRequiredError(impact, "impact_changed"));
    expect(await deleteRepaymentAction("repayment-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }))).toMatchObject({ formError: "The dependent records changed. Review the updated deletion impact and confirm again.", impact, impactRevision: deletionImpactRevision(impact) });
    deleteRepayment.mockResolvedValue({ friendIds: [friendId], repaymentIds: [] });
    const confirmed = form({ confirm: "delete", impactRevision: revision });
    confirmed.set("confirmCascade", "delete-dependents");
    await expect(deleteRepaymentAction("repayment-a", { formError: "" }, confirmed)).rejects.toThrow("redirect:/app/repayments?deleted=1");
    expect(deleteRepayment).toHaveBeenCalledWith("repayment-a", { cascadeDependents: true, expectedImpactRevision: revision });
  });
});
