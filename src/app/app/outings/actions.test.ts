import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOutingAction, deleteOutingAction, updateOutingAction } from "./actions";
import type { OutingActionState } from "./actions";
import { deletionImpactRevision, LedgerDeletionConfirmationRequiredError, LedgerNotFoundError } from "@/domain/ledger-repository";

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
vi.mock("@/domain/ledger-repository", async () => {
  const actual = await vi.importActual<typeof import("@/domain/ledger-repository")>("@/domain/ledger-repository");
  return { ...actual, createLedgerRepository: mocks.createLedgerRepository };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

const initialState: OutingActionState = {
  fieldErrors: {},
  formError: "",
  values: { title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" },
};

function form(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.set(key, value);
  return formData;
}

describe("outing actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns validation errors before touching the repository", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createOutingAction(undefined, initialState, form({ title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" }));

    expect(state.formError).toBe("Please correct the marked fields.");
    expect(state.fieldErrors).toMatchObject({ title: "Title is required." });
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("binds create to the authenticated owner and redirects", async () => {
    const createOuting = vi.fn().mockResolvedValue({ id: "outing-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createOuting });

    await expect(createOutingAction(undefined, initialState, form({
      title: "  Dinner  ",
      occurredAtLocal: "2026-01-02T10:30",
      timezoneOffsetMinutes: "-480",
      notes: "  Notes  ",
      ownerUserId: "owner-b",
    }))).rejects.toThrow("redirect:/app/outings?created=outing-a&tz=-480");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createOuting).toHaveBeenCalledWith({ title: "Dinner", occurredAt: new Date("2026-01-02T02:30:00.000Z"), notes: "Notes", tripId: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/outings");
  });

  it("returns to Add expense with the created outing selected", async () => {
    const createOuting = vi.fn().mockResolvedValue({ id: "outing-a" });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ createOuting });

    await expect(createOutingAction("/app/expenses?q=Dinner&outing=old&create=0#top", initialState, form({
      title: "Dinner",
      occurredAtLocal: "2026-01-02T10:30",
      timezoneOffsetMinutes: "-480",
      notes: "",
    }))).rejects.toThrow("redirect:/app/expenses?q=Dinner&outing=outing-a&create=1&tz=-480#top");
  });

  it("keeps continuation validation errors inside the outing form", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    const state = await createOutingAction("/app/expenses", initialState, form({ title: "", occurredAtLocal: "", timezoneOffsetMinutes: "", notes: "" }));

    expect(state.formError).toBe("Please correct the marked fields.");
    expect(mocks.createLedgerRepository).not.toHaveBeenCalled();
  });

  it("maps a foreign update to the generic not-found form error", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ updateOuting: vi.fn().mockRejectedValue(new LedgerNotFoundError()) });

    const state = await updateOutingAction("outing-b", initialState, form({ title: "Outing", occurredAtLocal: "2026-01-02T10:30", timezoneOffsetMinutes: "0", notes: "" }));

    expect(state.formError).toBe("This outing is no longer available.");
    expect(state.formError).not.toContain("outing-b");
  });

  it("requires exact deletion confirmation and uses the canonical list redirect", async () => {
    const deleteOuting = vi.fn().mockResolvedValue({ friendIds: [], repaymentIds: [] });
    const getOutingDeletionImpact = vi.fn().mockResolvedValue({ recordType: "outing", expenseCount: 0, expenseTotal: 0, receiptCount: 0, shareCount: 0, allocationCount: 0, affectedRepaymentCount: 0, affectedRepaymentIds: [], affectedFriendIds: [] });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ deleteOuting, getOutingDeletionImpact });

    expect((await deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "yes" }))).formError).toBe("Type delete to confirm.");
    expect((await deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "delete", impactRevision: "bad" }))).formError).toBe("Impact revision is invalid.");
    const duplicateRevision = form({ confirm: "delete", impactRevision: revision });
    duplicateRevision.append("impactRevision", revision);
    expect((await deleteOutingAction("outing-a", { formError: "" }, duplicateRevision)).formError).toBe("Impact revision is invalid.");
    expect(deleteOuting).not.toHaveBeenCalled();
    await expect(deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }))).rejects.toThrow("redirect:/app/outings?deleted=1");
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(deleteOuting).toHaveBeenCalledWith("outing-a", { cascadeDependents: false, expectedImpactRevision: revision });
    expect(getOutingDeletionImpact).not.toHaveBeenCalled();
  });

  it("requires current cascade confirmation and preserves missing-record handling", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const impact = { recordType: "outing" as const, expenseCount: 1, expenseTotal: 100, receiptCount: 0, shareCount: 1, allocationCount: 1, affectedRepaymentCount: 1, affectedRepaymentIds: ["repayment-a"], affectedFriendIds: ["friend-a"] };
    const getOutingDeletionImpact = vi.fn().mockResolvedValue(impact);
    const deleteOuting = vi.fn().mockRejectedValue(new LedgerDeletionConfirmationRequiredError(impact));
    mocks.createLedgerRepository.mockReturnValue({ deleteOuting, getOutingDeletionImpact });
    const blocked = await deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }));
    expect(blocked).toMatchObject({ formError: "Review the dependent records and confirm their deletion.", impact, impactRevision: deletionImpactRevision(impact) });
    deleteOuting.mockRejectedValue(new LedgerDeletionConfirmationRequiredError(impact, "impact_changed"));
    expect(await deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "delete", impactRevision: revision }))).toMatchObject({ formError: "The dependent records changed. Review the updated deletion impact and confirm again.", impact, impactRevision: deletionImpactRevision(impact) });
    deleteOuting.mockResolvedValue({ friendIds: ["friend-a"], repaymentIds: ["repayment-a"] });
    const confirmed = form({ confirm: "delete", impactRevision: revision });
    confirmed.set("confirmCascade", "delete-dependents");
    await expect(deleteOutingAction("outing-a", { formError: "" }, confirmed)).rejects.toThrow("redirect:/app/outings?deleted=1");
    expect(deleteOuting).toHaveBeenCalledWith("outing-a", { cascadeDependents: true, expectedImpactRevision: revision });
    deleteOuting.mockRejectedValue(new LedgerNotFoundError());
    getOutingDeletionImpact.mockRejectedValue(new LedgerNotFoundError());
    expect((await deleteOutingAction("foreign", { formError: "" }, confirmed)).formError).toBe("This outing is no longer available.");
  });
});
