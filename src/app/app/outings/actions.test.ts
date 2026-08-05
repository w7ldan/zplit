import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOutingAction, deleteOutingAction, updateOutingAction } from "./actions";
import type { OutingActionState } from "./actions";
import { LedgerNotFoundError, OutingDeletionInvariantError } from "@/domain/ledger-repository";

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
    }))).rejects.toThrow("redirect:/app/outings?created=outing-a");

    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(createOuting).toHaveBeenCalledWith({ title: "Dinner", occurredAt: new Date("2026-01-02T02:30:00.000Z"), notes: "Notes" });
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
    }))).rejects.toThrow("redirect:/app/expenses?q=Dinner&outing=outing-a&create=1#top");
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
    const deleteOuting = vi.fn().mockResolvedValue({ friendIds: [] });
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    mocks.createLedgerRepository.mockReturnValue({ deleteOuting });

    expect((await deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "yes" }))).formError).toBe("Type delete to confirm.");
    expect(deleteOuting).not.toHaveBeenCalled();
    await expect(deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "delete" }))).rejects.toThrow("redirect:/app/outings?deleted=1");
    expect(mocks.createLedgerRepository).toHaveBeenCalledWith("database", "owner-a");
    expect(deleteOuting).toHaveBeenCalledWith("outing-a");
  });

  it("maps the outing invariant and missing record to stable messages", async () => {
    mocks.requireSession.mockResolvedValue({ user: { id: "owner-a" } });
    mocks.getDatabase.mockReturnValue("database");
    const deleteOuting = vi.fn().mockRejectedValue(new OutingDeletionInvariantError());
    mocks.createLedgerRepository.mockReturnValue({ deleteOuting });
    expect((await deleteOutingAction("outing-a", { formError: "" }, form({ confirm: "delete" }))).formError).toBe("Move or delete this outing's expenses first.");
    deleteOuting.mockRejectedValue(new LedgerNotFoundError());
    expect((await deleteOutingAction("foreign", { formError: "" }, form({ confirm: "delete" }))).formError).toBe("This outing is no longer available.");
  });
});
